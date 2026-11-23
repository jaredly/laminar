# Plan: `mut`, `linear` and shared immutable values

Status: proposal. Design notes live in [mut-and-linear.md](mut-and-linear.md). Nothing here is
implemented.

## Where we start

- Every binding is already consume-once. `consume` in `src/infer.ts` marks a place empty and
  reports `use-after-move`. `dup` (sugar: `!x`, `src/laminar.cst`) is the only way to get a
  second value. In effect, every value today is linear.
- Lenses (`~x` parameters, `aslens`) are the exclusive-access mechanism. They are the borrow
  mechanism, so no `&`/`&mut` split is needed.
- Backends assume single ownership of every heap allocation, and `dup` deep-copies
  ([mutable-boxes.md](mutable-boxes.md)). Box reuse (`retains`/`reuses`, checked in
  `src/verify-concrete.ts`) depends on that.
- Naming hazard: `Linear` in `src/ast.ts` means "ordinary expression" (as opposed to a lens
  expression), not a linear type. Use `mustConsume`/`owned` in code for the new notion, or rename
  the AST type first.

So the work is mostly **relaxing** the current rule, not adding a new one: non-`mut` bindings
become readable more than once, and `mut`/`linear` keep today's behaviour.

## Two languages: pure and dual

The paper's language ("pure": today's behaviour) and the new language ("dual") are separate
languages that are never mixed. Everything below applies to dual only; pure stays as it is.

- **Selection.** The mode is a compiler option (`--mode` on the CLI, `mode` in the API) or a
  `// laminar: <mode>` pragma on the first non-blank line. With neither, the mode is pure. A
  pragma that disagrees with the requested mode is an error (`mode-mismatch`). It applies to a
  whole program. There is no cross-mode linking, so loading a
  program in the other mode, or importing across modes, is an error. Host exports are not
  affected.
- **Same text, different meaning.** In pure, `let x = ...` is a binding you can assign and lens.
  In dual it is an immutable shared binding, and `let mut x = ...` is the pure meaning. Pure
  programs are therefore not valid dual programs without rewriting. No automatic migration is
  planned.
- **Keywords.** `mut` and `linear` are reserved in both modes, so there is one lexer and one
  grammar with no mode-dependent tokenization. This is a research project with no real programs
  to preserve. Using the dual syntax in pure mode is a compile error that says dual mode is
  needed, raised by the checker rather than the parser.
- **Policy object.** One `Mode`/policy value is passed to the checker and consulted at five
  points: `consume` (copy or move), `dup` (linear check), the default mode of a `let` or
  parameter, `type linear` declarations, and the freeze and re-`dup` checks. Pure answers every
  one with today's behaviour. No other `if (dual)` branches in `src/infer.ts`.
- **Shared back half.** Typed IR, concrete IR, verifiers and backends are shared. Pure programs
  never produce shared storage or implicit copies, so the new paths stay dormant for them.
- **Tests.** The existing suite and snapshots run in pure mode, unchanged. Dual gets its own
  fixtures and error tests, plus a small set that checks dual-only syntax is rejected in pure.

## Rules to implement

Two axes. Type capability: `copyable` (scalars, shared immutable data) or `linear` (no `dup`).
Binding mode: `mut` (exclusive, lensable, consume-once) or plain (shared, immutable, readable any
number of times).

| Operation                         | Result                                        |
| --------------------------------- | --------------------------------------------- |
| read a plain binding              | allowed repeatedly; yields shared immutable   |
| read a `mut` binding              | consumes it (`:=` still yields `()`)          |
| move `mut` into plain             | consuming freeze; type error if value linear  |
| plain into `mut`                  | needs `dup()`; type error if value linear     |
| `dup()` of a linear value         | type error                                    |
| linear value into plain binding   | type error                                    |
| write or lens a plain binding     | type error                                    |
| `~x` parameter                    | implicitly `mut`                              |

Linearity of a value comes from its type alone (`type linear X`). What `lens p <- v` binds is an
ordinary `mut` value of its own type, so a lens-bound `Number` can be `dup`ed or dropped, as in
the pure language.

