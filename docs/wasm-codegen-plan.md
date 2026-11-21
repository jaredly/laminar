# Plan: Direct Wasm Backend for Laminar

Status: **Draft, not started.** This is the fourth consumer of `ConcreteProgram`,
beside C (`src/c/`), Go (`src/go/`), and Zig (`src/zig/`). Like them, it starts
from verified concrete IR and does no semantic analysis, specialization, or
representation inference. Nothing in this plan has been checked against a real
engine yet. Phase 0 exists to do that checking.

---

## 1. Objective and positioning

Emit a WebAssembly module directly from `ConcreteProgram`, as bytes produced in
TypeScript with no C compiler, Emscripten, or external assembler. Run it under
Node's `WebAssembly` API, and reach parity with the C backend's executable
subset.

```text
Concrete IR (concrete-ir.ts, lower-concrete.ts)
    ├──> C    (src/c/lower.ts    → emitC    → clang / emcc)
    ├──> Go   (src/go/lower.ts   → emitGo   → gofmt → go build)
    ├──> Zig  (src/zig/lower.ts  → emitZig  → zig fmt → zig build-exe)
    └──> Wasm (src/wasm/lower.ts → emitWasm → WebAssembly.Module)
```

### Why a direct Wasm target, given Emscripten

The C backend already runs on Wasm through `wasm32-unknown-emscripten`, and
`zig cc -target wasm32-wasi` would give a second route (Zig plan, Phase 0a). If
the goal is only to run on Wasm, those routes are enough. A direct emitter
earns its cost by:

- **Owning physical layout.** The backend contract defers sizes and offsets to
  the target C compiler, and says that "any offsets computed by Laminar must
  come from an explicit target data-layout model". There is no C compiler
  here, so this backend has to build that model. The model can then be checked
  against clang's own wasm32 layout (§4), which is a new cross-check for the
  C and Zig backends too.
- **A toolchain-free pipeline.** Check → typed IR → concrete IR → Wasm bytes →
  instantiate can all run in TypeScript. That makes a browser playground
  possible, and keeps tests from depending on a locally installed compiler.
- **Runtime enforcement of the ABI rules.** `call_indirect` checks the callee's
  function type on every call, and Wasm traps on a mismatch. The contract's
  rule against casting incompatible code pointers is enforced by the engine,
  not just by convention.
- **A path to a Wasm GC profile** (Phase 8). That profile forces lenses to work
  without pointers into the middle of a struct, which stress-tests the
  thin vs. scattered split from a new direction.

### Starting point: port C, through a folded instruction tree

Wasm has the C execution model: linear memory, manual allocation, typed
function indices, no closures. So `src/wasm/lower.ts` starts as a port of
`src/c/lower.ts`, keeping its disposal, context, staging, and restoration
machinery, and shares `Storage` from `src/c/storage.ts`.

C lowering builds expressions as nested C expression strings. Wasm is a stack
machine, but its *folded* form is an expression tree:
`(f64.add (local.get $a) (local.get $b))`. `src/wasm/syntax.ts` therefore
models folded instructions as a tree. Lowering composes trees the way C
lowering composes strings, and the encoder flattens them into stack order.
Keeping the port this close to C is what makes it tractable.

---

## 2. Target profile

Add to `src/backend/target.ts`:

| Field | Value |
| :--- | :--- |
| `triple` | `wasm32-unknown-unknown` |
| `pointerBits` / `byteOrder` | `32` / `little` (fixed by the Wasm spec) |
| `abi` | new `'wasm'` |
| `toolchain` | `{ compiler: 'laminar-wasm', version: <encoder schema version> }`. The "compiler" is our own encoder, so its version must change whenever the output format or layout model changes. |
| `runtime` | new `'wasm-node'` and `'wasm-browser'` |
| `features` | the Wasm proposals the module may use, e.g. `multi-value`, `bulk-memory`, `tail-call`. Different feature sets give different cache keys. |

Validation rules: the `'wasm'` ABI requires the `laminar-wasm` toolchain, the
`wasm32-unknown-unknown` triple, 32-bit little endian, and a `wasm-*` runtime.
Add a `wasmTarget(options)` helper like `goTarget`.

**Baseline features:** MVP plus multi-value, bulk memory, and mutable globals.
All are on by default in Node 24 and current browsers. `tail-call` is opt-in,
used for self-recursive tail calls (`return_call`). Recursion is Laminar's only
looping construct, so deep recursion will hit V8's stack limit, as it does for
the C/Emscripten path. Phase 0 records the exact Node version and confirms
every feature in use.

