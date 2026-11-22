# A focus operation for borrowed constructor patterns

Status: proposal (2026-11-21). Follows step 3 of [mutable boxes](mutable-boxes.md), which
this supersedes as the way to remove the payload copy. Box reuse (implemented) saves
the allocation but not the copy. Parts of this document are plans I have not checked
against the code; they are marked as open questions.

## Summary

A borrowed match (`match ~xs { [head, ...tail] -> ... }`) is a projection of the owner
into its fields, like `fst(~pair)` or `v[i]`. The IR instead encodes it with `aslens`:
move the owner out, bind its fields in a temporary tuple, lend the copies, rebuild the
constructor at the end of the scope, and prove by verification that the rebuild
restores what was taken apart.

This proposal adds a dedicated IR operation for borrowed constructor focus. It
yields field lenses directly, with their own read and write types, and leaves
restoration implicit. Backends then choose a physical form per focus: when every
field keeps its layout, a field lens is a pointer into the owner's storage and
nothing is copied, rebuilt or restored. When a field changes type, the backend
rebuilds the owner once, in the operation's lowering. `aslens` stays for
user-visible `lens x <- ...` temporaries, where restoration really is arbitrary.

The source language and the checker do not change.

## Scope: every borrowed pattern

`aslens` has two producers. User-written `lens pat <- value; body`
(`src/laminar.cst`) is the real feature: an arbitrary put-back body, which `aslens`
fits. The other is `src/normalize-borrowed.ts`, which expands every borrowed pattern
the same way, through three entry points:

- `match ~x { ... }` (a `case` over a lens value). It wraps every arm's pattern,
  constructor or not, so borrowed tuple matches such as `match ~pair {(h, rest) -> ...}`
  go through it too.
- `let <pattern> = ~x` when the pattern contains a constructor.
- a lens-typed function parameter whose pattern contains a constructor.

All three are projections and all three move to `focus`, for tuple patterns as well
as constructor patterns (`fst` is already a native projection). The rest of the
typed IR only consumes `aslens` (traversals in `captures.ts`, `decompose.ts`,
`lens-specialization.ts`, the verifiers and the evaluator). I did not audit the legacy
flow front end (`flowparse.ts`, `flowtots.ts`).

After the migration `aslens` is produced only by user `lens` temporaries.

## Mental model

The owner is *inaccessible* while a borrow is live. The checker already enforces
that. The IR does not need to represent the owner as empty, because nothing can
observe it. "Empty" is an artifact of the current encoding, which moves the owner
into a temporary.

## Current behavior

`bump` from `examples/bump.lm`:

```lm
fn bump(~xs) {
    match ~xs {
        [] -> ()
        [head, ...tail] -> {
            head := head + 1
            bump(~tail)
        }
    }
}
```

With box reuse, the emitted Go for the `cons` arm is:

```go
case List_Number_cons:
    v16 := (v2).v1                     // retained box
    v17 := (*(v2).v1)                  // copy the payload out
    v18 := (v17).item0
    v19 := (v17).item1
    var back0 Backing_List_Number_946144c3f6
    back0.read0 = v19                  // lend the copied tail
    bump(Lens_List_Number{read: &back0.read0})
    v39 := back0.read0
    *v16 = Tuple_Number_List_Number{item0: (v18 + 1.0), item1: v39}  // rebuild
    v43 := List_Number{tag: List_Number_cons, v1: v16}
    *(xs).read = v43                   // write the header back
```

The target is:

```go
case List_Number_cons:
    box := v2.v1
    box.item0 = box.item0 + 1.0
    bump(Lens_List_Number{read: &box.item1})
```

## Why `aslens` is the wrong form here

`src/normalize-borrowed.ts` rewrites `match ~x { P -> body }` into:

```
let owner = ~x
case owner { P_owned -> let P_public = lens(aslens initial -> final; owner := restore) in body }
```

It derives the private names, the `initial` and `final` tuples and the `restore`
constructor from the shape of the pattern alone. Then:

