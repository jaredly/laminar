# Plan: Zig Backend for Laminar

Status: **Phase 1 done** (scalars, records, direct calls). Phase 0 is done
except the `target.ts` schema change, which has a stopgap (see Phase 0 below). A third consumer of `ConcreteProgram`, beside the C/Wasm
backend (`src/c/`) and the Go backend (`src/go/`). Like them, it begins at
verified concrete IR and does no semantic analysis, specialization, or
representation inference.

---

## 1. Objective and positioning

Emit standalone Zig source from `ConcreteProgram`, build it with a pinned Zig
toolchain, and reach parity with the C backend's executable subset (phases 4–6
plus returned lenses, callable joins, and scoped manual restoration).

```text
Concrete IR (concrete-ir.ts, lower-concrete.ts)
    ├──> C   (src/c/lower.ts   → emitC   → clang / emcc)
    ├──> Go  (src/go/lower.ts  → emitGo  → gofmt → go build)
    └──> Zig (src/zig/lower.ts → emitZig → zig fmt → zig build-exe)
```

### Why a Zig target, given `zig cc`

`zig cc` already compiles the existing C output, cross-compiles it, and targets
`wasm32-wasi` without Emscripten. If portability or a second Wasm path is the
only goal, use that: add a `zig-cc` compiler option to `src/c/build.ts`. That
is Phase 0a below and does not require this plan.

A native Zig target earns its cost by:

- **Being a third independent consumer of concrete IR.** Zig's strictness
  (no implicit conversions, explicit mutability, no shadowing) exposes places
  where concrete IR or the C lowering relies on C-specific leniency.
- **Checked execution without sanitizers.** Debug and ReleaseSafe builds trap on
  invalid optional unwraps, `unreachable`, and bad `@alignCast`. Zig's debug
  allocator reports leaks and double frees, so it covers most of what ASan and
  LSan do for the C backend, with no extra build profile.
- **Producing readable Zig** as an end product.

### Starting point: port C, not Go

Zig has manual memory, value structs, typed function pointers, an opaque data
pointer, and **no closures**. That is C's execution model. The Go backend
depends on GC and on function literals (for example, inline `restore: func(...)`
callbacks), and neither exists in Zig. So `src/zig/lower.ts` starts as a port of
`src/c/lower.ts` and keeps all of its disposal, context, and restoration
machinery. `src/c/storage.ts` (logical cells, views, versions) is target-neutral
and should be shared, not copied: move it to `src/backend/storage.ts` or import
it directly.

---

## 2. Mapping concrete IR to Zig

| Concrete IR | C backend | Zig backend |
| :--- | :--- | :--- |
| `f64` | `double` | `f64` |
| `bool` | `_Bool` | `bool` |
| `unit` | `struct { unsigned char inhabitant; }` | `struct {}` (zero-sized). Keep a one-byte inhabitant only if some ABI needs an addressable unit. |
| record | `struct L0 { double item0; ... }` | `const L0 = struct { item0: f64, ... };` |
| pointer | `T *` | `*T` |
| ABI | `R (*abiN)(void *, A0, ...)` | `const AbiN = *const fn (?*anyopaque, A0, ...) R;` |
| environment unpack | implicit `void *` conversion | `const env: *EnvN = @ptrCast(@alignCast(environment.?));` |
| null environment | `NULL` | `null` (`?*anyopaque`) |
| optional disposer | `if (x.dispose) x.dispose(x.environment);` | `dispose: ?*const fn (?*anyopaque) Unit` and `if (x.dispose) \|d\| _ = d(x.environment);` |
| `allocate_context` / `release_context` | `malloc` / `free` plus `live_contexts` | `allocator.create(T)` / `allocator.destroy(p)` through a global allocator, plus the same live counter |
| residual context | `void *` with a typed cast | `*Ctx` created per specialization, erased to `?*anyopaque` |
| trap | `abort()` | `@panic("laminar: ...")`; `unreachable` for verified-impossible arms |
| branch selector `int selected` | `int` | `u32` |
| test entry | `int main(void)` | `pub fn main() void` |

Contract notes:

