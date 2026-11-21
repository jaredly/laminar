# Plan: TypeScript Backend for Laminar

Status: **Draft, not started.** Unlike the C, Go, Zig, and planned Wasm
backends, this backend does **not** consume `ConcreteProgram`. It compiles
verified, generic typed IR (`TypedProgram`) into generic TypeScript, using one
uniform runtime representation for every lens and JavaScript closures for every
function value. Nothing in this plan has been checked against generated code
yet.

---

## 1. Objective and positioning

Emit a standalone, strictly typed ES module from `TypedProgram`. Type-check it
with `tsc`, run it under Node and Bun, and match `executeTypedProgram` on the
whole acceptance corpus. Then make the output useful to people outside this
repo: readable, generic, and importable from npm with ordinary TypeScript
signatures.

```text
Generic Typed IR (typed-ir.ts, lower-typed.ts, verify-ir.ts)
    ├──> eval-typed.ts   reference interpreter (the specification and test oracle)
    ├──> TS backend      src/ts/lower.ts → emitTs → tsc --noEmit → node / bun
    └──> specialize.ts → infer-representations.ts → concrete IR
            ├──> C   ├──> Go   ├──> Zig   └──> Wasm (planned)
```

### Why TypeScript

- **The broadest audience.** TypeScript and JavaScript run in every browser,
  in Node, Bun, and Deno, and in edge runtimes. Projects can import a compiled
  module without a native toolchain or a Wasm loader.
- **The compiler is already TypeScript.** The whole pipeline, from source to
  runnable module, can run in one process, including in a browser.
- **`tsc` is an extra type checker.** Generated code must type-check under
  `strict`, which checks the lowering independently.

### Why typed IR, with one uniform representation

The pipeline makes three kinds of decision:

1. **Semantic and resource decisions:** ownership, moves, loans, restoration
   order, cleanup, capture at construction. These are explicit in typed IR and
   don't depend on the target.
2. **Representation decisions:** thin vs. scattered lenses, separately typed
   read and write storage, callable slot tables, adapters, joins. C-family
   targets need these because they have fixed-size values passed by value and
   no runtime dispatch. They depend on concrete types, so they run after
   monomorphization.
3. **Physical layout:** specific to each target.

A target with garbage collection and closures needs only the first kind. The
evidence is `src/eval-typed.ts`, which already runs generic typed IR with no
representation analysis. It uses one lens interface:

```ts
type Lens = { peek(): Data; replace(value: Data): Data; finish(): void; project(path: number[]): Lens };
```

with `cell` for owned places, `project` for projections, `tupleLens` for
scattered lenses, and `scoped` for restoration that runs exactly once. Thin vs.
scattered is a performance specialization of that interface, not a semantic
distinction.

So this backend **compiles what the evaluator interprets**. The evaluator's
lens machinery becomes a small runtime library, each IR instruction becomes
the code the evaluator would run for it, and the evaluator is both the
specification and the differential oracle.

**What this gains:**

- Generic output. Laminar's polymorphic functions stay polymorphic in
  TypeScript, so there's no monomorphization blow-up and the output keeps
  definition names instead of SHA-derived instance names.
- No representation restrictions. Programs the concrete pipeline rejects
  (changing-specialization recursion, unsupported representation joins)
  should run here, because the evaluator runs them. Each such case needs a
  test before it's claimed.
- Much less backend code. There's no port of a 1,200-line concrete lowering.

**What it gives up:**

- Speed: every lens access goes through indirect calls, and writes through a
  projected lens rebuild the tuples along the path, just as in the evaluator.
  Phase 7 addresses this.
- This backend doesn't exercise concrete IR, so it adds no check on
  representation decisions. C, Go, and Zig still provide that.

### Not an evaluator fallback

The backend contract forbids passing a test by evaluating instead of running
generated code. Generated modules import only the runtime library in §3, never
an evaluator. The runtime library is written separately from `eval-typed.ts`,
not imported from it, so a bug shared by both can't hide behind the
differential test (§9 has the trade-off).

