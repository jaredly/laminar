# Checker completeness: scoped lenses and restoration

## Objective

Complete semantic checking and retained elaboration for the language's scoped lens
forms. These are core language features that the initial checker explicitly
rejected; they must not become permanent language restrictions merely because the
C backend was built around the accepted subset.

The immediate motivating example is a persistent alias to a returned lens:

```lm
fn first(~(x, y)) ~x

{
    let pair = (1, 2)
    {
        let focus = ~first(~pair)
        focus := true
    }
    pair
}
```

Expected result: `(true, 2)`. Currently checking rejects the alias with
`unsupported-alias`. The alias should retain the computed lens's restoration
obligation until its scope ends, while protecting the borrowed owner.

This handoff records an audit of explicit checker restrictions, not a proof that
the remaining checker is sound or complete. Do not infer additional language
semantics from the existing rejection paths.

## Repository state and preserved work

Work in the `ts/` Git repository. At the time of this handoff:

- Phase 3 commit: `c312abb`.
- Phase 4 commit: `35173ae`.
- The phase-5 implementation accompanies this handoff. Inspect `git log` and
  `git status` to establish its current commit state before working, and preserve
  any subsequent user edits.
- The last full verification of phase 5 reported **683 passing tests, 39 existing
  skips, zero failures across 26 files**. TypeScript and whitespace checks passed.
- Native strict C11 execution passes at `-O0`, `-O2`, and ASan/UBSan with
  stack-use-after-return detection. Emscripten/Node execution passes at `-O0` and
  `-O2`. Remote CI is not running and is not a prerequisite requested by the user.

Read these before implementation:

- `docs/type-inference.md`: implemented checker behavior and current restrictions.
- `docs/type-inference-research.md`: initial design and, crucially, its update after
  language feedback. Earlier recommendations superseded by that update are not
  current language decisions.
- `docs/backend-contract.md`: evaluation order, affine ownership, borrow/restoration
  obligations, and diagnostics.
- `docs/typed-ir.md` and `docs/concrete-ir.md`: retained executable contracts.
- `docs/c-backend.md` and `docs/backend-progress.md`: current phase-5 storage and
  restoration implementation and its boundaries.

Follow repository code-search instructions: use Semble to discover implementations,
then navigate to the returned files directly. Locations below are starting points;
line numbers can move as the uncommitted implementation evolves.

## Confirmed checker gaps

### Implementation checkpoint: retained alias protection

The phase-5 implementation is committed as `c0d870d`. The first follow-up
hardens `verifyElaboration`: a lexical alias must retain a borrow, and its place
and projection must lie within that borrow's focus. Lens parameter bindings are
exempt from the lexical-borrow requirement because their protection comes from
the caller's flow contract. Serialized corruption tests cover removed protection,
changed alias owners, changed borrow owners, and incompatible projections.

This checkpoint does not accept any new source forms. In particular, the
motivating computed alias still reports `unsupported-alias`. The next change
needs separate identities for the focus and the protected owners: today's typed
`borrow` verifier requires a `place` capability with exactly the loan's owner and
path, so it cannot represent a returned call capability. Updating inference alone
would therefore fail independent typed verification. The evaluator's `release`
already calls the retained lens's `finish`, but that runtime mechanism does not
establish the missing static relationship. Keep the existing owner/path invariant
for direct aliases when introducing a distinct computed-restoration record.

Checkpoint verification: `bun test` reports 684 passing tests, the same 39 skips,
and zero failures across 26 files, including native and Wasm execution.
`bunx tsc --noEmit` and `git diff --check` pass. No new backend behavior is claimed.

### Computed-alias implementation slice

