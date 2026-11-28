# Plan: polymorphic unions

Status: proposed (2026-11-27). Nothing here is implemented. It follows
[row-polymorphic records](done/row-polymorphic-records-plan.md) and reuses their row machinery.
The [decisions](#decisions) at the end are recommendations until confirmed.

## What we are building

Constructors that need no `type` declaration, typed structurally with row variables.

```
fn circle(r) { Circle(r) }        // (a) => [Circle(a), ...b]

fn area(s) {                      // ([Circle(Number), Square(Number)]) => Number
    match s {
        Circle(r) -> 3 * r * r
        Square(w) -> w * w
    }
}

fn isEmpty(s) {                   // ([Empty, ...a]) => Bool
    match s {
        Empty -> true
        _ -> false
    }
}

fn areaOr(s, other) {             // handles Circle and passes the rest on
    match s {
        Circle(r) -> 3 * r * r
        rest -> other(rest)       // rest : [...a] where a lacks Circle
    }
}
```

`[Circle(Number), ...a]` is "`Circle` with a `Number`, or whatever else is in `a`". A closed row
lists every case. As with records, only top-level definitions are polymorphic and there is no
subtyping: two union types are equal after rows are solved, or they do not match.

Declared unions stay nominal and behave as they do today.

## Where we start

Checked by running unless marked "read".

- An undeclared constructor is `unknown-constructor`.
- A match on a declared union that misses a constructor is accepted and fails at run time with
  `unmatched-case`.
- `[A(Number), B]` does not parse as a type.
- (read) Constructor names are unique across all declared unions. `nil` and `cons` are builtins.
  The expression and pattern grammars treat uppercase names as constructors.
- (read) Records are `{tag: 'record', fields, rest?}`. `unifyRecords`, the `lacks` map,
  `Scheme.rows`, generalization and instantiation already do the row work.
- (read) Layouts come from [`deriveNominalLayoutDefinitions`](../src/layout-definitions.ts), which
  reads constructor imports: one tag per constructor, and a payload is boxed when the generic
  declaration mentions a nominal type.
- (read) [`erase-records.ts`](../src/erase-records.ts) removes records after specialization, so
  backends never see rows.

## Semantics

### Which constructors are structural

A constructor that no `type` declares is structural. Its name must be uppercase, so a misspelled
`nil` or `cons` is still `unknown-constructor`. No marker is needed.

- A declared name always means the declared union. A structural type cannot list it.
- Declaring a constructor that an earlier item used structurally is an error.
- A name has no global arity or payload type. `Some(Number)` and `Some(String)` can both exist.
  Within one row, a label has one arity and one type per argument.

The cost is that a typo makes a new constructor. A closed match or a signature usually turns it
into a type error. A match with a catch-all does not: the misspelled arm never matches. When a
mismatch involves a label close to a declared or expected one, the diagnostic should say so.

### Construction

`A(x)` has type `[A(X), ...r]` with `r` fresh and lacking `A`. Branches that build different
constructors join by ordinary row unification: `[A, ...r]` with `[B, ...s]` is `[A, B, ...t]`.

### Matching

A match on a structural union decides whether the row stays open:

- Each constructor pattern requires its label in the scrutinee's row.
- If some arm has a name or `_` at that position, the row stays open.
- Otherwise, after all arms are checked, the row is closed to the labels listed.

So a structural match is statically exhaustive over constructors. Passing `[A, B, C]` to a
function that matches only `A` and `B` is a type error. This does not extend to payloads:
`A(1) -> ...` alone still fails at run time for `A(2)`, as it does today. Declared unions do not
change.

Nested positions are judged separately, identified by their path through the pattern, including
constructor names. `Pair(A, _)` and `Pair(_, B)` leave both positions open.

`let A(x) = v` closes the row to `[A]`.

### Narrowing in a catch-all

In a top-level catch-all arm, the bound name's type omits every label that an earlier arm matched
with irrefutable arguments. `A(x)` removes `A`; `A(1)` does not. Naming the scrutinee itself in
the arm still gives the full type.

This is what lets a function handle some cases and hand off the rest. It also types a rewrite:

```
fn upgrade(x) {          // ([Old(a), New(a), ...r]) => [New(a), ...r]
    match x {
        Old(v) -> New(v)
        other -> other
    }
}
```

Nested catch-alls do not narrow in this version. Declared unions never narrow.

### Types and signatures

- Written and printed as `[Circle(Number), Empty, ...r]`, with labels sorted. `[...r]` is the row
  `r`, `[..._]` an anonymous open union, and `[A]` a union of one case.
- Type aliases may splice a parameter: `type Shape(r) = [Circle(Number), ...r]`.
- A declared union's constructor may hold a closed structural union. As with records, it cannot
  hold an open one (`open-union-in-union`), but a type parameter can stand for a whole union.
- Inferred lacks print as `where a lacks Circle` when the type does not already show them.
- One row variable cannot be both a record remainder and a union remainder.

### Recursion

Structural unions cannot be recursive. This function infers a type that contains itself, and the
occurs check rejects it:

```
fn size(t) {
    match t {
        Leaf -> 1
        Node(l, r) -> size(l) + size(r)
    }
}
```

Recursion goes through a declared union. The `infinite-type` diagnostic should suggest declaring
one when the cycle passes through a structural union. Equirecursive types would be a separate
project, affecting unification, printing, specialization keys and layouts.

### Ownership and lenses

- A structural value owns its payload. It is linear, droppable, copyable or comparable according
  to every case, including the unknown remainder, which carries a bound as record rows do.
- A function in a payload follows the same capture, channel and pure-mode rules as in a record.
- A constructor of lenses over a structural union is always `FIXED`. The checker cannot count the
  cases of an open row when it builds the lens, and a stable answer is better than one that
  depends on solving order. This includes `[A]` with a single case.
- Its read and write types have separate payload types and the same remainder.
- A borrowed match restores the scrutinee at the type it had. Moving a payload out and refilling
  it is fine; changing its type is an error in this version. The reconstruction built by
  [`normalizeBorrowed`](../src/normalize-borrowed.ts) must be tied to the original row. Checked as
  an ordinary construction, it would get a fresh remainder, and the owner's type would no longer
  be the one that came in.

## Type system design

**Representation.** One new type that wraps a row:

```ts
{ tag: 'union'; row: Ty } // record, meta or rigid
```

The row is a record type whose field names are constructor labels. Each field's type is a tuple
of that constructor's arguments, even for zero or one, so `A((x, y))` differs from `A(x, y)` and
an arity mismatch falls out of unification. `unify` on two unions unifies their rows, so
`unifyRecords` is used unchanged. Arity and missing-case errors need union wording, not "record"
and "tuple".

**Row kinds.** `lacks` and `RowConstraint` currently imply "this variable is a record row". Add a
kind, `record` or `union`. Binding a variable checks it, and printing uses it to choose between
`{...a}` and `[...a]`. `semanticRecord` collapses a record with only a remainder into the
variable, which is fine under the `union` wrapper.

**Match closing** needs per-match state that `pattern()` does not have: for each position, the
row tail and whether a catch-all appeared. After the last arm, bind each unmarked tail to the
empty record. A closed scrutinee with an unhandled case then fails there. Report it as
`non-exhaustive-match` and name the missing labels.

**Every traversal must visit the new tag:** `mapType`, `free`, occurs check, printing, `prune`,
`carried`, `channels`, `sent`, `abandoned`, `settleOpenKinds`, `selfContained`,
`requirements()`, `isLinear`, `dropRequirements`, `mapSemantic`, `typeKey`, `elaborated.ts`
conversion, import re-homing and the IR verifier's type checks. Adding a tag lets the TypeScript
compiler find the exhaustive switches. The `if (p.tag === ...)` chains have to be found by hand.

## IR and backends

Keep labels until after specialization, then turn each concrete structural union into an
ordinary nominal one. Representation inference, concrete lowering and the backends should need
only the naming change below.

1. **Generic IR** gets `variant` (construct) and a `variant` pattern, carrying a label and no
   `Instance`. The verifier checks them against the row.
2. **Reference evaluator** runs the generic IR. It stores a label and its values, as it does for
   constructors now, so narrowing does nothing at run time.
3. **Erase after substitution**, next to record erasure. Each set of labels and arities becomes
   one synthesized generic union with a type parameter per argument. Its cases are sorted by
   label, which fixes the tags. Add its constructor imports, rewrite the new IR forms to the
   existing ones, and verify again. Closed structural types inside declared union fields must be
   erased in the `generic` snapshot too, because layouts are derived from it.
4. **Names.** `[A, B]` and `[A, C]` both need an `A`, and constructor imports are keyed by name.
   Synthesized constructors need qualified internal names plus a source label. Anything that
   prints a constructor, including native host JSON, uses the label. C, Go and Zig identifiers
   must be checked for collisions and illegal characters.
5. **Boxing** needs no new rule. A synthesized payload is a bare parameter, so it is stored by
   value. Every recursive cycle still passes through a declared union, whose payload mentions a
   nominal type (the erased union counts as one) and is boxed.
6. **Narrowing** erases to binding the whole value in a hidden place and rebuilding it in the
   smaller union with a `case` over the remaining labels. Tags differ between the two layouts, so
   it is a conversion, not a cast.
7. **Empty rows.** An unsolved union row defaults to no cases. A type that is only that row has no
   values and can lay out as unit. A narrowed arm whose remainder is empty is unreachable and is
   removed during erasure.
8. **Specialization keys** use the types before erasure, as for records.
9. **Legacy decomposition** is untyped. Check what it does with an undeclared constructor, and
   reject what it cannot run.

Costs to watch: a function returning `[A, ...r]` is instantiated once for each shape its callers
settle on, against the 256-instance default. Narrowing a boxed payload allocates unless a later
change reuses the box.

## Phases

Each phase ends with its targeted tests passing (`bun test <files>`, not the whole suite) and
`bunx tsc --noEmit`.

1. **Types in the solver.** The `union` tag, row kinds, unification, schemes, predicates and
   printing, with unit tests that drive the solver directly. No language change.
2. **Construction and owned matching,** through the generic IR and the reference evaluator.
   Includes match closing. Borrowed matches and constructor lenses on structural unions are
   rejected with a clear error until phase 5. Catch-alls bind the full type until phase 6.
3. **Erasure and native backends.** Synthesized unions, naming, labels in output, defaulting, then
   C, Go and Wasm end-to-end tests. This is the riskiest phase. Start it by checking that two
   shapes sharing a label get through `verify-concrete`, C and Go.
4. **Signatures.** Parser, annotations, alias parameters, declared union fields and declared
   contracts with inferred lacks. Edit `laminar.cst` and run `bun run laminar-parser`. Check
   first that `[` in a type lexes as the grammar needs, especially `[A]` and `[...r]`.
5. **Borrowed matches and constructor lenses,** including scattered lenses and in-place box reuse
   on the synthesized layouts.
6. **Narrowing,** including its erasure, dropped unreachable arms and ownership joins.
7. **Finish.** Diagnostics for typos, recursion and missing cases, host export with union type
   arguments, `examples/unions.lm`, the playground and `docs/type-inference.md`.

Phases 2 and 3 can be tested through inferred schemes before phase 4 adds the syntax.

## Acceptance tests

- Joining branches that build different constructors, and one label with two payload types in
  unrelated unions.
- Arity and payload type mismatches within a row.
- Closed and open matches, nested positions, literal payloads, and `let A(x) = v`.
- A caller with an extra case: rejected by a closed match, accepted by an open one.
- Declared and structural names do not mix, including a declaration after structural use.
- Direct recursion is `infinite-type` with the suggestion. Recursion through a declared union that
  holds a structural one runs on every backend.
- A linear payload hidden in a row is rejected wherever the union is dropped or copied.
- A function in a payload sent over a channel becomes call-once.
- One generic definition used at two shapes where the same label has different tags, run on the
  reference evaluator, C and Go, with identical printed output.
- A borrowed match keeps the owner's type, including its remainder. Changing a payload type is
  rejected.
- Narrowing: passing the rest to another function, the `upgrade` rewrite, `A(1)` not removing `A`,
  and a remainder that specializes to empty.

## Decisions

Recommended answers. The first four change the language, so confirm them before phase 1.

1. **No marker for structural constructors.** An OCaml-style `` `Circle `` would catch typos, but
   the aim is to write constructors without ceremony. Alternative: require the marker.
2. **Structural matches are statically exhaustive over constructors.** The types need the closing
   rule anyway. Declared unions keep their run-time check; making them exhaustive is separate.
3. **`[...]` for union types,** mirroring `{...}` for records. `[A | B | ...r]` would need `|` in
   the type grammar and would not match records.
4. **No structural recursion.**
5. **Narrowing is in the plan but comes late.** It is the main reason to want open unions, and the
   only part that needs a run-time conversion.
6. **Borrowed matches cannot change payload types** at first.
7. **Constructor lenses are always `FIXED`.**

## Not in this plan

Equirecursive types, subtyping or implicit widening of closed unions, presence polymorphism (a
function that accepts a union whether or not it contains a matched case), merging two unknown
unions, narrowing in nested patterns, exhaustiveness for declared unions or payload values, and
effects.
