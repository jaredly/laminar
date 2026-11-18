# Make `aslens` the core deferred-restoration instruction

## Objective

Replace the general-purpose `manual` IR instruction with an `aslens` instruction
whose contract is owned temporary backing plus deferred cleanup. Lower existing
manual source forms and compiler-generated borrowed-pattern reconstruction to
that primitive, then remove the old manual instruction and its adapters.

This is proposed work, not a description of completed support. The language does
not require wrapping an initially empty focus. Do not retain a general manual
wrapper solely to support that case.

## Motivation and current implementation

The following source forms produce the same result for the shifted-value example:

```lm
fn shifted(~x) ~{lens v <- x + 2
 x := v - 2}
```

```lm
fn shifted(~x) ~{
 let v = x + 2
 @(v, fn () {x := v - 2})
}
```

Today `Inferencer.aslens` gives a temporary owned backing and transfers its final
contents into cleanup-local pattern bindings. `lower-typed.ts` implements this as
an owned scope, a backing place, an acquired lens, a `manual` instruction, and a
deferred move and pattern bind. The enclosing scope disposes backing.

The existing `manual` primitive is more general: it wraps an arbitrary frontend
lens, stages replacement contents, runs cleanup, and completes the frontend's
original restoration. That general composition makes the core responsible for
both temporary ownership and arbitrary frontend restoration.

The proposed core has one lifecycle: own backing, expose its focus, transfer final
contents to cleanup, dispose cleanup results and remaining locals, and release
backing. This should simplify the ownership model and backend contracts. It does
not remove the need for deferred execution or dependency protection.

## Proposed instruction contract

Conceptually, the instruction contains:

```text
aslens {
    initial: owned value
    final: cleanup input pattern
    cleanup: deferred block
    holds: protected lexical storage
}
```

The exact schema is an implementation decision. In particular, decide how the
cleanup block receives final contents and how backing is represented before
changing serialized IR. Avoid independently mutable fields that duplicate facts
the verifier can derive.

Required behavior:

1. Evaluate the initial value exactly once during setup and retain owned backing.
2. Protect backing and lexical cleanup dependencies throughout consumer execution.
3. Stage the consumer's final replacement, including a changed type or shape.
4. Transfer final contents into owned cleanup bindings. They may be consumed without
   refill; borrowed lexical owners must still satisfy their lifetime obligations.
5. Execute cleanup once, dispose its owned result and remaining cleanup locals
   once, and release backing after cleanup completes.
6. Preserve nested restoration order and selected-branch execution. No cleanup
   may observe a computed owner before that owner's required restoration.

The existing identifier, wildcard, and tuple cleanup-pattern scope is sufficient
for this change. Constructor-pattern source support is a separate feature.

## Lowering existing manual forms

Preserve existing initialized manual source behavior by lowering it to the new
primitive. Removing `@` syntax is not required by this proposal and would be a
separate surface-language decision.

For an initialized frontend, the intended translation is:

1. Evaluate and bind the frontend lens exactly once.
2. Move its contents into an `aslens` temporary.
3. On restoration, transfer final contents back into the frontend.
4. Run the original manual cleanup.
5. Complete the frontend's enclosing restoration.

Step 3 must stage the frontend without prematurely completing its restoration.
This ordering is an implementation obligation, not an assumption that ordinary
source assignment is always a sufficient translation. Check nested computed
lenses, tuple focuses, branches, consumed focuses, and cleanup that modifies the
staged frontend. If representing this requires recreating the full manual wrapper
inside `aslens`, revisit the proposed simplification before proceeding.

Generic cleanup expressions must retain restoration-time evaluation and
zero-argument invocation. Existing callback values retain their ordinary capture
semantics. The scoped function-literal cleanup exception must remain scoped;
ordinary escaping closures do not gain borrowing permission.

Do not introduce a dummy initial value to emulate an initially empty frontend.
Determine which existing cases, if any, depend on that capability and report the
compatibility impact explicitly. An initialized frontend consumed later by its
consumer is a separate case and must not be rejected merely because initial
empty-focus wrapping is out of scope.

## Borrowed-pattern reconstruction

Borrowed reconstruction is a natural client of temporary backing:

1. Exclusively borrow the original owner and move its matched contents into
   retained temporary storage.
2. Expose matched fields as borrowed sublenses over that storage.
3. Require consumed fields to be refilled before their sublens lifetimes end.
4. Consume the final fields during cleanup and reconstruct the same matched
   constructor into the original owner.
5. Release the owner only after reconstruction completes.

This changes the lowering, not the language contract. Preserve matched
constructors and literal fields, wildcard retention, constructor-signature type
constraints, unmatched traps, and whole-owner exclusion while field aliases live.

Owned backing must not grant a borrowed reconstruction permission to escape its
original owner. Preserve raw-local escape rejection and the original owner's
provenance. Independent verification must still tie reconstruction to the selected
pattern and validate constructor identity, field mapping, target owner, refill,
and restoration. Decide whether this remains explicit reconstruction metadata or
is expressed through another independently checkable contract.

## Implementation sequence

1. Specify the new typed IR schema and lifecycle. Audit existing manual uses and
   classify temporary lenses, explicit source wrappers, and generated reconstruction.
   Resolve staging and enclosing-restoration ordering before deleting any paths.
2. Implement `aslens` lowering and independent typed verification. Make cleanup
   inputs, dependency protection, ownership transfer, disposal, and escape rules
   explicit. Preserve JSON-detached execution without inference closures or AST
   fallback.
3. Implement representation analysis, concrete lowering and verification, and
   native C/Wasm adapters for the new instruction. Update all block walkers,
   indexers, printers, serializers, and specialization paths.
4. Migrate explicit manual forms and borrowed reconstruction. Preserve existing
   accepted initialized programs and ownership rejection cases.
5. Remove the old manual instruction, redundant retained-context machinery, and
   obsolete verifier paths after all clients migrate. Update schema versions or
   explicitly document serialized-IR compatibility as appropriate.
6. Update the handoff and IR/backend documentation to describe the resulting core
   and its actual supported scope.

Keep existing backend limitations separate from language acceptance. This work
does not require adding callable-focus storage, captured callback invocation, or
nominal/heap physical layouts.

## Verification and completion criteria

Use the existing `aslens`, manual-restoration, borrowed-pattern, computed-alias,
and lens-branch suites as the behavioral baseline. Add targeted regressions where
the new representation changes an ownership or ordering boundary.

Verify:

- Equivalent shifted examples and final-type/shape changes.
- Exact-once setup, cleanup, result disposal, and backing disposal.
- Nested cleanup order, staged tuple contents, and selected branches.
- Lexical dependency protection and refill of borrowed owners.
- Consumed consumer focuses and cleanup-local moves without accidental refill rules.
- Borrowed constructor reconstruction, field refill, and raw-local escape rejection.
- Frontend evaluation once and cleanup before enclosing frontend restoration.
- Independent rejection of corrupted lifecycle, dependency, disposal, provenance,
  and reconstruction contracts.

Run checked legacy execution where applicable, detached generic and specialized
typed execution, serialized typed/representation/concrete verification, and the
shared native C/Wasm corpus. Run TypeScript checking and diff whitespace checks.
Use the existing native optimization and sanitizer matrix for affected adapters.
Record actual results rather than copying historical pass counts from the handoff.

The work is complete when supported clients use `aslens`, the old `manual` IR
instruction is removed, existing initialized behavior and ownership guarantees
are preserved, and the resulting implementation has a demonstrably simpler
lifecycle rather than the former wrapper hidden behind a new name.