- **Function pointers and data pointers stay separate.** The environment is
  always `?*anyopaque` and code is always a typed `*const fn`. `@ptrCast` is
  used only from `*anyopaque` back to the environment's concrete type, which
  meets the backend contract's ban on incompatible casts.
- **Allocation is typed.** `allocator.create(Ctx)` replaces `malloc(sizeof)`.
  `allocate_context` becomes a generic helper, for example
  `fn allocate(comptime T: type) *T`, which panics on OOM and increments
  `live_contexts`. `release_context` must recover the concrete type to call
  `destroy`, so every release site already knows its layout (the C lowering
  does too, because it casts before freeing).
- **Use a global allocator.** Generated functions keep the concrete ABI (no
  extra allocator parameter), so the backend uses a module-level
  `var gpa: std.heap.DebugAllocator(.{})` in debug builds and
  `std.heap.c_allocator` or `smp_allocator` in release builds. Before exiting,
  `main` asserts `live_contexts == 0` and that the debug allocator reports no
  leaks.

---

## 3. Strictness: the main engineering risk

The C emitter relies on `(void)x;` to silence warnings everywhere: locals,
parameters, `environment`, and results. Zig turns these into hard errors, and a
blanket discard is itself an error when the value is used:

| Zig rule | Effect on emission | Strategy |
| :--- | :--- | :--- |
| Unused local or parameter is an error | Same as Go | Discard where needed (below) |
| `_ = x;` when `x` is used elsewhere is an error ("pointless discard") | The C/Go habit of discarding everything defensively breaks | Do not emit `_ = x` for values. Use the address-discard idiom below. |
| A `var` that is never mutated is an error | Every C local is mutable by default | Emit every IR local as `var` followed by `_ = &x;` |
| Parameters are immutable | C code may assign into `argN` | Bind every parameter on entry: `var p0 = arg0; _ = &p0;`. This also counts as using the parameter. |
| Locals cannot shadow other locals | Nested blocks that reuse a name fail | The C lowering already uses per-function `fresh()` names (`v0`, `v1`, ...). Audit fixed names (`selected`, `out`, `back${i}`, `replacement`, `opaque`) and route them through `fresh()`. |
| No implicit numeric or pointer conversions | Literal `0`, `{0}`, `NULL`, and int/bool mixing fail | Emit typed zero values per layout (`std.mem.zeroes(T)` or explicit literals) and `null` for optionals |
| Top-level declarations are order-independent | Prototypes are unnecessary | Drop the C backend's declaration and prototype pass |

**Uniform-discard rule:** every emitted binding is `var name: T = expr;`
immediately followed by `_ = &name;`. Taking the address counts as a use and
as potential mutation, so it suppresses both "unused" and "never mutated"
errors. It is not a pointless discard, so it stays legal when the name is used
later. Phase 0 must confirm this on the pinned compiler, before any lowering
work, by compiling a fixture that covers each row of the table. If the idiom is
rejected, the fallback is a real use and mutability analysis over the IR. That
analysis would also yield `const` for read-only bindings and more idiomatic
output.

**Result-location aliasing.** Zig writes a struct literal directly into its
destination. `x = .{ .a = x.b, .b = x.a };` can therefore overwrite `x.a`
before it is read. The backend contract already requires sequencing through
temporaries, but any aggregate rebuild in which the destination's current
version is also an input must build into a fresh temporary and then assign.
Swaps, storage-version joins, and parent-aggregate reconstruction in restoration
routines are the places to watch. Add regression samples that rebuild a tuple
from its own permuted fields.

### Verified (Zig 0.17.0-dev.1902+896bd9e15, macOS arm64)

[`test/zig/fixtures/strictness.zig`](../test/zig/fixtures/strictness.zig) is
checked by [`test/zig/phase0.test.ts`](../test/zig/phase0.test.ts). It is written
in the shape `lower.ts` will emit, and builds and runs cleanly in Debug and
ReleaseSafe with `-lc`. Confirmed:

- `var x: T = e; _ = &x;` is accepted whether `x` is later used, unused, or
  mutated. `_ = x;` after a use is rejected ("pointless discard"), and the test
  pins that.
