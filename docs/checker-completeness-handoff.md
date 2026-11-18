# Remaining scoped-lens work

## Start here

Continue in the `ts/` Git repository. This handoff supersedes the earlier audit of
checker restrictions: computed aliases and lens-valued branches are implemented,
and manual restoration now has semantic/reference and scalar/tuple C/Wasm support. Do not reimplement
those milestones or treat their old rejection paths as current restrictions.

Manual restoration now has staging and retained-context adapters for the tested
scalar/tuple subset, including returned and selected-branch focuses. Remaining
checker work is borrowed matching, constructor alias patterns, `aslens`, and
conservative computed-owner invalidation. The last item has a concrete regression
below and does not require the unresolved constructor reconstruction decision.
Captured cleanup invocation and callable focus storage retain separate backend
restrictions.

This is a status and implementation handoff, not a proof that checking or the
remaining ownership model is sound or complete. Do not infer new language rules
from existing rejection paths or backend limitations.

## Repository and verification baseline

The original semantic milestone was committed as `b56eb04`; concrete contracts
are committed through `b573d01`. C/Wasm adapter changes follow that baseline. Inspect `git status` and `git log` when resuming,
and preserve any later user edits.

| Commit | Milestone |
| --- | --- |
| `c0d870d` | Phase 5: typed C storage versions and returned-lens restoration |
| `20766e9` | Retained alias protection verification |
| `fca0c20` | Persistent computed/tuple aliases through native C and Wasm |
| `1a9d2e4` | Lens-valued branches through checking and reference execution |
| `9e6e327` | Selected-branch adapters through concrete IR, C, and Wasm |
| `b56eb04` | Scoped manual restoration through checking and reference execution |

Last full implementation verification: **809 passing tests, 39 existing skips,
zero failures across 30 files**. `bunx tsc --noEmit` and `git diff --check` passed.
The existing C-supported corpus passes native strict C11 at `-O0`, `-O2`, and
ASan/UBSan with stack-use-after-return detection, and Emscripten/Node at `-O0` and
`-O2`. Manual scalar/tuple restoration now has the same execution coverage for
the 23 shared samples described below. Remote CI was not run
and has not been requested as a prerequisite.

Read before implementation:

- `docs/type-inference.md` and the language-feedback update in
  `docs/type-inference-research.md`; earlier superseded recommendations are not
  language decisions.
- `docs/backend-contract.md` for ordering, ownership, and cleanup contracts.
- `docs/typed-ir.md`, `docs/concrete-ir.md`, and `docs/c-backend.md` for retained
  representations, independent verification, execution, and restrictions.
- `docs/backend-progress.md` for the earlier backend milestones.

Use Semble to discover implementations, then navigate directly to returned
locations. Prefer symbol names below over stale line numbers. The active legacy
pointer path is `src/decompose.ts` and `src/eval.ts`, not `src/value-passing/`.

## Current support by layer

| Form | Checker/elaboration | Serialized typed IR and verifier | Legacy execution | Native C/Wasm |
| --- | --- | --- | --- | --- |
| Computed/tuple persistent aliases | Implemented | Implemented | Tested | Tested scalar/tuple subset |
| Branches producing lenses | Implemented | Implemented | Tested | Tested selected-branch adapters |
| Manual `@(focus, cleanup)` | Implemented | Implemented | Tested | Tested scalar/tuple subset |
| Matching a borrowed scrutinee | Unsupported | Not implemented | Unchecked machinery exists | Not implemented |
| Constructor alias patterns | Unsupported | Not implemented | Unchecked machinery exists | Not implemented |
| `aslens`: `lens pattern <- value` | Unsupported | Not implemented | Unchecked machinery exists | Not implemented |

“Tested” is not universal backend coverage. Captured closure invocation, dynamic
callable joins, and nominal/heap runtime data retain their existing later-phase
restrictions. Semantic acceptance must remain independent of physical topology;
use explicit backend diagnostics for missing adapters, without evaluator fallback.

## Preserve the established language decisions

- Local values and first-class functions are affine monotypes. Unused values are
  allowed; consuming one stored value twice is not. Top-level schemes are reusable
  and polymorphic.
- Persistent aliases exclusively borrow owners. Nested aliases suspend parents.
  Consumed borrowed focuses require refill before their lifetime ends.
- Ordinary closures move captured values at construction and cannot borrow outer
  storage. Capturing alias contents requires subsequent refill.
- **User-approved manual exception:** a zero-argument function literal used as
  manual cleanup is a scoped restoration body and may borrow lexical storage until
  restoration completes. This permission does not extend to ordinary or nested
  escaping closures. Do not ask the user to reconfirm this decision.
- Generic cleanup expressions execute at restoration and must produce an owned
  zero-argument function with an owned result. Existing callback values keep their
  ordinary construction-time captures; callbacks and their results are consumed
  or disposed once at restoration.
