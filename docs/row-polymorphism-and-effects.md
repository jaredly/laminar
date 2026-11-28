# Implementation specification: row-polymorphic records and algebraic effects

## 1. Objective and scope

Extend the existing Hindley–Milner (HM) inference engine with two related but semantically distinct row systems:

- **Records:** Gaster–Jones-style extensible records, unique labels, explicit lacks constraints, order-independent row unification.
- **Effects:** Koka-style open effect rows with scoped duplicate labels, shared ambient effect unification, and elimination of one effect occurrence by a handler.

Preserve rank-1 let-polymorphism and the existing inference architecture (W, J, levels, or constraint-based inference as appropriate). Do not introduce general subtyping, arbitrary row union, or a general qualified-type solver solely for these features. General polymorphic record concatenation is out of scope for the initial implementation.

This is an implementation proposal, not a description of the existing repository. Inspect the parser, AST, type representation, unifier, generalizer, runtime record operations, and effect-handler implementation before making changes. Adapt names and syntax to existing conventions; do not replace working HM machinery unnecessarily. Examples use JavaScript-like surface syntax and illustrative type notation, not a mandated annotation grammar.

## 2. Required record semantics

```javascript
let x = {a: 1}
let y = {...x, b: 2}

let withName = (m) => {...m, name: "Yes"}
let setName = (m) => {...m, name = "Yes"}
let withoutName = (m) => {...m, -name}
let replaceName = (m) => {...m, -name = "Yes"}
```

| Syntax | Requirement on input | Result |
|---|---|---|
| `name: v` | name absent | Add name with type of v |
| `name = v` | name present with type of v | Preserve field type, replace value |
| `-name` | name present with any type | Remove name |
| `-name = v` | name present with any type | Replace value and possibly type |

Operations construct new records, not in-place mutations. Other fields are preserved. Fields are unique, and record types are exact up to row permutation; closed record types do not imply width subtyping. Compound operations are evaluated and typed left to right, subject to the language's existing expression evaluation rules. A field label is statically known; computed keys are not part of this feature.

### 2.1. Type notation and expected schemes

`{name: T | r}` denotes a record with a known field and an unknown remainder. `{r}` wraps a row as a value type. `r # name` means the row lacks that label. `{}` is a closed empty record. All variables in the following schemes are universally quantified unless explicitly bound by the environment.

```text
x           : {a: Int}
y           : {a: Int, b: Int}
withName    : forall r. (r # name) => {r} -> {name: String | r}
setName     : forall r. (r # name) => {name: String | r} -> {name: String | r}
withoutName : forall a r. (r # name) => {name: a | r} -> {r}
replaceName : forall a r. (r # name) => {name: a | r} -> {name: String | r}
getName     : forall a r. (r # name) => {name: a | r} -> a
```

These signatures omit effects for readability. Once effects are enabled, pure record operations do not impose a nonempty effect requirement. Lacks constraints may be printed explicitly or represented by the kind/metadata of quantified row variables; they must never be discarded.

### 2.2. Core typing rules

Use label-indexed primitives or equivalent direct inference rules. `l` is a fixed syntactic label, not a quantified first-class label.

```text
select_l   : forall a r.   r # l => {l: a | r} -> a
extend_l   : forall a r.   r # l => ({r}, a) -> {l: a | r}
update_l   : forall a r.   r # l => ({l: a | r}, a) -> {l: a | r}
restrict_l : forall a r.   r # l => {l: a | r} -> {r}
replace_l  : forall a b r. r # l => ({l: a | r}, b) -> {l: b | r}
```

Desugar compound spreads into primitive operations where convenient, preserving single evaluation of the base and each value expression. Heterogeneous replacement is equivalent to restriction then extension at the type level. Homogeneous update intentionally checks type preservation.

## 3. Representation and invariants

Use distinct kinds, even if the underlying variable representation is shared:

