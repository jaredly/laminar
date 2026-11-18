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

Scoped restoration is supported for the documented forms. `aslens` accepts identifier, wildcard, tuple, constructor, and literal cleanup patterns; borrowed matches and constructor aliases use scoped same-constructor reconstruction. Manual restoration is checked and executed by typed/legacy reference paths; its tested scalar/tuple subset also executes on C/Wasm through staged restoration and retained contexts. Branches producing lenses are checked with separate setup and restoration state joins; only the selected branch executes, and its pattern storage and cleanup remain live until restoration. The typed reference and legacy evaluators execute these branches. Representation and concrete lowering retain a selected-branch restoration adapter, and scalar/tuple branch cases execute on C/Wasm, including thin/scattered joins. Persistent aliases accept computed and tuple lenses, retaining an independent focus and deferred restoration while protecting their owners. Raw returned lenses must be based on a lens parameter. An explicit manual restoration contract can retain owned focus storage until cleanup and disposal; an unmarked pointer into owned local storage still cannot escape. Overlapping tuple lenses and overlapping changes to an active computed owner are rejected; disjoint sibling changes are permitted. Affine use and lens restoration are checked statically. Unused owned bindings are permitted; exhaustiveness and a stricter exactly-once resource discipline remain future work. Runtime checks remain in place.

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

The [generic typed IR path](typed-ir.md) is now available through `checker.lowerTyped(checked)` and `checkTypedFile(file)`. It has its own verifier and reference interpreter, while `Checker.lower` and `checkFile` continue to use the original pointer IR.

## Manual restoration

`@(focus, cleanup)` sets up its frontend once. At restoration it first exposes
the final focus contents, evaluates cleanup, invokes it with zero arguments,
disposes its owned result, then runs the frontend's deferred restoration. Nested
manual cleanups consequently run outer cleanup before inner cleanup. A zero-argument
function literal in this position is a scoped cleanup body: it may borrow lexical
storage until restoration finishes. It is not an ordinary escaping closure, and
nested or ordinary function values retain the existing borrowing restrictions.
Other cleanup expressions are evaluated at restoration and must produce an owned
zero-argument function with an owned result.

Cleanup dependencies remain protected alongside the focus. The scoped cleanup body reads or consumes its values when it executes. Existing
owned callback values retain their ordinary construction-time captures and are
invoked and consumed at restoration. Cleanup can change owner types, or consume an owned temporary focus;
lens parameters must still be fully restored at the enclosing lifetime boundary.
Manual restoration explicitly retains owned frontend storage and its enclosing
scope's disposal obligation, allowing an owned focus to survive a function return
without exposing raw dead local storage. The serialized typed artifact retains a
`manual` instruction, its frontend capability, dependency references, and a
deferred cleanup block. Missing dependency protection and removed restoration
effects are independently rejected before execution.

Manual cleanup cannot access an owner whose computed frontend still has pending
restoration. Typed verification permits disjoint sibling updates during manual
cleanup using path-sensitive revision guards. Inference also tracks writes by
logical path during computed-lens setup, callee/argument evaluation, and assignment
RHS evaluation. Disjoint sibling updates, including type changes, are accepted;
overlapping ancestor/descendant writes still invalidate the computed owner even
if the final type is unchanged. Branch joins merge revision counters per path.
C/Wasm lowering supports the
tested scalar/tuple manual subset, including returned focuses and selected-branch
staging, without an evaluator fallback. Known captured cleanup callbacks execute in the tested C/Wasm subset; callable
focus storage retains its separate backend restriction.

## Pattern-bound temporary focuses

`~{lens pattern <- value
 cleanup}` evaluates `value` once into owned backing.
At restoration it stages the replacement, then binds `pattern` to the final
contents and runs `cleanup`. The pattern describes the replacement type and shape,
which may differ from the initial value. Identifier, wildcard, tuple, constructor, and literal patterns are supported.
Constructor/literal constraints match the final contents at restoration; an
unmatched pattern traps before the cleanup body. Owned field bindings may be
consumed without reconstructing the constructor. Nominal physical-layout
restrictions remain separate from checking and reference execution.

Cleanup variables own the temporary contents and may consume or refill them.
Borrowed lexical storage retains its ordinary refill requirements. Cleanup lexical
dependencies remain exclusively protected until restoration ends; ordinary and
nested escaping closures retain their capture restrictions. Cleanup results and
unused cleanup-local contents are disposed once. Raw local lens escapes remain
rejected; this form retains its own backing through restoration and enclosing disposal.

Elaboration retains temporary backing and staged/cleaned/restored phases alongside
manual restoration records. Typed lowering uses an owned scope and the existing
`manual` capability: cleanup moves the final contents into owned pattern bindings
only at restoration. Detached typed execution and independent verification cover
these capabilities, and the shared scalar/tuple corpus executes through C/Wasm's
existing retained-context adapter. This is subset coverage, not general nominal
or callable focus support.

## Borrowed patterns and constructor reconstruction

Borrowed matches, constructor alias lets, and constructor-pattern lens parameters
exclusively borrow the whole scrutinee while their field sublenses live. Each
constructor explicitly matched by the pattern is restored from the final fields.
Consumed fields must be refilled, including fields captured by ordinary closures.
Field type changes must satisfy the constructor signature. Unnamed fields remain
live and are preserved. Whole-owner replacement is allowed after the field scope,
and whole-value identifier patterns may themselves expose a whole-value alias.

Source normalization expands these forms into private owned matching and scoped
manual restoration before inference. The checked source snapshot is the canonical
core expansion; the caller's AST is untouched. Elaboration and typed IR retain
selected-pattern and reconstruction-owner correspondence. Independent verification
checks tag/field preservation, restoration target, permissions, and storage lifetime.
Non-exhaustive patterns trap before the body. The checked legacy and detached typed
paths execute list patterns; C/Wasm additionally execute the supported scalar/tuple
borrowed-match subset. List/variant physical layout restrictions remain separate.

Compiler-generated reconstruction preserves the original owner's escape provenance.
It does not grant the owned-retention permission of an explicit manual lens:
returning a field of an owned local list or tuple remains rejected. The detached
verifier enforces the same rule independently through reconstruction-owner capabilities.
