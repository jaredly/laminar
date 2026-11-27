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
- Distinct value/lens modes and n-ary arity checks. Functions and calls take any number of lens arguments, in any position. Two arguments of one call may not borrow overlapping storage; elements of one vector count as overlapping.
- Type-changing swaps, variable aliases, tuple aliases, tuple lenses, lens-returning functions, and computed lens assignments. Swaps return the previous value's type. Inference follows decomposition's lens setup order.
- Top-level definitions are reusable polymorphic schemes. All local values, including function literals and local copies of top-level functions, are affine monotypes: they may be unused, but each stored value may be consumed at most once. Writing a new value replenishes the storage.
- Persistent aliases exclusively borrow their owner until scope exit. Nested aliases suspend access through the parent alias. Lens contents may be consumed, but every borrowed focus and lens parameter must hold a value when its lifetime ends.
- Closures move captured values when created, including values taken from aliases. Borrowing an outer variable inside a closure is rejected. A captured alias must be replenished before its enclosing alias scope ends.
- Branch joins track both types and availability: a value consumed on any branch is unavailable after the join until replenished.
- Structured `TypeDiagnostic` errors with a code and source location. No implicit `any` fallback.

`builtinTypes()` derives its audited signatures from the runtime import registry (`src/runtime-imports.ts`): arithmetic, numeric comparisons, `round`, `heapsize`, `charList`, `fst`, `dup`, `getInput` and `print`. `constructorTypes()` registers `nil` and `cons`. Supply additional closed schemes through `new Checker(environment, constructors)`; all free metavariables in external signatures must be quantified. Types/schemes are separate from parsed annotation syntax. Parameterized types such as `List<a>` are currently internal/printed types, without new surface annotation syntax.

## Current restrictions

Scoped restoration is supported for the documented forms. `aslens` accepts identifier, wildcard, tuple, constructor, and literal cleanup patterns; borrowed matches and constructor aliases use scoped same-constructor reconstruction. Branches producing lenses are checked with separate setup and restoration state joins; only the selected branch executes, and its pattern storage and cleanup remain live until restoration. The typed reference and legacy evaluators execute these branches. Representation and concrete lowering retain a selected-branch restoration adapter, and scalar/tuple branch cases execute on C/Wasm, including thin/scattered joins. Persistent aliases accept computed and tuple lenses, retaining an independent focus and deferred restoration while protecting their owners. Raw returned lenses must be based on a lens parameter. An `aslens` focus owns its backing until cleanup and disposal. Overlapping tuple lenses and overlapping changes to an active computed owner are rejected; disjoint sibling changes are permitted. Affine use and lens restoration are checked statically. Unused owned bindings are permitted; exhaustiveness and a stricter exactly-once resource discipline remain future work. Runtime checks remain in place.

Assignment returns the value currently in its target when the swap happens. If the RHS has already consumed that value, the empty slot has unit type: `fn inc(~x) { x := x + 1 }` therefore returns unit. Swapping a full slot, as in `fn take(~x) { x := () }`, returns its old type. This distinction is tracked separately from whether a slot contains an actual unit value. Existing unchecked snapshots remain available for evaluator coverage.

Run `bun test test/infer.test.ts` for inference/checked integration tests, `bun test` for the full suite, and `bunx tsc --noEmit` for TypeScript checking. The design background and remaining restoration work are described in [the research note](type-inference-research.md).

## Records

Records are structural and order-independent, with unique field names. There is no width
subtyping: `{x: Number}` and `{x: Number, y: Bool}` are different types. A row variable stands for
the fields a type does not list, so definitions can work on any record that has, or lacks, certain
fields.

| Expression | Needs of `m` | Result |
| --- | --- | --- |
| `{...m, name: v}` | no `name` | adds `name` |
| `{...m, name = v}` | `name` of the type of `v` | replaces its value |
| `{...m, -name}` | `name` | removes it |
| `{...m, -name = v}` | `name` | replaces value and type |
| `m.name`, `~m.name` | `name` | the field |

- `fn setName(m) { {...m, name = "Yes"} }` has scheme
  `({name: String, ...a}) => {name: String, ...a}`. Only top-level definitions are polymorphic.
- Items apply left to right. With several spreads, at most one may have unknown fields at that
  point (`unknown-spread`), and no two may share a field.
- Operands, and spreads that are not places, run first in source order. Spreads that are places
  (`m`, `m.inner`) are taken afterwards. So `{...m, -old, new: m.old}` moves one field to another
  name. A field emptied this way must be removed or replaced by the update.
- `name = v` keeps the field's type, including the type it had before being moved out.
- A dropped field needs `Droppable` (dual mode). So does the unknown remainder of a record when a
  pattern or function drops it.