```text
Kind = Type | RecordRow | EffectRow
Type = ... | Record(RecordRow) | Function(args, EffectRow, result)
RecordRow = Empty | RowVar | Extend(label, Type, RecordRow)
EffectRow = Empty | EffVar | Extend(effectLabel, EffectArgs, EffectRow)
```

A normalized record row can be represented as a map of labels to types plus an optional unbound tail. An effect row can use a map from effect constructor identity to an ordered list of occurrences, plus an optional tail. Alternatively, use linked extensions and rewrite-based unification. Never use a set or a single-entry map for effect labels: multiplicity matters, and occurrences with the same label retain their relative order. Different labels commute. Effect constructor identities should be resolved names, not ambiguous source strings; parameter types are unified on matched occurrences, not used as speculative keys for reordering.

Both kinds need empty rows, fresh variables, substitution/dereferencing, occurs checks, levels (if applicable), free-variable collection, instantiation and generalization. A variable of one kind cannot be bound to another. Only record-row variables carry lacks constraints.

All normalized record prefixes are unique; the tail must lack every prefix label. Maintain this invariant at construction, normalization, and binding. Traverse field types and effect parameters in occurs checks, not just tails. Preserve any rigid/skolem distinctions already present in the compiler.

## 4. Record lacks solver

Maintain `forbidden` on each unbound record row variable (or an equivalent predicate environment). For a normalized row `(fields, tail)`:

```text
requireLacks(row, label):
    row = normalize(row)
    if label in row.fields: fail DuplicateField(label)
    if row.tail is flexible: add label to tail.forbidden
    if row.tail is rigid: require label is provably forbidden by its assumptions
    # closed tail: succeeds

bindRecordVar(v, row):
    dereference v; normalize row
    if row is exactly v: return
    require v flexible and row of correct kind
    occursCheck(v, row)
    for label in v.forbidden: requireLacks(row, label)
    for label in row.fields: requireLacks(row.tail, label) if tail exists
    lowerLevelsAsNeeded(v, row)
    bind v to row
```

When aliasing two flexible variables, union their forbidden sets on the surviving representative. If one is rigid, only bind the flexible variable if all requirements follow from the rigid variable's assumptions. Never silently strengthen a skolem. If the engine backtracks or speculates, trail mutations to forbidden sets as well as variable links.

Example:

```text
r # name
r := {age: Int | s}
=> s # name, s # age
s := {name: Bool}    # reject
```

Generalized schemes must snapshot the forbidden labels of quantified row variables. On each instantiation, create independent fresh variables with those same constraints; occurrences of the same quantified variable within one instantiation share a single fresh variable. Non-generalized variables retain identity and their constraints. Apply the existing environment/level-based generalization rules to all kinds.

## 5. Row unification

### 5.1. Shared normalized-prefix algorithm

For normalized rows `L = (A, l)` and `R = (B, r)`, match common labels and unify payloads. For records, each label has at most one occurrence. For effects, match occurrences of each label in order, from the outermost known occurrence; the surplus is the unmatched suffix for that label. Do not match occurrences by searching for compatible parameter types.

Let `LA` and `RB` be the unmatched left and right prefixes. The residual equation is `LA | l ~ RB | r`.

| Tail situation | Action |
|---|---|
| Both closed | Both residual prefixes must be empty |
| Left closed, right flexible | RB must be empty; bind r to LA with closed tail |
| Right closed, left flexible | LA must be empty; bind l to RB with closed tail |
| Same tail representative | Both residual prefixes must be empty; otherwise fail |
| Distinct flexible tails | Introduce fresh t; bind l to RB \| t and r to LA \| t |
| One rigid tail, one flexible | Require the flexible side's residual prefix empty; bind its tail to the other residual prefix plus rigid tail |
| Distinct rigid tails, or rigid versus closed | Fail unless the normalized equation is already equal under assumptions |