**No WASI.** Generated modules import only the host functions listed in §6. A
WASI profile can come later, separately.

---

## 3. Mapping concrete IR to Wasm

### Values: flattened, not memory-resident

Wasm has no aggregate value types. A value that never needs an address is
*flattened* into a sequence of core values, held in locals, parameters, and
multi-value results:

| Concrete layout | Flattened form | In memory (§4) |
| :--- | :--- | :--- |
| `f64` | `f64` | 8 bytes, align 8 |
| `bool` | `i32` (0/1) | 1 byte (`i32.load8_u` / `i32.store8`), matching C `_Bool` |
| `unit` | *nothing* (zero values) | 1 byte inhabitant, matching the C backend |
| record | each field's flattened form, in field order | C struct rules |
| `value` field | recurse | inline |
| `pointer` field | `i32` address | 4 bytes |
| `code` field | `i32` table index; `0` is null | 4 bytes (Emscripten also represents function pointers as table indices) |
| union | `i32` tag, then joined payload slots (below) | `uint32_t` tag, then C union rules |

**Union payload joining.** Variants flatten to different core types, so the
payload uses the Component Model's rule: slot *k* gets a type that holds every
variant's *k*-th value. Two `i32`s give `i32`; an `i32` and an `f64` give `i64`
via `i64.extend_i32_u` / `i64.reinterpret_f64`. Missing slots are zero-filled.
This is an early decision with real alternatives (for example, always keeping
unions in memory and passing pointers), so Phase 6 confirms it against
`nominalSamples` before building on it.

**Function signatures** are the flattened parameters followed by the flattened
result. So an ABI `(env, A0, A1) -> R` becomes
`(param i32 <A0...> <A1...>) (result <R...>)`. A unit result has no results.
Wasm's JS API limit is 1,000 parameters and 1,000 results; exceeding it is a
`BackendDiagnostic` (`wasm-signature-too-wide`), not a silent spill. Spilling
large aggregates to memory is an optimization to consider only if real
programs hit the limit.

**Storage fits flattening.** `Storage`'s `Data` is either a leaf expression or
an array of parts, and `split` breaks a record into its fields. For Wasm, a
leaf is a local (or a load from an address) and a record is an array of parts.
Most of the C backend's version and rebuild logic carries over unchanged.

### Places that need addresses: the shadow stack

C takes the address of stack locals for non-escaping lens backing
(`Backing name = {0}; ... .read=&name.field`). Wasm locals are not
addressable, so every *address-taken* backing lives in linear memory:

- **Non-escaping backing** gets a slot in a per-function frame on a shadow
  stack. A mutable global `$sp` grows downward. The prologue subtracts the
  frame size (aligned to 16) and the epilogue restores it. Lowering is
  structured and has no early returns, so one prologue and one epilogue per
  function are enough. A trap abandons the instance, so it never needs to
  unwind.
