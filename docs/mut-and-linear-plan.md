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

So the work is mostly **relaxing** the current rule, not adding a new one: scalars and
non-`mut` bindings become readable more than once, and `mut`/`linear` keep today's behaviour.

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
| read a scalar (any mode)          | implicit `dup`                                |
| move `mut` into plain             | consuming freeze; type error if value linear  |
| plain into `mut`                  | needs `dup()`; type error if value linear     |
| `dup()` of a linear value         | type error                                    |
| linear value into plain binding   | type error                                    |
| write or lens a plain binding     | type error                                    |
| `~x` parameter                    | implicitly `mut`                              |

Linearity of a value comes from its type (`type linear X`, `linear T`) or its provenance (heap
allocation with observable cleanup, `aslens`). It is not only a type declaration, because a heap
`Int` is linear and a bare `Int` is not.

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

## Phase 1: copyable scalars (no syntax)

- Add a `copyable(ty)` predicate next to the types in `src/types.ts`.
- In `consume` (`src/infer.ts`), when the binding's type is copyable, record a copy instead of a
  move and skip the empty-place transition. This needs the type to be resolved by then; if the
  solver has not fixed it yet, defer the decision to the end of inference.
- Typed IR: reuse the existing `dup` operation for scalars rather than adding an op.
  `src/verify-ir.ts` already rejects uses of consumed temporaries; make sure a copy does not
  count as consuming.
- `src/eval.ts` and `src/eval-typed.ts` need no change if scalar `dup` is already the identity.
- Tests: a scalar used twice compiles with no `!`; a non-scalar still gives `use-after-move`.
  Add to `test/infer.test.ts`, `test/typed-ir.test.ts` and the C/Go backend tests.

Exit: existing snapshots unchanged except for places where programs wrote `!n` on a scalar.

## Phase 2: `type linear X`

- Grammar: `src/laminar.cst` (type declaration rules near line 17) gains an optional `linear`
  marker. The AST `TypeDecl` in `src/ast.ts` carries a `linear` flag.
- `src/infer.ts` (type declaration handling around line 386) records linear types. Extend
  `copyable` to answer "not copyable" for them, and add a `linear(ty)` predicate that looks
  through constructor arguments, tuples and records.
- New diagnostics: `dup-linear` (on `dup`/`!`) and `linear-not-mut` (later enforced in phase 3).
- Tests: error cases in `test/basic.errors.fl`-style files.

Exit: `type linear Fd = ...` parses, and `dup` on it is a type error.

## Phase 3: `mut` bindings and plain shared bindings

- Syntax: `let mut x =` and `fn (mut x) {}`; carry a `mut` flag through the parser and the
  `Binding` record in `src/infer.ts`. A `~x` parameter sets it implicitly.
- Plain bindings: reading does not consume (extends phase 1 from scalars to all non-linear
  types). Reject assignment, lens use and `~` on them.
- `mut` bindings: unchanged consume-once semantics.
- Freeze (`mut` to plain) is a move. Plain to `mut` requires `dup()`. Both are checked in
  `src/infer.ts`; the linear checks come from phase 2.
- Typed IR and verification: add a "binding is shared" fact so `verify-ir.ts` allows repeated
  reads without a move, and rejects a write or lens on a shared place.
- Closures (`lambda` in `src/infer.ts`) capture plain bindings by sharing and `mut` bindings by
  move; check that rule against `captureUses` and `src/captures.ts`.
- Tests: the full table above, one test per row, including the error rows.

Exit: the table is enforced by the checker, and the reference evaluator runs programs that share
immutable values.

## Phase 4: provenance-based linearity

- Mark `aslens` temporaries and heap values with observable cleanup as linear, per the phase 0
  decision. This is a checker fact, not a type declaration.
- Make a lens-valued result of a call linear, to match "a borrow must end", and keep the existing
  `escaping-lens` check.
- Tests: a freeze of an `aslens` result is an error; a heap value with trivial cleanup can be
  frozen.

## Phase 5: backends

- Concrete IR (`src/concrete-ir.ts`, `src/lower-concrete.ts`, `src/verify-concrete.ts`): add a
  shared-storage class. Mut-owned memory keeps the single-owner invariant and box reuse. Shared
  memory is read-only and never `retains`/`reuses`.
- `dup` from shared to `mut` deep-copies as today, so mut memory never aliases shared memory.
- `freeze` is a no-copy move into the chosen reclamation scheme from phase 0.
- C (`src/c/lower.ts`, `src/c/storage.ts`) and Go (`src/go/lower.ts`, `src/go/storage.ts`)
  implement it. Go can lean on the GC. C needs refcounts or an arena.
- Add the concrete-verifier rule that no write reaches a shared allocation.
- Tests: `test/box-reuse.test.ts` still passes for mut data; new tests share a tree between two
  readers and check that neither write nor reuse touches it.

## Phase 6: documentation and examples

- Update `mut-and-linear.md` with the settled rules, link this plan from the docs index, and fix
  the stale claims in `mutable-boxes.md` ("every heap allocation has exactly one owner").
- Update `examples/` that currently write `!x` on scalars.

## Phase 0.5: mode plumbing

Status: done. `src/mode.ts` holds `Mode`, `Policy` (just `mode` for now), the pragma reader and
`policyFor`, which returns nothing for dual, so dual reports `unimplemented-mode`. `Checker`
takes the policy. `mut` and `linear` are reserved in the grammar, so using them as identifiers is
a parse error. The "needs dual mode" checker error arrives with the dual syntax in phases 2 and 3.
Tests are in `test/mode.test.ts`; the rest of the suite is unchanged.

Add the compiler option, the pragma, the reserved keywords `mut` and `linear` with a
checker-level "needs dual mode" error in pure, and the policy object, with pure as the only
implemented policy. Any existing test program or example that uses `mut` or `linear` as an
identifier needs renaming. This lands first, changes no behaviour, and
proves the existing snapshots are untouched. Phases 1 to 5 then add dual's answers to the policy.

## Ordering and risk

Phases 1 to 3 are checker-only and can ship without touching a backend, as long as the reference
evaluator shares values. Phase 5 is the largest risk, because it weakens an invariant the C and Go
backends rely on, so land it after the checker rules are stable. Phase 0 is the real gate: the
cleanup decision changes phases 2, 4 and 5.
