# `case-focus`: typed IR specification

Status: draft spec (2026-11-21, lens-valued form added 2026-11-22). Part of the
[focus proposal](direct-field-lenses.md), option 1. This fixes what `verify-ir.ts` must
check and what the evaluator and `lower-typed.ts` must do. Nothing here is implemented.
Claims about existing code come from reading `verify-ir.ts`, `eval-typed.ts` and
`lower-typed.ts`; items I could not settle are in "Open questions".

The plain-valued form is specified first. "Lens-valued `case-focus`" below covers a borrowed
match whose result is a lens (a search such as `find`), and a match on a constructor lens;
both are needed to remove the move-out-and-rebuild expansion for the programs that return
lenses.

## Why plain-valued only, first

`aslens` is a *lens-valued* instruction. It produces a lens capability (`Cap` kind
`aslens`), so every place that walks capabilities (`targets`, `read`, `empty`, `apply`,
`externalTargets` and the `escapes` check for returned lenses) has an `aslens` case.
That is most of its cost in `verify-ir.ts`.

`case-focus` produces no capability. Its arms are plain-valued blocks and the focus
itself is entered and left inside one instruction. So the `Cap` union does not change.
The cost is that a borrowed match that returns a lens (`find_` in `deep-update.lm`)
cannot use it yet and keeps the `aslens` expansion. The lens-valued form, with the new
capability it needs, is specified in "Lens-valued `case-focus`" below; that is the part
that matters most in practice, because the expansion's cost shows up on exactly those
programs (see "What the expansion costs today").

## Instruction

```ts
{
  op: 'case-focus';
  origin: string;
  out: IRValue;                 // plain type: the arm result
  owner: ValueId;               // a lens (flow R -> W), consumed
  arms: {
    pattern: IRPattern;         // refutable over R; binds no values
    fields: FocusField[];       // one per field position the arm names
    body: IRBlock;              // plain result
    setup?: Cleanup[];          // as for `case`
    restored?: Cleanup[];
  }[];
}
type FocusField = { place: SlotRef; read: SemanticType; write: SemanticType };
```

- `pattern` is a tuple or constructor pattern whose items are field positions, literal
  constraints or nested focuses. It binds nothing itself: field values are reached
  through `fields`.
- `fields[i].place` is a slot (a computed place like today's `$p1.0`, a tuple path
  under one place per arm) that the arm body uses with `acquire` and `move`.
  Reusing the public pattern's places leaves arm bodies unchanged.
- `read` is the field's type in `R`. `write` is the type the field holds when the arm
  exits. A field whose position is `_` or constrained by a literal has no entry and
  keeps its type.
- `owner` is a lens value, not a moved-out owner. The `move $owner` that currently
  feeds the case disappears.

## Typing

For each arm with constructor `C` (or the single tuple constructor):

1. `R` must be an instance of `C`'s type with argument types `A1..An`. This is the same
   check the verifier's `pattern` already applies to a constructor pattern.
2. For each entry in `fields`, `read` equals the declared argument type `Ai` at that
   position.
3. At arm exit the owner's type is `C(B1..Bn)`, where `Bi` is `fields[i].write` for named
   fields and `Ai` otherwise. This type must equal `W`, the owner lens's write type, in
   every arm (as `case` arms must agree on result type).
4. `out.type` is `plain`, and every arm body's result matches it.

## Verifier state transitions

State is the existing `State { slots, values, loans }`. For each arm, on a cloned state:

1. **Consume the owner lens.** `take(s, i.owner)` yields `cap c`. Check
   `read(s, c)` equals `R` and the lens is not empty (`empty(s, c)` is `[]`).
2. **Hold the owner.** Add a loan whose `owners` are `targets(s, c)`, so any access to
   those places during the arm that does not pass through the focus fails with
   `Use while exclusively borrowed`. `aslens` computes and checks a `holds` list from
   its cleanup block (`Temporary cleanup dependency protection mismatch`); `case-focus`
   has no cleanup block, so its hold set is `targets(c)` by construction and needs no
   check.
3. **Allocate field places.** For each `fields[i]`, allocate a slot at `place` with
   type `read`, full, reachable only through the focus loan's permit (the loan's
   `owners` are the hold set).
4. **Verify the body** with `verifyBlock(arm.body, branch)`, then apply `setup` and
   `restored` normalization as `case` does.
5. **Check restoration.** Each named field place must be `full` with type `write`
   (`Focus field was not restored`). A moved-out field that was not refilled, or
   refilled at another type, fails here.
