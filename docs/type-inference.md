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

`Checker.check` returns the inferred type, exported scheme, finalized occurrence types, immutable binding records, and a frozen, identified AST snapshot. The original caller-owned AST remains untouched. `types` and `bindings` use objects from the checked snapshot as keys. `lower` only accepts handles owned by that checker and lowers a snapshot of the checked source. `define` publishes a successful definition for subsequent source-order checks. Execution remains the caller's responsibility. For an execution driver, use `check`, `lower`, evaluate, then `publish` so failed evaluation does not register the definition. Global definitions cannot be replaced: runtime global name lookup would otherwise invalidate already checked call sites.

`checkFile` expects ordinary language file items, rather than alternating snapshot bodies/expected values. The snapshot runner supports `runSnapshot(raw, path, verbose, { checked: true })`; it checks both sides and their result types before evaluating either side. The legacy default remains unchecked because existing fixtures include unsupported lens forms and unchecked annotations that disagree with runtime results.

## Implemented

- First-order unification with occurs checks, rank-1 top-level schemes, fresh instantiation, and stable type printing.
- Literals, tuples, homogeneous lists, registered constructors, pattern destructuring, functions, higher-order calls, monomorphic recursion, ordinary cases, and branch state joins.
- Declared signatures checked with rigid variables. A narrower declaration controls the exported scheme. Argument/return annotation syntax is supported; `Int` aliases JavaScript-style `Number`, and `~A` means `A/A`.
- Distinct value/lens modes and n-ary arity checks. Lens arguments must be final.
- Type-changing swaps, variable aliases, tuple aliases, tuple lenses, lens-returning functions, and computed lens assignments. Swaps return the previous value's type. Inference follows decomposition's lens setup order.
- Top-level definitions are reusable polymorphic schemes. All local values, including function literals and local copies of top-level functions, are affine monotypes: they may be unused, but each stored value may be consumed at most once. Writing a new value replenishes the storage.
- Persistent aliases exclusively borrow their owner until scope exit. Nested aliases suspend access through the parent alias. Lens contents may be consumed, but every borrowed focus and lens parameter must hold a value when its lifetime ends.
- Closures move captured values when created, including values taken from aliases. Borrowing an outer variable inside a closure is rejected. A captured alias must be replenished before its enclosing alias scope ends.
- Branch joins track both types and availability: a value consumed on any branch is unavailable after the join until replenished.
- Structured `TypeDiagnostic` errors with a code and source location. No implicit `any` fallback.

`builtinTypes()` contains audited signatures for arithmetic, numeric comparisons, `round`, `heapsize`, `charList`, `fst`, and `dup`. `constructorTypes()` registers `nil` and `cons`. Supply additional closed schemes through `new Checker(environment, constructors)`; all free metavariables in external signatures must be quantified. Types/schemes are separate from parsed annotation syntax. Parameterized types such as `List<a>` are currently internal/printed types, without new surface annotation syntax.

## Current restrictions

Complex lens restoration remains explicit future work. Manual cleanup, `aslens`, lens cases, constructor alias patterns, and persistent aliases of computed lenses produce unsupported-form diagnostics. Returned lenses must be based on a lens parameter; local storage cannot escape. Overlapping tuple lenses and changes to the owner of an active computed lens are rejected conservatively. Affine use and lens restoration are checked statically. Unused owned bindings are permitted; exhaustiveness and a stricter exactly-once resource discipline remain future work. Runtime checks remain in place.

Assignment returns the value currently in its target when the swap happens. If the RHS has already consumed that value, the empty slot has unit type: `fn inc(~x) { x := x + 1 }` therefore returns unit. Swapping a full slot, as in `fn take(~x) { x := () }`, returns its old type. This distinction is tracked separately from whether a slot contains an actual unit value. Existing unchecked snapshots remain available for evaluator coverage.

Run `bun test test/infer.test.ts` for inference/checked integration tests, `bun test` for the full suite, and `bunx tsc --noEmit` for TypeScript checking. The design background and remaining restoration work are described in [the research note](type-inference-research.md).

## Backend elaboration

Every successful check now includes `checked.elaboration`, the revision-1 serializable backend DTO defined in `src/elaborated.ts`. `Checker.check` structurally verifies it before issuing a lowering handle. It retains namespaced node/binding/place identities, definition-use edges, explicit type instantiations, annotated-contract/body correspondence, captures, borrow scopes, storage transitions, function regions, and branch availability snapshots. Empty storage is distinct from an initialized unit value. Generic source typing is still independent of target layout.

```ts
const checker = new Checker(undefined, undefined, 'my-module');
const checked = checker.check(ast);
const metadata = checked.elaboration;
console.log(metadata.instantiations, metadata.transitions);
const serialized = JSON.stringify(metadata); // IDs survive serialization/cloning.
```

`checkFile` accepts the unit ID as its fourth argument. Supply unique unit IDs when combining independently checked units. Named definitions have stable identities within a unit; anonymous expressions use check-order ordinals. Cross-edit incremental identity is not promised. The previous low-level `Inferencer.infer` API also returns an elaboration, with an optional construction context for callers managing their own definition IDs.

`Solver.instantiateWithArguments` exposes the quantified-variable substitution alongside the instantiated type; `instantiate` retains its previous convenience API. Binding records and elaboration metadata do not expose the checker's mutable roots or borrow sets. `verifyElaboration` checks structural references/regions and escaped type variables; it is not the future typed-IR verifier or a proof of compiler correctness. See [backend progress](backend-progress.md) for the current implementation boundary.