---

## 2. Pipeline position and options

Input: a `TypedProgram` that has passed `verifyTypedProgram`, as produced by
`checkTypedFile` or `Checker.lowerTyped`. The backend calls the verifier itself
before lowering and refuses unverified input.

There is no `TargetConfig`: typed IR has no layouts, ABIs, or target-keyed
caches. Options are a plain object:

```ts
type TsOptions = {
    checks: 'debug' | 'release';     // runtime checks, see §6
    runtime: 'inline' | 'import';    // inline the runtime, or import it from a package
    roots?: string[];                // units to export (Phase 6); default: the last expression
};
```

---

## 3. The runtime library

`src/ts/runtime.ts` is written once, by hand, as ordinary TypeScript, and
either inlined into each output module or imported from a package
(`@laminar/runtime` or similar, Phase 6). It contains:

- **`Lens<R, W>`**: `peek(): R`, `replace(value: W): R`, `finish(): void`,
  `project(path)`. Internally the storage is `unknown`. The type parameters are
  a typed facade, and each acquisition site creates one with the read and write
  types from the IR (§5).
- **`ref(get, set)`**: a lens over storage reached by closures. A JavaScript
  closure over a `let` variable is a reference to that variable, so a
  Laminar place can be an ordinary local and acquiring it is
  `ref(() => p, (v) => { p = v; })`. This is the fact that makes JavaScript a
  good fit despite having no pointers.
- **`project(lens, path)`**, **`tupleLens(items)`**, **`scoped(lens, close)`**,
  with the evaluator's semantics: projection reads and rebuilds immutable
  tuples, a tuple lens fans `replace` and `finish` out to its items, and
  `scoped` runs `close` exactly once after the inner lens finishes.
- **`EMPTY`**, a unique sentinel for moved-out places, and **`LaminarTrap`**,
  the error type for runtime traps and failed debug checks.
- **Natives:** `+ - * / == >= <= round dup print getInput charList heapsize`,
  and `fst` as a lens-returning native. Host effects (`print`, `getInput`)
  go through an injectable host object, so the browser, Node, and tests can
  each supply their own.
- **Debug checks** (§6), compiled out in release mode by a constant flag.

The library should stay small: a few hundred lines. Its size is a direct
measure of how much semantics lives at runtime rather than in generated code.

---

## 4. Mapping typed IR to TypeScript

Whether a value is a lens is static: an `IRValue` whose type has
`tag: 'flow'` is a lens, and a function type's arguments and result say which
parameters take lenses. The evaluator checks `isLens` at runtime; generated
code doesn't need to.

| Typed IR | Generated TypeScript |
| :--- | :--- |
| unit (`IRUnit`) with `definition` | a top-level `function`, generic over `signature.quantified`. Definitions are closed and reusable, like the evaluator's `reusable` functions. |
| expression unit | a block inside the module's `main()`; earlier expression results are discarded, as in the evaluator |
| `IRFunction` | a function or arrow function. `lensPlace` parameters have type `Lens<R, W>`; others have their value type. |
| value (`ValueId`) | a `const`, named from the value ID |
| place (`SlotRef.place`) | a `let` local. Name it from the binding records where possible. |
| `constant` | a literal; numbers go through `decodeNumber`; unit is `null` |
| `string` | a template literal |
| `tuple` | a readonly array literal |
| `construct` | a tagged object `{ tag: 'Name', items: [...] }` (§5) |
| `global` | a reference to the top-level function, or to a runtime native |
| `move` | read the place (projected by `path`) and, in debug mode, overwrite it with `EMPTY` |
| `acquire` | `project(ref(() => p, (v) => { p = v; }), path)`, typed as `Lens<R, W>` |
| `lens-tuple` | `tupleLens([...])` |
| `swap` | `const old = lens.replace(value); lens.finish();` |
| `call` | evaluate the arguments, call, then `finish()` each lens argument. If the result is a lens, wrap it in `scoped(result, () => finish lens arguments)` instead. Unit lens contents are materialized as `null` before the call, as in the evaluator. |
| `closure` | an arrow function. Each capture is first bound to a fresh `const` at construction, because JS closures capture variables, not values, and the contract moves captures at construction. |
| `scope` | a nested block |
| `case` | an `if / else if` chain of pattern tests, then `throw new LaminarTrap('unmatched-case')`. Each arm binds its pattern, runs its body, then runs `setup` cleanup; `restored` cleanup runs at once, or through `scoped` when the arm returns a lens. |
| `bind` | destructure into place locals |
| `borrow` | keep the lens under its loan name; `release` cleanup finishes it |
| `manual` | `scoped` over the frontend lens, whose `finish` runs the compiled cleanup block, disposes its result, then finishes the frontend |
| block `cleanup` | `drop-place` disposes the place; `release` finishes the loan; `restored` checks that the place is full (debug only) |