- Copying parameters into locals (`var p0 = arg0; _ = &p0;`) works. A parameter
  that is never read, such as `environment` in capture-free code, takes a plain
  `_ = environment;`.
- `?*anyopaque` environments, `@ptrCast(@alignCast(env.?))` unpacking, typed
  `*const fn` ABIs, `?Dispose` fields called via `if (x.dispose) |d|`, and
  zero-sized `Unit` all work.
- The `DebugAllocator` global (`= .init`), typed `allocate(T)` / `release(T, p)`,
  and the live counter work. Dropping one `release` makes the exit check panic,
  and the test pins that.
- libc `printf("%.17g")` printing works without touching `std.io`. So do
  `@"type"` keyword escapes.
- **Aliasing is real:** `x = .{ .a = x.b, .b = x.a }` yields `{2, 2}`, and the
  test pins this. Building into a temporary gives the correct `{2, 1}`.

The runner (`src/zig/build.ts`) and syntax module (`src/zig/syntax.ts`) now
exist. The target config change is deferred (see Phase 0).

---

## 4. Toolchain and output

- **Pin an exact Zig version.** The standard library's I/O and allocator APIs
  changed incompatibly across 0.14, 0.15, and 0.16, and the local install is
  `0.17.0-dev`. Record the version string in `TargetConfig.toolchain.version`
  and treat a mismatch as a configuration diagnostic. CI downloads a pinned
  release tarball by checksum (as it pins emsdk).
- **Keep generated code off `std.io`.** Build with `-lc` and have the test entry
  adapter print through `extern fn printf` / `fputs` / `putchar`. That mirrors
  `print_number` in the C backend exactly (NaN, ±Infinity, -0, `%.17g`) and
  isolates generated code from stdlib churn. Of the standard library, generated
  code uses only `std.heap` and `std.math` (`isNan`, `isInf`, `signbit`).
- **Formatting:** run `zig fmt --check` (or format in place) as an early syntax
  gate, like `gofmt` in the Go runner.
- **Build modes:** `Debug` by default in tests (safety checks plus the leak
  detector), and `ReleaseSafe` / `ReleaseFast` as options, analogous to the C
  runner's `optimize` flag.
- **Wasm:** use `zig build-exe -target wasm32-wasi`, run under Node's
  `node:wasi`. This is optional and comes after native parity (Phase 6).

---

## 5. Phased roadmap

Each phase's exit gate is the same filtered sample sets the Go plan used, run
through `test/zig/execute.test.ts`. Results are compared with
`executeTypedProgram` using the backend contract's JSON protocol.

### Phase 0a (optional, independent): `zig cc` for the C backend
Add `compiler: 'zig-cc'` to `src/c/build.ts` (`zig cc` with the same flags,
minus unsupported sanitizers). **Gate:** the existing C execute tests pass under
`zig cc` natively. Optionally also `-target wasm32-wasi` under `node:wasi`.

### Phase 0: Target, syntax, runner, and the strictness fixture
1. `src/backend/target.ts`: add `'zig'` to `abi` and to `toolchain.compiler`,
   a `'zig'` runtime, a validation rule (Zig ABI requires the Zig toolchain),
   and a `zigTarget(version, options)` helper matching `goTarget`.
2. `src/zig/syntax.ts`: the statement tree (`string | { head, body }`), a
   printer, and an `identifier()` that also rejects Zig keywords (`fn`,
   `const`, `var`, `error`, `type`, `test`, ...) or escapes them with `@"..."`.
3. `src/zig/build.ts`: `buildAndRunZig` modelled on `src/go/build.ts`, with
   stages `zig-fmt`, `zig-build`, `zig-runtime`, and `zig-result`. It keeps the
   temporary directory and writes `build.json` on failure.
4. **Strictness fixture:** a hand-written Zig file that uses the
   uniform-discard rule for a local that is used, one that is unused, one that
   is mutated, a copied parameter, `@ptrCast(@alignCast(...))` environment
   unpacking, and an optional disposer call. **Gate:** it compiles with zero
   errors on the pinned version, and the test fails loudly if a later Zig
   release breaks the idioms.

