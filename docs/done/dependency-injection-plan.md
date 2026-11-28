# Plan: dependency injection

Status: implemented, apart from the differences listed under [As built](#as-built). This replaces the effects half of
[row-polymorphism-and-effects.md](../row-polymorphism-and-effects.md) for now. There is no `resume`.
Abort and checked exceptions are wanted later and are not planned here. It builds on
[row-polymorphic records](row-polymorphic-records-plan.md).

## What we are building

```
type Http = {get: (String) => String, put: (String, String) => String}
type Clock = {now: () => String}

fn log(message) { print("${#now()} ${message}") }          // needs now

fn fetch(url) {                                            // needs get, now
    log("get ${url}")
    #get(url)
}

fn main() {
    inject now = fn () { "noon" }
    inject get = fn (url) { "contents of ${url}" }
    fetch("a")
}
```

- Every function type says what it **needs**: a row of named entries.
- `#name` reads `name` from the needs record.
- A function that needs anything takes that record as a hidden first argument. A function that
  needs nothing has no hidden argument.
- `inject name = value` adds or replaces an entry for the rest of the block.
- Nothing is looked up by name at run time. After specialization the record is a tuple.

## Rules

### Needs flow to the caller

- A function body has one set of needs, shared by everything it runs. `#x` adds `x` to it.
- Calling a function adds the callee's needs to it. So in `{g()\n h()}`, `g` and `h` share the
  caller's set, and no merging of records is involved.
- Creating a closure adds nothing. A closure's needs are supplied **by whoever calls it**, not by
  where it was written. That follows from the hidden argument: a closure created under an `inject`
  and called outside it sees the outer entry. Capture a value (`let now = #now`) to keep it.
- Entry types are matched by name. Within one set, each use of `#x` has the same type.

### `inject`

`inject x = e` evaluates `e` once, under the surrounding needs. In the rest of the block, `x` is
that value. Everything else passes through. This includes calls to function parameters: a callback
invoked there sees the injected `x`.

The inner needs are the surrounding needs with `x` pushed in front. The surrounding needs may or may
not have an `x` of their own, possibly of another type. For example, wrapping the logger:

```
fn quietly(job) {
    let loud = #log
    inject log = fn (m) { loud("(quiet) ${m}") }
    job()
}
```

### Entries are self-contained values

An entry cannot itself have needs. If `#log("x")` could need things from the record that holds
`log`, the type of the record would contain itself, and the checker would reject every unannotated
call to an entry. So every function type inside an entry type needs nothing, and a bare `=>` there
means that.

A service often does depend on another. So when the injected value **is** a function with needs,
`inject` supplies them from the surrounding needs, there and then:

```
inject now = fn () { "noon" }
inject log = fn (m) { print("${#now()} ${m}") }   // `now` is bound here, once
```

The surrounding function then needs whatever the injected one did. Functions nested inside an
injected record or list get no such binding and must already need nothing. The checker applies the
rule to types that are not yet known as well, the way channel-carried functions are tracked today.

### Ownership

- Entries are immutable and read any number of times, so each entry type must be `Copyable`. Linear
  values, lenses, and closures that must be called once cannot be entries.
- `#x` gives a copy, or a shared read for a plain value. `~#x` and `#x := v` are errors.
- `inject x = e` moves `e` in. A plain value in dual mode is copied.
- Entries hold no shared mutable state. A copied closure has its own captures. A service with state,
  such as a recording logger in a test, talks to a task over a channel.

## Signatures

| Written | Meaning |
| --- | --- |
| `(a) => b` | needs are inferred |
| `(a) ={}> b` | needs nothing |
| `(a) ={Http, Clock}> b` | the entries of both record aliases |
| `(a) ={log: (String) => (), ...e}> b` | `log`, and whatever `e` stands for |
| `(a) ={e}> b` | exactly the row `e` |

- Aliases are merged as records are: they must be closed, with no name in common. At most one row
  variable may appear.
- **On a top-level definition, a closed list is a limit on the body.** The body may use nothing
  else, but any caller that has at least those entries may call it.
- **Calling a value whose needs are closed** (a parameter typed `() ={Http}> a`) takes just those
  entries from the caller's needs, which may hold more. This builds a smaller record at the call.
- **Calling a value whose needs are open or unknown** makes its needs equal to the caller's, and
  passes the caller's record unchanged.
- The two rules depend on what is known at the call. So a declaration's parameter types must be
  applied **before** the body is checked, and its own type is used for recursive calls. Today the
  declaration is compared afterwards.
- A union constructor may take a row parameter in this position:
  `type Job(e) { Job(() ={e}> ()) }`. In a union declaration, `=>` means needs nothing, since
  there is nothing to infer it from. An alias is expanded where it is used, so its `=>` is inferred
  there, or means needs nothing inside an entry.
- Printed schemes keep `=>` when the needs are a row that appears nowhere else, so existing printed
  types do not change.

**The program's entry must need nothing.** Otherwise the error `missing-dependency` names each
entry and points at the `#name` that requires it. The checker records that origin as needs
propagate. Host library exports that need anything are rejected in this version.

## Type system design

Needs are their own kind of row, **not** a record type, because `inject` needs two entries with
one name:

```ts
| { tag: 'fn'; args; result; needs: Ty }
| { tag: 'needs'; entries: { name: string; type: Ty }[]; rest?: Ty }
```

- Inside `inject x = e`, the needs are `x: T` in front of the surrounding row `A`. This is one
  ordinary row equation, with no deferred constraint or solver.
- Entries with different names commute. Entries with the same name keep their order, and the first
  is the visible one. Unification matches same-named entries in order, as in section 5 of the spec.
  It must fail when both sides share a remainder but have different leftovers, or it will not
  terminate.
- Duplicates exist only in types. A later entry with the same name can never be read, so
  specialization drops it, and the run-time record has unique names.
- There are no lacks constraints.
- Schemes quantify needs rows like other variables. The new `needs` tag makes the type checker
  point out every traversal that must handle it.

Two limits come from using equality rather than subtyping:

- Two values with **different closed needs** cannot be passed where one row variable expects both.
  Wrap one in a closure (`fn () { g() }`), whose needs are open.
- **Recursion under an `inject`** fails for an undeclared function, because recursion is not
  polymorphic and the needs would have to contain themselves. Declaring the function's needs as a
  closed list fixes it. The diagnostic should say so.

## IR and backends

The generic IR keeps needs in function types and adds two operations: read an entry, and run a
block under an added entry. The reference evaluator runs this form, passing the current record into
each call.

A new specialization step runs after rows are substituted and before records are erased. It writes
the hidden argument out in ordinary IR:

| Source | After this step |
| --- | --- |
| function with non-empty needs | an extra first parameter, a plain record |
| call with the same needs | pass a shared read of the caller's record |
| call of a closed callee | build the smaller record, then pass it |
| `#x` | a shared read of field `x` |
| `inject` | a new record, bound for the block |
| injected function with needs | a wrapper closure that captured them |

- After this step no function type has needs, so representation inference, concrete lowering, C,
  Go, Wasm and Zig should not change.
- Whether there is a hidden argument is decided per instance. One generic function can have it at
  one use and not at another.
- **Runtime imports need adapters.** `apply(round)` may give `round` a type with needs, because
  `apply` shares its callback's needs with its own. The step wraps an import used at such a type in
  a function that ignores the record. Closures and definitions are compiled at their own types and
  need no wrapper.
- A needs row that nothing constrains specializes to empty.
- `spawn(task)` supplies the spawner's needs. The new task gets a real copy, as a channel send
  does, never a shared one.
- **Cost.** Each call with needs passes the record. In C, a shared read adds a reference to each
  heap entry; Go copies the struct. This is the same in pure mode, where it must be a shared read
  and not a deep `dup`, which is safe because entries are never written. If measurements call for
  it, pass a pointer to the record.
- **Code size.** A function gets one instance per distinct needs layout, so the default limit of
  256 instances may need raising.

Abort fits later: the record is only passed downward and `inject` has nothing to restore.

## Prerequisites

Both were confirmed against the current compiler, and both predate this work.

1. **Function types as record fields need extra parentheses.** `{get: (String) => String}` does
   not parse, and `{get: ((String) => String)}` does. The `Http` alias above needs the first form.
2. **Dual mode cannot pass a plain-parameter function to higher-order code.** With
   `fn use(f) { f("a") }` and `fn log(m) { "log ${m}" }`, `use(log)` is `mode-mismatch`. It works in
   pure mode. The cause appears to be that a call to an unknown function assumes it takes ownership
   of its arguments, while `fn log(m)` takes a plain one. A function with a `mut` parameter or none
   works. For dependency injection, **parameters in entry types are plain**: a call to `#x` passes
   shared arguments, and a written entry type means the same. A service with a `mut` parameter is
   not supported at first. Fixing ordinary higher-order calls is separate and not in this plan.

## Phases

Each phase ends with its targeted tests passing and `bunx tsc --noEmit`.

1. **Prerequisites.** The grammar fix, and plain parameters for entry function types.
2. **Needs rows in the solver.** The new tag, unification, schemes, printing. Every function type
   gets needs, with an open row for runtime imports. Unit tests drive the solver. Existing tests and
   printed types stay the same.
3. **`#name` and propagation.** Parsing, the per-function needs, both call rules, the entry check
   with origins, the `Copyable` requirement and the self-contained rule.
4. **`inject`,** including binding an injected function's needs.
5. **IR and specialization.** The two operations, verifier, reference evaluator, the hidden-argument
   step and import adapters. Run end to end on C with AddressSanitizer, Go and Wasm, with a leak
   check on the new copies.
6. **Signatures.** The `={…}>` forms, alias merging, union row parameters, and applying
   declarations before bodies.
7. **Finish.** `spawn` and channels, rejected host exports, a test that swaps services, and
   `docs/type-inference.md`.

Phases 3 and 4 are tested through inferred schemes and checker diagnostics until phase 5 can run
them.

## Acceptance tests

- `#a` and `#b` in one function; the order of use does not matter.
- `fn f(g, h) { g()\n h() }` with `g` and `h` needing different entries.
- A function with no needs passed where needs are expected, including a runtime import.
- A closure made under `inject` and called outside it sees the outer entry.
- `inject` over an entry of another type, with the outer one still used before and after.
- A callback called under `inject` sees the injected entry.
- An injected function with needs is bound at the `inject`, and a later `inject` does not change it.
- A missing entry at the program's entry names the entry and the `#` that needs it.
- A linear entry, a lens on an entry and an assignment to an entry are rejected.
- `={}>` rejects a body that uses `#`.
- A closed top-level definition called from a caller with more entries. A closed parameter called
  the same way.
- One definition used at two needs layouts and at none, on every backend.
- A spawned task reads entries while the spawner keeps using them, under Go's race detector.
- Recursion under `inject`, rejected without a declaration and accepted with one.

## Decisions

Confirmed.

1. **Callers supply a closure's needs.** Where it was created does not matter.
2. **`inject` binds an injected function's needs immediately.** The alternative is to require
   injected functions to need nothing, and to capture dependencies by hand.
3. **A closed list on a definition limits its body, not its callers.**
4. **`=>` in a union declaration means needs nothing.**
5. **Built-ins are not injectable yet.** `print`, input and sockets can follow: they become entries
   the host provides to the program's entry, and `={}>` would then rule them out. That changes every
   program that prints, so it deserves its own step. Channels and `spawn` are harder. `chanSend` and
   `chanRecv` work at any type, and an entry has one type per record. `spawn` is syntax, not a
   function. Until then, `={}>` does not mean free of I/O.

## As built

These differ from the text above, or were found while building it.

- **A definition that needs nothing is given no needs row.** Rather than staying generic in a row
  it never mentions, it is typed like a runtime import. So existing type-argument counts, host
  exports and compiled output did not change. Used as a value, either one may stand for a function
  with any needs, and gets the adapter described for imports. So adapters are not only for imports.
  This is only done for functions with no lens parameters.
- **A union holding a function that needs dependencies checks and runs in the reference evaluator,
  but does not compile** (`unsupported-needs-in-union`): union layouts are derived before
  specialization. A union with a row parameter compiles when every use of it needs nothing.
- **A closed list also covers the callbacks the body calls.** Under `={}>`, calling a callback
  parameter makes that callback need nothing. This is intended, and applies only to callbacks that
  are called: one the body ignores, stores or returns may need anything. A call in one branch
  counts, as does a call through a helper or through a closure the body runs. A call inside a
  closure the body never runs does not. Under an `inject`, the callback may need what was injected.
- **The only functions in pure mode entries are top-level ones,** named at the `inject`. Reading an
  entry copies it, and pure mode copies no other function. Examples here that inject a lambda, or
  wrap an outer entry in one, need dual mode or a top-level function.
- **A lens cleanup cannot use a dependency** (`dependency-in-cleanup`). It runs when the lens ends,
  perhaps outside the block that created it. Read the entry into a binding before the lens.
- **An injected function that has needs cannot take a lens.** `mut` parameters are allowed.
- **The step that writes dependencies out is** [`lower-needs.ts`](../../src/lower-needs.ts). The typed
  IR has a fourth operation, `widen`, beside reading, injecting and supplying.
- **`#a.b` copies the whole entry** and then reads the field from the copy.
- **Changed later:** written function types say who owns each position, and a function can be
  used as another type of function ([ownership](../type-inference.md#ownership-in-function-types)).
  So an entry may take `mut` parameters, and a signature may publish an owned result as shared.
- Infix expressions, `if` and `fn` after `name:` in a record still need parentheses.

## Not in this plan

Abort and exceptions, `resume`, injectable built-ins, entries that work at several types, services
with `mut` or lens parameters, and removing or hiding an entry.