Persistent returned-call and tuple aliases now use a fresh logical focus with an
ordered list of protected owner references and permits. Inference defers the
original view's `put` until alias scope exit. Retained elaboration and typed loans
preserve the focus/owner distinction; typed verification derives owner references
from capabilities, validates protection, checks refill, applies restoration, and
retires the focus. Direct aliases keep their existing representation. The typed
interpreter exposes the computed focus through the retained runtime lens.
Representation analysis and verification now carry its topology into subsequent
acquisitions. Existing concrete/C borrow mapping and release already consume this
focus/finish relationship, without a new syntax-printing path.

`test/computed-alias.test.ts` exercises serialized typed artifacts against checked
legacy execution. Shared samples in `test/backend/computed-alias-samples.ts` also
run through concrete verification and native/Wasm execution. They cover returned
and tuple focuses, thin/scattered inputs, nested calls and aliases, replacement
growth and nested projections, repeated type changes, move/refill, discarded
captures, and deferred scopes through both calls and inline lens blocks.
Corruption tests remove or forge owner protection. The remaining scoped forms
below are still open; this slice does not establish complete lens semantics.

Slice verification: 730 passing tests, the same 39 existing skips, zero failures
across 27 files. Thirteen computed-alias samples pass serialized typed execution,
checked legacy execution, native strict/optimized/sanitized C, and Emscripten/Node
at both optimization levels. TypeScript and whitespace checks pass. Additional
negative tests reject missing cleanup, premature release, forged owner protection,
and an empty focus at scope exit. Shared-owner projection tests preserve one loan
identity across branch state snapshots. No remote CI execution is claimed.

### 1. Persistent aliases to computed lenses (original gap description)

`src/infer.ts`, `Inferencer.alias` (approximately line 614), explicitly requires an
identifier. `Inferencer.letBody` (approximately line 632) uses that helper for every
lens RHS. Consequently both returned/computed lenses and tuple-of-lenses RHSs are
rejected as persistent aliases.

Existing persistent aliases are `Binding` records containing a root, projection
path, and borrow permit. General lens inference instead produces a `View` with a
read type, target bindings, and a `put` operation encoding restoration effects.
The alias-binding path does not bridge those representations.

Required behavior:

- Evaluate lens setup once, in source order.
- Keep the resulting focus and deferred restoration alive through the alias scope.
- Permit reads/moves/refills and type changes through the alias.
- Keep all relevant owner borrows active until restoration completes.
- Suspend conflicting access through owners and parent aliases.
- On scope exit, require the focus to be restored, restore exactly once, and expose
  the correct replacement owner types to subsequent code.
- Preserve alias identity across storage versions, including nested projections.
- Compose with aliases inside lens-valued blocks whose cleanup is itself deferred.

Do not implement this by removing the identifier guard or by copying a focus type
into an unrelated binding. Neither approach retains the restoration relationship.

### Lens-branch implementation slice

Lens-valued branches now pass semantic checking, retained elaboration validation,
and independent typed verification. Setup and restoration states are joined
separately. Selected branch pattern storage, computed aliases, and owned lens-block
storage remain alive until cleanup; the typed reference and legacy pointer paths
execute the selected setup and restoration only. Typed arm normalization edges
record availability drops separately from deferred block cleanup. Function-return
provenance still rejects lenses into owned local storage.

`test/lens-branches.test.ts` covers serialized execution, selected-only setup,
type changes, differing owners, nested selections, deferred aliases and closure
disposal, branch-local storage release, ownership negatives, missing normalization
and cleanup, missing retained restoration metadata, and unmatched-case traps.
At the semantic checkpoint (`1a9d2e4`), representation inference stopped with `unsupported-representation`:
“Lens-valued branches require a selected-branch restoration adapter”. Implementing
that adapter and concrete/C/Wasm execution was deferred to the backend slice below. Matching a
borrowed scrutinee remains separate unsupported checker work.

Branch-slice verification: 750 passing tests, the same 39 existing skips, and
zero failures across 28 files. TypeScript and whitespace checks pass. The existing
native/optimized/sanitized and Emscripten/Node corpus still executes; new branch
execution is tested only in serialized typed IR and the checked legacy evaluator.

