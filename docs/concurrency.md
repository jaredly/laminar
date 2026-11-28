# Concurrency in dual mode

Status: prototype on the Go backend. `spawn`, number channels, `sleep` and TCP handles exist;
`examples/server.lm` is a concurrent web server built on them. Everything below the first section
is a design note about where to go next.

## Why the memory model already fits

Dual mode's rules were written for in-place updates, but they are the rules a data-race-free
language needs. Each one below was checked against the compiler, not assumed.

| Rule in the language | What it means for tasks |
| --- | --- |
| A plain binding is immutable and readable any number of times | Any number of tasks can read it. Two tasks reading one table compiles and runs. |
| A `mut` binding is exclusive and consumed by a read | Handing one to a task moves it. The spawner can no longer use it (`use-after-move`). |
| A closure moves or shares what it captures, and can never borrow (`borrowed-capture`) | A task cannot reach its spawner's stack or another task's mutable data. Two tasks incrementing one counter does not compile. |
| A lens is an exclusive focus; there are no shared read-only borrows | A borrow cannot be split between tasks by accident. |
| `type linear` values cannot be copied and must be consumed (`linear-unconsumed`) | A connection moved into a task cannot be used twice or forgotten. |

So "no data races" is not a new analysis. `spawn(task)` only has to take a closure, and the
checker's existing closure rules already give it the guarantee Rust spends `Send` and `Sync` on.

Rejected by the checker today (see `test/go/spawn.test.ts`):

```
let mut hits = [:0:]
spawn(fn () { hits[0] := hits[0] + 1 })     // borrowed-capture: the closure may not borrow hits
spawn(fn () { hits[0] := hits[0] + 1 })

let mut c = Conn(1)
spawn(fn () { finish(c) })
finish(c)                                   // use-after-move: c belongs to the task now

let mut c = Conn(1)
spawn(fn () { print("forgot") })            // linear-unconsumed: nobody closes c
```

## What exists

- **`spawn(task)`** runs a closure on its own task and returns `()` at once. It is not a native
  import. The dual-mode desugar rewrites `spawn(f)` into a *detached call* of `f`, so the task goes
  through representation inference, entries and wrappers like any other call. The Go lowerer reads
  the task value on the spawning side and starts `go func() { f(env) }()`. The reference evaluator
  runs it on its own scheduler. C rejects a detached call rather than quietly run it inline.