- A pattern `{x, y: p}` matches a record with at least those fields. `{x, ...rest}` binds the
  others. A lens pattern leaves unnamed fields in place and cannot use `...rest`. A borrowed match
  with constructors still has to name every field of the records in it.
- Signatures write `{name: String, ...r}`, `{...r}` or `{x: Number, ..._}`, and type aliases can
  splice a parameter: `type Named(r) = {name: String, ...r}`. Labels a row must lack are not
  written. Those the types do not show print as `where a lacks tmp`, and a declared signature
  keeps whatever the body needs.
- Union constructors cannot hold open records yet.

Backends never see rows. Specialization substitutes them, then stores each record as the tuple of
its fields in name order, so one definition can get a different layout at each use. Natively an
empty record prints as unit does. The legacy decomposition supports only closed records with
complete patterns. See [the plan](row-polymorphic-records-plan.md).

## Vectors

`[:a, b, c:]` builds a homogeneous `Vector<a>` (`[::]` is `Vector<a>`),
`array(n, init)` makes one of length `n`, and `size(~v)` is its length. Elements
are only reached through an index lens: `dup(~v[i])`, `v[i] := x`, `f(~v[i])`,
`let x = ~v[i]`, and chains such as `v[i][j]`. A bare `v[i]` in value position is
rejected (`index-value`).

`src/normalize-vectors.ts` expands this syntax before inference, so the checked
snapshot, elaboration and typed IR contain only ordinary calls. `v[i]` becomes
`[](i, ~v)`, a lens-returning runtime import typed
`(Number, Vector<a>/Vector<a>) => a/a`, and a literal becomes
`[:push:]([:push:]([::](), a), b)`, evaluating items left to right. These import
names are not source identifiers, so definitions cannot shadow them. Because the
index lens reads and writes the element type, elements cannot change type or be
left empty, and the vector stays whole. As for any lens argument, the vector
lens is set up before the index is evaluated.

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

Elaboration retains temporary backing and the staged and cleaned states.
Typed lowering uses an `aslens` instruction, which transfers the final contents
out of backing at restoration. See [owned temporary lenses](aslens-core-ir.md).

## Borrowed patterns and constructor reconstruction

Borrowed matches, constructor alias lets, and constructor-pattern lens parameters
exclusively borrow the whole scrutinee while their field sublenses live. Each
constructor explicitly matched by the pattern is restored from the final fields.
Consumed fields must be refilled, including fields captured by ordinary closures.
Field type changes must satisfy the constructor signature. Unnamed fields remain
live and are preserved. Whole-owner replacement is allowed after the field scope,
and whole-value identifier patterns may themselves expose a whole-value alias.

Source normalization expands these forms into private owned matching and scoped
`aslens` restoration before inference. The checked source snapshot is the canonical
core expansion; the caller's AST is untouched. Elaboration and typed IR retain
selected-pattern and reconstruction-owner correspondence. Independent verification
checks tag/field preservation, restoration target, permissions, and storage lifetime.
Non-exhaustive patterns trap before the body. The checked legacy and detached typed
paths execute list patterns; C/Wasm additionally execute the supported scalar/tuple
borrowed-match subset. List/variant physical layout restrictions remain separate.

Compiler-generated reconstruction preserves the original owner's escape provenance.
Returning a field of an owned local list or tuple remains rejected. The detached
verifier enforces the same rule independently through reconstruction-owner capabilities.

## Inferred constraints

A top-level scheme can carry built-in predicates on its quantified parameters. Each
use instantiates the predicates along with the parameter types. This also applies
when a definition is used as a value, passed to a higher-order function, or
exported with a narrower declaration. `printScheme` renders inferred bounds
with `where`. There is no new annotation syntax.

| Predicate | Operation requiring it |
| --- | --- |
| `Display(a)` | Interpolating an expression of type `a` |
| `Comparable(a)` | Comparing two values with `==` or `!=` |
| `Copyable(a)` | Copying a value or binding it as shared in dual mode |
| `Droppable(a)` | Leaving an owned value unconsumed on a path in dual mode |

`fn label(x) { "${x}" }` has pure-mode scheme `(a) => String where Display(a)`.
String, Number, Bool, and tuples of displayable elements support interpolation.
Unit displays as `()`. For example, interpolating `(1, ("hi", true))` produces
`(1, ("hi", true))`, including the quotes. Nested strings escape quotes,
backslashes, interpolation openers and the control sequences understood by the
lexer. Interpolating a string directly preserves its contents. An interpolation
hole evaluates its expression once, with the ordinary ownership rules.

Equality inspects the payloads of every constructor in a union. A function
payload makes the union ineligible, including through recursive definitions.
A type parameter used only as a phantom imposes no comparison requirement.