### Selected-branch backend adapter

Representation analysis now normalizes a branch lens to a thin focus, while
retaining and independently validating the original arm topologies. Concrete IR
records a selected `lensJoin` adapter and both normalization edges. C storage
lowering retains the selector, lifts setup storage needed by deferred cleanup,
restores only the selected source lens, and merges owner versions after setup and
restoration. Returned contexts capture selected state without pointers to expired
branch stack frames. Owned moves mark logical slots empty before normalization.

Shared branch samples run through serialized typed/legacy execution, independently
verified concrete artifacts, native strict/optimized/sanitized C, and Wasm. They
cover true/false selection, deferred aliases, owned pattern storage, availability
joins, selected-only setup effects, mixed thin/scattered topologies, nested local
storage, and replacements that change nested field offsets. Corruption tests
reject missing or altered adapter contracts, incorrect normalized topology, and
lost normalization edges. Complete C and concrete printer expectations are inline
in `test/c/branch-print.test.ts`. Captured closure invocation and nominal/runtime
data still retain their existing backend restrictions.

Adapter verification: 784 passing tests, the same 39 existing skips, zero failures
across 29 files. Twelve shared branch samples execute on native strict C11 at
`-O0`, `-O2`, and ASan/UBSan with stack-use-after-return detection, and on
Emscripten/Node at `-O0` and `-O2`, matching typed and legacy reference results.
TypeScript, whitespace checks, and complete inline printer expectations pass.
The existing ordinary branch and recursion cases also pass after logical moves
and affine cleanup drops were made consistent. No remote CI execution is claimed.

### 2. Lens-valued branches (original gap description)

`Inferencer.lensInner` (approximately line 722) rejects `Lens.case` with
`unsupported-lens`. The AST and grammar can represent branches producing lenses.

The checker needs to join read/replacement contracts, owner states, availability,
and restoration obligations across mutually exclusive branches. Only the selected
branch's setup and restoration may execute. Do not conflate this with ordinary
value-valued `match`, which already has type and availability joins.

Dynamic representation joins can require later concrete/backend adapters. Semantic
acceptance must remain independent of pointer topology: a valid checked program
may reach a precise unsupported-backend diagnostic until those adapters exist.
Do not reject it in the checker merely to simplify C emission.

### 3. Matching borrowed data

`Inferencer.caseBody` (approximately line 815) rejects a lens scrutinee with
`unsupported-lens-case` before checking branches. This is separate from branches
that produce a lens.

Required checking must account for destructuring borrowed storage, branch-local
permissions, consumption/refill, reconstruction, and restoration at branch exit.
Determine the intended replacement rules for constructor/tag changes before
implementing them; do not invent those rules from ordinary owned matching.

### 4. Manual restoration

`Inferencer.lensInner` rejects `Lens.manual`, the `@(focus, cleanup)` form.
The AST, grammar, and existing lowering contain this construct.

Its checking must represent effects that run at restoration time, rather than
checking the cleanup as though it executes during lens setup. Audit the active
pointer decomposition/evaluator to establish the existing calling convention and
cleanup order. Preserve ownership of values retained for cleanup.

### 5. `aslens`: temporary owned focuses

`Inferencer.lensInner` rejects `Lens.aslens`, represented in source by the
`lens pattern <- value` form inside a lens block.

This needs an owned temporary focus with a scoped lifetime and cleanup that uses
its final contents. Validate how its pattern is bound at restoration time. Prevent
references to temporary storage from escaping after cleanup, while allowing the
intended scoped operation.

This is related to the current rule that returned lenses must derive from lens
parameters (`Inferencer.function`, around line 590). Do not simply relax that rule
to allow raw pointers into dead local storage; introduce the appropriate ownership
and restoration model first.

### 6. Constructor alias patterns

`Inferencer.pattern` (approximately line 425) rejects constructor patterns whenever
it receives an aliased source, using `unsupported-lens-pattern`.