- `verify-ir.ts` spends over 200 lines (the reconstruction checks) re-proving that the rebuild is an identity
  on the matched fields (`Reconstruction field changed`, `Reconstruction
  constructor or shape changed`). The encoding lost the information that this was
  a projection and the verifier recovers it.
- Inference gives the temporary a fresh `reps.thin(read, write)` unrelated to the
  owner (`case 'aslens'` in `src/infer-representations.ts`). Nothing can say "a
  pointer into the owner's box".
- To avoid the copy without changing the form, I would need an "in-place" mark on
  `aslens` and a cleanup block that is verified but never emitted. That is a sign
  the form is wrong.
- The IR already has the right concept. `fst` and `[]` return lenses into parts of
  an owner (`nativeCall` in `src/infer-representations.ts`), and `reps.project`
  composes them. These lenses carry separate read and replacement types, so type
  changes are already part of the lens model.

## Proposal

### Typed IR: `focus`

A borrowed case focuses an owner lens on one constructor (or tuple) per arm:

```
case-focus %owner {
    cons($a, $b) -> body        // $a, $b are lenses, not values
    nil() -> body
}
```

Name and syntax are tentative. The scrutinee is the owner's lens (an `acquire`),
not a moved-out value.

**Typing.**
- The owner lens has read type `R` and write type `W`. A tuple pattern is the same
  rule with a single implicit constructor.
- Arm `C(p1..pn)` requires `R` to have constructor `C` with argument types `A1..An`.
  Field `i` is bound as a lens with read type `Ai` and a write type `Bi` that the
  body fixes by assigning through the lens (`Bi = Ai` if never reassigned to another
  type, as today).
- After the arm, the owner holds `C(B1..Bn)`. The arm's result must agree with `W`
  across arms exactly as a lens-valued `case` does today.
- Sub-patterns: a literal constrains the selected variant and its field is not
  bound; a nested constructor pattern is a nested focus on that field's lens.

**Reference semantics (`eval-typed.ts`).** Selecting the arm reads the owner's
constructor. Field lenses are places inside the owner's cell, reached by path
(the evaluator already uses `getPath` and place paths for `$p1.0`-style slots), so
the evaluator never moves the owner out. At arm exit the owner is whatever the
field places contain. There is no reconstruction step to execute or verify.

### What is removed

- The expansion in `normalize-borrowed.ts` for all three entry points (`match`,
  `let`, lens-typed parameter). The normalizer shrinks to producing the focus form.
- `reconstructionOwner`, `reconstructionId` and `reconstructionPattern` across
  `ast.ts`, `infer.ts`, `lower-typed.ts`, `elaborated.ts`, `verify-elaboration.ts`
  and `verify-ir.ts`, and the large reconstruction check in `verify-ir.ts`.
- `retains`/`reuses` from `concrete-ir.ts`: the contract becomes an internal choice
  of the focus lowering (below).

`aslens` remains for user-written temporaries and keeps its verifier.

### Representation inference

A focus's field lenses get a new shape tied to the owner: "field `i` of constructor
`C` of the owner's lens", with its own read and write layouts. This composes through
`reps.project` the same way `fst` does. Because the field's read and write types are
in the IR, inference can tell, per focus, whether each field's layouts match.

Open question: whether this is a new `LensRep` kind or a path on `thin`. I have not
read `reps.thin` and `reps.project` closely enough to say which is smaller.

### Concrete IR and lowering

The concrete `focus` carries an explicit physical form, as other contracts do
(`lensJoin`, callable entries):

- **`in-place`**: every bound field has equal read and write layouts. The owner's
  box is the storage. Each field lens is `&box.itemN`. Nothing is copied or restored.
- **`rebuild`**: some field changes layout. The backend copies fields out, lends
  them, then allocates the new constructor and writes the owner's header, once, as
  the focus's lowering. Different layouts mean a different box layout, so no box
  reuse applies.