6. **Write the owner.** Apply `apply(branch, c, W)` with the owner type `C(B1..Bn)`
   (check 3 above). If `c` is itself an `aslens` or a place cap this reuses the existing
   put logic, which is how nested focuses compose: an inner focus's owner is the outer
   field place.
7. **Retire** the field places and the focus loan; they must not escape the arm.

After all arms, join states exactly as plain-valued `case` does (`mergeStates`, the
`Branch availability was not normalized` check), and set `out` to the common result.

## Obligations the verifier enforces

Numbered so tests can name them.

1. `owner` is a lens value of type `flow(R, W)` and is consumed exactly once (a lens-valued
   focus does not consume it; see below).
2. Every arm's pattern is a valid refutable pattern for `R` and names distinct field
   positions.
3. `fields[i].read` matches `R`'s argument type at that position.
4. The owner and everything it targets are inaccessible during the arm except through
   the field places.
5. Every named field place is full at arm exit, with type `write`.
6. The resulting owner type equals `W` in every arm.
7. No field place, loan or lens derived from them survives the arm.
8. Arms agree on result type and on the availability of outer places (existing `case`
   rules).
9. `out` is plain (the lens-valued form relaxes this; see below).

## What disappears for these arms

- The `move $owner` feeding the case, the private `$_borrowedN` bindings, the initial
  tuple, the backing place, the cleanup block and its `swap`, and the owner-reassignment
  `construct`.
- The reconstruction check. Nothing has to prove the rebuild is an identity, because
  there is no rebuild: obligation 6 computes the owner's new type from the final field
  types.
- The `Temporary cleanup dependency protection mismatch` check, for the reason above.

## Evaluator semantics (`eval-typed.ts`)

Defined at the IR level and implemented literally:

1. Read the owner through `lens.peek()`. Find the first arm whose pattern matches; none
   is `unmatched-case`.
2. Create a cell per named field with the matched field's value. Bind the field places
   to those cells.
3. Execute the body.
4. Read each cell (all must be full), build `C(final fields)` with unnamed fields carried
   over, and call `lens.replace(value)`.
5. Delete the cells.

This is the same work `aslens` does at runtime, minus the cleanup block interpretation,
so the evaluator is simpler. Backends are free to choose the physical form (see
[the proposal](direct-field-lenses.md) and `in-place` in the concrete IR).

## Lowering from elaboration (`lower-typed.ts`)

For a case arm whose pattern has `reconstructionOwner` and a body that is the public
`let` over a matching `aslens`:

- emit `case-focus` with `owner = acquire <reconstructionOwner slot>`;
- take `fields` from the public pattern's places and the `aslens` temporary's initial
  fields (the `read` types), and the `write` types from the `reconstruction` pattern's
  final bindings;
- drop the `move`, the aslens and its cleanup block.

`let <pattern> = ~x` and lens-typed parameter patterns are the single-arm irrefutable
case of the same instruction. Until the lens-valued form below exists, arms of a
lens-valued `case`, and any arm the recognizer does not fully match, keep today's
expansion unchanged.

## What the expansion costs today

Learned from compiling lens-returning matches to C and Go (2026-11-22). The expansion moves
the owner out, destructures it, lends the fields and rebuilds the owner at restoration. For
a match that returns a lens, that restoration is deferred past the function return, so every
piece below exists only to undo it:

- **A no-op write-back for arms that bind nothing.** `[] -> None` has no field to change, yet
  the expansion ends the arm with `$owner := nil`, so the generated `find` builds a closure
  whose only job is `*lst.read = nil`. Nothing in the source asked for it. It is also why
  the compiler cannot know that `find` never returns a lens with a callback, and so must test
  for one at every call.
- **Retained boxes.** `retains`/`reuses`/`inPlace` and `markBoxReuse` recover "the box stays
  in the list" for arms that rebuild the constructor they matched. They were extended to
  lens-valued arms so a returned lens may point into the box after the arm ends.
- **Backend repairs of a rebuild that does not happen.** The forwarding join and its `closureLens`
  fallback, "consumed" enclosing cleanup, `scatteredHomes` and `constructedBy` (so that a
  `swap` writes the matched constructor's fields through pointers instead of rebuilding a
  union), and the `scattered` mark on a leaf so a match dispatches on a lens's own tag.

`case-focus` removes the cause: the owner is never emptied, so there is nothing to refill.

## Lens-valued `case-focus`

### Instruction

The same op, with a lens-typed result:

```ts
{
  op: 'case-focus';
  origin: string;
  out: IRValue;                 // plain (above) or `flow(R', W')` (this section)
  owner: ValueId;               // a lens (flow R -> W); not consumed when `out` is a lens
  arms: {
    pattern: IRPattern;
    fields: FocusField[];       // one per field position the arm names; may be empty
    body: IRBlock;              // result is a lens when `out` is
    setup?: Cleanup[];
    restored?: Cleanup[];
  }[];
}
```