Ordinary owned constructor patterns work. The missing behavior concerns borrowed
list/variant destructuring and restoration. Establish which constructor alias
forms are valid in the intended language, including reconstruction and possible
tag changes; not every arbitrary constructor expression is necessarily a valid
lens. Tuple alias destructuring already exists and provides a useful comparison.

### 7. Conservative invalidation of active computed lenses

`Inferencer.call` (approximately line 775) records owner types during computed lens
setup and rejects argument evaluation that changes those owners. Similar ordering
constraints matter for assignment.

Audit whether this rejects valid updates to disjoint components or safe owner
transitions. Preserve genuine exclusive-borrow restrictions and the specified
lens-setup-before-callee/ordinary-arguments order. Broaden acceptance only where
focus identity and restoration safety can be established.

## Separate front-end gap

The README lists `A & B` as unimplemented, and the current AST has no corresponding
form. This is a broader language/front-end feature gap, not just an unsupported
checker branch. Do not silently include parser/type-system design for it in a small
computed-alias fix. Record its intended semantics and scope separately if taking
on full language completeness.

## Preserve deliberate language decisions

The following are not missing features to remove as part of this work:

- Local values and first-class functions are affine: unused values are allowed;
  consuming the same stored value twice is not.
- Top-level definitions are reusable polymorphic schemes; local stored values are
  monomorphic under the clarified resource model.
- Persistent aliases exclusively borrow their owners. Nested aliases suspend the
  parent while active.
- Closures move captured values at construction. Borrowing outer storage inside
  a closure remains invalid. Capturing alias contents requires subsequent refill
  before the borrow lifetime ends.
- Moving a slot's contents and then assigning into it yields unit as the old swap
  result; an empty slot is distinct from an initialized unit value.
- Ordinary unmatched cases currently trap; lack of exhaustive-match checking is a
  separate policy question, not evidence that ordinary `match` is unsupported.

## Cross-layer implementation work

A checker-only acceptance change is insufficient. Trace and update all affected
contracts rather than bypassing verifiers:

1. **Inference and environments** — `src/infer.ts`. Design an explicit scoped
   computed-view/restoration model, including nested borrow permissions and
   branch behavior. Preserve source-order evaluation and current valid diagnostics.
2. **Durable elaboration** — `src/elaborated.ts`, the builder in inference, and
   `src/backend/verify-elaboration.ts`. Retain the focus identity, underlying owners,
   permissions, restoration relationship, and lexical/deferred lifetime without
   depending on inference closures or solver-local object identity. Existing borrow
   records describe one owner place/path; assess how multi-owner computed aliases
   and independent focus storage should be represented.
3. **Typed lowering and verification** — `src/lower-typed.ts`, `src/typed-ir.ts`,
   `src/verify-ir.ts`. Currently a lens let expects one elaborated borrow record,
   emits `borrow`, and adds a `release` cleanup. Ensure bindings actually refer to
   the computed focus, not accidentally to the whole underlying owner. Model
   deferred restoration and selected-branch cleanup explicitly.
4. **Typed reference execution** — `src/eval-typed.ts`. Exercise the new forms on a
   detached, serialized typed artifact, without falling back to the source AST or
   legacy evaluator.
5. **Representation/concrete lowering and verification** — representation analysis,
   `src/lower-concrete.ts`, and their independent verifiers. Propagate focus topology
   and restoration ownership faithfully. Keep semantic rejection distinct from an
   explicit later-phase backend restriction.
6. **C storage/restoration lowering** — `src/c/storage.ts`, `src/c/lower.ts`.
   Phase 5 already retains logical cell/path identities, creates typed call backing,
   emits returned-lens restoration contexts, and dispatches lexical `release` to a
   lens's finish operation. However, its current borrow handling maps the elaborated
   owner place directly to a view; do not assume it already handles an independent
   computed focus or a view borrowing multiple owners.