- Empty storage is distinct from initialized unit. Moving a slot and then swapping
  into it returns unit as the old swap result.
- Raw returned lenses into owned local storage remain rejected. Explicit manual
  contracts may retain owned focuses through cleanup and enclosing disposal; this
  is an implemented ownership contract, not permission for raw dead pointers.
- Non-exhaustive ordinary and lens-valued matches trap. Exhaustiveness policy has
  not changed.

## 1. Implemented slice: manual restoration backend adapter

This program checks and returns `8` in both detached typed IR and checked legacy
execution:

```lm
fn shifted(~x) ~{
    let v = x + 2
    @(v, fn () {x := v - 2})
}
{
    let x = 1
    shifted(~x) := 10
    x
}
```

This example also executes as generated native C and Wasm, returning `8`.
Captured generic cleanup invocation still reports `unsupported-c` with
“Captured closures require phase 6”; callable focus storage retains its
representation-layer diagnostic.
### Existing semantic and executable contract

1. Set up the frontend once.
2. Stage the final replacement contents into its focus.
3. Evaluate cleanup at restoration time. Execute a scoped function-literal body,
   or evaluate the generic expression and invoke its result with zero arguments.
4. Dispose the cleanup's owned result.
5. Complete the frontend's original restoration and enclosing cleanup.

Nested manual cleanup runs outer cleanup before inner cleanup. Tuple focuses must
have all final contents staged before cleanup reads them. For branches, only the
selected setup and cleanup execute. Dependencies remain protected for the entire
borrow lifetime, including an initially empty owner that cleanup must refill.
Pending computed owners remain inaccessible before their restoration.

Implementation anchors:

- `src/infer.ts`: `View.stage`, `Inferencer.stage`, `manual`, `lensCase`,
  `computedAlias`, and lens-valued `letBody`. `stage` returns a completion action;
  ordinary restoration still uses `put`. Manual ownership permits retained owned
  storage while preserving raw-local escape rejection elsewhere.
- `src/elaborated.ts`: `manuals` records frontend/cleanup node IDs, dependency
  binding IDs, scoped-literal mode, and staged/cleaned/restored states.
- `src/backend/verify-elaboration.ts`: manual metadata coverage and phase checks.
- `src/typed-ir.ts` and `src/lower-typed.ts`: `manual` consumes a frontend lens and
  retains `holds: SlotRef[]` plus a deferred `cleanup: IRBlock`.
- `src/verify-ir.ts`: manual capabilities, `stage`, `pending`, dependency scanning,
  protected-owner locks, deferred disposal, and explicit owned-focus retention.
  Dependencies are derived from cleanup instructions, excluding local places and
  normalizing nested permits, rather than trusted from `holds`.
- `src/eval-typed.ts`: deferred block execution, owned-result disposal, and cleanup
  indexing. This path executes serialized IR without the AST or inference closures.
- `src/decompose.ts`, `src/expr.ts`, `src/eval.ts`: compiler-generated retained
  cleanup thunks preserve lexical storage frames. Do not restore the old eager
  value-capture behavior: cleanup must see the final temporary contents.

### Backend adapter status and remaining changes

- `src/infer-representations.ts` and `src/verify-representations.ts` now cover
  deferred cleanup regions, retaining frontend topology with manual endpoints and
  complete temporary/call coverage. Data moves use independently verified
  restoration-time semantic annotations; protected lexical callable dependencies
  retain their provenance. Analysis visits deferred regions after setup without
  applying cleanup effects to the setup state. This is representation analysis,
  not a physical staging or lifetime adapter.
- Audit every nested-block walker. A manual cleanup block is a new executable
  region, alongside scopes, branches, and function bodies. Semantic specialization
  recursively rewrites objects, but other analyses/indexers may require explicit
  handling. Retain complete temporary, call, and cleanup coverage.
- `src/concrete-ir.ts` and `src/lower-concrete.ts` retain a concrete `manual`
  operation with a recursively lowered cleanup block. Its independently checked
  restoration contract names frontend/result shapes, protected logical references,
  stage/cleanup/result-disposal/restore/release order, and retention through enclosing
  cleanup. Typed verification still establishes ownership and dependency validity;
  concrete verification checks correspondence, layouts, invocation contracts, and
  these adapter records. Physical retained contexts reuse the existing C returned-lens machinery.
  Both concrete callable indexers and the printer traverse deferred regions.
- `src/c/lower.ts` represents a lens with `view`, `finish`, and an optional
  `stage` action returning a completion. Manual lowering stages its frontend,
  lowers deferred cleanup against final logical storage, then runs completion.
  Tuple staging prepares every child before completion. Selected branches commit
  and merge the selected owner's replacement during staging; completion preserves
  subsequent cleanup changes before original restoration and normalization.
