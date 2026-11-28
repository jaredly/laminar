# Plan: ownership in function types

Status: proposed. Nothing here is built, apart from what "Where we are" lists and the rules for
sharing and copying functions.

This finishes phase 5a of [the mut and linear plan](mut-and-linear-plan.md). Everything here is
about dual mode unless it says otherwise.

## Where we are

A function type records, for each parameter and for the result, whether it is owned (`mut`) or
shared (plain). Two function types match only if all of these are equal.

Built: `mut` can be written on a parameter, an unmarked written parameter is
shared, a signature must agree with its definition about `mut` on parameters, union fields follow
the file's mode, and dependency entries may take `mut` parameters.

Still wrong:

| Problem | Example |
| --- | --- |
| Printed types mark the opposite of what is written | `(&Number) => Number` means a shared parameter and an owned result |
| A result cannot be marked, and unmarked means owned | `(a) => mut b` does not parse |
| A function that only reads does not fit where one that takes ownership is expected | `fn ap(f) { f("a") }`, then `ap(show)` |
| The same in pure mode, for built-ins that read | `ap(round)` |
| One that returns an owned value does not fit where a shared result is expected | blocks making unmarked results shared |
| Parentheses around a type make a 1-tuple | `((a) => b)` is not the same type as `(a) => b` |
| A function-type annotation on a parameter crashes the checker | `fn ap(f: ((String) => String))` |
| An injected function with dependencies cannot take `mut` | rejected by `bindNeeds` |
| `mode-mismatch` talks about `mut` and `dup` even when neither is in the source | |

## Inventory of forms

Every form the plan has to cover, in dual mode unless a row says otherwise. "Today" is the current
syntax and "Planned" is what it should become. **Open** marks something not yet decided.

### Parameters

| Form | Today | Planned | Printed today |
| --- | --- | --- | --- |
| shared value | `T` | `T` | `&T` |
| owned value | `mut T` | `mut T` | `T` |
| borrowed lens | `~T` | `~T` | `T/T` |
| borrowed lens, whole value fixed | `=T` | `=T` | `T/=T` |
| borrowed lens that changes type | `A/B` | `A/B` | `A/B` |
| borrowed, fixed, changes type | `A/=B` | `A/=B` | `A/=B` |
| owned lens | `mut ~T` | `mut ~T` | `mut T/T` |
| owned lens: fixed, type-changing, or both | none | `mut =T`, `mut A/B`, `mut A/=B` | `mut A/B` and so on |

I have not checked that all three owned variants in the last row can arise in a program.

### Results

| Form | Today | Planned |
| --- | --- | --- |
| shared value | none | `T` |
| owned value | `T` | `mut T` |
| borrowed lens | `~T` | `~T` |
| owned lens | `~T` | `mut ~T` |
| borrowed lens: fixed, type-changing, or both | `=T`, `A/B`, `A/=B` | the same |
| owned lens: fixed, type-changing, or both | `=T`, `A/B`, `A/=B` | `mut =T`, `mut A/B`, `mut A/=B` |

### What a function value allows

This is separate from what the function takes and returns.

| Kind | Copy | Drop | Today | Planned | Printed today |
| --- | --- | --- | --- | --- | --- |
| top-level definition, named | use again | yes | its name | its name | |
| reusable value | yes | yes | `(A) => B` | `(A) => B` | `(A) => B` |
| closure with state | no | yes | none | `once (A) => B` | `once …` |
| must-call closure | no | no | none | `linear (A) => B` | `linear …` |
| any value, pure mode | no | yes | `(A) => B` | `(A) => B` | `(A) => B` |

A closure must be called when it captured a linear value or an owned lens. Functions that travel
over channels are also treated this way today; see "Channels" below.

### Where a function value is held

A kind has to be writable wherever a function type can be. Today none can be written anywhere.

| Place | Today |
| --- | --- |
| parameter | `mut (A) => B` says who owns it, not which kinds it takes |
| result, alias, tuple, record | no kind |
| vector or other type argument | no kind |
| union field | no kind: a written function type is reusable |
| channel | not written: a function carried by a channel becomes must-call |
| dependency | no kind needed: dual entries are reusable, and pure mode takes only top-level functions |

A kind is written in front of the function type, as in `Chan(linear () => Number)`, which works in
all of these. **Decided: `once` and `linear` imply `mut`**, since neither kind can be shared. In a
parameter or result, `once (A) => B` is owned without writing `mut`.

### Promises and requirements