Each arm body is a lens-valued block, as the arms of a lens-valued `case` are today. Its
result is one of: a field lens (`acquire` of a `fields[i].place`), a constructor of field
lenses (`lens-construct`), a call result, or a nested focus. The instruction's result lens is
the arm that matched; arms must agree on `read` and `replaceable` as lens-valued `case` arms
do.

### The focus stays open while the result lives

A plain-valued focus closes at the end of its arm. A lens-valued one cannot: the returned lens
points into the owner, so the hold on the owner and the field places must last until that
lens is restored. The owner must therefore be, or be reachable from, a lens parameter of the
function (the existing `Returned lens must refer to a lens parameter` rule, applied to
`targets(owner)`).

### New capability: `focus`

Add a `Cap` kind next to `choice`, with the same shape of per-arm bookkeeping:

```ts
{ kind: 'focus';
  owner: Cap;                              // the owner lens
  read: SemanticType;                      // R' of the result lens
  refs: SlotRef[]; places: string[];       // as `choice`
  versions; baseLoans; guards;             // as `choice`
  arms: { state: State; cap: Cap; fields: FocusField[]; restored: Cleanup[] }[] }
```

- `targets`: `targets(owner)` plus each arm's field places (as `choice.refs`).
- `read`: the stored `read`.
- `empty`: each arm's `empty(arm.state, arm.cap)`, as `choice`.
- `externalTargets` and `escapes`: the owner's targets plus each arm's cap, so the existing
  escape check applies to the owner and to everything the arm returns.
- `apply(s, c, type)` (restoration, when the returned lens is finished): for each arm, run
  the arm's `apply`, check each named field place is full with type `write`, then write the
  owner with `C(B1..Bn)` as in the plain form. A fieldless arm, or one whose named fields
  keep their type and layout, writes nothing to the owner.

### Fieldless arms and the no-op write-back

An arm whose pattern names no field (`[]`, `None`, a literal) has empty `fields`. At arm
exit the owner has type `C(A1..An)`, so the arm requires `R = W` (obligation 6 below); there
is no restoration and no write. This is the case the expansion handled with a rebuilt
constant, and it is why a function whose arms are all pointer-valued can be known to
return no callback.

### Matching a constructor lens

A constructor lens (`lens-construct`, or a call whose result is `replaceable: false`) has a
tag and field lenses but no storage of its own. `case-focus` over such an owner needs no
move and no rebuild:

- The pattern selects the arm by the lens's tag.
- Each `FocusField` is a lens value, not a place:
  `FocusField = { place: SlotRef } | { lens: ValueId; read; write }`. The arm block
  receives the owner's field lenses as new values of type `flow(read, write)`.
- There is nothing to write back, so the owner is never applied to (its `replaceable` is
  false, and the checker already rejects a whole write).
- A refutable sub-pattern on a field needs the field's value: it is read through the field
  lens, which the backend may do in place.

This is what the backends already do for a scattered lens (`switch` on the lens's tag and
bind each field to its pointer), but only after the expansion has moved the "whole value" out
and builds a union to match on in the fallback.

### Evaluator semantics

For a lens-valued `out`:

1. Read the owner through `lens.peek()`; select the arm; none is `unmatched-case`.
2. Create a cell per named field and run the arm body, producing a lens `r`.
3. Return a lens whose `peek` is `r.peek` and whose `finish` finishes `r`, reads each named
   cell (all must be full), and, unless the arm is fieldless, calls `owner.replace(C(final))`.

For a constructor-lens owner, step 2 binds the constructor lens's field lenses directly and
step 3 has no `replace`.

### Typing additions

- A lens-valued focus is `replaceable: false` exactly when its arms are constructor lenses
  over a multi-constructor type (the existing checker rule, unchanged).
- Arms mixing a field lens with a constructor lens fail as `replaceable-mismatch` today and
  keep doing so.
- A scattered result needs `read` and `write` of each constructor field to share a layout. A
  type-changing field makes the result thin and its restoration a rebuild, deferred to the
  returned lens's `finish`.

### Obligations added (numbered after the plain form's)

10. A lens-valued focus keeps the owner and the field places held until its result lens is
    restored, and its result escapes only through `targets(owner)`.
11. Every arm's lens result has `read` equal to the instruction's.
12. A fieldless arm leaves the owner at `R`; if `R != W` the arm is rejected.
13. For a constructor-lens owner, no arm writes the owner, and each `{ lens }` field has the
    constructor's declared field type at that position.
