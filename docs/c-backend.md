# C backend: phase 4

`src/c/lower.ts` consumes independently verified concrete IR. It resolves logical
places, projections, thin/scattered lenses, and homogeneous restoration into a
statement tree. `src/c/syntax.ts` only formats that tree; it does not infer
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

Phase 4 supports Number (`double`), Bool, inhabited unit, tuples, first-match
control flow, unmatched-case aborts, direct calls and recursion, homogeneous
thin and recursively scattered lens parameters, moves, swaps and refills.
Empty swap results become unit without loading storage. Full swaps save the old
value before writing. Ordered IR temporaries sequence all effects. Homogeneous
restoration writes directly into caller storage; lexical release/drop operations
for this non-owning subset require no runtime continuation or destructor.
Restoration fields remain null and are never invoked by this subset.

Capture-free `make-callable` instructions retain static provenance until a direct
invocation chooses its verified wrapper/ABI. No environment is allocated. Calls
through parameters, local first-class callable moves, captured environments,
returned lenses, type-changing backing, nominal/heap data, and unsupported
native imports report `unsupported-c`. Phase 4 implements numeric `+`, `-`, `*`,
`/`, `==`, `>=`, `<=` and data `dup`; there is no host/evaluator fallback.
Function roots with parameters require a future host adapter. Expression roots
are executable now. Source errors and malformed concrete IR still fail in their
existing verifiers before emission.

The harness uses strict C11 (`-Wall -Wextra -Werror -pedantic`), `-O0` and `-O2`.
Native tests additionally use ASan/UBSan. It removes inherited host include-path
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

Complete expected C output for tuple, thin and scattered examples is inline in
`test/c/print.test.ts`. Execution tests compare typed IR, native and Wasm with the
same expected structured results, including recursion, temporary consumption,
full and nested swap ordering, fractional division, NaN, infinity and negative
zero. Later-phase restrictions and corrupt concrete artifacts have negative tests.
