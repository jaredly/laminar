# C backend: phases 4–5

`src/c/lower.ts` consumes independently verified concrete IR. It resolves logical
places, projections, thin/scattered lenses, typed storage versions, and restoration
into a statement tree. `src/c/storage.ts` retains logical cell/path identities
independently of C aggregate versions. `src/c/syntax.ts` only formats that tree; it does not infer
storage, inspect source, or execute language code. `emitC` composes these passes.
Building and running are separate operations in `src/c/build.ts`.

```ts
import { emitC } from '../src/c/emit.ts';
import { buildAndRun } from '../src/c/build.ts';

const source = emitC(concrete);
const results = await buildAndRun(source, {
    compiler: 'clang',
    optimize: true,
});
// For a concrete program compiled with wasm32Emscripten(actualVersion):
// buildAndRun(source, { compiler: 'emcc', wasm: true, node: 'node' });
```

The generated translation unit includes concrete scalar/record types, typed ABI
pointer declarations, prototypes, capture-free direct function bodies with the
opaque environment argument, and a test-only `main` adapter. Each expression
entry prints one JSON result line. Special doubles use the backend contract's
tagged number protocol. This is not a public host ABI.

The executable subset supports Number (`double`), Bool, inhabited unit, tuples,
first-match control flow, unmatched-case aborts, direct calls and recursion,
thin and recursively scattered lenses, moves, swaps and refills. Empty swap
results become unit without loading storage. Full swaps save the old value
before installing a replacement. Ordered IR temporaries sequence all effects.

Phase 5 gives each logical place a current typed storage version. A view retains
its logical cell and projection path; replacing a field updates that mapping,
rather than leaving aliases pointing into the old physical aggregate. Reads
reconstruct aggregates from the current component versions, preserving unaffected
fields with their original types. Branches merge versions through typed temporaries.
No layout sizes, offsets, union punning or incompatible pointer casts are used.

Each lens call adapts the caller's logical view into concrete typed read and
replacement backing. Homogeneous backing can share one typed buffer; different
layouts use independent buffers. Plain-result calls use stack backing and commit
output immediately afterward. Lens-result calls allocate backing on the heap:
that backing can outlive the call frame and stays owned until restoration.

A function returning a lens allocates a concrete residual context. Its read focus
is materialized in that context; only values referenced by deferred restoration
are captured. A generated function with the exact concrete restoration ABI accepts
the replacement, rebuilds the parent aggregate, runs deferred cleanup, writes the
parameter outputs, and releases the context. Nested returned calls retain heap
backing through the whole chain, copy outputs before releasing it, and restore
in source order. Native `fst` is an explicit logical projection; user-defined
lens functions execute real calls and typed restoration routines. Lexical alias
release uses the same cleanup path.

The entry adapter checks the number of live restoration/backing allocations is
zero. Allocation failure traps. Native sanitizers additionally detect invalid
access and double disposal, with stack-use-after-return detection enabled and
undefined behavior configured to stop execution.

Statically known, capture-free function values retain compile-time provenance,
including specialized higher-order parameters used by `map`. Their finite call
contracts select verified direct wrappers; no runtime code pointer is invoked.
Invocation-erased closures containing this subset's scalar/tuple captures preserve
the explicit capture moves and need no runtime destructor. The discarded-capture
refill test exercises this rule. Invoking captured closures, dynamic callable
joins, nominal/heap data, and unsupported native imports retain explicit backend
diagnostics. Executing captured closure bodies remains phase 6.

Implemented imports are numeric `+`, `-`, `*`, `/`, `==`, `>=`, `<=`, data `dup`,
and logical `fst`. `dup` of a computed focus restores that focus after copying it.
There is no evaluator fallback. Function roots with parameters need a future host
adapter, and borrowed lenses cannot escape the test entry boundary. Existing
checker restrictions still apply: matching borrowed scrutinees is unsupported,
and raw owned-local lenses cannot escape through function returns. Explicit manual
restoration may retain owned focuses in typed/legacy execution, but its physical
adapter is pending and reports `unsupported-representation`: “Manual restoration
requires a deferred-cleanup representation adapter”. No manual C/Wasm execution
is claimed. Lens-valued
branches normalize their focus into thin storage and retain a selector plus each
arm’s original restoration operation. Only the selected arm runs setup,
normalization, and cleanup. Deferred branch variables are initialized outside the
conditional and captured when a returned lens needs them; escaping call backing
remains heap-resident. Thin/scattered joins, nested local storage, selected setup
effects, and type-changing replacements execute on native C and Wasm. Persistent computed aliases retain their
focus and restoration operation until lexical release; thin, scattered, nested,
and type-changing cases are exercised by the execution harness.
Malformed concrete IR fails verification before storage lowering.

The harness uses strict C11 (`-Wall -Wextra -Werror -pedantic`), `-O0` and `-O2`.
Native tests additionally use ASan/UBSan and stack-use-after-return detection. It removes inherited host include-path
injection when spawning tools, so Emscripten uses its own sysroot. Failed builds,
traps, malformed results and expected-result mismatches retain their temporary
`laminar-c-*` directory, generated C/JS/Wasm, exact command arguments and observed
compiler/runtime versions. Successful runs remove their directories.

Run `bun test test/c` for the backend tests, `bun test` for all regressions, and
`bunx tsc --noEmit` for TypeScript checks. Missing local compiler/runtime tools
produce explicit execution skips; `CI` makes them failures. Tests copy the local
Emscripten cache to writable temporary storage when `EM_CACHE` is unset, removing
relocation-sensitive build files. Set `EM_CACHE` to an existing writable cache to
reuse it. The relocated Homebrew cache disables batch library builds to avoid
its relative-path issue; assertions are enabled for Wasm runs.

`.github/workflows/backend.yml` provisions Emscripten 4.0.23 from emsdk commit
`c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56` (the release mapping selects the
compiler build), Node 24.13.1, and Bun 1.4.2. The required job executes the full
native/Wasm corpus and uploads failure artifacts. This configuration is checked
in; remote CI execution and branch-protection requirements are not established
by local verification.

Complete expected C output for tuples, thin/scattered calls, returned lenses,
and branch version joins is inline in `test/c/print.test.ts`. Execution tests
compare typed IR, native and Wasm with the same expected results. In addition to
the phase-4 corpus, cases cover Number/Bool and small/large transitions, nested
mixed shapes, offset-changing aggregate reconstruction, `take`, `map`, native and
user-defined focus assignment, repeated and nested returned calls, alias refill,
discarded captures, computed-focus `dup`, branch changes, and empty/unit lenses.
Invoked captured closures and corrupt concrete artifacts retain negative tests.
