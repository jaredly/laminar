# Mutable heap data: `dup` pays for copies

Status: partly implemented (2026-11-21). Vectors, Go `dup` copying boxes (step 1), the
concrete IR reuse contract and verifier (step 2), and C and Go reuse (step 3) are done.
Direct field lenses and owned reuse are not, and no benchmark has been run.

Implemented as follows:

- Go `dup` copies every box and vector it reaches (`reachesHeap`/`copyValue` in
  `src/go/lower.ts`). Leaves are copied lazily, so a duplicated field the program
  never reads is never copied.
- `lower-concrete.ts` (`markBoxReuse`) sets `retains` on a case arm and `reuses` on
  the root `construct` of the matching reconstruction. It does so only for a
  plain-valued case with the same constructor and the same union layout.
  `verify-concrete.ts` checks the pairing (lexical containment, boxed variant,
  same constructor and layout, retained exactly once).
- `src/c/lower.ts` keeps the box in a local and writes `*box = payload`. The
  same-layout `bump` above has no `allocate_context` or `release_context`.
- Lens-valued cases (`lensJoin`) fall back to free and allocate.
- `src/go/lower.ts` does the same: the bind keeps the owner's box in a local and the
  construct writes `*box = payload`. A value constructed in place has no box, so its
  reconstruction allocates.

## Summary

Every heap allocation a compiled program makes has exactly one owner. `dup` is the
only operation that turns one value into two, and it must copy every allocation it
reaches. Given that invariant, an owner may write its own heap data in place.

Vectors already follow this rule: element lenses write into the buffer, and `dup`
copies every buffer it reaches. This document proposes the same rule for boxed
union payloads (list cells, tree nodes and other variants that `layout-definitions.ts`
marks `indirect`). Today those boxes are rebuilt on every borrowed update.

The source semantics do not change. The checker, typed IR and reference evaluator
are untouched. This is a guarantee about physical representations: no two live
values share a heap allocation, so writing one cannot be observed through another.

## Current behavior

A borrowed update of a list:

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

Borrowed-pattern normalization moves the owner into private storage, binds its
fields, and rebuilds the constructor at restoration (see
[owned temporary lenses](aslens-core-ir.md)). The emitted C for the `cons` arm
frees the old cell and allocates an identical one at every level (trimmed):

```c
Tuple_Number_List_Number v12 = (*(v2).as.v1);
release_context((v2).as.v1);              // destructure frees the box
...
Unit v27 = bump(..., v28);                // recursive update of the tail
...
Tuple_Number_List_Number *v35 = allocate_context(sizeof *v35);
*v35 = (Tuple_Number_List_Number){v32, v33};
List_Number v34 = (List_Number){.tag=1, .as.v1=v35};
...
*(arg0).read = v37;                       // write the new header to the owner
```

Go does the same, without the explicit free:

```go
v16 := (*(v2).v1)
...
v47 := new(Tuple_Number_List_Number)
*v47 = Tuple_Number_List_Number{item0: (v17 + 1.0), item1: v38}
*(xs).read = List_Number{tag: List_Number_cons, v1: v47}
```

`dup` differs between the backends:

- **C** `duplicate()` in `src/c/lower.ts` deep-copies every box and vector buffer.
- **Go** shares boxes. `src/go/lower.ts` relies on boxed payloads never being
  written in place ("binding copies them out and construction allocates"), so `dup`
  and moves may share them. Since vectors were added, `copyValue` deep-copies only
  values that reach a vector (`reachesVector`).

Rebuilding is O(1) per cell, so this is a constant-factor cost, not an asymptotic
one: a traversal that updates n cells performs n frees and n allocations in C, and
n allocations in Go. Vectors were different, since rebuilding a buffer is O(n) per
element write.

## The ownership invariant

No two live values may share a heap allocation. The language already ensures this
except where a backend duplicates a pointer:

- A move consumes its source, so the moved-from storage is dead.
- A borrow is exclusive. The checker protects the owner while aliases live, and
  borrowed patterns leave the owner empty until reconstruction.
- Closures move their captures.
- `dup` is the only way to keep a value and also have a copy of it.

So the work is:

1. Make every backend's `dup` copy every allocation it reaches.
2. Audit the backends for any other place that writes the same pointer into two
   live values. Known candidates in Go are `snapshot`/`dataValues` reuse and
   storage-join adapters. Moves that share a pointer with a dead source are fine.

Strings stay immutable in both backends and are out of scope.

## Proposed changes

### 1. Go `dup` copies boxes

