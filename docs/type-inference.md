# AST type inference

`src/check.ts` provides the checked compiler boundary. Inference runs on `ast.Linear` before `linearToExpr` produces IR. Existing low-level decomposition and evaluator APIs remain available for unchecked experiments.

```ts
import { Checker, checkFile } from '../src/check.ts';
import { printType } from '../src/types.ts';

// `ast` is a parsed Linear; `file` is a parsed File.
const checker = new Checker();
const checked = checker.check(ast);
console.log(printType(checked.type));
const ir = checker.lower(checked);

// For a named function, check, lower, then publish its scheme:
const definition = checker.define(namedFunction, optionalDeclaration);

// Check all file items before lowering any of them:
const compiled = checkFile(file);
```

`Checker.check` returns the inferred type, exported scheme, finalized occurrence types, resolved binding identities, and original AST. `lower` only accepts handles owned by that checker and lowers a snapshot of the checked source. `define` publishes a successful definition for subsequent source-order checks. Execution remains the caller's responsibility. For an execution driver, use `check`, `lower`, evaluate, then `publish` so failed evaluation does not register the definition. Global definitions cannot be replaced: runtime global name lookup would otherwise invalidate already checked call sites.

`checkFile` expects ordinary language file items, rather than alternating snapshot bodies/expected values. The snapshot runner supports `runSnapshot(raw, path, verbose, { checked: true })`; it checks both sides and their result types before evaluating either side. The legacy default remains unchecked because existing fixtures include unsupported lens forms and unchecked annotations that disagree with runtime results.

## Implemented

- First-order unification with occurs checks, rank-1 schemes, fresh instantiation, and stable type printing.
- Literals, tuples, homogeneous lists, registered constructors, pattern destructuring, functions, higher-order calls, monomorphic recursion, ordinary cases, and branch state joins.
- Declared signatures checked with rigid variables. A narrower declaration controls the exported scheme. Argument/return annotation syntax is supported; `Int` aliases JavaScript-style `Number`, and `~A` means `A/A`.
- Distinct value/lens modes and n-ary arity checks. Lens arguments must be final.
- Type-changing swaps, variable aliases, tuple aliases, tuple lenses, lens-returning functions, and computed lens assignments. Swaps return the previous value's type. Inference follows decomposition's lens setup order.
- Generalization of closed function lets whose free names are reusable definitions. Generalized definitions are immutable lens targets; application results and ordinary mutable storage are monomorphic.
- Structured `TypeDiagnostic` errors with a code and source location. No implicit `any` fallback.

`builtinTypes()` contains audited signatures for arithmetic, numeric comparisons, `round`, `heapsize`, `charList`, `fst`, and `dup`. `constructorTypes()` registers `nil` and `cons`. Supply additional closed schemes through `new Checker(environment, constructors)`; all free metavariables in external signatures must be quantified. Types/schemes are separate from parsed annotation syntax. Parameterized types such as `List<a>` are currently internal/printed types, without new surface annotation syntax.

## Current restrictions

Complex lens restoration remains explicit future work. Manual cleanup, `aslens`, lens cases, constructor alias patterns, and persistent aliases of computed lenses produce unsupported-form diagnostics. Returned lenses must be based on a lens parameter; local storage cannot escape. Closures capturing mutable local storage are rejected until capture effects are represented. Overlapping tuple lenses and changes to the owner of an active computed lens are rejected conservatively. Resource consumption, duplication, unused bindings, and exhaustiveness remain runtime checks or future analysis; a successful inference result does not establish static linearity.

Some existing functions declare a unit result but have a swap as their body. A checked signature must describe the old value returned by that swap, or the source must explicitly end with `()` to discard it. Existing snapshots were left intact for evaluator coverage.

Run `bun test test/infer.test.ts` for inference/checked integration tests, `bun test` for the full suite, and `bunx tsc --noEmit` for TypeScript checking. The design background and remaining restoration work are described in [the research note](type-inference-research.md).
