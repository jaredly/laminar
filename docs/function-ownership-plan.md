# Plan: ownership in function types

Status: proposed. Nothing here is built, apart from what "Where we are" lists and the rule for
closures with their own state.

This finishes phase 5a of [the mut and linear plan](mut-and-linear-plan.md). Everything here is
about dual mode unless it says otherwise.

## Where we are

A function type records, for each parameter and for the result, whether it is owned (`mut`) or
shared (plain). Two function types match only if all of these are equal.

Already in the working tree: `mut` can be written on a parameter, an unmarked written parameter is
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

## Rules

### Writing and printing

An unmarked position is shared. `mut` makes it owned. This now includes results.

```
(String) => String            // reads its argument, returns a shared string
(String) => mut String        // returns a string the caller owns
(mut Vector(a)) => mut b
mut (a) => mut b              // an owned function value
```

- `mut` is allowed on a parameter or result of a function type, and nowhere else. `(mut a, b)`
  as a tuple type, or `Vector(mut a)`, stays `invalid-mut`. One mark covers a whole result.
- A lens position (`~A`, `mut ~A`, `A/B`) keeps its own meaning. `mut` there says who ends the
  lens.
- Pure mode has no `mut`. A written position there is owned, as now.

Printed types use the same spelling, so `&` goes away:

| Type | Printed now | Printed after |
| --- | --- | --- |
| reads, returns owned | `(&Number) => Number` | `(Number) => mut Number` |
| takes and returns owned | `(Number) => Number` | `(mut Number) => mut Number` |
| reads, returns shared | `(&Number) => &Number` | `(Number) => Number` |

The printer has to be told the mode: pure mode prints no marks. While changing it, make dual-mode
output parse again: print `Chan(Number)`, not `Chan<Number>`, and print an owned lens as `mut ~A`
(or add syntax for `mut A/B`). `where` clauses, rigid variables (`!a`) and `linear` function types
still will not parse.

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

- Such a function type matches only another with state. A written function type cannot say it, so
  phase 2 or 5 needs a spelling, or a conversion from a reusable function into a one-use slot. The
  natural reading is that an owned (`mut`) function position may hold either. I have not tried it.
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

1. **Grammar.** `mut` on results, in every form that takes a function type, including record
   fields and `={...}>`. One-item parentheses group instead of making a 1-tuple. Check
   `(a) => (b) => c`, which does not parse as a function type annotation today. The parser lexes
   `mut` and `=>` flat, so each combination may need its own rule; prototype this first.
   *Done when* a table of types parses to the expected trees.
2. **Written results and signatures.** Apply "Signatures" above. Reject a shared linear result.
   *Done when* the four result cases pass in signatures, union fields, aliases and entries, and
   the broken tests are updated.
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
6. **Remaining items.** Let an injected function with dependencies take `mut` parameters, as pure
   mode already allows for owned ones, with a native test of the adapter. Fix the parameter
   annotation crash (phase 1 may already fix it; I have not found the cause). Make
   `mode-mismatch` name the position and show both types. Update the docs.

## To decide

1. **Inferred results of callbacks.** I recommend staying owned, as above. Defaulting to shared
   accepts more callbacks, but `ap`'s own result then becomes shared, and a linear result stops
   working. Accepting both and keeping each caller's ownership would mean functions generic over
   ownership, which is a much larger change.
2. **Reversal inside parameters.** I recommend including it. Leaving it out is less code, but some
   higher-order functions would be rejected for no safety reason.

Decided: closures with their own state cannot be shared. This is built.

## Not in this plan

Functions generic over ownership, converting functions already inside containers, a different
ownership for each part of a tuple result, injecting lens functions that have dependencies, and
unions holding functions with dependencies. The last two are about dependencies, not ownership.