| Form | Meaning | Written today | Planned |
| --- | --- | --- | --- |
| exactly-once parameter | the function calls or forwards this argument once on every path, so it may be given a closure with state or a must-call one | no: inferred, and stored beside the type | phase 6 |
| copyable type variable | a generic function copies or shares such values | no: prints as `where Copyable(a)` | phase 6 |
| droppable type variable | a generic function may discard such values | no: prints as `where Droppable(a)` | phase 6 |
| generic replaceability | a function works whether or not a lens's whole value can be replaced | I know of no syntax | phase 6 |

An exactly-once promise belongs to a named or inferred function. A written callback type cannot
carry it. If the parameter's type states its kind, as in `mut linear () => a`, the type may be
enough and the separate promise may not be needed. I have not tested that.

### Dependencies

These are separate from ownership, and all can be written: `=>` (inferred; none in a union field),
`={}>`, `={x: T}>` or a record alias, `={e}>`, and `={x: T, ...e}>`.

## Channels

Today a function type that becomes part of what a channel carries is changed to must-call, even if
the checker has only seen the receiver call it. So `Chan(() => ())` silently means a channel of
must-call functions. **Decided direction: the channel's type says it**, as in
`Chan(linear () => Number)`, and the special rule goes.

I expect this to be sound, though I have not built it. Both ends share one channel type, and
function types of different kinds already fail to match. So:

- `Chan(() => a)` carries reusable functions, and sending a must-call closure into it is an error.
- `Chan(linear () => a)` accepts any function at `chanSend`, since calling once is always allowed.
  The receiver must call what it gets.
- The two channel types never convert into each other. A channel is both written and read, so
  either direction would break a promise.
- A channel for closures with state needs that kind's spelling too.

What needs work:

- **A kind nothing states.** This arises only when inference has no annotation or other known
  type to go on. Functions cannot be generic over kinds, so one has to be chosen. **Decided: it
  defaults to must-call** where the body allows it. A body that does more with what it receives
  gets the kind that permits it, and which accepts the most senders:

  | The body | Inferred kind |
  | --- | --- |
  | only calls what it receives, on every path | must-call |
  | may drop it, and never copies it | closure with state |
  | copies it | reusable |

  A send inside the same definition does not force a kind, since a reusable function may be sent
  into a must-call channel. A caller with a reusable-only channel then has to annotate the
  receiver.
- **Reusable functions between tasks.** Receivers could then copy and call them. Their captures
  cannot change, but this needs a run under Go's race detector.
- **Existing code.** `Chan(() => ())` in a signature or union field changes meaning and needs
  `linear`. The channel tests and [concurrency](concurrency.md) describe the old rule.
- The special rule also covers functions inside tuples, records and other data that is sent. A
  written kind covers these as long as it can appear inside any type.

## Lens results

**Decided: a lens result states its ownership**, as a parameter does. `~T` is borrowed and
`mut ~T` is owned.

Who owns a returned lens still follows from the parameters, as [owned lenses](owned-lenses.md)
describes: it is owned exactly when the function borrows no lens. The written form must agree with
that, or it is an error. Today `~T` means whichever the parameters imply, so every written result
that is owned has to gain `mut`. `(a) => mut ~b` does not parse yet.

## Rules

### Writing and printing

An unmarked position is shared. `mut` makes it owned. This now includes results.

```
(String) => String            // reads its argument, returns a shared string
(String) => mut String        // returns a string the caller owns
(mut Vector(a)) => mut b
mut (a) => mut b              // an owned function value
```

- A function type written with `once` or `linear` is owned without `mut`:
  `(linear () => a) => once () => b` takes and returns owned functions.
- `mut` is allowed on a parameter or result of a function type, and nowhere else. `(mut a, b)`
  as a tuple type, or `Vector(mut a)`, stays `invalid-mut`. One mark covers a whole result.
- A lens position (`~A`, `mut ~A`, `A/B`) keeps its own meaning. `mut` there says who ends the
  lens, in a parameter or a result.
- Pure mode has no `mut`. A written position there is owned, as now.

Printed types use the same spelling, so `&` goes away, and no `mut` is printed before `once` or
`linear`:

| Type | Printed now | Printed after |
| --- | --- | --- |
| reads, returns owned | `(&Number) => Number` | `(Number) => mut Number` |
| takes and returns owned | `(Number) => Number` | `(mut Number) => mut Number` |
| reads, returns shared | `(&Number) => &Number` | `(Number) => Number` |

The printer has to be told the mode: pure mode prints no marks. While changing it, make dual-mode
output parse again: print `Chan(Number)`, not `Chan<Number>`, print an owned lens as `mut ~A`,
and give the other owned lens forms syntax. Kinds must print as they are written. `where` clauses
and rigid variables (`!a`) will still not parse unless phase 6 gives them syntax.