- **Escaping backing** (C's `allocate_context` path) is heap allocated, as in C.

Values that are never address-taken stay flattened in locals. This is the
same split the C compiler makes when it promotes locals to registers, but
here it is decided by lowering, from information it already has (`escapes`
and lens construction sites).

### Code, environments, and callables

| Concrete IR | C backend | Wasm backend |
| :--- | :--- | :--- |
| ABI `abiN` | `R (*)(void *, A0, ...)` | a type-section entry `(func (param i32 ...) (result ...))` |
| code / wrapper | function definition | function, plus an `elem` entry if its index is ever taken |
| code pointer value | function pointer | `i32` index into one `funcref` table; index 0 is a trapping null stub |
| indirect call | `x.entry(x.environment, ...)` | `call_indirect (type $abiN)` on the entry field. The engine traps if the type does not match. |
| direct call | `codeN(env, ...)` | `call $codeN` |
| environment | `void *` | `i32` address; `0` is null |
| environment unpack | implicit conversion | none needed: field loads use the concrete layout's offsets from the `i32` |
| optional disposer | `if (x.dispose) x.dispose(env)` | `(if (local.get $dispose) (then (call_indirect (type $dispose) ...)))` |

Code fields stay `i32` table indices rather than typed function references
(`ref.func` / `call_ref`), because callable records are stored in linear
memory (environments, backings, contexts), and references cannot be. The Wasm
GC profile (Phase 8) reverses this choice.

### Control flow, traps, and the rest

| Concrete IR | Wasm |
| :--- | :--- |
| `case` first-match chain | nested `if/else` with a block result type equal to the flattened phi type. Multi-value blocks use a type-section entry. |
| unmatched case / verified-impossible arm | `unreachable`, preceded by `call $trap (i32.const <code>)` so the host can report which trap fired |
| `abort()` (allocation failure, bad release) | the same `$trap` + `unreachable` pair |
| phi locals | locals declared up front. Every Wasm local starts at zero, so no explicit initializers are needed. |
| arithmetic/comparison intrinsics | `f64.add`, `f64.lt`, ...; `f64.eq` result is `i32` |
| `Math` natives | `f64.sqrt`, `f64.floor`, ... where Wasm has them; otherwise a host import |

**No result-location aliasing hazard.** Unlike Zig (§3 of the Zig plan),
flattened values are read onto the operand stack before any `local.set`, so
`x = (x.b, x.a)` cannot clobber itself. Memory-resident rebuilds still go
through a temporary: load every input before the first store. Reuse the Zig
plan's self-permutation regression samples.

---

## 4. The data-layout model

`src/wasm/layout.ts` computes size, alignment, and field offsets for every
`ConcreteLayout` that can be memory-resident. Rules (wasm32 C ABI as clang
implements it):

- `f64`: size 8, align 8. `bool`, `unit`: size 1, align 1. `pointer`, `code`,
  union tag: size 4, align 4.
- Record: fields in declared order, each at the next offset aligned to the
  field's alignment. Record alignment is the maximum field alignment, and size
  is rounded up to it. An empty record is size 1 (the C backend's one-byte
  inhabitant).
- Union: tag at 0, payload at the first offset aligned to the largest variant
  alignment. Payload size is the largest variant, and the total size is
  rounded up to the overall alignment.
- Pointer-recursive layouts are fine. By-value recursion is already rejected
  by the concrete-IR verifier.

The model is keyed by `targetKey`, so the contract's ban on deriving layout
from the build host holds. It lives in the backend, not in concrete IR. Concrete
IR stays free of offsets, and the C/Go/Zig backends keep deferring to their
compilers.

**Layout agreement test.** For every layout in the acceptance corpus, emit a C
probe that prints `sizeof`/`_Alignof`/`offsetof` for the C backend's struct.
Compile it with `emcc`, and compare with `layout.ts`. This is the one place the
Wasm backend uses a C toolchain, and only as an oracle. The test skips locally
without `emcc`, and is required in CI (which already pins emsdk). It catches
mistakes in either direction: a wrong model here, or a C backend struct that
does not match what concrete IR describes.

---

## 5. Runtime: allocator and contexts

The C backend calls `malloc`/`free` through `allocate_context` /
`release_context`, with a `live_contexts` counter checked at exit. The Wasm
module has no libc, so it carries a small runtime written directly in the
instruction tree (`src/wasm/runtime.ts`):

- **Memory map.** Address 0 is unused (so null is never a valid object), then
  static data, then the heap growing up, with the shadow stack at the top of
  the initial memory growing down. A collision between them traps.
- **Allocator.** `allocate(size, align) → i32` and `release(ptr)`. Every
  allocation size is known statically, so a segregated free list per size
  class (power-of-two classes up to a limit, plus a word-sized header holding
  the class) is enough. Bump allocation from the heap top handles misses,
  calling `memory.grow` when needed; failure traps. Freed blocks go back on
  their class's list.
- **Leak and double-free checks.** `allocate` increments a `$live` global and
  `release` decrements it. Releasing null or with `$live == 0` traps, exactly
  like C. A debug mode (default in tests) also poisons a freed block's header,
  so a second release of the same block traps. This covers part of what ASan
  and the Zig debug allocator catch.
- **Exit check.** The entry function traps if `$live != 0` after printing,
  matching the C `main`. `$live` is also exported, so tests can report the
  count.

---

## 6. Host interface and runner

**Imports** (module `laminar`):

| Import | Use |
| :--- | :--- |
| `print_number(f64)` | mirrors C `print_number`, including the tagged NaN / ±Infinity / -0 forms |
| `putchar(i32)` | brackets, commas, newline, as the C printer does |
| `trap(i32)` | records a trap code before `unreachable` |

**Exports:** `memory`, `main`, `live`.

The printer is ported from the C backend's `print` helpers (recursive tuples,
union and list printing), so the existing line-per-result JSON parsing in the
runner works unchanged. JS's shortest-round-trip number formatting differs
from `%.17g` textually, but the runner compares parsed JSON, so the values
agree.