### Phase 1: Scalars, records, direct calls
Layouts, record structs, arithmetic and comparison intrinsics, special-float
printing, recursive tuple printing, and direct and self-recursive calls.
**Gate:** the Go plan's phase-1 corpus and arithmetic samples (`nan`,
`infinity`, `negative-zero`, `nested-tuple`, ...).

**Done.** `test/zig/execute.test.ts` passes 23 phase-1 samples on Zig 0.17-dev:
the Go phase-1 set, plus negative infinity, `0.1 + 0.2`, unit, multi-argument and
nested direct calls, tuple destructuring in `let` and in a parameter, and a
shadowed `let`. Two further tests check that lens updates and `match` raise
`unsupported-zig` rather than emitting partial code. Every sample is also checked
against `executeTypedProgram`. Notes:

- Phase 1 was built without touching existing non-Zig files, which forced two
  deviations from this plan:
  - **Target:** `src/zig/target.ts` exports a stopgap `zigTarget()`. It is a
    validated native `c11` config with triple `native-zig`, toolchain version
    `zig <version>`, and feature `zig-stopgap`. Concrete IR uses the target only
    for layout-table identity and cache keys, so this is enough for lowering.
    Replace it once `target.ts` accepts `abi: 'zig'`.
  - **Storage:** `src/zig/storage.ts` is a copy of `src/c/storage.ts` that holds
    expression trees instead of strings. Merge the two once the shared one can
    be made generic.
- Callable records give their pointer and code fields `= null` defaults.
  Indirect calls unwrap the entry with `.?`.

### Readable output

Lowering builds a small expression and statement tree (`src/zig/ast.ts`) rather
than strings. The printer runs a readability pass, `tidy`, over each function
body. The phase-0 idiom (`var x = e; _ = &x;`) is no longer emitted at all.
Today's output for `fn swap(p) {let (a, b) = p\n (b, a)}\nswap((1, true))`:

```zig
fn swap(p: Tuple_f64_bool) Tuple_bool_f64 {
    const a = p.item0;
    const b = p.item1;
    return .{ .item0 = b, .item1 = a };
}

fn entry() Tuple_bool_f64 {
    return swap(.{ .item0 = 1, .item1 = true });
}
```

- **Names:**
  - Functions, parameters, and locals use their source names. These come from
    `unit/definition/<name>/…` IDs and each IR unit's `bindings`, so no IR
    change was needed.
  - Shadowed bindings get suffixes (`x`, `x_1`), because Zig forbids shadowing.
  - A generic with several specializations gets parameter-type suffixes
    (`id_f64`, `id_bool`).
  - Types are `f64`, `bool`, `Unit`, `Tuple_f64_bool`, `Callable`, and `Abi`.
  - Locals avoid every top-level name.
- **Signatures:** capture-free code gets a plain signature. A separate
  `<name>_entry(environment, ...)` adapter carries the opaque-environment ABI
  for callable records.
- **Pruning:** only declarations reachable from `main` are printed, so unused
  layouts, ABIs, adapters, and native helpers disappear.
- **`tidy`:** values are never reassigned in phase 1, so every binding is
  `const`. Unused parameters print as `_`. The pass inlines unnamed temporaries
  without reordering effects:
  - A call result used once is inlined only past pure lets.
  - It is not inlined if a sibling call in the using expression could run
    before it. A call that encloses the use is fine, because arguments run
    first.
  - Unused call results become `_ = call;`.
  - Projections of struct literals fold to the field's value.
- **Literal arithmetic:** when both operands of an operator are bare number
  literals, the left one is wrapped in `@as(f64, …)` (e.g. `@as(f64, 1) / 0`).
  Untyped `1 / 0` would be a comptime_int error, while `f64` division by zero
  gives IEEE results even at comptime.
- `test/zig/readable.test.ts` pins the golden output and the pass's
  order-preservation rules.

Remaining readability work for later phases:
- `tidy` handles flat function bodies only. Phase 3 needs it to recurse into
  `if` arms and to treat phi assignments as `var`.
- Phase 2 should emit homogeneous thin lenses as plain `*T`.
- Field names are still `item0`/`item1`. Zig tuple types
  (`struct { f64, bool }` with `t[0]`) would read better, but they are
  anonymous, so equal layouts would need deduplicated declarations.