Optimize the empty-residual case by ordinary variable aliasing. Apply record lacks checks for record bindings; effect bindings have no lacks constraints. For example:

```text
{a: Int | r} ~ {b: Bool | s}
r := {b: Bool | t}
s := {a: Int | t}
t # a, t # b

<Console | e> ~ <State | f>
e := <State | t>
f := <Console | t>
```

**Implementation caution:** Unifying matched payload types can itself instantiate row tails or other payloads. Re-dereference and normalize after payload unification before deciding residual bindings; if row structure changed, restart/decompose the equation again. Recheck before each binding, and use the standard unifier to solve newly generated equations rather than overwriting existing links. The table is a mathematical decomposition, not safe imperative code without these steps. Fresh variables must have appropriate levels and scope; ensure both resulting bindings pass occurs/escape checks. See the scoped-label unification reference for an alternative rewrite-based implementation.

### 5.2. Multiple record spreads

If supported, spreads are disjoint extensions (not JavaScript overwrite semantics). Closed + closed and one open row + closed rows are straightforward: union the known disjoint fields, impose lacks constraints on the one open tail. Reject overlapping fields. Preserve source evaluation order.

```javascript
let a = {x: 1}
let b = {y: true}
let c = {...a, ...b}             // {x: Int, y: Bool}
let addBoth = (m) => {...a, ...m, ...b}
// forall r. (r # x, r # y) => {r} -> {x: Int, y: Bool | r}
```

Two independently unknown tails require a concatenation relation not expressible by ordinary row equality and lacks alone. Do not accidentally unify the tails or discard one. Either initially support only one spread syntactically, or defer restricted multi-spread constraints until relevant types are resolved and reject unresolved joins at generalization. The restricted feature is not full principal inference for arbitrary concatenation; document that limitation. Record transformers provide a useful alternative. Effects do not require this feature.

## 6. Koka-style effect typing

An effect row is a latent capability requirement of a function. A computation need not perform every permitted effect. It differs from a data record, which must actually contain all declared fields. Effects use scoped duplicate labels, not idempotent set union.

Notation: `() -><Console | e> A` is a thunk returning A with a Console requirement plus ambient remainder e; `<>` is a closed total/pure effect row. A computation judgment is `Gamma |- expr : T ! e`. Distinguish immediate evaluation effects from latent function effects.

### 6.1. Ambient-row inference

The recommended implementation is bidirectional in the effect argument while retaining HM inference for value types. `infer(expr, env, ambient)` infers the expression's value type while constraining a shared ambient row. Equivalent implementations can synthesize fresh open expression effect rows and unify them, provided they obey the same rules.

- Literals and variable lookup impose no immediate effect constraint. Instantiate a variable's scheme normally; any effects in its function type remain latent.
- A lambda expression is immediately pure. Allocate a fresh effect row for its body, infer the body under that row, and attach the resulting row to the function type. Do not unify the body's effects with the enclosing expression's ambient effects merely because the lambda was created.
- Application evaluates the callee and arguments in the current ambient row. Unify the callee's function type with `Function(argTypes, ambient, freshResult)` (subject to the closed-effect policy below). This includes effects from the actual call, not just argument evaluation.
- A block, conditional, record construction, or other eager composite evaluates its immediate subexpressions in a shared ambient row; branch value types are unified where required. An effect performed in either branch must be permitted. Do not close the ambient row for an empty block or literal.
- An operation of effect E, with fixed signature `Args -> Result`, constrains ambient to `<E | freshTail>` and checks its arguments. Parameterized effects instantiate their effect parameters consistently with the operation signature.
- Top-level definitions and explicit pure annotations must follow the existing execution model; do not default open latent effects to empty at every let binding.

```text
inferLambda(params, body, env):
    args = freshTypeVars(params)
    latent = freshEffectVar()
    result = infer(body, env + params:args, latent)
    return Function(args, latent, result)

inferCall(callee, arguments, env, ambient):
    fn = infer(callee, env, ambient)
    args = [infer(arg, env, ambient) for arg in arguments]
    result = freshTypeVar()
    unify(fn, Function(args, ambient, result))
    return result
```