**Runner** (`src/wasm/build.ts`, modelled on `src/go/build.ts`). Stages:

1. `wasm-encode`: lower and encode. Failures are lowering bugs.
2. `wasm-validate`: `new WebAssembly.Module(bytes)`. V8's validation message
   names the function and byte offset. The module carries a `name` section, so
   that function is a readable `$code…` name.
3. `wasm-runtime`: instantiate and call `main` inside a `try`. A
   `WebAssembly.RuntimeError` is reported with the last `trap` code.
4. `wasm-result`: compare with the expected results.

The runner runs in-process. There is no child process and no temporary
directory on success. On failure it writes `module.wasm`, `module.wat` (from
the WAT printer), and `build.json` to a temporary directory, like the other
runners. Because it runs in-process, it should be the fastest backend to test.

---

## 7. Encoding

`src/wasm/encode.ts` writes the binary format directly. The instruction subset
is small (core numeric ops, locals, globals, loads/stores, `call`,
`call_indirect`, `block`/`if`/`br`, `unreachable`, `memory.grow`, bulk memory),
so a hand-written encoder is a few hundred lines. It needs no dependency, it
works in the browser, and its output is deterministic. `src/wasm/print.ts`
prints the same tree as folded WAT, for debugging and snapshot tests.

Optional: if `wasm-tools` is installed, tests also run `wasm-tools validate`
and round-trip the WAT through `wasm-tools parse` to cross-check the encoder.
This step is never required.

---

## 8. Phased roadmap

Each phase's exit gate uses the same filtered sample sets as the Zig plan,
through `test/wasm/execute.test.ts`. Every result is compared with
`executeTypedProgram` using the backend contract's JSON protocol.

### Phase 0: Target, encoder, runner, and an engine fixture
1. `target.ts`: the `'wasm'` ABI, `laminar-wasm` toolchain, `wasm-*` runtimes,
   validation, and `wasmTarget()`.
2. `syntax.ts` (folded instruction tree), `encode.ts`, `print.ts`.
3. `build.ts` with the four stages above.
4. **Engine fixture:** a hand-built module covering: multi-value function
   results and `if` blocks, a typed `call_indirect` that succeeds and one with
   a mismatched type that traps, a null (index 0) entry that traps, shadow
   stack prologue/epilogue, `memory.grow`, `i32.load8_u` booleans, and the
   `name` section appearing in validation errors. **Gate:** it passes on the
   pinned Node version, and the test fails loudly if a feature is missing.
5. Record the Node version in the test output and in this plan, as the Zig
   plan does for Zig.

### Phase 1: Scalars, records, direct calls
`layout.ts` (sizes are unused yet, but the model and the layout agreement
test land now), flattened records, arithmetic and comparison intrinsics,
special-float printing, recursive tuple printing, and direct and
self-recursive calls. **Gate:** the Zig phase-1 sample set, plus the layout
agreement test.

### Phase 2: Lenses, swaps, aliases
Shared `Storage`, the shadow stack for non-escaping backing, thin lenses
(`read`/`replacement` addresses), scattered lenses, move and swap lowering,
lexical aliases, and subloans. Add the self-permuting aggregate samples.
**Gate:** the lens and swap samples (`lexical-alias`, `swap-order`, thin and
scattered lens tests), `computedAliases`, `borrowedPatternSamples`, and
`aggregateResultSamples`.

### Phase 3: Control flow and version joins
First-match `if/else` chains with multi-value block types, trapping unmatched
cases, phi locals, and storage and cleanup joins. **Gate:**
`lensBranchSamples`, `storageJoinSamples`, `aggregateJoinSamples`,
`lensStorageJoinSamples`, `nativeJoinSamples`.

### Phase 4: Allocator, callables, and disposal
The runtime from §5. The `funcref` table and `elem` segments, callable
records with an `i32` environment, optional disposer and entry indices, heap
environments, capture copy-out followed by release on invocation, generated
recursive disposers, result adapters, and callable joins. **Gate:**
`callableStorageSamples`, `callableJoinSamples`, `indirectCallSamples`,
`capturedCleanupSamples`, and `abiMigrationSamples`, with `$live == 0` and no
double-free traps.