## Phase 0: settle the open design points (no code)

Status: drafted in `mut-and-linear.md` ("Settled rules"). Decisions 1 to 3 are accepted.

1. **Which cleanup makes a value linear.** If every heap value is linear and freezing a linear
   value is an error, nothing heap-allocated can be shared, which defeats the feature. Proposed:
   only *observable* cleanup (close an fd, end a connection) makes a value linear. Plain memory
   reclamation does not. Write the decision and how a type declares it into
   `mut-and-linear.md`. The codebase has no surface syntax for `cleanup()` yet, so this also
   decides what that looks like.
2. **How shared immutable memory is reclaimed** (refcount, arena or static). It only has to
   serve read-only data, because `dup` copies before any write.
3. **Which types are scalar.** Number and Bool at minimum. Decide on String and on records or
   tuples made only of scalars.
4. Confirm that a getter-only lens is out of scope for now.

Done when the table above is final and the three decisions are written down.

## Phase 1: dropped (scalar auto-copy on reads)

The first version of this phase copied scalars on every read. It was built, then removed:
reading a scalar `mut` binding would leave its place full, so `x := x + 1` would return the old
value instead of `()`, which changes `:=`. Plain bindings (phase 3) already make `f(x) { x + x }`
work for every type, because `x` is plain, not because scalars copy. The only scalar rule left is
the implicit `dup()` when a plain scalar initializes or is assigned into a `mut` binding (phase 3).
Phase numbers below are kept so existing references stay valid.

## Phase 2: `type linear`

Status: done for unions (checker only). Dual mode is now selectable, and the checker consults
`Policy.linearTypes`.

- Grammar: `type linear X ...` in `src/laminar.cst` (union and alias forms), with a `linear` flag
  on `TypeDecl` in `src/ast.ts` and on the union `TypeDefinition` in `src/infer.ts`.
- `src/linear.ts` has `isLinear(type, isDeclaredLinear)`: a type is linear when declared so, or
  when a type argument, tuple item or record field is.
- Diagnostics (`src/check.ts`): `dual-only` (pure mode), `linear-alias` (an alias is transparent,
  so it cannot carry its own linearity; declare a union), `linear-field` (a union holding a
  linear value must itself be `type linear`), `dup-linear` (`dup` or `!` of a linear value) and
  `linear-unconsumed` (a let-bound linear local that is not consumed by the end of its scope).
- Tests: `test/linear.test.ts`.

Not covered yet (each is a known gap, not a design change):

- `dup` inside a generic function was only checked at concrete types; phase 3 adds copy bounds
  on type variables that close this.
- `_` patterns, unused function parameters and discarded expression statements can still drop a
  linear value. Only let-bound locals are checked.
- Closures that capture a linear value are not treated as linear.
- No cleanup function can be declared yet, so no code runs when a linear value is consumed. That
  belongs with the cleanup decision in phase 4.

Exit: `type linear Fd { Fd(Number) }` parses, `dup` on it is a type error, and pure rejects it.

## Phase 3: `mut` bindings and plain shared bindings

Status: done for the checker and the reference evaluator. Backends are untouched.

How it works. Binding modes are a rewrite in front of the pure checker (`src/desugar-plain.ts`),
run by `Checker.check` in dual mode. The checker, typed IR, evaluators and backends only ever see
the pure language.

- Syntax: `let mut pat = ...` and `fn (mut x)` (`src/laminar.cst`, `mut` flag on `let` and
  `FnArg`). In pure mode `mut` is a `dual-only` error.
- Plain is the default. `mut` is: `let mut`, `fn (mut x)`, `~x` parameters, `let x = ~lens`
  aliases, owned `lens` temporaries, named local functions, and the names a borrowed `match ~x`
  binds.
- A read of a plain binding or a field of one becomes `dup(~x)`. So for now a shared value is a
  deep copy that cannot be told apart from sharing. Phase 5 replaces the copy with real sharing.
- `~x`, `x := ...` and `match ~x` on a plain binding are a `plain-lens` error. The explicit
  `dup(~x)` / `!x` is allowed.