These snippets assume exact equality for already inferred open latent rows. If explicit closed annotations are supported, the application boundary needs the policy in section 6.4. Preserve language-specific arity/currying rules.

### 6.2. Motivating example

```javascript
let f = (g, h) => { g(); h() }
```

Assuming the last expression is the result:

```text
f : forall a b e.
    (() -><e> a, () -><e> b) -><e> b
```

Here `<e>` is shorthand for the row variable e itself. The two invocations share the body's ambient row. With independently generalized functions:

```text
g : forall r. () -><Console | r> Unit
h : forall s. () -><State | s> Int
```

Instantiating them at the call and unifying with e yields:

```text
<Console | r> ~ <State | s> ~ e
r := <State | t>
s := <Console | t>
e := <Console, State | t>
f(g,h) : Int ! <Console, State | t>
```

No union constraint or solver is required. Calling two Console computations in the same ambient row normally requires just one Console occurrence. A pure callback with a polymorphic effect row unifies with the effectful callback as well.

### 6.3. Duplicate labels and handlers

Unlike record rows, effect rows permit repeated labels. For example, `<Console, Console | e>` has two scoped occurrences. It is not equal to `<Console | e>` in general. Duplicates represent scoped handling/forwarding structure, not how many times an operation executes. In particular, `<Console | e> ~ <Console>` forces e to `<>`; treating rows as idempotent sets would also admit e = `<Console>`, destroying the simple unification property.

For an ordinary deep handler with handled effect E, a useful core type is:

```text
handleE : forall a b e.
    (() -><E | e> a, HandlerClauses(a,b,e)) -><e> b
```

Here `HandlerClauses` is explanatory notation, not a required runtime type. For a monomorphic effect with operation `op : P -> Q`, check:

- Handled computation under `<E | e>`, returning A.
- Return clause parameter of type A; clause body returns B under e.
- Operation clause parameter of type P; deep resumption has type `Q -><e> B`; clause body returns B under e.
- All clauses agree on B and the residual effect row e. Parameterized effects share their instantiated parameters between the handled occurrence and clauses.

The handler expression itself runs in the outer ambient e (account separately for eager evaluation of any handler operands). An ordinary deep handler removes one occurrence, not all occurrences. For example:

```text
input:  <Console, Console, State | t>
output: <Console, State | t>
```

Do not add a `lacks E` constraint to e. Effects performed by the handler clauses themselves must remain visible in e; e.g. a Console handler implemented using an IO effect produces an IO requirement. A handler may also handle an action that never performs E if its latent effect row is flexible enough to unify with `<E | e>`.

Specify runtime handler semantics separately: nearest matching handler, whether clauses execute outside the handled scope, deep vs shallow resumptions, forwarding/masking, and one-shot vs multi-shot continuation restrictions. The above assumes deep handlers, with clauses outside the handled scope and resumption reinstating it. A bypass/mask operation, if supported, needs an explicit typing and runtime rule; duplicates alone do not implement forwarding. Do not infer a handler as a mere record deletion at runtime.

### 6.4. Closed effect rows and precision

Shared-row unification is not the same as a general union or subeffecting system. For example, two explicitly closed callback types `() -><Console> Unit` and `() -><State> Unit` cannot unify under bare equality. Even a closed pure callback cannot unify with a closed nonempty row.

For the first implementation, use open latent effect rows by default and retain their polymorphism at generalization. Define explicit closed annotations as exact equality checks unless the language already provides a sound effect adjustment/weakening mechanism. Document that this restricted policy can reject otherwise safe compositions of closed or monomorphic callback values. Do not silently reopen every closed row: doing so inside arbitrary nested types or across rigid annotations can break intended guarantees. If closed annotations must compose ergonomically, implement and test an explicit effect-opening/adjustment rule at the appropriate boundaries using the Koka literature; this is a separate feature from row equality.