**Disposal has no observable effect under GC.** In the evaluator, `dispose`
walks a value, marks closures as used, and clears their captures. It does not
run restoration: closures can't capture borrowed storage, so disposal can't
reach a lens. In generated code, disposal therefore does nothing in release
mode. Debug mode keeps a disposal counter and an "already used" flag per
affine closure, so the existing `onDisposeClosure` tests have an equivalent.

**Places that are never acquired** are never read through a lens, so the
`ref` closure is unnecessary and they stay plain locals. That's a static
check over the unit, and it's the first optimization (Phase 2), not a later
one.

---

## 5. Types

| Semantic type | TypeScript |
| :--- | :--- |
| `Number` | `number` |
| `Bool` | `boolean` |
| `String` | `string` |
| unit (empty tuple) | `null` |
| tuple | `readonly [A, B, ...]` |
| type variable | a generic type parameter |
| function | `(a: A, b: Lens<R, W>) => C` from the flow types of its arguments and result |
| nominal type | a generated discriminated union, one member per constructor: `{ readonly tag: 'Cons'; readonly items: readonly [A, List<A>] }` |

**Where TypeScript can't follow.** A Laminar place can change type over its
lifetime (an `A/B` lens leaves `B` behind), and TypeScript can't type one
variable as `A` and later as `B`. Rules:

- A place whose type never changes gets its exact type.
- A place whose type changes is declared `unknown`; each `move` and
  `acquire` casts to the type the IR gives at that point.
- The `Lens<R, W>` facade is the only other cast, and it lives in the runtime.

Every cast comes from an IR type that the typed-IR verifier has already
checked, so `tsc` checks everything except those points. Phase 1 adds a test
that counts casts per sample, so growth in unchecked code is visible.

---

## 6. Debug and release checks

Typed IR is verified before lowering, so a correct backend never trips these.
They exist to catch backend bugs, and match the evaluator's runtime errors:

