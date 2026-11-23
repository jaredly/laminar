
In order for this language to be really usable, we're going to want the ability to have shared immutable values.
We'll also want scalars to be auto-cloning, semantically.

I'm thinking we have two new features added to the language:
- `let mut x =` and `fn (mut x) {}`, where we can declare a variable as 'mutable'. this means it is both linear and lensable. `~x` in a parameter is implicitly mut.
- `type linear X = y` declares a type to be 'linear only', or in other words, `NoCopy`. This is for types that cannot be `dup`d, such as file descriptors, or http connections, etc. It is invalid to put a linear value in a non-mut variable, or to dup() it.

You can put a non-linear mut value in a non-mut variable, because a mut value is a single owner.
To put a non-mut value in a mut variable, you need to dup() it.

Note that anything on the heap is linear, as it has cleanup(). Anything created with aslens is also linear.
I'm realizing that because of this, we can't have linearity only be a feature of the type declaration. You could have an int on the heap that is linear because it has cleanup, but an int in another context that is not required to be linear.

I guess things like fdopen() would return a `linear FileDescriptor` with cleanup that closes it, but you could imagine a non-linear FileDescriptor (oh like stdout!) that needs no cleanup because it's open for the lifetime of the program.

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

A value is linear if its type is linear **or** its provenance is (an `aslens` result, or an
allocation with observable cleanup). Provenance is why a heap `Int` is linear while a bare `Int`
is not.

### Legality

| Operation                       | Result                                       |
| ------------------------------- | -------------------------------------------- |
| read a plain binding            | allowed repeatedly; yields shared immutable  |
| read a scalar (any mode)        | implicit `dup`                               |
| move `mut` into plain           | consuming freeze; type error if linear       |
| plain into `mut`                | needs `dup()`; type error if linear          |
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
3. **Scalars (accepted).** Number and Bool: stored inline, no allocation, implicitly copied. String
   and every aggregate (tuple, record, union) are ordinary shareable immutable data, not scalars,
   even when their fields are scalars.
4. **Getter-only lenses:** out of scope for this work.