Shared rows can also lose precision:

```javascript
let f = (g, h) => { g(); h(); return g }
```

```text
f : forall a b e.
    (() -><e> a, () -><e> b) -><e> (() -><e> a)
```

The returned g appears to have the shared effects, including effects only required by h. A union/subeffect system could preserve separate effect variables, but is deliberately not the initial design. Higher-order arguments passed monomorphically may likewise become constrained by multiple uses. Do not promise unrestricted principal inference across future weakening, higher-rank polymorphism, or concatenation extensions.

## 7. Generalization, purity and soundness

Extend all type traversals to visit record tails, fields, function effects and effect parameters. Generalize all eligible kinds using existing environment subtraction or level rules; instantiate each quantified variable freshly with sharing preserved. Immediate effects of a let initializer are part of the surrounding computation, not the latent effects of a subsequently used value.

Effects and mutable state can invalidate unrestricted HM let-generalization. Audit the language's existing value restriction or effect-based generalization strategy before enabling handlers and mutable effects. A conservative syntactic value restriction is a reasonable initial policy for an effectful language, but multi-shot continuations, polymorphic operations, and polymorphic resumptions require their own soundness analysis. Initially prefer monomorphic operation signatures after effect-parameter instantiation, and do not assume the row algorithm alone makes arbitrary algebraic effects sound. Preserve existing purity guarantees; test that genuinely effectful functions cannot satisfy closed empty-effect requirements.

## 8. Tests and acceptance criteria

Use the existing test framework. Assert inferred schemes modulo alpha-renaming, row permutation (for distinct labels), and presentation of lacks constraints; compare constraints as well as value types. Add unit tests for the unifier independently of source syntax.

### Records

| Case | Expected |
|---|---|
| Original five bindings | Schemes in section 2.1 |
| `withName({age: 42})` | `{age: Int, name: String}` |
| `withName({name: 42})` | Reject: forbidden label |
| `setName({name: "old"})` | Success |
| `setName({name: 42})` | Reject: field type mismatch |
| `setName({})` | Reject: missing field |
| `withoutName({name: true, age: 42})` | `{age: Int}` |
| `withoutName({})` | Reject: missing field |
| `replaceName({name: 42, age: 42})` | `{name: String, age: Int}` |
| `replaceName({})` | Reject: missing field |
| `{a: Int,b: Bool} ~ {b: Bool,a: Int}` | Success |
| `{a: Int | r} ~ {b: Bool | s}` | Shared fresh tail with both lacks constraints |
| `{a: Int | r} ~ {b: Bool | r}` | Reject |
| `r ~ {a: Int | r}` | Reject: occurs check |
| `r ~ {a: Record(r)}` | Reject: nested occurs check |
| `r # a; r := {b: Int | s}; s := {a: Int}` | Reject propagated constraint |
| Instantiate same scheme twice | Independent fresh tails with preserved lacks |
| Payload unification binds a row tail | Re-normalize; no stale links or lost constraints |
| Two independently open record spreads | Reject or explicitly unsupported in initial version |

Additional source-level tests:

```javascript
let addX = (r) => {...r, x: 1}
let addY = (r) => {...r, y: true}
let addBoth = (r) => addX(addY(r))
// forall r. (r # x, r # y) => {r} -> {x: Int, y: Bool | r}

let rename = (m) => {...m, -old, new: m.old}
// forall a r. (r # old, r # new) => {old: a | r} -> {new: a | r}

let mapName = (f, m) => {...m, -name = f(m.name)}
// forall a b r e. r # name => (a -><e> b, {name: a | r}) -><e> {name: b | r}
```

### Effects