| Check | Evaluator | Debug | Release |
| :--- | :--- | :--- | :--- |
| Read from an empty place | `owned()` | yes | no |
| Restoration runs twice | `scoped` | yes | no |
| Affine closure used twice | `used` flag | yes | no |
| Tuple lens arity mismatch | `tupleLens` | yes | no |
| `restored` place is full | `cleanup` | yes | no |
| Unmatched case | `unmatched-case` | yes | yes (it's semantic) |

Tests run in debug mode. Release mode is what Phase 6 packages.

---

## 7. Output, strictness, and runner

- **Module shape.** One ES module: generated types, the runtime (inline or
  imported), top-level definitions, and `export function main()`.
- **Erasable syntax only.** Node runs `.ts` by stripping types, which rejects
  enums, namespaces, and parameter properties. Generated code and the runtime
  avoid them, and the type-check uses `erasableSyntaxOnly`, so one file runs
  under Node, Bun, and Deno, and `tsc` can also emit `.js` and `.d.ts`.
- **Compiler options.** `strict`, `erasableSyntaxOnly`, `isolatedModules`,
  `noImplicitReturns`. Leave `noUnusedLocals` / `noUnusedParameters` off.
  Emit a matching `tsconfig.json`.
- **Formatting.** `oxfmt` (already a dependency), which also catches syntax
  errors before `tsc`.

**Runner** (`src/ts/build.ts`). Stages:

1. `ts-format`: `oxfmt`.
2. `ts-check`: `tsc --noEmit`. The suite checks **all samples in one `tsc`
   run**, each as its own module in one temporary project, because `tsc`
   startup costs more than checking one small file.
3. `ts-runtime`: under Bun, `await import()` the module in-process; also run a
   subset with `node file.ts` as a subprocess, to cover Node's type stripping.
4. `ts-result`: compare with `executeTypedProgram` on the same `TypedProgram`.
   Compare the result value (through `encodeNumber` for special numbers) and
   the sequence of `print` calls recorded by the test host, so effect order is
   checked as well as the final value.

On failure the runner keeps the module, the `tsconfig.json`, and a
`build.json`, as the other runners do.

---

## 8. Phased roadmap

Gates name the existing sample sets. Because there are no representation
restrictions, each phase should also run samples that the concrete backends
skip or reject. Every sample must type-check and match the evaluator.

### Phase 0: Runtime, syntax, runner, fixture
`src/ts/runtime.ts`, `src/ts/syntax.ts` (the statement tree from the Go
backend), `emit.ts`, and `build.ts` with batched `tsc`. A hand-written fixture
in the shape lowering will produce: a place acquired through `ref`, a
projected and a tuple lens, a type-changing `Lens<A, B>`, a `scoped`
restoration, a closure with copied captures, and a discriminated union.
**Gate:** the fixture type-checks with the pinned `tsc`, runs under both Bun
and `node`, and each debug check fires when deliberately violated.

### Phase 1: Scalars, tuples, strings, definitions, generics
Constants, strings, tuples, native arithmetic, top-level generic definitions,
direct and recursive calls, and the cast-count test. Include a
changing-specialization recursion sample that `specialize.ts` rejects.
**Gate:** the phase-1 sample set used by the Zig plan, plus that sample.

### Phase 2: Places, lenses, swaps, loans
Place locals, `acquire` through `ref`, projection, `lens-tuple`, `swap`,
`borrow`/`release`, type-changing places, and the never-acquired-place
optimization. **Gate:** the lens and swap samples (`lexical-alias`,
`swap-order`, thin and scattered lens tests), `computedAliases`,
`borrowedPatternSamples`, `aggregateResultSamples`.

### Phase 3: Case, patterns, nominal data
Pattern tests, constructor patterns, generated union types, `setup` and
`restored` cleanup, and lens results from arms. **Gate:** `lensBranchSamples`,
`storageJoinSamples`, `aggregateJoinSamples`, `lensStorageJoinSamples`,
`nominalSamples`, `borrowedNominalSamples` (the nominal sample files are new
and still in progress in the working tree).

### Phase 4: Closures, first-class functions, returned lenses
Closures with copied captures, debug affine flags, first-class definitions,
natives as values, `fst`, lens-returning calls wrapped in `scoped`, and
callable joins. **Gate:** `callableStorageSamples`, `callableJoinSamples`,
`indirectCallSamples`, `capturedCleanupSamples`, `nativeJoinSamples`,
`lensResultSamples`, `callableFocusSamples`, `callableResultSamples`,
`abiMigrationSamples`.

### Phase 5: Manual restoration and full corpus
`manual`, as-lens patterns, and deferred restoration. **Gate:**
`manualRestorationSamples`, `aslensSamples`, `aslensNominalSamples`,
`deferredStorageSamples`, `demandSamples`, and the full `backendCorpus`, plus
the `test/typed-ir.test.ts` corpus cases.

### Phase 6: Export boundary, packaging, CI
- **Exports.** For each root, an exported function with its Laminar name and
  an ordinary generic signature. Following the backend contract, lens
  parameters and results don't cross the boundary at first.
- **Packaging.** The runtime as its own small package; `tsc` emits `.js`
  and `.d.ts`; a `laminar build --target ts file.lm` CLI entry.
- **CI.** A required job; it needs only Bun/Node and the pinned TypeScript, so
  these tests never skip.
- `docs/ts-backend.md`: the runtime, the type mapping and its casts, and the
  export boundary.

**Gate:** a sample npm consumer project imports a compiled module and
type-checks against its `.d.ts`.

**Possible follow-up:** with a uniform representation, a TypeScript caller
could pass its own `Lens` (for example, over an object property) into a
Laminar function. That would let lenses cross the host boundary, which the
contract currently forbids, so it needs a contract revision first.

### Phase 7: Performance
Benchmark against the evaluator and the C backend on the corpus, then, in
order of cost:

1. Local optimizations: inline the get/set for static projection paths;
   read and write the place directly when a thin lens doesn't escape its
   function.
2. **Representation specialization without type specialization.** Key
   `infer-representations.ts` variants by lens shape alone when the target
   erases types, and emit thin/scattered fast paths while keeping TypeScript
   generics. This reintroduces part of the representation layer, so only do it
   if profiling shows lens indirection matters.

---

## 9. Relation to the other backends

- **Different source, same corpus.** This backend shares the acceptance
  samples and the evaluator oracle with the concrete backends, but not their
  representation decisions. A sample that passes here and fails in C points at
  the concrete pipeline; one that fails here and passes in C points at this
  backend or its runtime.
- **Independent runtime.** Sharing one lens core between `eval-typed.ts` and
  the runtime would remove duplication but make the differential test weaker,
  because a bug in the shared core would affect both sides. Keep them separate.
  If they're ever merged, the concrete backends remain an independent check.
- **No fifth C-family port.** This backend shares no lowering code with
  C/Go/Zig/Wasm, so the porting-drift risk those plans list doesn't apply.

---

## 10. Files

```text
docs/ts-codegen-plan.md       this plan
docs/ts-backend.md            reference, after Phase 6
src/ts/runtime.ts             Lens, ref, project, tupleLens, scoped, natives, checks
src/ts/types.ts               semantic type → TS type, nominal unions
src/ts/syntax.ts              statement tree, printer, identifier/keyword escaping
src/ts/lower.ts               TypedProgram → TS module
src/ts/emit.ts                emitTs
src/ts/build.ts               oxfmt / batched tsc / import or node / compare
test/ts/phase0.test.ts        runtime and fixture
test/ts/execute.test.ts       acceptance corpus against executeTypedProgram
```

---

## 11. Risks

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Lens indirection is slow | Lens-heavy programs much slower than the C backend | Correctness first; never-acquired places stay plain locals from Phase 2; Phase 7 optimizations and shape specialization if profiling justifies them |
| Type-changing places need casts | Unchecked code hides lowering bugs | Casts only at `move`/`acquire` of type-changing places and in the runtime; cast-count test; types come from verified IR |
| Generated code and evaluator disagree on cleanup order | Wrong restoration order, silently | Compare recorded `print` effects, not just results; debug checks for double restoration and reads of empty places |
| Closure captures shared by reference | Captures see later writes | Bind every capture to a fresh `const` at construction; a regression sample that writes to a place after capturing it |
| Evaluator semantics depend on dynamic checks the compiler drops | Behaviour differs in release mode | Release mode drops only checks that verified IR guarantees; tests always run debug mode |
| `tsc` is slow per file | Slow test suite | One batched `tsc` run over all samples; execution is in-process |
| Node type stripping rejects some syntax | Module type-checks but won't run under `node` | `erasableSyntaxOnly`; Phase 0 runs the fixture under `node` |
| TypeScript version churn | Generated code stops type-checking | Pin the `tsc` version in tests; emit a conservative subset of TS |
| Deep recursion overflows the JS stack | Traps where native C succeeds | Report `RangeError` as a distinct runtime failure |