7. **Legacy checked execution** — `Checker.lower` still uses the active pointer
   decomposition in `src/decompose.ts`. Check that newly accepted forms behave
   consistently there, as well as in typed IR. Do not treat the separate
   `src/value-passing/` implementation as the active reference by accident.

Keep storage/restoration lowering separate from C syntax printing. Put complete
expected diagnostic/printer output inline in tests; do not introduce abbreviated
output assertions or external generated snapshots in place of the current style.

## Recommended implementation sequence

Start with persistent aliases to computed lenses as a coherent end-to-end slice:

1. Add a positive regression for the motivating example and negative cases for
   conflicting owner access and an unrestored focus.
2. Design the scoped view and retained metadata, then implement inference,
   elaboration verification, typed lowering, and independent typed verification.
3. Prove reference execution on serialized typed IR, including type-changing and
   nested alias cases.
4. Carry the accepted forms through representation/concrete verification and C
   execution where the required representation is already supported.
5. Update current-restriction documentation only after the corresponding checks
   and execution paths are covered.

Then address lens-valued control flow, borrowed matching/constructor patterns, and
manual/temporary restoration in appropriately scoped slices. These share machinery,
so design the obligation model with them in mind rather than adding a special case
for `first` or recognizing particular source function names.

## Acceptance and regression matrix

### Computed aliases

- The motivating `first` example returns `(true, 2)` after alias scope exit.
- The same behavior with a larger tuple replacement that changes field offsets.
- Thin owner input, scattered inputs, and recursively mixed tuple topologies.
- A persistent alias to `~(a, b)`, and nested computed-lens calls.
- Alias move followed by refill; scope exit without refill is rejected.
- Repeated type changes through an alias preserve unaffected owner components.
- A nested alias suspends its parent and restores access at the correct boundary.
- Owner/conflicting alias use while borrowed remains rejected.
- Capturing alias contents moves the value and requires refill. Verify checker and
  typed-IR behavior even where executing the captured closure in C remains phase 6.
- Lens-valued let bodies defer alias release until the returned view is restored.
- Setup executes once; cleanup executes once in the prescribed order, including
  `dup` of a computed focus and unused owned results.

### Other scoped forms

- Lens branches execute only the selected setup/cleanup and join replacement types
  and owner availability correctly.
- Borrowed matching restores all surviving fields on every accepted branch.
- Constructor alias cases either have an established reconstruction contract and
  pass, or retain a precise documented restriction until that contract is resolved.
- Manual cleanup executes at restoration time, with captured values consumed once.
- Temporary focuses may change type within their valid lifetime, clean up once,
  and cannot escape after their storage becomes invalid.
- Non-exhaustive ordinary cases preserve the current trap behavior unless the user
  explicitly chooses a new exhaustiveness policy.

### Verification gates

- Existing accepted checker programs continue to pass and ownership negatives
  continue to fail.
- Retained elaboration and typed/concrete artifacts survive JSON round trips.
- Deliberately malformed borrow/restoration metadata is independently rejected,
  including removed cleanup, missing owner protection, and premature release.
- Compare typed reference and legacy execution where both implement the construct.
- For C-supported cases, compare typed IR, native strict/optimized/sanitized C,
  and Emscripten/Node. Preserve failure artifacts.
- A valid semantic program whose concrete adapter is not yet implemented produces
  an explicit backend diagnostic; it must not fall back to JavaScript execution.
- Run `bun test`, `bunx tsc --noEmit`, and `git diff --check`. Compare against the
  recorded baseline and distinguish existing skips from any newly added ones.

## Completion/reporting standard

Report separately:

1. Language forms now accepted and ownership rules enforced by the checker.
2. Forms carried through retained IR and independent verification.
3. Forms actually executed by each backend.
4. Remaining restrictions, with concrete examples and responsible layer.

The previous backend milestone was complete only for checker-accepted inputs.
Do not describe that as complete support for the language's scoped lens semantics.