- Reading a `mut` binding consumes it for every type, so `:=` is unchanged.
- `mut` into plain is a move, a consuming freeze: `let p = m`, and `let (a, b) = m` binds plain
  parts. The value must not be linear, which the existing `linear-plain` check already enforces
  from the type. Plain into `mut` takes a real `dup`, because other readers may still hold the
  value, so the cost of each direction shows in the source. `mut` on a whole pattern
  (`let mut (a, b) = m`, `match m { mut Fd(n) -> ... }`) keeps its parts owned; it never applies
  to single names. Passing a `mut` value to a plain parameter is such a move too.
- A closure that reads a plain binding captures a copy (`let $plainN = dup(~x)`) and rebinds the
  name plain inside its body, so it can read it repeatedly.
- A callee is never copied, so closures stay affine: a plain parameter holding a function can be
  called once.
- Linearity: a plain binder whose type is linear is `linear-plain`. A type variable held by a
  plain binder or copied by `dup` cannot later be instantiated at a linear type. Each published
  definition records those variables (`Checker.copyBounds`), and a call that supplies a linear
  type, directly or through another generic function, is `dup-linear`. This closes the generic
  gap from phase 2. A `mut` parameter can take a linear value.
- Tests: `test/plain.test.ts`; `test/linear.test.ts` now uses `let mut` for linear values.

Deviations from the rules table, to settle:

- Plain to `mut` is implicitly a deep copy for every type, not only scalars, because every plain
  read is a `dup`. The "needs `dup()`" rule, which exists to make the cost visible, needs a
  distinction between shared and owned values in the types. It belongs with phase 5, when a
  plain read stops copying.
- Scalars are not special yet.

Known gaps:

- Closures that capture a linear `mut` value are not treated as linear.
- `_` patterns, unused parameters and discarded statements can still drop a linear value; only
  let-bound locals are checked for consumption.
- A plain parameter holding a function can only be called once.

## Phase 4: linearity beyond declarations (settled: nothing more to build)

An earlier draft made what `lens p <- v` binds linear by provenance. That was wrong: a lens of a
`Number` is a `Number`, and the pure language already lets you `dup(~p) + 1`. Linearity comes
from the type alone, so the existing checks cover freezing, `dup` and plain parameters.

- **Heap values with observable cleanup** need no declaration. A linear value is cleaned up by the
  function that consumes it (a native `close` that takes it), so nothing is inserted implicitly.
- **Lens-valued call results** keep the existing `escaping-lens` and `unrestored-lens` checks.

## Phase 5: sharing

Status: designed, not started. Open: whether a result's mode is inferred or written (5a).

Today a plain read is rewritten to `dup(~x)`, so nothing is shared and the backends see only
owned data. Real sharing needs four pieces, in this order:

- **5a. `mut` in function types.** Shared is just plain: what a non-`mut` binding holds. A
  function type records the mode of each parameter and of its result, written with the same
  keyword: `(Number) -> mut Number`, `(mut Pair) -> Pair`. A plain result is shared, so it needs
  `dup` before it enters `mut` storage. A `mut` result is owned and can go anywhere. A plain
  argument for a `mut` parameter needs `dup`; a `mut` argument for a plain parameter is a move.
  - Stage 1 (done): `FlowTy.plain` carries a `mode` (`$owned` or `$shared`, a `Ty` that unifies
    like `replaceable`), and `SemanticFlow.plain` an optional `mode: 'shared'`.
  - Stage 2 (done): the dual desugar marks plain parameters `shared` and flags the plain-read
    `dup(~x)` it inserts with `share`. Inference gives each expression a mode (a `share` read is
    shared; an aggregate, `let` or `case` is shared if a part is; a call takes its callee's
    result mode; anything else is owned), so a function's result mode comes from its body and the
    node types carry it. A call leaves each argument and result mode open, and a mode nothing
    decided defaults to owned when a definition is generalized. Annotations say nothing about
    modes. Modes are invariant inside function types, which is strict for higher-order code; a
    coercion can come later. `share` is still a `dup` in every backend. Not done: printing modes
    in types, and the native `share` primitive 5b and 5c will need.
  - Stage 3 (done): the errors. A shared value for a `mut` parameter or a `let mut` is
    `shared-into-mut`. Natives' and constructors' parameters only read, so they accept either mode
    (`reads`, and fresh modes at constructor sites). A pure lambda's parameter mode is left open so
    natives still unify with it. A `mut` argument for a plain parameter is a move and needs
    nothing. Not checked yet: a shared result flowing into `mut` storage by other routes (`:=`,
    returned from a `mut` result position), and modes printed in types.
