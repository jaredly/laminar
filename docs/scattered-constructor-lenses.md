# Constructor lenses: returning constructors of lenses

Status: design sketch (2026-11-22). Nothing here is implemented. Statements about the
checker come from reading `src/infer.ts`, `src/types.ts` and `src/laminar.cst`; items
not settled by that reading are in "Open questions".

## Status (steps 1-5 done, 2026-11-22)

Implemented and tested through the reference evaluator and the native C and Go backends
(`test/constructor-lens*.test.ts`, `test/c/constructor-lens.test.ts`,
`test/replaceable-flag.test.ts`). Wasm shares the C output but was not built here. See "Representation
and backend" for how the backends lower it.

- **Grammar/AST:** constructor in `Lens`; `=A` and `A/=B` in `Type`.
- **Types:** `flow(read, write, replaceable)` with `REPLACEABLE | FIXED | meta`;
  `unifyReplaceable` reports `replaceable-mismatch`.
- **Checker (`infer.ts`):** `View.replaceable` propagated through `lens()`, calls
  (fresh meta per lens-position call, resolved by the callee or a self-call's body),
  `lensCase` joins and function results. The constructor view derives read and write
  from two independent instances of the constructor scheme. Its flag is `FIXED` unless
  the data type has exactly one constructor. `:=`, tuple items and constructor fields
  require `REPLACEABLE` (`not-replaceable`); lens arguments unify the flag
  (`replaceable-mismatch`).
- **Binding by name:** `let r = ~find(...)` is allowed. The binding carries the flag
  (`Binding.replaceable`, copied by aliases of it, absent for ordinary bindings), so
  `r := ...`, moving `r` out as a value and `dup(~r)` are rejected, and `match ~r {...}`
  works. A binding is a place whose type is its current contents (updated by `put`), so
  the flag is binding-level metadata rather than part of a stored lens type. The owner
  alias that `normalizeBorrowed` generates for a match drops the flag.
- **`find` types as** `(Number, List<Number>/List<Number>) => Option<Number>/=Option<Number>`,
  and the motivating `match ~find(2, ~x) { Some(y) -> ... }` type-checks to
  `List<Number>`.

- **Typed IR (step 4):** `lens-construct { name, items, instance, writeInstance }`
  lowers a constructor lens. `instance` and `writeInstance` are two recorded
  instantiations of the same AST node (the read and write sides). `SemanticFlow`'s lens
  form gains `replaceable?: false`, included in `flowKey`, so passing a non-replaceable
  lens to a stored-lens parameter is also a verifier type mismatch.
- **Evaluator:** a constructor lens is a runtime lens over the field lenses: `peek`
  builds the value, `replace` checks the tag and routes each field back. The motivating
  program runs: `find(2, x)` on `[1, 2, 3]` with `y := 20` gives `[1, 20, 3]`, and a
  miss leaves the list unchanged.
- **Verifier:** a `constructor` `Cap` (targets, read, empty, apply, escape handling as for
  `tuple`), checks of the constructor signature, arity and field types at both
  instances, and rejection of a whole-value `swap` on a non-replaceable lens and of a
  non-replaceable lens as a tuple item or constructor field. It does not check that a
  user-written move-out of a non-replaceable alias is absent; that is the checker's job
  (`Cannot move it out`).

### Finding: how matching works today

`match ~e { ... }` is not typed directly. `normalizeBorrowed` rewrites it before
inference into `let $owner = ~e`, a `case` over the owner with owned patterns, and an
`aslens` whose restoration is `$owner := <reconstructed pattern>`. For a
non-replaceable `e` that expansion would trip the very checks above, so the two
generated `let` carries `borrowedOwner`, which leaves the generated owner alias
unflagged, so the generated move-out of the owner and the reconstruct-assign onto it
are ordinary operations on an ordinary binding. (An earlier `reconstruct` flag on the
generated assign turned out to be unnecessary and was removed.) Users cannot write either
(the owner names are `$borrowed<n>`). The reconstruction is sound because it rebuilds
the arm's own constructor, so the tag never changes, and the type-level routing already
works: the call view's `put` unifies the write type and restores the argument lens.

In the reference evaluator this works by materializing: moving the whole value out of
a constructor lens builds it from the fields, and the reconstruct-assign routes the
fields back after checking the tag. A concrete backend should instead lower the `case`
over such an alias as tag dispatch with component lenses and the reconstruct-assign as
per-field restoration, without building the whole value. That is the
`case-focus`-over-constructor-`Cap` question below.

### Observations

- Joining `Some(a)` with `None` yields `(Bool, a/a) => Option<a>/=Option<a>`: the
  `None` arm leaves `a` untouched, so its write type must equal its read type. This is
  open question 4 below, confirmed for this shape.
- Constructor args in lens position parse only as lenses (`Pair(x, 5)` does not).
- Annotations: `r :: (a/b) => c/=d` works through `decl`. In an inline result
  annotation, `fn r(~a): =T ~{ ... }` (and the existing `~T` form) failed to parse in
  my attempts, and a `decl` containing `Maybe(Number)/...` also failed; I did not
  investigate either. Parameters annotated as non-replaceable are rejected with
  `replaceable-mismatch`, because parameter lens bindings are always replaceable
  (open question 2).
- `Option` is a builtin constructor pair with no declared type name, so it cannot be
  named in annotations; use a user union.
- There is no `if`; the language branches with `match cond { true -> ... false -> ... }`
  (the examples above use `if` as sketch syntax).

## Motivation

A borrowed search should return a position in the data without moving the data out:

```lm
match find(10, ~lst) {
    Some(x) -> (
        x := 20
        ()
    )
    None -> ()
}

fn find(needle, ~lst) ~{
    match ~lst {
        [x, ...rest] -> if (dup(~x) == dup(~needle)) {
            Some(x)
        } else {
            find(needle, ~rest)
        }
        [] -> None
    }
}
```

`examples/deep-update.lm` shows the current workaround: `find` returns a lens whose
contents are a `Bool` (`lens res <- true` / `lens res <- false`), so "found" and the
element position cannot be returned together.

This must stay invalid:

```lm
match (find(1, ~x) := None) { ... }
```

## Why `Some(x)` is not a lens today

`src/ast.ts` says "constructor cannot be a sound lens", and the `Lens` grammar has no
constructor form. A lens means whole read plus whole replace. That is sound for a
leaf lens at a place, and for `tuple`, where each component is independently
replaceable. It is not sound for `Some(l)`: `Some(l) := None` would change the tag, and
the tag exists only in the lens bundle, not in any storage.

## The principle

Whole replacement of a lens is sound exactly when replacing cannot change which
constructor the value is:

1. the tag is backed by storage (a leaf lens at a place, today's `flow`), or
2. there is no tag to change: the data type has a single constructor (a tuple or a
   one-constructor struct), so replacement routes each field to its field lens.

A constructor lens over a multi-constructor type has neither. It supports `match` and
assignment through the bound fields, and nothing else.

| shape | tag | replaceable |
|---|---|---|
| leaf lens at a place (`flow` today) | stored | yes |
| constructor view, single-constructor type (today's `tuple`) | none | yes, per field |
| constructor view, multi-constructor type | in the bundle, read-only | no |

A leaf is strictly more capable than a constructor view: it can always be downgraded
to one by matching (`case-focus`). The reverse never works.

## The type

Add one boolean to the lens form of `FlowTy` ([src/types.ts:8](../src/types.ts)):

```
flow(read, write, replaceable)       replaceable : a unifiable boolean
```

No new `FlowTy` form and no per-constructor table. `read`/`write` are the semantic
endpoints (`Option<A>` / `Option<B>`) exactly as for `flow` today.

The checker already rejects `plain` against `flow` with `mode-mismatch`
(`unifyFlow`). A `replaceable` mismatch is rejected by the same function.

## Rules

**Introduction.** A constructor application is allowed in lens position when its
arguments are lens expressions:

```
Γ ⊢ l1 : flow(R1, W1, _) … ln : flow(Rn, Wn, _)     C : (A1..An) → T
───────────────────────────────────────────────────────────────────
Γ ⊢ C(l1..ln) : flow(T[Ai := Ri], T[Ai := Wi], single(T))
```

where `single(T)` is true iff `T` has exactly one constructor. `None` has no fields and
fresh `read`/`write` arguments: `None : flow(Option<α>, Option<β>, false)`.

`tuple` is the single-constructor instance of this rule. In `infer.ts` the tuple view
and the constructor view can share one implementation (`put` splits the write type
across fields and calls each field's `put`).

**Join.** Lens `match` / `if` branches already unify their `read` types and run every
arm's `put` with the same type (`lensCase`). Additionally the `replaceable` flag is
unified, so a mix of a stored lens and a multi-constructor constructor view is a type
error. The join of `Some(x)`, `find(…)` and `None` is `flow(Option<A>, Option<A>,
false)`.

**Elimination.** Only `match`. For a scrutinee of type `flow(T…, _, false)`, an arm for
constructor `C` binds its sub-patterns to field lenses typed `flow(Ci_read, Ci_write)`,
derived by instantiating `C`'s scheme at the scrutinee's read and write types. The
bound variables are ordinary lens bindings, so `x := 20` works. An arm for a
constructor that no branch built is legal and simply never runs.

**Uses that need `replaceable = true`.** `:=` on the whole lens, move-out, a lens
argument position where the parameter is a stored lens, and a persistent alias or `let`
of the whole lens. Passing the result to a `~Option<A>` parameter fails the same way,
at the parameter's own unification.

**Return.** A function whose body is a lens expression gets `flow(read, write,
replaceable)` taken from the body's view ([src/infer.ts:760](../src/infer.ts)).

**Explicit conversion from a stored value.** `match ~o { Some(x) -> Some(x), None ->
None }` produces a non-replaceable lens from a stored one. There is no implicit
coercion, and no way back.

## Recursion

A self-call is typed against a fresh meta for the function, and the call site builds
`flow(read, write)` because it is in lens position (`call(..., lensResult)`). The
only unknown is now the flag, so the call builds `flow(read, write, ρ)` with a fresh
boolean meta `ρ`. The body's result then resolves it (`false` for `find`). No open
arm table is needed.

## Surface syntax for types

Annotations need a way to say "not replaceable": to pin a function's result, and to
accept such a lens as a parameter (open question 2). Today `~A` is `A/A` and `A/B` is a
lens with distinct read and write types (`Type` in `src/laminar.cst`, AST
`{ type: "lens", left, right? }`).

| syntax | type |
|---|---|
| `A` | `plain(A)` |
| `~A` | `flow(A, A, true)` |
| `A/B` | `flow(A, B, true)` |
| `=A` | `flow(A, A, false)` |
| `A/=B` | `flow(A, B, false)` |

The AST lens type gains `replaceable?: boolean` (default true). Annotations feed the
flag through `unifyFlow` like any other type, so `fn f(...) ~Option(A)` on a body that
returns `Some(x)` is a type error with no extra rule. Unannotated functions infer it.

- **Prefix `=A`.** `=` is reserved but only appears infix (`let p = v`, `==`, `=>`),
  so a prefix use in `Type` should not collide. It may read as "equals"; a sigil such
  as `^A` is the alternative. Taste, not a technical issue.
- **Infix `A/=B`** (decided). `A//B` is unusable because `//` starts a line comment
  in `.lm` files. The lexer reads operator characters greedily (`oprx` in
  `src/lexer.ts`: `/[-+/~=*!@:#$%^&<>?.|]+/`), so `/=` is one token distinct from
  `/`, and nothing else in the grammar or builtins uses `/=`. The `Type` rule is
  `left:Type "/=" right:Type`. Because of the greedy lexing, `A/=B` (no spaces) is the
  non-replaceable lens, while `A/ =B` would be `A/` applied to the prefix form `=B`;
  the checker should reject a lens-typed write endpoint (whether it already does for `A/~B` was not checked).
  Consequence: `/=` is no longer free as a future not-equal operator.

## Where it plugs into `infer.ts`

The checker's lens abstraction is `View { read, put, targets, provenance, empty }`.

| existing | role |
|---|---|
| `tuple` view: `put(t)` splits `t`, calls each item's `put` | generalized to the constructor view |
| `lensCase`: unify arm `read`s; each arm's `put` runs with the same type | unchanged; unify the flag too |
| `targets`/`provenance`: union over arms/items; `disjoint` check | unchanged; each field lens contributes its own |
| "Returned lens must refer to a lens parameter" | unchanged, applied to every field's targets |
| call result targets come from the lens argument's targets | unchanged |

New pieces:

1. `View.replaceable`: set by the constructor view and propagated through `let` bodies,
   `lensCase` and calls. The operations above check it and report a normal diagnostic:
   "cannot replace this value as a whole; it is built from a constructor of borrowed
   fields". This is a type error at the use site, found in `infer.ts`.
2. `FlowTy` flow gains the flag; `unifyFlow`, `mapFlow`, generalization and
   instantiation learn it. The consumers of the `'flow'` tag are few: `types.ts`,
   `typed-ir.ts:139`, `lower-typed.ts:58,277` plus the verifier and printer.
3. Grammar and AST: `Lens` gains `{ type: 'constructor', name, args: Lens[] }`, and the
   "cannot be a sound lens" note becomes "types as a non-replaceable lens when the type
   has more than one constructor".

## Typed IR and verifier

After inference, the typed IR needs a lens value that is a tag plus field lenses. The
verifier's `Cap` union ([src/verify-ir.ts:22](../src/verify-ir.ts)) already has `tuple`
(scattered) and `choice` (a join of per-arm lenses). A constructor lens is a third
scattered form: `{ kind: 'constructor', ctor, items: Cap[] }`, with `choice` joining
branches as today. `tuple` can become its single-constructor instance.

The verifier re-derives the same rule independently, as it does for the escape check
(`test/borrowed-patterns.test.ts` corrupts valid IR and expects rejection): whole
replacement and move-out of a multi-constructor constructor `Cap` are invalid. This is
a second check, not the first.

`case-focus` ([focus-spec.md](focus-spec.md)) takes an owner lens and enters a focus in
place. A constructor `Cap` has no owner place, so matching one dispatches on the stored
tag and binds the component lenses directly. Whether that is a second owner form of
`case-focus` or a separate instruction is open.

## Representation and backend

Status: implemented for C and Go (step 5); Wasm shares the C output but was not built here. The investigation that led to the design:

### How returned lenses work in the concrete backends today

- A returned lens is one runtime struct: a read pointer, a replacement pointer, a
  `restore(context, replacement)` callback and a context
  (`Lens_bool_to_double` in `examples/deep-update.lm.c`). Its read pointer points at a
  temporary backing, and the callback runs the callee's deferred restoration.
- Representation inference gives every returned lens a canonical *thin* shape
  (`variant.result` starts as `reps.thin(read, write)`), and a `case` or dynamic dispatch
  with lens results also normalizes to thin (`infer-representations.ts`).
- The C `case` with `lensJoin: { kind: 'selected' }` handles arms with different lens
  shapes: each arm reads its lens's contents into one joined thin temporary and records
  the selected arm, and the restoration dispatches on that selector and writes the
  replacement back through the selected arm's own lens (`src/c/lower.ts`). Scattered
  (tuple) arms already go through this path.
- Lenses in `src/c/lower.ts` are compile-time *views* (`lenses` map: a reference or an
  array of views) over a storage model, not runtime pointers until they cross a call
  boundary.

### Rejected: lower `Some(x)` to an `aslens` before inference

A constructor lens is the same thing as the hand-written workaround in
`examples/deep-update.lm`, `lens Some(v) <- Some(x) { x := v }`, and rewriting it that
way in `normalizeBorrowed` makes every backend work unchanged for a single
constructor lens (`fn pick(~a) ~{Some(a)}` and its caller type-check and run). It fails
for the motivating `find`: the `aslens` consumes `x` when the lens is built, but the
other arms of the join (the recursive call, `None`) do not. The affine join then marks
`x` unavailable in every arm and the other arms drop its contents, so the checker
reports `unrestored-lens` or `use-after-move`. The hand-written workaround avoids this
only because it never moves `x`. A constructor lens must read its fields lazily (when
the caller matches), which is what the reference evaluator's runtime lens does.

### What was built (step 5)

The planned scattered `constructor` shape turned out to be unnecessary. A constructor
lens is given the *thin* shape (`reps.thin(read, write)`), like an `aslens`, and the
backends read its field lenses lazily when they lower the instruction:

- **Representations:** `lens-construct` yields a thin shape; its items must be lenses.
  `verifyRepresentations` checks the same. No change to `RepresentationTable`, call ABIs
  or lens topologies, because a constructor lens never crosses a call as an argument
  (a stored-lens parameter rejects it by type) and results and joins already normalize
  to thin.
- **C (`src/c/lower.ts`):** `lens-construct` creates a temporary cell (`storage.own`) whose
  initial value is the constructor applied to the field lenses' *current* contents.
  This is a read, not a move: in the C storage model emptiness is symbolic and moves are
  explicit IR `move`s, so the field cells simply hold a stale copy until restoration
  overwrites them. The lens's `finish` checks the tag (`abort()` on mismatch), extracts
  the payload from the replacement and `storage.put`s each field back, then runs the
  fields' own `finish`. Calls, restore callbacks and `lensJoin: selected` are unchanged.
  Boxed variants (recursive data) are reported as unsupported.
- **Go (`src/go/lower.ts`):** the same, with `panic` for a tag mismatch.
- **Why this avoids the problem that sank the `aslens` rewrite:** the aslens consumed
  the field when built, so the arms of a join disagreed about which places were empty.
  Here nothing is consumed until the caller's match moves the whole value out of the
  joined temporary, and the checker's typed IR (no moves) is what the backends lower.

Observed: `fn pick(~a) ~{Some(a)}` compiles to a callee that stores
`Some(*a.read)` in its restore context and returns a `Lens_Option_Number` whose
`restore0` checks the tag and does `*ctx->a.read = replacement.as.v0`. The recursive
`find` runs natively under ASan/UBSan at -O0 and at -O2 and in Go, and updates the
found element in place.

Not covered: a constructor lens over a boxed variant (for example a lens constructor of a
recursive tree type), and a field that is itself a scattered tuple lens with
restoration of its own (the generic fallback path was not exercised).

## Examples

Accepted:

- `find` and its caller above.
- `fn pick(~(a, b), c) ~{ if c { Some(a) } else { Some(b) } }`.
- `Some(x)` with a scattered pair field, matched and assigned.
- `match ~o { Some(x) -> Some(x), None -> None }` (explicit conversion).
- A tuple of lenses, unchanged (single constructor, `replaceable = true`).

Rejected by `infer.ts`:

- `find(1, ~x) := None`: assignment needs `replaceable`.
- Binding the result with `let` and assigning to it as a whole.
- Passing the result to a `~Option<A>` parameter.
- Branches mixing `Some(x)` with a stored lens `~o`.
- Using the result after `~lst` is modified (loan check, as for any returned lens).

## Plan

1. Grammar/AST: constructor in `Lens`; `=A` and the infix form in `Type`; parse and
   print tests.
2. `types.ts`: the `replaceable` flag, unify/map/generalize/instantiate.
3. `infer.ts`: constructor view (sharing code with `tuple`), flag propagation, join,
   `match` over a non-replaceable view with derived field types, checks at `:=`,
   lens arguments and aliases, return typing, boolean meta at lens-position calls.
4. Typed IR and `lower-typed.ts`: lower the constructor lens and the match (done).
5. `verify-ir.ts`: constructor `Cap`, independent rules, corruption tests (done).
6. Representations, concrete IR, C and Go: thin shape, lazy field reads, tag-checked
   restoration; native and Go execution tests (done).

## Open questions

1. **Nested case lenses.** `Some(Some(x))` does not type: the derived field type is
   `flow(…, …, true)`, but the inner lens is not replaceable. Lift by giving each
   field its own flag in the derived type; cheap, deferred.
2. **Parameters of non-replaceable lens type.** Returning one is enough for `find`;
   accepting one needs variant specialization (the syntax is above).
3. **`case-focus` over a constructor `Cap`.** Second owner form or a new instruction.
4. **Type-changing fields.** Confirmed for the joined `Some(a)` / `None` shape (see
   Status). Whether `find` over a list can ever change the element type is not tested.
5. **Surface syntax for the scrutinee.** Resolved: `match ~find(...) { ... }` works
   through the `normalizeBorrowed` expansion (see Status). `match find(...)` without
   `~` is not supported.
6. **`provenance`/`empty` for constructor views.** Not traced; expected to be the union
   over fields as for `tuple`.
7. **Unifiable booleans in the solver.** `Solver` unifies `Ty`; the flag needs either a
   small `Ty` encoding (a nullary constructor and a meta) or its own union-find.
   Not checked.
