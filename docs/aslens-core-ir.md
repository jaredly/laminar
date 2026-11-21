# Owned temporary lenses and deferred restoration

`lens pattern <- initial` creates an owned focus. The initial expression runs
once. When the focus is restored, the cleanup pattern receives the final value,
which can have a different type or shape from the initial value.

```lm
fn shifted(~x) ~{
    lens v <- x + 2
    x := v - 2
}
```

The `@(...)` syntax and the `manual` IR instruction have been removed. Rewrite
an owned temporary using `lens pattern <- initial`. Use ordinary assignment to
fill an already-empty place. Programs that wrapped arbitrary computed lenses
must express the cleanup in the scope that owns the temporary or performs the
original restoration.

## Typed and concrete IR

The `aslens` instruction consumes one owned value into a private backing place.
It retains a deferred block and the lexical slots that block needs protected.
The first cleanup instruction moves the complete replacement out of backing.
The block then binds or matches the final value, runs the cleanup, and disposes
its remaining owned locals. The instruction discards the cleanup result and
ends the backing lifetime. A refutable pattern traps before executing its body
when the final value does not match.

Typed verification checks operand ownership, backing access, cleanup
dependencies, and disposal on detached IR. The representation is a thin lens
over owned storage. Concrete verification checks that lowering preserved the
operation and cleanup contract. The reference evaluator and the C/Wasm and Go
backends implement the same lifecycle.

## Borrowed patterns

A borrowed match exclusively holds the original owner and moves the selected
pattern's stored fields into an `aslens` temporary. The field aliases are scoped
loans, so consumed fields must be refilled. Cleanup moves the final fields out,
rebuilds the selected constructor or tuple, and restores the original owner.
Wildcard fields are retained and literal fields are reconstructed unchanged.

Detached verification checks that the selected pattern came from the original
owner, that the initial and final field mappings agree with it, and that cleanup
restores the same owner and constructor. Returning a field through the temporary
still carries the owner's provenance. A raw local owner cannot escape through a
borrowed field.

## Serialized compatibility

The serialized program envelopes still use version 1. Artifacts with the removed
instruction must be rebuilt from source. Older readers do not understand
reconstruction attached to `aslens`. Elaboration snapshots that contain
temporary lenses must also be regenerated to get the revised metadata.