- A pure literal or lambda creation does not impose a nonempty immediate effect or close the ambient row.
- Lambda latent effects are inferred independently of the enclosing ambient.
- A block calling Console then State has both labels; reversed order gives an equivalent row.
- Calling Console twice ordinarily needs one Console occurrence.
- The higher-order `f(g,h)` example infers a shared row and composes independent open Console and State callbacks; also test a pure callback.
- Effects in callee expressions, argument expressions, conditional conditions, branches, and record field expressions are included.
- `<E | e> ~ <E>` binds e to empty. `<E,E>` is not equal to `<E>`.
- Same-label parameterized occurrences match in order; different labels commute; mismatched parameters in matched occurrences fail.
- `<E | e> ~ <F | e>` fails; `e ~ <E | e>` fails the occurs check.
- A deep handler removes exactly one occurrence; other effects and clause effects survive. Test resumption result typing and incompatible clause result types.
- An unhandled operation cannot satisfy an explicit closed pure requirement; a handled computation can if no other effects remain.
- A closed callback mismatch follows the documented policy (reject unless an explicit sound adjustment feature exists).
- Instantiating generalized effect schemes creates independent fresh rows; monomorphic uses share rows as intended.
- Record-row and effect-row variables never unify with each other or ordinary value types.
- Existing HM regression suite passes; mutation/value restriction and continuation safety tests cover the chosen language semantics.

## 9. Implementation order and deliverables

1. Inspect existing code and add baseline inference tests. Identify whether records are already structural and how effects/handlers are represented.
2. Add kinded row variables and extend substitution, occurs checks, level handling, generalization, instantiation, and printing.
3. Implement record normalization, lacks propagation, and row unification with unit tests.
4. Add record syntax/desugaring/runtime semantics and end-to-end record tests. Treat restricted multi-spread as optional follow-up.
5. Add effect rows with scoped duplicates and unification tests. Do not reuse unique-label record normalization unchanged.
6. Add latent effects to function types and shared ambient inference. Update built-ins, annotations, and all expression inference paths. Verify higher-order composition before implementing handlers.
7. Add or integrate algebraic handlers with explicitly specified resumption semantics; audit generalization and runtime soundness.
8. Add readable diagnostics and canonical type printing, run the entire test suite, and document unsupported cases and decisions.

Prefer small changes consistent with existing architecture. Report actual files changed, tests run, outstanding failures, and deviations from this specification. Do not claim the design is implemented until the regression tests pass.

## 10. References

These are the theoretical foundations, not a requirement to reproduce an entire source language:

- Benedict R. Gaster and Mark P. Jones (1996), [A Polymorphic Type System for Extensible Records and Variants](https://web.cecs.pdx.edu/~mpj/pubs/96-3.pdf). Unique-label rows, lacks predicates, extensible records and inference. This specification specializes absence predicates to finite forbidden-label sets rather than requiring general qualified-type machinery.
- Daan Leijen (2005), [Extensible Records with Scoped Labels](https://www.microsoft.com/en-us/research/publication/extensible-records-with-scoped-labels/). Duplicate-label row equivalence and unification; use its row theory for effects, not the unique-label data-record semantics.
- Daan Leijen (2014), [Koka: Programming with Row Polymorphic Effect Types](https://arxiv.org/abs/1406.2061). Shared open effect rows, duplicate labels, effect elimination and HM-style inference. The original paper precedes the full algebraic handler system.
- Daan Leijen (2017), [Type Directed Compilation of Row-Typed Algebraic Effects](https://www.microsoft.com/en-us/research/publication/type-directed-compilation-row-typed-algebraic-effects/). Algebraic handlers and implementation considerations.
- [Koka language manual](https://koka-lang.github.io/koka/doc/manual.html). Concrete examples of effect types and handlers; modern Koka has additional features beyond this proposal.

The core design choice is to use unique-label rows for actual data and scoped duplicate-label rows for potential effects. The two systems share HM infrastructure but do not share the same label invariants. Effect composition uses unification in a common ambient context rather than general row concatenation.
