# Plan: row-polymorphic records

Status: implemented, apart from the differences listed under [As built](#as-built). This plans the record half of
[row-polymorphism-and-effects.md](../row-polymorphism-and-effects.md). Effects are out of scope and get
their own design later. Where this plan and that spec disagree, this plan wins.

## What we are building

```
fn withName(m)    { {...m, name: "Yes"} }    // m lacks name
fn setName(m)     { {...m, name = "Yes"} }   // m has name: String
fn withoutName(m) { {...m, -name} }          // m has name: a
fn replaceName(m) { {...m, -name = "Yes"} }  // m has name: a

fn rename(m)      { {...m, -old, new: m.old} }
fn mapName(f, m)  { {...m, -name = f(m.name)} }

fn getName({name})       { name }            // other fields are dropped
fn split({name, ...rest}) { (name, rest) }
fn bump(~m)              { inc(~m.count) }   // works on an open record
```

As elsewhere, only top-level definitions are polymorphic. Records have unique labels and no width
subtyping. Records can be merged only when all but one of them have statically known fields.

## Where we start

Checked by running the parser and checker unless marked "read".

- Closed records, full patterns, `r.x`, and field lenses work. `test/records.test.ts` passes (16 tests).
- `{}` already parses and checks as the empty record, including as a function body. No work needed
  beyond a test.
- Spread, `-name`, and `...rest` in a record do not parse. The lexer already produces usable nodes
  for them. `{name = "y"}` currently parses as an application of the operator `=`, so the new field
  rules must take precedence inside a spread.
- `r.x` on a parameter of unknown type fails with `unknown-record`.
- Moving a field out leaves a hole: using the whole record is then `use-after-move` in pure mode.
  Dual mode copies reads of plain bindings.
- (read) A field is identified by its position in the name-sorted record, in checker paths, in IR
  `SlotRef.path`, and in the reference evaluator. Positions are unstable once a row can grow.
- (read) [`specializeProgram`](../../src/specialize.ts) turns records into tuples *before* it
  substitutes type arguments.

## Semantics

### Update expressions

A record with a spread is a list of items, applied left to right to a record that starts empty:

| Item | Needs | Result | Old value |
| --- | --- | --- | --- |
| `...e` | no field in common | merges the fields of `e` | none |
| `l: e` | `l` absent | adds `l` | none |
| `l = e` | `l` present, same type as `e` | replaces | dropped if still there |
| `-l` | `l` present | removes `l` | dropped if still there |
| `-l = e` | `l` present | replaces, type may change | dropped if still there |

- `{...m}` is `m`. So `{...m, -name, name: 1}` is legal.
- A literal with no spread allows only `l: e`.
- **Merging.** With two or more spreads, at most one may have unknown fields. Every other spread must
  already have a closed record type at the point where it is checked. The check does not wait for
  later code to settle a type; it reports `unknown-spread`. A shared field is `duplicate-field`
  when both sides are known, and a lacks failure when one side is the unknown remainder.

**Evaluation order.** First, op values and every spread that is not a place run left to right in
source order. Then the spreads that are places (`m`, `m.inner`) are taken. Reading a place has no
effect of its own, so taking it late only changes what ownership allows.

**Holes.** When the base is taken, a field may be empty only if an op removes or replaces it.

- `{...m, -old, new: m.old}` and `{...m, -name = f(m.name)}` are legal in every mode. Nothing is
  copied or dropped, so `old` and `name` need no `Droppable`.
- `{...m, copy: m.name}` is `use-after-move` for pure and `mut` values. A plain binding copies.
- `{...m, x: f(m)}` is `use-after-move`: the whole base is gone.
- For `l = e` on an empty field, "same type" means the type the field had when it was moved out.
  The checker currently overwrites a moved slot's type with unit, so it must remember the old type.
- For nested holes the rule applies to the first path segment: `{...m, -a = m.a.b}` drops what is
  left of `a`, which then needs `Droppable`.

**Modes.** A `mut` or pure base is consumed. A plain base in dual mode is unchanged: the existing
desugar copies it. That first version copies fields it then removes, and requires them to be
`Copyable`. Avoiding the extra copy is a later optimization.

### Patterns

- `{x, y: p}` matches a record with *at least* `x` and `y`.
- `{x, ...rest}` also binds the remaining fields as a record. `...rest` comes last and takes a name
  or `_`.
- In an owned pattern (not a lens, not shared), unnamed fields are dropped and need `Droppable`.
- In a lens pattern, unnamed fields stay where they are. The pattern only focuses the named ones.
- A plain value in dual mode is matched through a copy, so the original keeps every field.
- `...rest` in a lens pattern is rejected in version 1 (see decision 3).

This changes behavior: `let {x} = {x: 1, y: 2}` is a type error today and becomes legal. A pattern
naming a field the record lacks is still an error.

**Borrowed constructor patterns need care.** (read) [`normalizeBorrowed`](../../src/normalize-borrowed.ts)
takes a borrowed record apart and rebuilds it from only the fields the pattern names. With subset
patterns that would silently delete the others. The expansion must add a hidden `...$rest` to the
owned pattern and rebuild as `{...$rest, x: x1, y: y1}`. This lands in the same change as subset
patterns, with a test that unmentioned fields survive.

### Types and signatures

- Printed and written as `{name: String, ...r}`. `{...r}` is the record `r` itself.
- Annotations also accept `..._` for an anonymous remainder.
- Type aliases may splice a parameter: `type Named(r) = {name: String, ...r}`. An argument for `r`
  must be a record type. Using one variable both as a record remainder and as a non-record is an
  error.
- Union constructors may hold open records, using the union's parameters the same way.
- **Lacks constraints get no new syntax.** A visible `{name: a, ...r}` already says `r` lacks
  `name`. A body can need more, for example by adding and removing a temporary field. Those extra
  labels are inferred and attached to the exported scheme, including a declared one, as built-in
  predicates are today. They print as `where r lacks tmp`.

## Type system design

**Representation.** Extend the existing record type with an optional remainder instead of adding a
separate row type:

```ts
{ tag: 'record'; fields: { name: string; type: Ty }[]; rest?: Ty } // rest: meta or rigid
```

- A row variable only appears in `rest`. Binding it binds it to a record: empty, closed, or open.
- `prune` and the `record()` constructor flatten nested remainders, keeping fields sorted.
- The solver keeps `lacks: Map<varId, Set<label>>`. Its presence marks a variable as a row, which
  is the kind check.
- `Scheme` and `IRScheme` gain `rows?: { parameter: number; lacks: string[] }[]`, indexed by
  parameter like `bounds`. Instantiation copies the constraints to fresh variables.

**Unification** follows sections 4 and 5 of the spec: match common fields, then solve the leftover
fields against the remainders. After unifying field types, normalize and start the decomposition
again before binding any remainder. A rigid remainder never gains a lacks label during unification
with a contract. Extra labels reach the contract only through the explicit step that attaches
inferred constraints.

**Field access** on an unknown type unifies it with `{l: a, ...r}`. `unknown-record` goes away for
unknown types. A closed record without the field still reports `unknown-field`.

**Predicates.** `requirements()` already returns variables as obligations, so visiting `rest` gives
`Droppable`, `Copyable` and `Comparable` over rows. `Display` still rejects records.

**Every traversal must visit `rest`.** The easy ones to miss:

- `carried`, `channels` and `sent`: a function hidden in a row and sent on a channel must still
  become call-once, including when the row is solved after the send.
- `isLinear` and `dropRequirements`: a row can hide a linear field.
- `put`: rebuilding a record after a write must keep its remainder.
- `mapType`, `free`, occurs check, printing, `convert` in `elaborated.ts`, import re-homing.

## IR and backends

Keep field names until after specialization. Then lower to today's tuples, so representation
inference, concrete lowering, C, Go and Wasm should not need to know about rows.

1. **Paths use names.** A record step in `Binding.path` and `SlotRef.path` is the field name. Tuple
   steps stay numeric.
2. **Generic IR keeps records.** Today lowering emits `tuple` for record values and patterns. Add
   explicit record construction, update, and record pattern (with optional rest) forms. The generic
   IR verifier checks them, including lacks constraints.
3. **Erase after substitution.** For each instance: substitute type and row arguments, flatten, then
   rewrite record forms and named paths into tuple forms and positions. An update becomes a move of
   each surviving field, a drop of each removed field that is still full, and a tuple construction.
   Verify the result with the existing verifier.
4. **Specialization keys** use types before erasure. `{a: Number, name: String}` and
   `{name: String, z: Number}` erase to the same tuple but need different positions for `name`.
5. **Defaults.** An unsolved row defaults to `{}`. Today every unsolved variable defaults to unit.
6. **Reference evaluator.** It runs the generic IR, so it cannot know positions. Store records as
   name-keyed values. Test expectations that show records as sorted arrays will change.
7. **Legacy decomposition.** It desugars records without types. A subset pattern would become a
   tuple that is too short. Reject spread, `...rest` and subset patterns there with a clear error,
   using the checker's inferred types to detect subsets.

Costs to watch: each distinct record shape makes another instance, against a default limit of 256.
A spread moves every surviving field; in-place reuse can come later.

## Phases

Each phase ends with its targeted tests passing (`bun test <files>`, not the whole suite) and
`bunx tsc --noEmit`.

1. **Named paths, no language change.** Steps 1, 2 (construction and patterns only), 3, 4, 6 and 7
   above, for closed records. Existing record, lens, specialization and backend tests prove behavior
   is unchanged. This is the riskiest step, so it goes first.
2. **Rows in the solver.** Representation, unification, lacks, schemes, instantiation,
   generalization, predicates, printing, defaults. Unit tests drive the solver directly, covering the
   unifier cases in spec section 8.
3. **Open field access.** `r.x` and `~r.x` on unknown records, including field type changes through
   lenses, run on every backend that supports the closed equivalent.
4. **Patterns.** Subset and `...rest` parsing, checking, lowering, the borrowed-pattern rebuild, and
   the dual-mode and capture passes (`desugar-plain.ts`, `captures.ts`, binder helpers in `ast.ts`).
5. **Update expressions.** Grammar, the four ops, evaluation order, holes, `Droppable`, update IR
   and its lowering.
6. **Signatures.** Open record annotations, alias and union parameters, declared contracts with
   inferred lacks.
7. **Finish.** C, Go and Wasm end-to-end programs, host export with record type arguments, an
   updated `examples/records.lm`, and `docs/type-inference.md`.

Phases 3 to 5 can be tested through inferred schemes before phase 6 adds the syntax to write them.
Regenerate the parser with `bun run laminar-parser`; do not edit `laminar-parser.ts` by hand.

## Acceptance tests

Everything in the spec's record table, rewritten in Laminar. In addition:

- Merging closed records, and one open record with closed ones. Two unknown spreads are rejected.

- The holes cases above, in pure mode and with `mut` and plain values in dual mode.
- `-l` and `=` on a linear field are rejected unless the field was moved out first.
- A linear value hidden in a row is rejected wherever the row is dropped or copied, including when
  the row is only known at the call site.
- A function inside a row sent over a channel becomes call-once.
- Subset patterns leave other fields intact for lens patterns, borrowed constructor patterns, and
  plain values.
- One generic definition used at two shapes that put the same field at different positions, run on
  the reference evaluator, C and Go.
- Evaluation order with printing in both the ops and a non-place base.

## As built

These differ from the text above.

- **Record patterns in a borrowed match with constructors must still list every field.** Instead of
  carrying the other fields through the rebuild with a hidden `...$rest`, the expansion requires the
  pattern to be exact, so nothing can be lost. `...rest` there is `inexact-borrowed-record`, and a
  missing field is a type error that says why. Other patterns, including lens patterns without a
  constructor, can name some fields.
- **A union constructor cannot hold an open record** (`open-record-in-union`): nominal layouts are
  derived before specialization. A type parameter can still stand for a whole record, as in
  `Box(a)` used at `{x: Number}`.
- **The legacy decomposition rejects open patterns,** which includes any unannotated record pattern
  on a parameter. Two corpus samples that did this are now `legacy: false`.
- **Specialization verifies with names, then erases** ([`erase-records.ts`](../../src/erase-records.ts)).
  The IR verifier reports each named path's position where it is used, since assignment can change
  the shape of a place.
- **Fixed along the way:** a borrowed constructor pattern with record fields out of name order failed
  IR verification.
- **`examples/records.lm` was left as it was.** It now checks and runs unchanged.

Infix expressions, `if` and `fn` after `name:` still need parentheses, as they did before this work:
`{total: (a + b)}`. The `name = value` forms do not.

## Decisions

1. **Merging only with statically known fields,** as described above.
2. **Place spreads are taken after op values.** Other spreads are evaluated in source order.
3. **No `...rest` in lens patterns for now.** The remaining fields are not contiguous once records
   become sorted tuples, so a lens to them needs move-out-and-restore machinery or a new layout.
4. **Inferred lacks on declared signatures,** with no syntax to write them.

## Not in this plan

Effects and handlers, merging two unknown records, first-class or computed labels, polymorphic local bindings,
field punning in literals (`{name}` stays a block), in-place spread optimization.
