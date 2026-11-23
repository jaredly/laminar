
This is the original design sketch; the settled rules below supersede it. Implementation status
and phases are in [mut-and-linear-plan.md](mut-and-linear-plan.md).

The language gains shared immutable values and scalars that copy implicitly, as a separate "dual"
mode next to the paper's "pure" one:

- `let mut x =` and `fn (mut x) {}` declare a binding exclusive and lensable (consume-once). `~x`
  parameters are implicitly `mut`. Everything else is plain: shared, immutable, readable any number
  of times.
- `type linear X = y` declares a type that cannot be `dup`d or put in a plain binding (file
  descriptors, connections). Linearity comes from the type alone, never from where a value was bound.
- A `mut` value moved into a plain binding is frozen; a plain value needs `dup()` to become `mut`.
  Function types mark `mut` positions, e.g. `(Number) -> mut Number`.

## Settled rules (draft, phase 0)

These rules define a separate "dual" language. The paper's language ("pure": every binding
consume-once, explicit `dup`) stays as it is, and the two are never mixed in one program. See
"Two languages" in [mut-and-linear-plan.md](mut-and-linear-plan.md).

Entries marked **accepted** change or extend the notes above and have the author's sign-off.

### Two axes

- **Type capability:** a type is either copyable or `linear`. `linear` is a type modifier
  (`linear FileDescriptor`); `type linear X = ...` declares a type that is only ever used linear.
- **Binding mode:** `mut` (exclusive, lensable, consume-once) or plain (shared, immutable, readable
  any number of times). `~x` parameters are implicitly `mut`.

A value is linear only if its type is. A `lens` binding of a `Number` is a `mut Number`: it can
be `dup`ed or dropped, as in the pure language. Linearity never comes from where a value was
bound.

### Legality

| Operation                       | Result                                       |
| ------------------------------- | -------------------------------------------- |
| read a plain binding            | allowed repeatedly; yields shared immutable  |
| read a `mut` binding            | consumes it (`:=` still yields `()`)         |
| move `mut` into plain           | consuming freeze; type error if linear       |
| plain into `mut`                | needs `dup()`, implicit for a scalar         |
| `dup()` of a linear value       | type error                                   |
| linear value in a plain binding | type error                                   |
| write or lens a plain binding   | type error                                   |

Borrowing is lenses. A lens is an exclusive focus, so there are no shared read-only borrows.
Shared immutable values cover the many-readers case; `mut` plus a lens covers the one-accessor
case. A getter-only lens may come later as a capability restriction, never as a sharing mechanism.

### Decisions

1. **What makes a value linear (accepted).** Only *observable* cleanup does: closing an fd, ending
   a connection, anything a program can see happen. Plain memory reclamation does not. This revises
   "anything on the heap is linear". Otherwise the freeze rule means nothing heap-allocated can
   ever be shared. A type declares observable cleanup by being `linear` and naming its cleanup
   function; the exact syntax is left for phase 2. Alternative if you prefer to keep "all heap is
   linear": add an explicit `shared` wrapper that consumes a linear value and runs its cleanup on
   the last drop. That weakens static single ownership at one visible point.
2. **Reclaiming shared memory (accepted).** Go relies on its GC. C uses reference counts. Frozen
   data is immutable and built bottom-up, so it cannot form cycles, and counts are enough. A write
   path never sees shared memory, because plain to `mut` goes through `dup()`, which deep-copies.
3. **Scalars (accepted).** Number and Bool: stored inline, no allocation. String and every
   aggregate (tuple, record, union) are ordinary shareable immutable data, not scalars, even when
   their fields are scalars. The only place scalars differ is plain to `mut`, where the `dup()` is
   implied. Reads never copy: a plain binding is readable any number of times because it is
   plain, and reading a `mut` binding consumes it for every type. Auto-copying on reads of `mut`
   would leave the place full, so `x := x + 1` would return the old value instead of `()`.
4. **Getter-only lenses:** out of scope for this work.