Generalize `reachesVector` to "reaches heap data": any pointer field or vector.
`copyValue` already handles unions, allocating a new box per boxed variant, so this
is mostly a change of predicate. Go's `dup` of a list becomes O(n), matching C.
That is the intended place to pay. Programs that keep snapshots of large structures
pay for them explicitly.

This step is independent and safe on its own. It must land before any in-place
box write.

### 2. Box reuse at borrowed reconstruction

When a borrowed match rebuilds the constructor it destructured, write the new
payload into the old box instead of freeing it and allocating another.

Reuse is valid when the reconstruction has the same constructor and the same payload
layout as the destructured value. Otherwise the backend frees and allocates as it
does today. Fallback cases:

- A field changed type, which borrowed patterns allow when the constructor's
  signature permits it (for example `Option<Number>` to `Option<String>`). The
  payload layout differs.
- The owner was replaced with a different constructor after the field scope.

The information already reaches the backends. The concrete `aslens` instruction
keeps the typed `reconstruction` pattern, with its `reconstructionOwner` slot and
`reconstructionId`. Neither backend uses it yet. There are two ways to use it:

- **Backend-local matching.** Each backend pairs the destructuring `bind` with the
  cleanup's `construct`. This is simple to start, but duplicated in C and Go, and
  unverified.
- **An explicit concrete IR contract (recommended).** `lower-concrete.ts` annotates
  the destructuring bind with the box it retains and the reconstructing construct
  with the box it reuses. `verify-concrete.ts` checks the pairing: same constructor,
  same payload layout, retained exactly once, and released on every path that does
  not reuse it. Backends then emit `*box = payload` without re-deriving anything.
  This matches how the rest of the pipeline states physical decisions as checked
  contracts (`lensJoin`, callable entries, representation variants).

With reuse, the C `cons` arm above has no `release_context` or `allocate_context`.
It writes `*box = (Tuple_Number_List_Number){...}`, and the owner's header (tag and
pointer) does not change, so writing it back becomes a self-assignment.

Branch joins need care. A borrowed match under a lens-valued `case` keeps
per-arm storage until restoration (`lensJoin`), so each arm retains its own box and
the contract must cover every arm.

### 3. Later: direct field lenses into boxes

See [the focus operation proposal](direct-field-lenses.md) for the detailed design.

Instead of copying fields into private storage and back, a field alias could be a
pointer into the payload, as vector element lenses are. That is only possible when
the field's read and replacement layouts match, so representation analysis would
choose per borrow. This removes the payload copy in and out, which matters for
large payloads. It is a larger change to representation inference and its verifier.

### 4. Later: reuse for owned rebuilds

`match xs { [h, ...t] -> [h + 1, ...t] }` destructures an owned value and constructs
one with the same layout in the same arm. Reusing the box there needs a reuse
analysis over owned values, similar to Koka's reuse analysis, with affine ownership
standing in for reference counts. This is out of scope for the first pass.

## Trade-offs

- Go `dup` goes from O(1) to O(size) for boxed data. C is unchanged.
- The win is a constant factor: one allocation (and in C one free) per visited cell.
  It should be measured, especially in Go, where allocation is cheap.
- The concrete IR contract adds lowering and verifier work, but keeps the backends
  simple and the decision checkable.

## Testing

- **Aliasing.** `dup` a list or tree, update one copy through a borrowed match, and
  check that both copies are correct, on every backend. Go is the backend at risk.
  The vector sample "dup copies buffers inside variants" covers one case; add list
  and tree versions.
- **Reuse.** For a same-layout borrowed update, check that the emitted C has no
  allocation in the rebuilding arm. Alternatively, add a test-only allocation
  counter next to `live_contexts`.
- **Fallback.** A type-changing borrowed field update still allocates, produces the
  right value, and is ASan clean.
- **Regression.** Run the full corpus with `LAMINAR_EXEC=1`.
- **Benchmark.** Updating every element of an n-element list, and a path update in
  a tree, before and after, in C and Go.

## Plan

1. Go `dup` copies boxes, plus aliasing tests.
2. Concrete IR reuse contract and verifier.
3. C and Go lowering of reuse.
4. Measure, then decide whether to pursue direct field lenses or owned reuse.

## Open questions

- Is Go reuse worth it given cheap allocation, or should Go stop at step 1?
- Should the reuse contract live in concrete IR (recommended) or in each backend?
- Does reuse interact with any storage-join adapter that currently relies on
  rebuilt boxes being fresh?
