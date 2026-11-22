# `case-focus`: typed IR specification

Status: draft spec (2026-11-21). Part of the [focus proposal](direct-field-lenses.md),
option 1. This fixes what `verify-ir.ts` must check and what the evaluator and
`lower-typed.ts` must do. Nothing here is implemented. Claims about existing code come
from reading `verify-ir.ts`, `eval-typed.ts` and `lower-typed.ts`; items I could not
settle are in "Open questions".

## Why plain-valued only, first

`aslens` is a *lens-valued* instruction. It produces a lens capability (`Cap` kind
`aslens`), so every place that walks capabilities (`targets`, `read`, `empty`, `apply`,
`externalTargets` and the `escapes` check for returned lenses) has an `aslens` case.
That is most of its cost in `verify-ir.ts`.

`case-focus` produces no capability. Its arms are plain-valued blocks and the focus
itself is entered and left inside one instruction. So the `Cap` union does not change.
The cost is that a borrowed match that returns a lens (`find_` in `deep-update.lm`)
cannot use it yet and keeps the `aslens` expansion (see "Consequences for deletion").

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

1. `owner` is a lens value of type `flow(R, W)` and is consumed exactly once.
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
9. `out` is plain.

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
case of the same instruction. Arms of a lens-valued `case`, and any arm the recognizer
does not fully match, keep today's expansion unchanged.

## Consequences for deletion

The `reconstruction*` fields and the reconstruction check in `verify-ir.ts` can only be
deleted when no borrowed pattern uses the `aslens` expansion. A lens-valued borrowed
match (`find_`, `find`) still does, until `case-focus` can return a lens (a new `Cap`
kind, plus `escapes`, `externalTargets` and `choice` interplay). So the realistic order
is: plain-valued `case-focus` first (this spec), lens-valued later, deletion last.

## Touch list (estimates, not verified)

| Area | Change | Rough size |
|---|---|---|
| `typed-ir.ts` | add the instruction type | small |
| `verify-ir.ts` | new `case 'case-focus'` in `verifyBlock`; index the new arms for slot/loan bookkeeping | about 100-150 lines |
| `eval-typed.ts` | evaluate it (above) | about 50 lines |
| `lower-typed.ts` | recognize the three-node shape and emit it | about 100 lines, the riskiest part |
| traversals: `captures.ts`, `decompose.ts`, `lens-specialization.ts`, `infer-representations.ts`, `verify-representations.ts`, `lower-concrete.ts`, `verify-concrete.ts`, `print-concrete.ts` | add a `case-focus` branch each | a few lines each |
| concrete IR and backends | lower to the existing `in-place`/rebuild forms | reuses option 3 |

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