### When one function type fits where another is expected

| Position | The function has | The slot expects | Fits? |
| --- | --- | --- | --- |
| parameter | shared | `mut` | yes: the caller hands over a value, and it is only read |
| parameter | `mut` | shared | **no**: it could write a value others can see |
| result | `mut` | shared | yes: an owned value is frozen |
| result | shared | `mut` | **no**: others may still hold it |

So `(T) => mut R` fits every combination, and `(mut T) => R` accepts every function from `T` to
`R`.

- Inside a parameter the directions reverse, because there the slot supplies the function. A
  function that accepts any callback, `(mut (mut a) => b) => c`, fits where one is expected that
  only ever hands over readers.
- Only function types convert. A `Vector`, record, union or channel that already holds functions
  keeps its exact type. In a literal each element converts where it is written, so
  `[reader, writer]` gets the type that both fit.
- Not every owned value can become shared; see the next section.

### What cannot become shared

Making a result shared must be allowed exactly when `let p = m` would be, where `m` is `mut`. I
tried that statement on each kind of value:

| Value | `let p = m` today |
| --- | --- |
| a linear union | rejected (`linear-plain`) |
| a tuple, record, union or vector holding one | rejected |
| a closure that captured a linear value or an owned lens, or a tuple holding it | rejected |
| a function received from a channel | rejected |
| a channel that carries linear values | accepted, as intended: the handle can be shared, and each message is still linear |
| a closure that captured a `mut` value and could change it | rejected (`shared-closure`), since the fix below |

**The check will not come for free.** Today a shared result comes from reading a plain binding,
and declaring that binding already required its type to be shareable. A signature `=> R` over an
owned body, and a converted function value, freeze a result with no binding. Both must add the
requirement themselves. Where the type is a variable, the requirement has to stay on the scheme,
so that a later linear instantiation is rejected.

**Closures with their own state are now refused.** Before this, one could be moved into a plain
binding and copied. The reference evaluator and C gave each copy its own captures, but Go shared
them, so the copies saw each other's writes, and two tasks calling them raced. [Owned
lenses](owned-lenses.md) describes the rule as built. Two limits matter for this plan:

- Such a function type matches only another with state. A written function type cannot say it
  until kinds have a syntax (phase 6). An earlier idea was to let an owned (`mut`) position hold
  either kind. A written kind also works inside containers, which `mut` cannot, so the plan now
  leans that way.
- Conversion must carry the restriction: a function whose result is such a closure cannot fill a
  shared-result slot.

In pure mode no function value can be copied by `dup` or `array`. Dependencies are the one
exception, since each `#name` read copies the entry: the only functions `inject` accepts are
top-level ones, named at the `inject`.

`array(n, value)` copies its value but had no copy requirement, so in dual mode it could duplicate a
linear value. It now has the requirement `dup` has.

### No runtime code

I forced the checker to ignore ownership mismatches in a scratch copy and ran the results:

- **Both allowed directions** gave correct output on native C with AddressSanitizer, wasm32 and
  Go. Four programs covered a shared-parameter function returning a fresh string or its
  argument, one that takes a boxed value apart, and an owned result in a shared slot. The same
  four showed no leaks under macOS `leaks`.
- **A forbidden direction** (a function that writes its argument, where a reader is expected)
  compiled everywhere and silently changed a value the caller still held. The reference evaluator
  gave the correct answer, because it copies.

So a conversion only changes a type. No wrapper and no new IR operation are needed. In the second
case above, the result was returned into an owned slot, which the rules forbid. It worked only
because the argument was a temporary, so it is evidence about the calling convention, not a reason
to allow it.

Two consequences:

- `typeKey` and `flowKey` ignore ownership inside function types, so **the IR verifiers cannot
  catch a bad conversion.** All the safety would rest on the checker.
- **Tests that only run the reference evaluator cannot catch one either.** Conversion tests must
  run natively and compare with it.

### How the checker converts

Inference unifies, so it has no subtyping. It already handles a similar case for dependencies
(`widen` in `src/infer.ts`). Do the same here: when a function value whose type is already known
is used as a value, replace each position that may convert with an open mode that **defaults back
to what it was**.

- Meeting an exact slot fixes the mode. Meeting nothing leaves it as declared.
- Two branches join by themselves. A reader's open parameter unifies with a writer's `mut`.
- This needs a default per open mode. Today every undecided mode defaults to owned.
- A conversion that would freeze a result adds the requirement that its type is not linear.

The limit: only a type already known at the use converts. A parameter whose type is still being
inferred keeps exact modes, so in rare cases the order of two uses will matter. The alternative is
real mode inequalities solved at generalization. That removes the limit but changes how schemes
are solved, so I would not start there.