14. The result is `replaceable: false` iff its arms are constructor lenses over a
    multi-constructor type.

### Backend mapping

Representations are unchanged: the focus's result keeps the shape the lens-valued `case`
already has (thin, or the scattered `sum` for a non-replaceable result), and the join of
arms is still the forwarding join. What the form removes from the concrete IR and the
backends is listed under "What the expansion costs today"; what stays is the physical choice
per field (`in-place` pointer into the owner's box when read and write layouts match,
`rebuild` otherwise) from the plain form.

## Consequences for deletion

The `reconstruction*` fields and the reconstruction check in `verify-ir.ts` can only be
deleted when no borrowed pattern uses the `aslens` expansion. With the lens-valued form
above, a lens-valued borrowed match (`find_`, `find`) no longer does. The order is:
plain-valued `case-focus` (above), the lens-valued form (with its `focus` capability), and
only then deletion, including the retained-box contract and the backend repairs listed under
"What the expansion costs today".

## Touch list (estimates, not verified)

| Area | Change | Rough size |
|---|---|---|
| `typed-ir.ts` | add the instruction type | small |
| `verify-ir.ts` | new `case 'case-focus'` in `verifyBlock`; index the new arms for slot/loan bookkeeping | about 100-150 lines |
| `eval-typed.ts` | evaluate it (above) | about 50 lines |
| `lower-typed.ts` | recognize the three-node shape and emit it | about 100 lines, the riskiest part |
| traversals: `captures.ts`, `decompose.ts`, `lens-specialization.ts`, `infer-representations.ts`, `verify-representations.ts`, `lower-concrete.ts`, `verify-concrete.ts`, `print-concrete.ts` | add a `case-focus` branch each | a few lines each |
| `verify-ir.ts` (lens-valued form) | `focus` `Cap`: `targets`, `read`, `empty`, `apply`, `externalTargets`, `escapes`, plus `{ lens }` fields for constructor-lens owners | about 150-250 lines, the largest part of this form |
| `eval-typed.ts` (lens-valued form) | a lens whose `finish` replays the owner write | about 60 lines |
| concrete IR and backends | lower to the existing `in-place`/rebuild forms; the lens-valued form reuses the forwarding join and the scattered lens | reuses option 3 |
| backend repairs | delete `retains`/`reuses` pairing for lens-valued arms, `scatteredHomes`, `constructedBy` swap special-case | after the lens-valued form lands |

`infer.ts` and `normalize-borrowed.ts` are untouched in this stage.

## Open questions

- **Binding records.** `aslens` checks a temporary backing against `u.bindings`
  (`Invalid temporary backing`). Field places are existing bindings, but I have not
  checked what `declaration`, `kind` and `borrow` values elaboration gives the public
  pattern's places, so `allocate` for them may need adjustment.
- **Loan table.** Whether the focus loan is a new entry in `IRUnit.loans` (computed
  from the elaborated `borrows`) or synthesized by the verifier. Today `owners` come
  from elaboration.
- **Mixed fields.** The spec lets named fields change type independently. How the
  concrete lowering shares storage between a same-layout field (pointer into the box)
  and a type-changing field (copied) in one focus is the open question from the
  proposal.
- **Nested focus encoding.** A nested constructor pattern as a nested `case-focus` on a
  field place versus a pattern tree in one instruction.
- **Literal constraints.** A literal on a field narrows the arm. I assume
  `pattern` carries it and `fields` omits it, but the elaboration's reconstruction
  re-emits literals today, which I have not traced.
- **Case edges.** The `setup`/`restored` `drop-place` normalization for plain cases uses
  block cleanup; I assume it carries over unchanged.
- **Deferred restoration order.** The `focus` capability's `apply` runs when the returned lens
  is finished, possibly after other restorations in the caller. Whether the hold can be
  expressed with the existing `baseLoans`/`guards` machinery of `choice`, or needs an owner
  version guard of its own, is untested.
- **Nested lens-valued focus.** `find` focuses the owner and returns either a field lens or the
  result of a recursive call that itself focuses the tail. The recursive result's `targets`
  must be the tail place, which is a field place of the outer focus; the escape check has to
  treat a field place of an open focus as part of the owner.
- **`{ lens }` fields and loans.** A constructor-lens owner's field lenses carry their own
  loans. The arm block needs them as ordinary values without opening a second hold.
- **Mixed arms.** An arm returning a field lens next to one returning a constructor lens is
  rejected by the checker today; whether the instruction should also reject it independently is
  a verifier choice, and the focus `Cap` currently assumes it.
