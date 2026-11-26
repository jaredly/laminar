# Owned lenses: moving a lens into a closure

Status: owned lenses are implemented in the checker (see
[What the checker does now](#what-the-checker-does-now)), on the Go and C backends and in the
reference evaluator (see [What the backends do now](#what-the-backends-do-now)). The shared closure
mode is not started. It grew out of [concurrency.md](concurrency.md), where
a connection that should be a lens, with its cleanup owned by the library that produced it, cannot be
handed to a task.

## The problem

A lens is a borrow. The checker treats it as second class: it can be passed down a call, and a
closure cannot capture it.

```
let conn = ~connection(listener)        // a lens; connection's cleanup closes it
spawn(fn () { handle(~conn) })          // borrowed-capture: Closure cannot borrow outer binding conn
```

That rule is right for a lens into someone else's storage (`~board`, a `~world` argument): the
closure could outlive what the lens points into. It is wrong for a lens the producer made for
itself, like a connection, which points into nothing. There is nothing to outlive, so moving it is
as safe as moving an owned value. The restore (the producer's cleanup) just has to run when the new
holder is done.

## What works today, and why it is not enough

Checked against the compiler:

- The owned linear value moves into the task and the lens scope opens there. `scoped(mut c)` takes
  the value and lends it back for a scope (`lens conn <- c`), and `spawn(fn () { handle(c) })`
  moves `c`. Using `c` afterwards is `use-after-move`. This compiles and its cleanup runs.
- A library can own the whole thing: `serveEach(listener, handler)` accepts, spawns, opens the scope
  inside the task and calls `handler(~conn)`. 100 concurrent connections left one socket open (the
  listener) and the race detector was silent.

Both work, but the connection is a bare linear value between `accept` and `scoped`, the producer
needs a second function to turn it into a lens, and every library has to rebuild that pair. An
owned lens would make that one concept.

## The proposal

A lens can be **owned**. An owned lens is a lens whose ownership, including its restore obligation,
moves to whoever holds it, the way an owned value moves.

| Binding | Meaning |
| --- | --- |
| `x` | plain: shared, immutable |
| `mut x` | an owned value: exclusive, consumed by a read |
| `~x` parameter | a borrowed lens: the caller keeps the storage, the callee must restore it |
| `mut ~x` parameter | an **owned lens**: the callee receives the lens and its restore obligation |

`fn foo(mut ~x) {}` already parses and means the same as `~x`, so the spelling is free today. See
the open questions: `mut` already implies exclusive, so another word may read better.

### Producers declare the kind

A function may return an owned lens only if it takes no borrowed lens. `connection(listener)` takes
a plain argument, so it can. `fst(~pair)` depends on a borrowed lens, so its result is borrowed.
This is a fact about the signature, so nothing has to be inferred from loan records and a lens
that arrives as a function argument is never movable: its signature says it is borrowed.

The checker can infer the producer's kind from the body (no borrowed lens in, a lens made by
`lens x <- ...` out). A parameter's kind is written.

### Call sites stay uniform

The call site writes `~conn` either way. The callee's signature decides whether it is a reborrow
(`conn` stays usable) or a move (`conn` is consumed, and a later `~conn` is `use-after-move`).
A bare `handle(conn)` cannot mean a move, because reading a `mut` binding consumes its current
value, which for a lens is the thing it focuses, not the lens.

The price is that a callee whose parameter mode is unknown needs an annotation, for example a
`handler` parameter that is called as `handler(~conn)`. Plain parameters already carry a mode
variable (`freshMode()` in `lambda`), so unification could infer a lens mode too, defaulting to
borrowed. That is an optimisation to add later, not a requirement.

### Capturing

Whether a closure may capture a lens depends on the binding's own type, never on the callee:

- an **owned lens** binding is captured whole, by move. Inside the closure it is an ordinary lens
  name: `~conn` can be reborrowed any number of times, or passed to a `mut ~` parameter once.
- a **borrowed lens** binding is still `borrowed-capture`.

This makes `spawn(fn () { handle(~conn) })` legal when `conn` came from a producer of an owned lens.
The closure is once-callable, so ending the closure ends the lens.

### Ending

Not required to move. An owned lens that is not moved ends at the end of its scope, which runs its
restore, the same way a lens scope ends today. Moving it only transfers who ends it. Anything that
must be finished explicitly is what `type linear` already provides and stays a separate choice.

The existing rule still holds: an owned lens must hold a value when it ends, or it is
`unrestored-lens`. That is why every read of a lens-bound handle in the examples is `dup(~fd)`.

### What it looks like

```
fn connection(listener) ~{                 // returns an owned lens: it takes no borrowed lens
    lens fd <- accept(listener)
    closeHandle(fd)
}

fn handle(requests, mut ~conn) {            // owned: this function ends the lens
    let request = recvFrom(~conn)           // reborrow
    sendTo("...", ~conn)
}

fn serve(listener, requests) {
    let conn = ~connection(listener)
    spawn(fn () { handle(requests, ~conn) })     // captured by move; the call moves it again
    serve(listener, requests)
}
```

(A lens argument must come last, so `requests` precedes `conn`.)

## Checker work

All in the checker, testable without touching a backend.

1. **A mode on lens types.** `flow(read, write, replaceable)` gains an owned/borrowed marker, beside
   the `OWNED`/`SHARED` mode that plain types carry in `src/types.ts`. It has to unify, print and
   round-trip through `src/elaborated.ts` and the typed IR.
2. **The `mut ~x` parameter.** `lambda` in `src/infer.ts` already handles `pat.type === 'lens'`,
   including "Lens argument must be last" and the restore check at exit. An owned lens parameter
   skips the "borrowed from the caller" bookkeeping and gets its own place that it must end.
3. **The producer rule.** A function whose result is an owned lens may take no borrowed lens
   parameter. An error otherwise, with a message that names the parameter.
4. **Type-directed capture.** `captureUses` in `src/captures.ts` runs on the AST before types
   exist and files every `~name` in a closure as borrowed. `lambda` then rejects any borrowed
   name that is a local. This has to consult the binding: an owned-lens alias is captured by move
   (the same path as a captured `mut` value, with a lens type), and anything else is rejected as
   now.
5. **Moves at call sites.** Unifying a `~conn` argument with a `mut ~` parameter consumes the
   binding. Later uses are `use-after-move`.
6. **Linear interplay.** `Conn` can stay `type linear` underneath. A lens over a linear type is
   already allowed; an owned one must be moved or ended like any owned value.

## Closure modes: shared, owned, linear

A closure's mode is the join of its captures' modes, the same lattice values already use:

| Captures | Closure | Calling it | Copying it |
| --- | --- | --- | --- |
| only plain (shared, immutable) values | **shared** | any number of times, even from many tasks | shares it; nothing is copied |
| a `mut` value, moved in | **owned** | once; the call consumes it | no |
| a linear value or an owned lens | **linear** | once, and it cannot be dropped | no |

Shared closures are what makes a handler reusable: `serveEach(listener, handler)` could take a
closure that captures the request channel and call it for every connection, instead of a named
top-level function.

### What existed before the checker work

Checked against the compiler on all three backends:

| Program | Result |
| --- | --- |
| a top-level `fn` called twice | works; definitions are reusable |
| `let f = fn (x) { x + 1 }`, then `f(1), f(2)` | `use-after-move`, though it captures nothing |
| the same with a plain capture, `x + k` | `use-after-move` |
| `fn twice(f) { (f(1), f(2)) }` with a closure or a named function | `use-after-move` |
| `apply(f, 1), apply(f, 2)`, copying a plain closure into each call | accepted, and now correct on all three backends (see below) |

So shared closures do not exist as a mode. Every closure is affine, including ones that capture
nothing, so a closure still cannot be called twice directly. But the checker lets a plain closure be
copied by reading it, and that now works everywhere.

That copy used to be a heap-use-after-free in C, and the reference evaluator refused it
(`unsupported-reference-dup`). The C copy shared the closure's environment without counting it,
and the closure body frees its environment on return, so the second call read freed memory. Fixed:

- **Sharing a closure retains its environment.** A copy or shared read is one more holder of the
  reference-counted environment (`shareCallable` in `src/c/lower.ts`). A closure with no captures has
  no environment and nothing to count.
- **The sole holder moves its captures out; a holder of a shared environment copies them.** The
  closure body checks `unique_context` for each capture that reaches heap data. A call therefore owns
  what it uses, and the other holders still see theirs.
- **Only the last holder drops the captures.** A closure's `dispose` entry drops them only when the
  environment is unique, and otherwise just gives up its reference.
- **The reference evaluator copies the function value,** with its own copies of the captures.
- Tests: `test/backend/shared-closure-samples.ts`, run on the reference evaluator, C under ASan (which
  fails on a leaked environment) and Go. Without the C change five of the six fail.

The copy per call costs one deep copy of any heap capture when the environment is shared. A real
shared mode can avoid it, because shared captures are immutable and can be shared in turn.

### The linear case

A closure that captures a linear value or an owned lens must be called, or passed to something that
consumes it, and cannot be dropped. That one rule replaces a "dropped closure must still end the
lens" path in the backend. It also closes a hole that exists today:

```
let mut c = Conn(1)
let f = fn () { finish(c) }     // accepted; f is dropped and the connection is never closed
0
```

The checker now rejects it.

### What it needs

- **A mode on function types.** A closure's type does not record what it captured, so its mode
  cannot be derived from the type. `fn(args, result)` gains a three-valued flag and `isLinear` reads
  it. The mode of a closure is computed in `lambda`, where captures are already known.
- **Calling follows the mode.** `desugar-plain` deliberately leaves a callee unread ("closures are
  affine and cannot be duplicated"). A shared callee must be read as shared instead, so the call
  does not consume it.
- **Capturing follows the mode.** A shared closure shares its plain captures where `closure()` in
  `desugar-plain` copies them today.
- **Droppable goes where linear is expected, not the reverse.** Consuming a shared or owned closure
  is fine where a linear one is wanted, so `spawn` takes all three. A function that may drop or
  reuse its closure argument rejects a linear one at the call (`linear-unconsumed`), and one that
  calls it twice rejects an owned one.
- **Higher-order inference** uses the mode-variable machinery plain parameters already have,
  defaulting to the least demanding mode, with annotations where it is unknown.
- **Backends.** A shared closure is shared, not copied. Go already does this (GC). C needs reference
  counts on the environment (`retain_context` exists for strings and vectors), atomic once tasks
  exist there. The reference evaluator needs to share a callable value instead of throwing.

## What the checker does now

Dual mode only. Tests are in `test/owned-lenses.test.ts`.

All six items above are in, with these decisions:

- **The producer rule holds by construction.** A returned lens is owned exactly when the function
  has no `~x` parameter. Nothing is inferred from the body, so there is no separate producer error:
  moving the result of a borrowing function is `borrowed-lens-move` where the move is written.
- **Spelling** is `mut ~x`, and `mut ~A` for a parameter in a function type. A result is always
  written `~A`.
- **Unknown callees borrow.** To take ownership, use a top-level declaration, which now speaks
  before the body is checked: `each :: (Number, (mut ~Number) => ()) => ()`. A function type
  after a parameter's `:` does not parse, and in dual mode a declaration needs every value parameter
  to be `mut`. Both limits were already there.
- **Branches.** A lens moved in one branch is moved afterwards. The other branches must still hold a
  value, and end the lens at the branch edge. In a lens-valued `case`, every arm must agree.
- **Typed IR** carries `owned` on lens positions and `linear` on function types. `owned` is part of
  a function type's identity, because the calling convention differs. `linear` is not.

Linear closures are in; shared closures are not. Function types have two states, not three, and
linearity is not inferred through unification:

- A closure is linear when it captured a linear value or an owned lens. Two function types that
  differ in this do not unify (`linear-closure-mismatch`), so two branches cannot mix them.
- A linear closure can be passed to a top-level function whose `mut` parameter is only ever called,
  or passed on to another such parameter, once on every path. `spawn` counts as a call. Anything
  else is `linear-unconsumed`. This is conservative: a local function and a recursive self-call
  never qualify.
- A generic closure that captures a value of unknown type can only be used at types that are not
  linear.

Linear closures needed four older leaks closed, which also changes how plain linear values check:
`let _ = Conn(1)` (or any `_` over a linear value), a value consumed in only one branch, a generic
wrapper around a function that drops its argument, and a generic `_` or one-sided branch used at a
linear type are all `linear-unconsumed` now.

## What the backends do now

All three run moved lenses. The samples in `test/backend/owned-lens-samples.ts` make every cleanup
print, so each checks when each lens ends, and all three must print the same thing
(`test/owned-lens-execution.test.ts`). C runs them under ASan and UBSan at `-O0` and again at `-O2`,
and its test program aborts if any allocation is still live at exit.

- **One convention.** An argument to a `mut ~` parameter, or a captured owned lens, is one
  self-contained lens struct whose `restore` runs everything still pending. The caller runs nothing
  afterwards. A function that returns a lens already packed it this way.
- **Typed IR** has a `give` instruction, which takes a lens out of a scope's loan, a parameter or a
  capture without restoring it, and an `end` cleanup for a parameter or capture that is still held.
  The scope that gave a lens away has no `release` for it. When one branch gives a lens away, the
  others end it on their own edge, newest first.
- **The IR verifier** checks that each owned lens ends or moves exactly once on every path, and
  that a lens which moves borrows no caller storage.
- **Shape.** An owned lens is never split into one pointer per field, because only the single
  struct has a `restore`.
- **Tail calls.** A restore is a Go closure. A function whose closures mention its own parameters
  is already left as recursion, and one that only mentions locals gets fresh ones on each pass, so
  an accept loop stays a loop.
- **C** has no closures of its own, so the struct's `context` is a counted heap allocation holding
  the focus and every local the pending cleanup reads. The restore function releases it. A function
  that moves several lenses builds one context for each. A captured lens is moved out of the
  environment and never copied, since a closure that holds one cannot be shared.
- **C exports** reject a definition whose result holds a closure that must be called: a host could
  drop the handle, skipping the cleanup. Lens parameters and results were already rejected.
- **The reference evaluator** hands over the lens object itself, still unfinished. It runs the typed
  IR directly, so it shares nothing with the backends' lowering. It fails if a lens is restored
  twice, if a function returns still holding one, or if a closure that holds one is dropped.
- **Branch joins.** A branch that ends or moves a lens clears that lens's storage in every arm
  before joining them. Without that, C read freed memory when one arm wrote a string through a
  lens and another moved it. Random programs compared against the reference found this; the
  hand-written samples had not. `test/owned-lens-random.test.ts` keeps that comparison, with
  fixed seeds; `LAMINAR_LENS_SEEDS=1000-1400` runs other ones.
- **`examples/server.lm`** now moves each connection into its own task. Built with `go build -race`
  and sent 200 `/count`, 100 `/mandelbrot` and 100 `/slow` requests at once, it answered all 400
  in 1.1 seconds with counts 1 to 200, left only the listener open, and reported no races.

Not yet:

- C has no `spawn`. The reference evaluator has `spawn`, channels and `sleep`, so moves into tasks
  are compared between it and Go. It has no sockets, so `examples/server.lm` runs only on Go.
- The reference runs one interleaving of a program and cannot find a data race. That still takes
  `go build -race`.
- A lens cannot move inside a lens-valued `case`.

## Backend plan

This was the harder half, and the reason to do the checker first.

A lens today is borrowed in a lexical scope. The typed IR emits `borrow` for the `let`, and the
nested block carries a `release` cleanup, so the restore runs at the end of the `let`. In Go the
lens is a struct (`read`, `restore`, `context`) and the generated code calls
`v.restore(v.context, final)` at that point.

For an owned lens:

- **The restore moves** from the end of the `let` to the end of the closure body, or the end of
  the function that owns it.
- **The lens struct rides in the closure environment**, as a capture.
- **No dispose path.** Because a closure that captures an owned lens is itself linear (see below),
  it is always called or passed to something that consumes it, so the lens always ends in the body.
  The closure's `dispose` entry never has to run a restore.
- **C** has the same shape (`LensResult`/restore callbacks) but no `spawn`; it gets the type
  rule and the move semantics for free, and the closure-end restore when it needs tasks.
- **The reference evaluator** needs the lens value to travel in a closure's captures and the
  restore to run when the closure's body finishes.

## Tests

Accepted:

- producer returns an owned lens, a closure captures and ends it
- an owned lens passed to a `mut ~` parameter, reborrowed first
- an owned lens left unmoved ends at the end of its scope
- a closure that captures an owned lens or a linear value, called once or passed to `spawn`
- a shared closure called twice, copied into two calls, and called from two tasks, on all three backends
- the `server-pool.lm` and `serveEach` shapes rewritten without a bare `Conn`

Rejected, each with its own code:

- a borrowed lens captured (`borrowed-capture`, as now)
- a lens argument (`~x` parameter) captured
- an owned lens used after it moved (`use-after-move`)
- a producer that returns an owned lens but takes a borrowed one
- an owned lens that holds no value when it ends (`unrestored-lens`)
- a closure that captured a linear value or an owned lens and is dropped uncalled (`linear-unconsumed`)
- a linear closure passed to a function that may drop or reuse it
- an owned closure called twice
- a call that moves a lens into a callee of unknown parameter mode (needs an annotation)

## Open questions

- **Spelling.** `mut` already implies "exclusive, consume-once", and every `~x` is implicitly `mut`,
  so `mut ~x` reading as "owned" overloads the word. `own ~x` or `move ~x` are alternatives.
- **Return syntax.** How a producer says it returns an owned lens, if inference is not enough.
- **Lenses in data.** Whether an owned lens can be stored in a tuple or record, or returned inside
  one. Nothing above needs it. Allowing it makes owned lenses first-class values, which is a bigger
  step than moving them into closures.
- **Channels.** Channels are typed now ([concurrency.md](concurrency.md#typed-channels)). A lens
  still cannot be sent as itself, but a closure that captured one can, and its receiver must call
  it. `examples/server-workers.lm` hands connections to workers that way.

## Not in this work

- **Scoped and joined tasks that may borrow.** A different feature for lenses into someone else's
  storage (splitting a `mut` vector between tasks). See option D in [concurrency.md](concurrency.md).
- **A shared borrow** of a lens for many tasks. `mut-and-linear.md` rules out a getter-only lens as a
  sharing mechanism; shared resources like a listener are plain values.