- Logical cells/paths and returned contexts retain owned temporary focuses and
  deferred callbacks across function return. Required setup variables are copied
  into returned contexts; call backing remains heap-resident until completion.
  Context/backing release retains the existing allocation accounting and sanitizer
  checks. No manual evaluator fallback is used.
- Keep generic callback limitations separate: a scalar inline cleanup can be
  supported before captured closure invocation. Unsupported callable/environment
  adapters must produce precise backend diagnostics, not checker restrictions.
- Extend concrete diagnostic printing with complete inline expected output.
  Storage/restoration lowering belongs outside C syntax printing.

### Acceptance gates for this slice

Acceptance-corpus preparation is in `test/backend/manual-restoration-samples.ts`:
23 shared cases cover the original examples plus both selections of tuple staging
around a branch, selected cleanup effects, late generic cleanup reads, initially
empty dependency refill, cleanup-only definition reachability, unused/duplicated
focuses, and an owned cleanup result. `test/manual-restoration.test.ts` runs every
case through checked legacy execution, JSON-detached typed execution, and
JSON-detached semantic-specialized typed execution. The dedicated event-order,
disposal-count, ownership-negative, and artifact-corruption tests remain in place.
Every case also passes representation analysis and independent serialized analysis
verification. Corruption tests reject missing cleanup temporaries, missing calls,
and substituted callable provenance. Callable focus replacement retains its existing
closure-storage representation diagnostic. Concrete manual contracts pass
independent verification after JSON round trips.
Corruption tests reject missing cleanup/dependencies, incorrect shapes, ordering,
retention, and invocation records; complete concrete and C printer output is
inline. All 23 samples are also in the shared native/Wasm execution corpus,
including returned manual branches, returned owned branch focuses, and nested
manual staging around a branch.

Start from all 50 tests in `test/manual-restoration.test.ts`. Carry the supported
subset into shared C execution samples rather than replacing reference tests.
Cover shifted owned focuses, final-type changes, tuple staging, manual around a
branch, branch-selected manual cleanup, nested ordering, owned callback parameters,
late generic cleanup expressions, owned results, and unused/duplicated focuses.
`manual around branch` is especially important for staging order.

Check serialized concrete artifacts and reject missing cleanup, lost dependencies,
wrong capture/lifetime records, premature release, and incorrect ordering.
Compare native strict/optimized/sanitized and Wasm execution against typed/legacy
results. Existing branch and computed-alias C samples must continue to pass.

## 2. Borrowed matching and constructor alias patterns

These are distinct from implemented branches that **produce** lenses. Verified
current examples and diagnostics:

```lm
fn head(~xs) {match ~xs {[h, ...rest] -> h; [] -> 0}}
```

```text
unsupported-lens-case
Matching a lens requires scoped restoration checking
```

```lm
{
    let xs = [1]
    {let [h, ...rest] = ~xs
     h := 2}
    xs
}
```

```text
unsupported-lens-pattern
Constructor aliases require restoration checking
```

Entry points: `Inferencer.caseBody`, `lensCase`, and `pattern` in `src/infer.ts`;
`makeLensCase`/`makeCase` and pattern paths in active `src/decompose.ts`.

**Unresolved language decision:** establish the reconstruction contract, including
whether and how a constructor/tag may change and which constructor alias forms are
valid. Ask the user about that decision before implementing it. Ordinary owned
matching and arbitrary constructor expressions do not establish borrowed semantics.
The AST deliberately does not make arbitrary constructor expressions into lenses.

Then model branch-local borrow permits, field consumption/refill, surviving fields,
whole-owner reconstruction, and restoration at every accepted branch exit. Join
replacement types and availability. Retain reconstruction and selected cleanup in
elaboration and typed IR, and independently reject incomplete reconstruction or
lost permissions. Existing branch/manual ownership machinery should be reused.

List/variant C representation may additionally require later nominal/runtime data
support. Accept established semantic forms independently of that backend work.
Ordinary unmatched-case trap behavior must remain unchanged.

## 3. `aslens`: pattern-bound temporary focuses

Verified checker restriction:

```lm
fn temp() ~{lens v <- 1
 v}
```

```text
unsupported-lens
aslens lenses require scoped restoration checking
```

This form is still separate from explicit manual owned-focus retention.
`Lens.aslens` exists in `src/ast.ts`/`src/laminar.cst`. The active decomposition's
`aslens` case allocates the value using `heap`, returns a focus and deferred
cleanup, binds the pattern by reference during cleanup, evaluates the linear body,
then invokes the backing disposer. Audit that implementation and its unchecked
fixtures; do not mistake setup-time binding for restoration-time binding.