- **`chanNew()`, `chanSend(ch, v)`, `chanRecv(ch)`** are unbuffered channels. See
  [Typed channels](#typed-channels).
- **`sleep(ms)`** blocks one task while the rest run.
- **`listen(port)`, `accept(l)`, `recv(c)`, `send(c, text)`, `closeHandle(h)`** are the socket
  handles `examples/server.lm` uses. The program holds only numbers; the host decides what they mean.

`examples/server-workers.lm` has long-running workers that are sent connections.
`examples/server-pool.lm` is the same server with the connection as a lens and a fixed pool of
workers; see the gaps below for why. `examples/server-bounded.lm` has a task per connection
and limits how many are open with slots passed over a channel.

State lives in tasks, not in shared memory. `examples/server.lm` keeps its request count as a
parameter of one counter task: handlers send it a reply channel and receive the new count. That is
an actor in four lines, with no lock, and the checker guarantees nothing else can touch the count.

Measured with `go build -race`: 200 concurrent `/count` requests mixed with 100 `/mandelbrot` and
100 `/slow` returned 200 distinct counts (1 to 200), and the race detector reported nothing. Ten
parallel `/slow` requests (one second each) finish in 1.1 seconds.

## Typed channels

`chanNew()` makes a `Chan(a)`, and every use of one channel agrees on `a`. The channel itself is
only a handle: any number of tasks may hold it, whatever it carries. Dual mode, on Go and the
reference evaluator.

- **A send moves.** `chanSend(ch, x)` uses up a `mut` value. A plain binding is sent as a real
  copy, because the receiver owns what it gets and the two tasks must share nothing that either
  could change. So a plain binding of a linear value cannot be sent.
- **A channel's type says what kind of function it carries**: `Chan(() => a)` reusable ones,
  `Chan(once () => a)` closures with state, and `Chan(linear () => a)` ones the receiver must call.
  The three types never convert into each other, since a channel is both written and read. Any
  function can be sent into a must-call channel.
- **Where nothing says, a channel is must-call if the receiver allows it.** A job may have captured
  anything, including a connection. A receiver that only calls what it gets, on every path, takes
  must-call jobs. One that may drop a job gets a `once` channel, and one that copies it a reusable
  channel. A send in the same definition forces nothing, so a caller with a reusable channel has to
  annotate such a receiver. The same holds for a function inside a tuple, record or generic data.
- **Reusable functions may be copied across tasks.** What they capture cannot change, and a test
  runs this under Go's race detector (`test/function-conversion-execution.test.ts`).
- **Linear data** (`type linear`) sent over a channel must likewise be consumed by the receiver.

How the checker does it: a function type that a call worked out, and that becomes part of what a
channel carries, has its kind left open. After the item is checked, the kind is chosen from what
the item does with such values. A written type, a lambda or a definition keeps its own kind.

Where it is stricter than it needs to be, or does not reach:

- A local function cannot take a job; only a top-level function that consumes it can.
- When a generic worker loses what it receives, the error points at where it is used with a
  linear type, not at the line that loses it.
- A channel is unbuffered, so it holds nothing. But a task still waiting to send when the program
  ends never hands its value over: that job never runs, and a lens inside it is never restored.
  No check prevents this. As in Go, the program ending ends every task.
- There is no closing a channel, no choosing between channels, and no separate send and receive
  ends.

Checking this found that names a scope or a `match` arm bound and then left were not counted
when a generic function was later used with a linear type, and that arm names were not checked at
all. Both were older than channels and are closed.

## Options

**A. Detached tasks that own their captures (done).** Simplest, covers servers and background
work. Weak point: no result, no join, no cancellation, and a task that panics takes the process
with it.

**B. Channels that move ownership (typed; see above).** A send consumes its value, so a message
is handed over rather than shared. This is the natural second half of A. Still to do: closing,
and with it linear endpoints (`Sender(a)`, `Receiver(a)`) so a channel cannot be used after it
is closed.

**C. Actors (works today on B).** A task that loops over `chanRecv`, threading its state through a
recursive call. The Go backend turns that recursion into a loop. No new feature needed.

**D. Structured fork/join over disjoint lenses (not started).** The most distinctive option for this
language. A lens is an exclusive borrow, and a tuple's projections (`fst` exists; a `snd`
would mirror it) are disjoint ones, so a scoped `par` could run two tasks over two halves of one `mut` value and give
the whole value back when both finish. That is `split_at_mut` plus a scope, checked by rules that
already exist. It needs one new rule: a closure may borrow if it cannot outlive the scope that
joins it. `borrowed-capture` stays for `spawn`, where nothing joins.

**E. Parallel work on immutable data (cheap once there is a join).** Because plain values are
immutable, `spawn` plus a result channel gives parallel map with no copying. A `Task(a)` handle
that is `linear` and consumed by `join` would give results and make leaks a compile error.

**F. A single-threaded event loop (alternative, not recommended).** Needs no memory model at all,
but it turns every I/O function into a state machine or colours the language. It would waste
what the checker already proves.

**G. Locks, atomics, shared mutable state (not recommended).** Contradicts "plain is immutable,
`mut` is exclusive". If it is ever needed, a `linear Mutex(a)` whose `lock` yields a lens for the
length of a scope fits the model.

**Recommendation.** Keep A, give B closing and linear endpoints, add E's `Task(a)` and
`join`, then do D as the feature that shows what the language is for.

## What each backend needs

- **Go.** Done for A, B and the sockets. The GC makes sharing plain values trivially safe.
- **C.** Needs pthreads (or C11 threads) for `spawn`, and plain values shared across tasks need
  atomic `retain_context` / `release_context`, which are ordinary counters now. Allocation is
  `allocate_context`; whether it is thread safe depends on the allocator behind it. Everything the
  checker proves still holds, so this is runtime work, not language work.