### Phase 2: Lenses, swaps, aliases
Shared `Storage`, thin lenses (`read: *R, replacement: *W`), scattered lenses,
move and swap lowering, lexical aliases, and subloans. Add the self-permuting
aggregate regression samples from §3. **Gate:** the lens and swap samples
(`lexical-alias`, `swap-order`, thin and scattered lens tests),
`computedAliases`, `borrowedPatternSamples`, and `aggregateResultSamples`.

### Phase 3: Control flow and version joins
First-match `if` / `else if` chains, `@panic` for unmatched cases, phi locals
declared before the arms (with `var` and an initial value), and storage and
cleanup joins. **Gate:** `lensBranchSamples`, `storageJoinSamples`,
`aggregateJoinSamples`, `lensStorageJoinSamples`, `nativeJoinSamples`.

### Phase 4: Callables and disposal
Structural callable records (erased environment, optional disposer, typed entry
fields), typed heap environments, capture copy-out followed by release on
invocation, generated recursive disposers, result adapters, and callable
joins. **Gate:** `callableStorageSamples`, `callableJoinSamples`,
`indirectCallSamples`, `capturedCleanupSamples`, and `abiMigrationSamples`, with
the debug allocator reporting no leaks.

### Phase 5: Returned lenses and manual restoration
Residual contexts created per specialization, exact typed restoration
functions, nested returned-call chains that keep heap backing alive, and staged
manual cleanup. **Gate:** `lensResultSamples`, `deferredStorageSamples`,
`callableFocusSamples`, `callableResultSamples`, `manualRestorationSamples`,
`aslensSamples`, `demandSamples`, and the full `backendCorpus`, with zero live contexts and no
allocator leaks.

### Phase 6: Parity, CI, Wasm
Run the full acceptance set concurrently with build slots, as in
`test/go/execute.test.ts`. Add a pinned Zig step to `.github/workflows/backend.yml`
that uploads `/tmp/laminar-zig-*` on failure. Optionally add a `wasm32-wasi`
profile. Write `docs/zig-backend.md` covering the ABI and its divergences from C.
**Gate:** zero failures across applicable suites, with Zig tests skipping
locally only when the toolchain is missing. In CI they are required.

---

## 6. Files

```text
docs/zig-codegen-plan.md      this plan
docs/zig-backend.md           reference, after Phase 6
src/backend/target.ts         'zig' ABI, toolchain, runtime, and zigTarget()
src/backend/storage.ts        shared Storage (moved from src/c/storage.ts)
src/zig/syntax.ts             statement tree, printer, identifier/keyword escaping
src/zig/lower.ts              ConcreteProgram → Zig (port of src/c/lower.ts)
src/zig/emit.ts               emitZig
src/zig/build.ts              zig fmt / build-exe / run
test/zig/phase0.test.ts       runner and strictness fixture
test/zig/execute.test.ts      acceptance corpus
```

---

## 7. Risks

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Unused, pointless-discard, and never-mutated errors | Every program fails to build | Uniform-discard rule, proved by the Phase 0 fixture. Fall back to use and mutability analysis if needed. |
| Struct-literal result-location aliasing | Silent wrong results in swaps and rebuilds | Build into a fresh temporary when the destination is an input. Add self-permutation regression samples. |
| Zig version churn | Generated code or the runner stops compiling | Exact pin in `TargetConfig` and CI, libc printing, minimal stdlib surface, and a fixture that fails loudly |
| Typed `destroy` needs the concrete type | Releasing erased contexts | Every release site already casts to its concrete layout, so emit `destroy` there. Disposers are generated per environment layout. |
| Keyword collisions in generated names | Build failures | `identifier()` escapes Zig keywords with `@"..."` |
| Compile latency (Zig debug builds of small units are slower than `go build`) | Slow test suite | Build slots, as in `test/go`. Build a cached `zig build-exe` once per sample, not via `zig run`. |
| Divergence between the C and Zig ports of `lower.ts` | Fixes made twice | Share `Storage` now. Later, consider lifting target-neutral lowering decisions (naming, sequencing, restoration order) into `src/backend/` with per-target printers. |