### Inference without a written type

A call of an unknown function still decides its modes from the call.

- **Parameters: keep today's rule.** If every call passes an owned value, the parameter is `mut`.
  If any call passes a shared one, it is shared. Once conversion exists, `mut` is the choice that
  accepts the most functions, so `ap(show)` just works, and `ap` prints as
  `((mut String) => mut a) => mut a`.

  This replaces my earlier suggestion to default these to shared. That would have made `ap`
  reject any function that takes ownership.
- **Results: keep owned** unless the body or a signature requires otherwise. Then an unannotated
  `ap` rejects a function that returns shared, such as `fn same(s) { s }`. Writing
  `ap :: ((String) => String) => String` accepts both kinds.

### Signatures

A signature is a contract, and is published as written.

- Parameters must match the definition exactly, as now. They decide what the body may do.
- `=> mut R` needs a body that returns an owned value, or it is `shared-into-mut`.
- `=> R` accepts a body that returns either. Callers get a shared value even if the body's was
  owned.
- A linear result must be written `mut`.
- The special rule that takes the result's ownership from the body is removed.

Constructors and built-ins keep returning owned values.

**This breaks code.** Any dual-mode signature, union field, alias or dependency type whose result
is then written to needs `=> mut`, or the caller needs `dup`. That includes numbers. The examples
have no signatures; about a dozen test files have signatures or expected types to check.

## Phases

Each phase leaves the targeted tests passing.

1. **Grammar.** `mut` on results, including `mut ~T`, in every form that takes a function type,
   including record fields and `={...}>`. Add the other owned lens forms. One-item parentheses
   group instead of making a 1-tuple. Check `(a) => (b) => c`, which does not parse as a function
   type annotation today. The parser lexes `mut` and `=>` flat, so each combination may need its
   own rule; prototype this first.
   *Done when* a table of types, covering the inventory's value and lens forms, parses to the
   expected trees.
2. **Written results and signatures.** Apply "Signatures" above. Reject a shared linear result.
   Check a written lens result's ownership against the parameters ("Lens results"). *Done when*
   the four result cases pass in signatures, union fields, aliases and entries, both lens results
   are checked, and the broken tests are updated.
3. **Printed types.** Give the printer the mode and use the written spelling, including in error
   messages. *Done when* printed schemes without the three exceptions parse back to the same type.
4. **Verifier check.** Wherever the verifiers compare two function types, also check that
   ownership differs only in an allowed direction, from the value to its destination.
   *Done when* the current tests pass and hand-built bad IR is rejected. This goes before phase 5
   so that it is a second line of defence.
5. **Conversion.** Implement "How the checker converts", with the reversal inside parameters. It
   applies in pure mode too, which covers `round`. *Done when* the allowed and forbidden cases
   pass for definitions, lambdas, annotated locals, built-ins, branches, literals, constructor
   arguments, `inject` and channels; native runs match the reference evaluator under
   AddressSanitizer, wasm32 and Go; and a leak check finds nothing.
6. **Written kinds and channels.** Add the `once` and `linear` spellings, let a kind appear
   wherever a function type can, and replace the channel rule as described in "Channels". Decide
   whether exactly-once promises are still needed, and which of the other unwritten forms get
   syntax. *Done when* each kind can be written in every place in the inventory, the channel cases
   pass, and a race-detector run covers reusable functions sent between tasks.
7. **Remaining items.** Let an injected function with dependencies take `mut` parameters, as pure
   mode already allows for owned ones, with a native test of the adapter. Fix the parameter
   annotation crash (phase 1 may already fix it; I have not found the cause). Make
   `mode-mismatch` name the position and show both types. Update the docs.

## Decisions

- Closures with their own state cannot be shared. This is built.
- A closure with state is written `once (A) => B`. `once` and `linear` imply `mut`. Not built.
- A lens result states its ownership with `mut ~T`. Not built.
- A channel's type states the kind of function it carries. Where inference has nothing to go on,
  it is must-call if the body allows that. Not built.
- A callback result inferred only from calls is owned. A written type can accept a shared one too.
  Not changing.
- Conversion reverses inside parameters. Not built.
- Syntax for exactly-once promises, `Copyable` and `Droppable` requirements and generic
  replaceability is decided in phase 6, once kinds can be written. Until each one has syntax or
  stops being printed, not every printed type parses again.

## Not in this plan

Functions generic over ownership, converting functions already inside containers, a different
ownership for each part of a tuple result, injecting lens functions that have dependencies, and
unions holding functions with dependencies. The last two are about dependencies, not ownership.