Specify and test owned temporary lifetime, the pattern's final-content type,
consumption/refill during cleanup, result disposal, and cleanup ordering. Extend
retained metadata and independent typed verification. Prevent access after
cleanup while allowing intended scoped operations and type changes. Reuse manual
staging and owned retention without weakening ordinary closure or raw-local
escape checks. Carry supported forms through physical adapters afterward.

## 4. Conservative computed-owner invalidation

This remains an incompleteness issue, not a new language restriction. Inference
checks whole-owner type changes during computed-lens setup/arguments; typed
verification also uses whole-slot versions in computed-call guards.

The following example was rechecked during this handoff. Checking accepts it, but
`typedProgram`/typed lowering rejects it with `invalid-ir` and
`Computed lens owner changed before restoration`:

```lm
fn first(~(x, y)) ~x
{
    let pair = ((1, 2), 3)
    {let (a, b) = ~pair
     {let f = ~{@(first(~a), fn () {b := b + 1})}
      f := 4}}
    pair
}
```

The cleanup touches sibling projection `b`, while the computed frontend borrows
`a`; both share one logical root. This is a concrete checker/typed-verifier gap,
not a manual C-adapter error. Reproduce it as a regression before changing the
version model. Determine which disjoint updates preserve focus identity and
reconstruction, and retain genuine overlap/parent-replacement restrictions. Do not
silence verifier errors or classify all such programs as semantically invalid.
Path-sensitive version/provenance tracking and branch-version joins need to agree
across inference, typed verification, and C storage. Preserve lens setup before
callee/ordinary arguments and assignment RHS evaluation.

## Separate broader work

- `A & B` remains a front-end/language-design gap: the README marks it unimplemented
  and the AST lacks a form. Do not silently include parser/type-system design in a
  scoped restoration fix.
- Captured closure invocation, dynamic callable joins, nominal/runtime data, and
  host-callable root adapters remain separate backend milestones. Existing explicit
  diagnostics must remain until their contracts and implementations exist.

## Completed machinery to preserve and regression locations

- Computed loans distinguish an independent focus place from ordered protected
  owner references and permits. Direct aliases keep their original representation.
  See `test/computed-alias.test.ts` and
  `test/backend/computed-alias-samples.ts` (13 shared execution samples).
- Branches retain setup/restored states and normalization edges. Concrete
  `lensJoin: { kind: 'selected', arms, result }` normalizes the focus to thin storage
  while preserving each arm's original topology. Independent verifiers derive and
  check this contract. C retains selectors, lifts deferred setup storage, commits
  only selected restoration, and merges owner versions. See
  `test/lens-branches.test.ts`, `test/backend/lens-branch-samples.ts` (12 shared
  execution samples), and complete printer output in `test/c/branch-print.test.ts`.
- C moves and `drop-place` cleanup both mark logical storage empty. Omitting the
  latter caused ordinary branch/recursion regressions during the adapter work;
  those cases are now covered and passing. Do not revert either transition.
- Alias contents captured by an ordinary closure are moved and require refill.
  Captured closure **invocation** in C remains separate from preserving the move
  and discarding an invocation-erased closure environment.

## Verification and reporting

Manual C/Wasm adapter verification: `bun test` reports **881 pass,
39 existing skips, 0 failures across 30 files** (50 manual-restoration reference
and artifact tests plus 46 shared manual backend execution tests).
`bunx tsc --noEmit` and `git diff --check` pass. All 23 shared manual samples pass
native strict C11 at `-O0`, `-O2`, and ASan/UBSan with stack-use-after-return
checking, and Emscripten/Node at `-O0` and `-O2`. Existing branch/computed-alias
samples remain passing. Remote CI was not run.

For each slice:

1. Preserve accepted programs and ownership negatives. Add positive and negative
   regressions before broadening acceptance.
2. Verify elaboration and typed/concrete artifacts independently after JSON round
   trips. Deliberately corrupt cleanup, owner protection, reconstruction, lifetime,
   and adapter records. No solver closures or source-AST execution fallback.
3. Compare typed and active legacy execution where both implement the form. For
   C-supported forms, run strict C11, optimized and sanitized native execution,
   and Emscripten/Node at both optimization levels. Preserve failure artifacts.
4. Keep unsupported physical adapters explicit. Do not weaken checking to make
   emission convenient, or bypass independent verifiers to make tests pass.
5. Keep complete expected diagnostics/printer output inline; no abbreviated
   assertions or external generated snapshots in place of the current style.
6. Run `bun test`, `bunx tsc --noEmit`, and `git diff --check`. Compare against
   **809 pass / 39 existing skips / 0 fail** and explain any new skips.
7. Update current-restriction documentation only after corresponding checking,
   retained verification, and execution paths are covered.

Report separately: language forms accepted and enforced ownership rules; retained
IR/verification coverage; actual execution by each backend; and remaining
restrictions with examples and responsible layers. Do not describe support for a
tested subset as complete scoped-lens language support.