`verify-concrete.ts` checks the form against the layouts: `in-place` only when read
and write layouts match for all bound fields, the variant is boxed or inline as the
form assumes, and the case has no unsupported join.

Selecting the constructor still tests the tag of the owner's header. Copying the
header is physically fine because the owner is inaccessible.

### Lens-valued cases

`lensJoin` joins per-arm lens storage. Whether projection shapes can be joined, or a
lens-valued focus must always use `rebuild`, is unresolved. The first version uses
`rebuild` there.

## Migration

1. Add `focus` to the typed IR, with reference semantics and verification, and use it
   only for single-level constructor patterns in plain-valued `match` cases.
   Everything else keeps the `aslens` expansion. Both forms must pass the same corpus.
2. Add the inference shape and the concrete `focus` with `rebuild` lowering only.
   This should reproduce today's behavior and gives a baseline.
3. Add `in-place` lowering in C, then Go. This is where `bump` loses its copy.
4. Extend to tuple patterns, nested patterns, the `let` and lens-typed parameter
   entry points, then lens-valued cases.
5. When nothing emits the old expansion for borrowed patterns, delete the
   reconstruction machinery listed above and the `retains`/`reuses` contract.

Step 5 deletes box reuse as it exists today, so benchmark before and after (see
Testing) to confirm nothing is lost on `rebuild` paths.

## Risks

- **Size.** This touches normalization, inference, typed IR lowering, `verify-ir`,
  the reference evaluator, representation inference, concrete IR, its verifier and
  both backends. It is a much larger change than the box reuse work.
- **Slot paths.** Existing slot paths index tuples. Constructor arguments need a
  path form for variants, including which constructor a path assumes.
- **Mixed fields.** A focus where some fields change type and others do not. The
  `rebuild` lowering must still point same-layout fields into the box or copy them
  consistently; I have not settled which.
- **Literal sub-patterns.** The current restore re-emits literals; a focus must keep
  them selecting the arm without being bound.
- **Nested focus.** An inner borrow of a field that is itself a boxed constructor
  must see a pointer that stays valid while the outer focus is live.
- **Call sites.** Passing a field pointer to a callee replaces the `Backing` struct
  built around a copy (`adapt` in C, `Backing_*` in Go). The C `restore` and context
  mechanism has to agree.
- **Reordering.** Go's locals pass may move loads. Reading a field through a pointer
  after a callee writes it must not be hoisted or forwarded.
- **Aliasing.** `in-place` relies on the single-owner invariant that `dup` copies
  every allocation, which the earlier steps established.

## Testing

- The emitted code for `bump` has no payload copy, no `Backing` struct for the tail
  and no header write-back, in C and Go.
- Reference evaluator and both backends agree on the whole corpus, with the old and
  new forms side by side during migration (`LAMINAR_EXEC=1`).
- Aliasing: `dup` a list or tree, update one copy through a focus, and check both
  copies on every backend. The `dup copies list cells` and `dup copies tree nodes`
  samples cover the shape.
- Type-changing fields, mixed fields, literal sub-patterns, nested patterns and
  lens-valued matches each have a sample and are ASan clean in C.
- Verifier: reject an `in-place` focus whose field layouts differ or whose case has
  an unsupported join.
- Benchmark: updating every element of an n-element list and a path update in a
  tree, before and after, in C and Go. Step 4 of the mutable-boxes plan still needs
  this measurement.

## Open questions

- Is a dedicated `case-focus` right, or should the focus be a separate lens-producing
  instruction (`focus %owner C -> (%a, %b)`) that `case` selects on? The second keeps
  `case` unchanged but needs the tag test to be expressible on a lens.
- New `LensRep` kind or a path on `thin`?
- How do slot paths name variant arguments, and how do nested focuses compose?
- Can `lensJoin` adapters join projection shapes?
- Does the benchmark show enough gain over box reuse alone, particularly in Go, to
  justify the size of the change? If not, the right stopping point is the box reuse
  already implemented.