### Phase 5: Returned lenses and manual restoration
Heap-allocated residual contexts per specialization, exact typed restoration
functions, nested returned-call chains that keep heap backing alive, and
staged manual cleanup. **Gate:** `lensResultSamples`, `deferredStorageSamples`,
`callableFocusSamples`, `callableResultSamples`, `manualRestorationSamples`,
`aslensSamples`, `demandSamples`, and the full `backendCorpus`.

### Phase 6: Nominal data and unions
Flattened tagged unions with joined payload slots (§3), boxed recursive
variants on the heap, generated `dup`/`drop`/`print` helpers ported from the
C backend, and list printing. Confirm or replace the payload-joining decision
here. **Gate:** `nominalSamples`, `borrowedNominalSamples`,
`aslensNominalSamples` (these sample files are new and still in progress in
the working tree).

### Phase 7: Parity, CI, and playground
Run the full acceptance set. Add a required CI job (it needs only Node, plus
emsdk for the layout agreement test). Add a browser entry point that runs the
whole pipeline in TypeScript and instantiates the module. Write
`docs/wasm-backend.md` covering the layout model, the flattening rules, and
the divergences from C. **Gate:** zero failures across applicable suites; the
Wasm tests never skip, because they need no external toolchain.

### Phase 8 (exploratory): Wasm GC profile
A separate `wasm-gc` feature and target key. Backing and environments become
GC structs, code fields become typed function references (`call_ref`), and the
allocator and `$live` disappear. Disposal then matters only for its restoration
semantics, not for freeing memory. The main question is lenses. Wasm GC has no
pointers into the middle of a struct, so a thin lens cannot be a raw address.
Candidates are: one mutable GC box per backed place (`(ref (struct (mut T)))`)
as the backing unit; or (struct ref, typed getter/setter pair) lenses. Write
this up as its own plan before starting. The finding about which lens shapes
need boxes is useful even if the profile is never shipped.

---

## 9. Files

```text
docs/wasm-codegen-plan.md     this plan
docs/wasm-backend.md          reference, after Phase 7
src/backend/target.ts         'wasm' ABI, toolchain, runtimes, wasmTarget()
src/wasm/syntax.ts            folded instruction tree, module structure
src/wasm/encode.ts            binary encoder
src/wasm/print.ts             folded WAT printer
src/wasm/layout.ts            wasm32 data-layout model
src/wasm/runtime.ts           allocator, shadow stack, trap helpers
src/wasm/lower.ts             ConcreteProgram → module (port of src/c/lower.ts)
src/wasm/emit.ts              emitWasm
src/wasm/build.ts             encode / validate / instantiate / compare
test/wasm/phase0.test.ts      encoder and engine fixture
test/wasm/layout.test.ts      layout agreement with emcc
test/wasm/execute.test.ts     acceptance corpus
```

---

## 10. Risks

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Layout model disagrees with clang wasm32 | Silent wrong offsets in memory-resident data | Layout agreement test against `emcc` from Phase 1; one model file, keyed by target |
| Union payload joining is the wrong choice | Rework in Phase 6 | Flagged as a decision; isolated in one flattening module; revisit before building on it |
| Fourth port of `src/c/lower.ts` (C, Go, Zig, Wasm) | Fixes made in four places; ports drift | Before Phase 2, consider lifting target-neutral decisions (staging, restoration order, sequencing, naming) into `src/backend/` with per-target instruction selection. The Zig plan already lists this. Wasm is the port where it pays off most, because the folded tree is the least like C text. |
| Encoder bugs | Confusing validation failures | `WebAssembly.Module` validation in every test, a `name` section, the WAT printer for failures, optional `wasm-tools` cross-check |
| Stack overflow in deep recursion | Traps where native C succeeds | Same limits as Emscripten; opt-in `tail-call` for self tail calls; report as a distinct runtime diagnostic |
| Feature support varies across browsers | Browser playground fails where Node works | Features are part of the target key; the baseline uses only widely shipped proposals; `tail-call` is opt-in |
| Shadow stack overflows into the heap | Memory corruption | Check `$sp` against the heap top in each prologue (debug mode) and trap |
| Allocator is too simple | Fragmentation or slowness on heap-heavy programs | Tests are small; keep the allocator behind `allocate`/`release` so it can be replaced |
