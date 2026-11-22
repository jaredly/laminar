# Constructor lenses: returning constructors of lenses

Status: design sketch (2026-11-22). Nothing here is implemented. Statements about the
checker come from reading `src/infer.ts`, `src/types.ts` and `src/laminar.cst`; items
not settled by that reading are in "Open questions".

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

Representation follows from the type structurally. `RepresentationTable` gains one
shape:

```
sum(arms)        arms: ctor ↦ shape[]        (tag slot plus field shapes)
```

Arms are exclusive and may overlay. Only built constructors get meaningful field
shapes; an unbuilt constructor's arm is empty and never selected. Two builds of the
same field with different representations (a thin lens and a scattered tuple of the
same type) fail in the representation join with `unsupported-representation-join`,
exactly as thin vs scattered tuples do today. That failure is pre-existing behavior,
not something this design adds. Native and wasm32 share the abstract shape
([c-codegen-plan.md](c-codegen-plan.md)).

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
4. Typed IR and `lower-typed.ts`: lower the constructor lens and the match.
5. `verify-ir.ts`: constructor `Cap`, independent rules, corruption tests.
6. Representations, concrete IR and the C backend: `sum` shape, tag dispatch,
   restoration of each component. Native and wasm32 execution tests.

## Open questions

1. **Nested case lenses.** `Some(Some(x))` does not type: the derived field type is
   `flow(…, …, true)`, but the inner lens is not replaceable. Lift by giving each
   field its own flag in the derived type; cheap, deferred.
2. **Parameters of non-replaceable lens type.** Returning one is enough for `find`;
   accepting one needs variant specialization (the syntax is above).
3. **`case-focus` over a constructor `Cap`.** Second owner form or a new instruction.
4. **Type-changing fields.** `[A→B]` in `Some` should be forced to `A = B` by the
   unfocused remainder (the rest of the list), as `case-focus` requires. Not verified.
5. **Surface syntax for the scrutinee.** The motivating example writes
   `match find(10, ~lst)`; today lens-valued scrutinees go through `~` and the
   `aslens` expansion in `normalize-borrowed.ts`, and `lensCase` rejects `match ~e`
   directly ("Matching a lens requires scoped restoration checking").
6. **`provenance`/`empty` for constructor views.** Not traced; expected to be the union
   over fields as for `tuple`.
7. **Unifiable booleans in the solver.** `Solver` unifies `Ty`; the flag needs either a
   small `Ty` encoding (a nullary constructor and a meta) or its own union-find.
   Not checked.