- **5b. Concrete IR** (`src/concrete-ir.ts`, `src/lower-concrete.ts`, `src/verify-concrete.ts`):
  **done.** The storage class is the value's mode, which already survives into the typed and
  concrete IR (`out.type.mode: 'shared'`). A plain read is a `call`/`invoke` flagged `share: true`,
  the one place a backend may alias instead of copy (still a `dup` everywhere for now). The verifier
  checks: a `share` read yields a shared value; an aggregate holding a shared value is shared; a
  `swap` never writes a shared value into owned storage; a case never `retains` (so never reuses)
  a shared scrutinee's box. The checker rejects `x := shared` as `shared-into-mut`. Writes cannot
  otherwise reach shared memory, since a plain binding cannot be lensed. Not covered: natives that
  store a shared argument (vector push) are not tracked by type.
- **5c. Backends.** **Done.** Go aliases a `share` read (no copy; the GC reclaims it); a plain
  `dup` still deep-copies. C gives every allocation a reference count (a header ahead of the
  payload in `allocate_context`). A `share` read retains the root allocations (box, vector buffer,
  string); drops empty a box or buffer only when it is `unique_context`, else just release.
  Destructuring a boxed payload of a possibly shared value (a shared-typed scrutinee, or any
  parameter pattern) moves the payload out only if the box is unique, else shares it first.
  Because writes happen in place, natives that mutate or store their argument (`[:push:]`,
  `array`) take owned arguments: a plain value needs `dup`. Pure programs gain only the
  allocator header and the extra uniqueness check in drops.
- **5d. Tests.** **Done.** `test/box-reuse.test.ts` passes for owned data.
  `test/shared-storage.test.ts` shares a tree between two readers, updates an owned `dup` in place
  while the shared original is unchanged, and runs strings, vectors and returned shares on C
  (sanitizer, so refcount imbalance is a leak or double free) and Go under `LAMINAR_EXEC=1`; the
  verifier tests reject writes, retains and unshared aggregates.

`dup` is always a real deep copy and never becomes cheap. Sharing lives only in plain reads.

## Phase 6: documentation and examples

Status: docs updated (`mut-and-linear.md` summary, `mutable-boxes.md` ownership claim). Examples
not yet added.

- Update `mut-and-linear.md` with the settled rules, link this plan from the docs index, and fix
  the stale claims in `mutable-boxes.md` ("every heap allocation has exactly one owner").

## Phase 0.5: mode plumbing

Status: done. `src/mode.ts` holds `Mode`, `Policy` (just `mode` for now), the pragma reader and
`policyFor`, which returns nothing for dual, so dual reports `unimplemented-mode`. `Checker`
takes the policy. `mut` and `linear` are reserved in the grammar, so using them as identifiers is
a parse error. The `dual-only` checker error arrived with `type linear` in phase 2; `mut` gets the same in phase 3.
Tests are in `test/mode.test.ts`; the rest of the suite is unchanged.

Add the compiler option, the pragma, the reserved keywords `mut` and `linear` with a
checker-level "needs dual mode" error in pure, and the policy object, with pure as the only
implemented policy. Any existing test program or example that uses `mut` or `linear` as an
identifier needs renaming. This lands first, changes no behaviour, and
proves the existing snapshots are untouched. Phases 2 to 5 then add dual's answers to the policy.

## Ordering and risk

Phases 2 to 3 are checker-only and can ship without touching a backend, as long as the reference
evaluator shares values. Phase 5 is the largest risk, because it weakens an invariant the C and Go
backends rely on, so land it after the checker rules are stable. Phase 0 is the real gate: the
cleanup decision changes phases 2, 4 and 5.