- **Reference evaluator.** Done for `spawn`, channels and `sleep`, not sockets
  (`src/eval-tasks.ts`). Scheduling is cooperative and deterministic: a task runs until it waits,
  ready tasks run in turn, and `sleep` advances a simulated clock. As in Go, the program ends when
  the main task returns; if every task waits, that is a deadlock. It keeps each task's call stack
  in an array, so recursion depth no longer depends on JavaScript's stack. It tries one
  interleaving and cannot find a data race. Picking the next task from a seed would let tests
  try more of them.

## Gaps this prototype found

Since these were written, [owned lenses](owned-lenses.md) closed the first two on Go: a lens that
`connection` produces now moves into a task with its cleanup, and `examples/server.lm` uses that.
The notes below are kept as the record of what led there.

- **The example's `Conn` is a convention, not the real design.** A linear wrapper is consumed but
  not closed: `match c { Conn(fd) -> () }` leaks the descriptor. The language's answer is that the
  *producer* returns a lens on the resource, as `useFile` does in the Dev Log: the lens body's
  cleanup (`closeHandle(fd)`) runs when the borrow ends, so a linear type never has to name its
  cleanup. `accept` would then be a lens producer (`lens fd <- accept(listener)`), and the
  handler would run inside the borrow. Handles are plain numbers and channels carry only numbers,
  so a program can still copy one; lens-scoped producers would remove that for connections and
  listeners.
- **That collides with `spawn`, on purpose.** A closure cannot borrow, so a lens cannot be moved
  into a task; the scope has to open inside the task. `examples/server-pool.lm` does that: workers
  that each loop on `accept`, with `Conn` a linear lens-only value, `recvFrom(~conn)` and
  `sendTo(text, ~conn)` borrowing it, and `dup(~conn)` a type error. The price is a fixed pool: eight
  slow requests block the rest.
- **The listener should be a lens too, and then a connection is a child borrow of it.**
  `connection(~listener)` holds the listener's exclusive borrow for as long as the connection
  lives. Checked: two live connections from one listener lens is `use-while-borrowed`; handing
  one to a task is `borrowed-capture`; a worker that opens its own listener lens and a connection
  inside it compiles. So with a lens listener, one scope serves one connection at a time, and
  concurrency can only come from more scopes.
  - **A listener per worker** (each opens its own with `SO_REUSEPORT`; the kernel balances accepts on
    Linux) needs no language change and nothing is shared. Every cleanup is owned by its producer and
    nested: connection inside listener inside worker.
  - **A task per connection** needs the child borrow to be usable while the parent stays usable:
    the Dev Log's `~~w` idea, where the producer's lens bundles the parent back (`(conn, listener)`),
    so `fst` and its mirror split it into two disjoint lenses. The connection half then goes to a
    task, which must be joined before the listener's scope ends. That is structured concurrency
    (option D), and it is real new machinery: a scoped task that may borrow if joined, a bundled
    producer, and a restore that waits for both halves. My attempt at the bundle form today gives
    `unrestored-lens`.
  - **A shared borrow** (freeze the lens to a plain view for a joined scope) would let a pool share
    one listener, but it is the "getter-only lens as a sharing mechanism" that `mut-and-linear.md`
    ruled out.
  - A lens that has no parent, such as `listener(port)` itself, could be moved into a task by a
    narrower rule (nothing to outlive). That is not the `connection` case, and my earlier claim that it
    was is wrong.
- **The `Conn` layer is source code.** `recv`, `send`, `accept` and `closeHandle` are still raw
  imports over plain numbers, and `send`/`recv` cannot be redefined because builtins share the
  namespace, hence `sendTo`/`recvFrom`. A native producer with a restore hook and a builtin linear
  `Conn` type would let the imports take lenses themselves.
- **A spawned task must return `()`.** The Go lowerer says so when it sees anything else; a type error
  at the call would be better.
- **`spawn` is a name the dual desugar recognises**, unless the program binds it locally. A
  top-level `fn spawn` is already a duplicate definition, because builtins share the namespace.
- **No `select`, timeouts or cancellation.** A server cannot be told to stop.
- **A request is one `recv`.** It reads up to 8 KB once, which is enough for `curl` but not a real HTTP
  parser.
