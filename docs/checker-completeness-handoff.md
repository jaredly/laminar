# Remaining scoped-lens work

## Start here

Continue in the `ts/` Git repository. Borrowed matching and constructor alias
patterns now use same-constructor reconstruction. The user approved the contract:
field sublenses exclusively borrow the whole owner; consumed fields must be refilled;
restoration rebuilds the matched constructor from final fields. Whole-owner
replacement is available after those sublenses end. See the completed slice below.

Manual restoration, computed/tuple aliases, lens-valued branches, and
path-sensitive computed-owner invalidation are implemented for the documented
scope. Do not reimplement those milestones, restore their former rejection paths,
or treat their old backend diagnostics as current restrictions. In particular,
disjoint sibling changes during cleanup, assignment RHS, and callee/argument
evaluation now pass checking, typed verification, and the shared C/Wasm corpus.

This handoff is not a proof of checker or ownership-model completeness. Preserve
established language decisions; do not infer new rules from rejection paths or
physical backend limitations. Captured cleanup invocation and callable focus
storage remain separate backend work.

## Repository and verification baseline

The earlier implementation baseline is **`f6e797c`**; the temporary-lens audit
is committed as **`83d9003`**, and temporary-focus support as **`1ba743b`**.
The borrowed-pattern implementation below extends those milestones.
Inspect `git status` and `git log` when resuming, and preserve later user edits.

| Commit | Milestone |
| --- | --- |
| `c0d870d` | Typed C storage versions and returned-lens restoration |
| `20766e9` | Retained alias protection verification |
| `fca0c20` | Persistent computed/tuple aliases through native C and Wasm |
| `1a9d2e4` | Lens-valued branches through checking and reference execution |
| `9e6e327` | Selected-branch adapters through concrete IR, C, and Wasm |
| `b56eb04` | Scoped manual restoration through checking and reference execution |
| `f52c89d` | Shared manual-restoration acceptance corpus |
| `64abe8b` | Deferred-cleanup representation analysis and verification |
| `b573d01` | Concrete manual restoration contracts and independent verification |
| `6aafda4` | Manual staging and retained contexts through native C and Wasm |
| `ff39cdb` | Path-sensitive typed computed-owner revision guards |
| `f6e797c` | Path-sensitive inference guards for RHS and callee/argument updates |

Pre-aslens implementation verification: **918 pass, 39 existing skips, 0 failures
across 30 files**. `bunx tsc --noEmit` and `git diff --check` passed. The shared
C-supported corpus passes native strict C11 at `-O0`, `-O2`, and ASan/UBSan with
stack-use-after-return detection, and Emscripten/Node at `-O0` and `-O2`.
This includes **23 manual-restoration samples**, **24 computed-alias samples**,
and **12 lens-branch samples**. This is tested subset coverage, not universal
backend support. Remote CI was not run or requested as a prerequisite.

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
| Matching a borrowed scrutinee | Implemented | Retained reconstruction | Tested | Tested scalar/tuple subset; nominal layouts remain explicit |
| Constructor alias patterns | Implemented | Retained reconstruction | Tested | Nominal layouts remain explicit |
| `aslens`: `lens pattern <- value` | Identifier/wildcard/tuple patterns | Retained manual capability | Tested | Tested scalar/tuple subset |

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

## Completed: `aslens` pattern-bound temporary focuses

```lm
fn shifted(~x) ~{lens v <- x + 2
 x := v - 2}
{let x = 1
 shifted(~x) := 10
 x}
```

This checks and returns `8` in checked legacy, JSON-detached typed execution,
native C, and Wasm. Identifier, wildcard, and recursively nested tuple cleanup
patterns are supported. Constructor and literal temporary cleanup patterns remain separate from borrowed
constructor aliases, and retain an explicit
`unsupported-lens-pattern` diagnostic.

The contract is:

1. Evaluate the initial value once and allocate owned backing during setup.
2. Keep backing and lexical cleanup dependencies protected through consumer execution.
3. Stage the final replacement; bind the pattern at restoration. Its type and shape
   describe the replacement, not the initial value. A number can be replaced by a
   tuple and destructured by a tuple cleanup pattern.
4. Run cleanup with owned final-content bindings. These may be consumed without
   refill or replenished with a different type. Borrowed lexical owners and lens
   parameters must still be restored at their ordinary lifetime boundaries.
5. Dispose the owned cleanup result and remaining cleanup-local contents once,
   then complete enclosing restoration and release backing. Manual cleanup wrapping
   a temporary runs before the temporary's own cleanup.

`Inferencer.aslens` retains a private temporary binding in `elaboration.manuals`
with `temporary`, initial-value/cleanup node IDs, dependency IDs, and all three
lifetime phases. It does not expose the pattern during setup or relax closure
capture rules. `verifyElaboration` independently requires backing retention and
full staged / empty transferred-backing cleanup states.

`lower-typed.ts` allocates the private place in an owned scope and emits the existing
`manual` instruction over its acquired focus. The deferred cleanup moves the staged
contents into owned pattern storage, evaluates the body, and disposes remaining
locals; the enclosing scope disposes backing. No source rewrite, solver closure,
new evaluator fallback, or unchecked typed instruction is involved. Independent
verification derives dependency protection, checks raw-local escapes, deferred
storage lifetime, cleanup-local disposal, and refill of borrowed lexical storage.
Branch verification resolves cleanup holds against outer storage, excluding
branch-local retained backing and normalizing lexical permits.

Representation analysis, concrete contracts, and C/Wasm reuse the existing manual
retained-context adapter. `test/backend/aslens-samples.ts` contains 17 shared
scalar/tuple cases, including final-type changes, returned backing, lexical refill,
selected branches, wildcard disposal, nested cleanup order, unused/duplicated focuses,
and owned cleanup results. Each runs through checked legacy and detached generic /
specialized typed execution, serialized representation and concrete verification,
and the shared native/Wasm execution corpus.

`test/aslens.test.ts` retains the original eight unchecked audit regressions and
adds checked acceptance, ownership negatives, exact-once closure disposal, and
corruption rejection for missing metadata/backing/protection/phases, removed
cleanup-local disposal, retired places, raw focus escape, and premature backing
consumption. The legacy evaluator's heap disposer deletes a cell without general
recursive resource disposal; disposal counts are established by the detached typed
interpreter, not inferred from heap-cell release. Existing unchecked fixture
anchors remain `makelens` in `src/systematic.test.lm` and `aside` / `useFile` in
`test/flow.test.lm`.

General callable focus storage, captured callback invocation, and nominal data adapters
remain separate restrictions.

## Completed: borrowed matching and constructor aliases

The user approved preserving every constructor explicitly matched by a borrowed
pattern. Changing a leaf field, including replacing a tail with `[]`, is allowed;
changing the whole matched owner while its field aliases live is not.

```lm
{let xs = [1, 2]
 {let [h, ...rest] = ~xs
  h := 3
  rest := []}
 xs}
```

This returns `[3]`. Reading or replacing `xs` inside the field scope is rejected;
after that scope, `xs := []` is allowed. Consuming `h` or `rest` without refill is
rejected. A type-changing reconstruction must satisfy the constructor signature:
changing the head to a Boolean also requires a compatible tail.

Borrowed ordinary and lens-valued matches are accepted, as are constructor-pattern
lens parameters. Pattern branches retain their own final field types, original
constructor identity, and restoration. Unmatched cases trap before the branch body;
exhaustiveness policy is unchanged. A whole-value identifier pattern exposes a
whole-value alias, while a constructor pattern exposes its field sublenses.

`src/normalize-borrowed.ts` expands these source forms hygienically before inference:
exclusively borrow the scrutinee once; match an owned private copy of its contents;
expose fields through scoped aliases over a retained manual lens; reconstruct the
matched constructor into the borrowed owner at scope exit. Wildcard fields retain
private storage, and literal fields reconstruct their matched values. The checked
AST / elaboration source is this canonical core expansion. Caller-owned ASTs remain
unchanged. Borrowed parameter patterns expand into the same core at function entry.
Ordinary closure capture and alias refill rules remain in force.

Elaboration retains selected-pattern/owner links and manual reconstruction node IDs.
Typed IR retains a reconstruction-marked input pattern and a matching deferred
`manual.reconstruction` contract. Independent verification ties that contract to an
actual selected pattern, checks every constructor/tag, literal, field move and owner
swap in the cleanup, and rejects missing contracts, tag/field substitutions, a
changed target, lost permissions and removed cleanup. The existing ownership verifier
also requires field refill and original-owner restoration. Generated reconstruction
preserves the original owner's escape provenance, and cannot implicitly grant the
owned-retention permission of an explicit manual lens. Raw local sublens returns
remain rejected in both inference and independent typed verification. Concrete lowering retains
that contract and independently checks correspondence; no evaluator fallback or
solver closure is introduced.

`test/borrowed-patterns.test.ts` covers checked legacy and JSON-detached generic and
specialized typed execution, ownership negatives, unmatched traps, constructor-pattern
parameters, elaboration corruption and typed/concrete reconstruction corruption.
`src/eval.ts` now propagates nested list-tail updates through ancestor slices; nested
constructor-pattern regression coverage exercises the previously detached update.
Five shared scalar/tuple cases in `test/backend/borrowed-pattern-samples.ts` cover
ordinary and returned borrowed tuple matches and selected literal branches through
native/Wasm execution and serialized concrete verification.

List/variant physical storage remains a separate backend restriction: checked list
examples report `unsupported-layout: No storage definition for List` during physical
lowering. This does not prevent semantic checking or detached reference execution.
`aslens` constructor cleanup patterns remain outside its identifier/wildcard/tuple
subset, and are not implicitly enabled by borrowed reconstruction. Single-arm C
case joins now materialize changed storage versions outside the conditional; this
applies to both ordinary matching and deferred selected-lens restoration.

## Completed: manual restoration through C/Wasm

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

### Retained representations and physical adapters

- `src/infer-representations.ts` and `src/verify-representations.ts` now cover
  deferred cleanup regions, retaining frontend topology with manual endpoints and
  complete temporary/call coverage. Data moves use independently verified
  restoration-time semantic annotations; protected lexical callable dependencies
  retain their provenance. Analysis visits deferred regions after setup without
  applying cleanup effects to the setup state. This is representation analysis,
  not a physical staging or lifetime adapter.
- Manual cleanup is an executable region alongside scopes, branches, and function
  bodies. Existing typed/concrete indexers and printers traverse it; preserve this
  coverage when adding new walkers or executable regions. Semantic specialization
  recursively rewrites objects.
- `src/concrete-ir.ts` and `src/lower-concrete.ts` retain a concrete `manual`
  operation with a recursively lowered cleanup block. Its independently checked
  restoration contract names frontend/result shapes, protected logical references,
  stage/cleanup/result-disposal/restore/release order, and retention through enclosing
  cleanup. Typed verification still establishes ownership and dependency validity;
  concrete verification checks correspondence, layouts, invocation contracts, and
  these adapter records. Physical retained contexts reuse the existing C
  returned-lens machinery.
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
- Capture-free known callbacks and scoped cleanup bodies work in the tested
  subset. Captured callback invocation and callable focus storage still produce
  explicit backend diagnostics; these are not checker restrictions.
- Complete concrete and C diagnostic output is covered inline. Storage/restoration
  lowering remains outside C syntax printing.

### Regression coverage to preserve

The shared acceptance corpus is `test/backend/manual-restoration-samples.ts`:
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

Preserve all 50 tests in `test/manual-restoration.test.ts` and the shared
execution samples. They cover shifted owned focuses, final-type changes, tuple
staging, manual around a branch, branch-selected cleanup, nested ordering,
callbacks, late cleanup expressions, owned results, and unused/duplicated focuses.
`manual around branch` is essential: cleanup must see the selected replacement,
and original branch restoration must preserve cleanup's subsequent changes.

## Completed: path-sensitive computed-owner invalidation

Both inference and typed verification now use per-write-path revision counters.
Inference snapshots these guards after lens setup and before the callee, ordinary
arguments, or assignment RHS are checked. Ordinary and lens-valued branch states
clone and merge the revision histories alongside type/availability states.
Guards observe writes to overlapping ancestors/descendants and ignore disjoint
siblings. Branch joins merge counters per path and transfer subsequent writes
into each retained arm. An adversarial overlapping move/refill is still rejected
even when it restores the original owner type.

The following regression originally checked successfully but failed typed
verification with `Computed lens owner changed before restoration`. It now passes
detached typed/legacy execution and the shared C/Wasm corpus, returning
`((4, 2), 4)`:

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
`a`; both share one logical root. Shared computed-alias regressions also cover a
sibling type change, cleanup around a computed branch, and cleanup selected by a
computed branch. C uses its existing logical cell/path storage for these cases.

The assignment-RHS example that formerly produced `alias-conflict` is now accepted:

```lm
fn first(~(x, y)) ~x
{
    let pair = ((1, 2), 3)
    {let (a, b) = ~pair
     first(~a) := {b := b + 1
                   4}}
    pair
}
```

It returns `((4, 2), 4)`. The analogous ordinary-argument example is accepted:

```lm
fn first(~(x, y)) ~x
fn replace(v, ~x) {x := v}
{
    let pair = ((1, 2), 3)
    {let (a, b) = ~pair
     replace({b := b + 1
              4}, ~first(~a))}
    pair
}
```

Shared regressions additionally cover sibling type changes, callee-side updates,
and both selections of a branching RHS. Same-type overlapping writes in an RHS,
ordinary argument, or branch remain `alias-conflict`. Setup still precedes
callee/ordinary arguments and assignment RHS evaluation. Independent typed guards
and C logical cell/path storage enforce their corresponding retained contracts.

## Checker audit: branches over existing computed focuses

A bounded interaction audit found and fixed a false rejection when a lens-valued
branch selects an already-live computed focus, including a reconstructed constructor
field. For example:

```lm
{let xs = [1, 2]
 {let [h, ...rest] = ~xs
  {let selected = ~{match true {true -> h; false -> h}}
   selected := 4}}
 xs}
```

This returns `[4, 2]`. Inference and independent typed verification previously
traced the existing focus to its already-protected frontend owners, losing the
focus's access permission. Both now preserve outer focus storage and its permit;
only branch-local computed backing is traced through its retained owners. Escape
provenance remains separate and raw local sublens returns remain rejected.

Both branch selections are covered in `test/borrowed-patterns.test.ts`, alongside
manual cleanup of a reconstructed sibling, temporary cleanup refill, and ordinary
closure capture followed by refill. Parent access and missing refill remain
negative tests. A detached typed-artifact corruption test removes the selected
field's permit and requires rejection before execution. Two new shared computed
alias samples select a projected outer computed focus, change its type, and update
a disjoint sibling; these exercise the scalar/tuple backend adapters.

This audit covers specific interactions, not checker completeness. Constructor
examples execute through checked legacy and detached generic/specialized typed
paths; their nominal physical-layout restriction remains unchanged. The shared
scalar/tuple examples additionally exercise serialized representation/concrete
verification and native C/Wasm execution. No new language forms, IR instructions,
or physical adapters were introduced.

## Separate broader work

- `A & B` remains a front-end/language-design gap: the README marks it unimplemented
  and the AST lacks a form. Do not silently include parser/type-system design in a
  scoped restoration fix.
- Captured closure invocation (including generic manual cleanup callbacks),
  callable focus storage/replacement, dynamic callable joins, nominal/heap runtime
  data, and host-callable root adapters remain separate backend milestones.
  Existing explicit diagnostics must remain until their contracts and
  implementations exist. List/variant support for borrowed matching may depend
  on nominal/runtime adapters; semantic checking must not depend on that schedule.

## Completed machinery to preserve and regression locations

- Computed loans distinguish an independent focus place from ordered protected
  owner references and permits. Direct aliases keep their original representation.
  See `test/computed-alias.test.ts` and
  `test/backend/computed-alias-samples.ts` (24 shared execution samples).
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

After the bounded computed-focus branch audit, the full run reports **1077 pass /
39 existing skips / 0 failures across 32 files**. The borrowed-pattern suite has
**60 passing tests**. The shared computed-alias corpus now has **26 samples**;
the two added samples pass strict native C11 at `-O0`, `-O2`, and ASan/UBSan,
and Emscripten/Node at `-O0` and `-O2`. `bunx tsc --noEmit` and
`git diff --check` pass. No new skips or remote CI run.

The final borrowed-pattern implementation full run reports **1058 pass / 39 existing
skips / 0 failures across 32 files**. The focused borrowed-pattern suite has **47
passing tests**, including constructor-pattern parameters, raw-local escape rejection
and independent serialized reconstruction checks. No new skips were introduced.

All five shared scalar/tuple borrowed-match cases pass native strict C11 at `-O0`,
`-O2`, and ASan/UBSan, plus Emscripten/Node at `-O0` and `-O2`. The existing manual,
temporary, computed-alias and selected-lens-branch corpus remains passing. Checked
legacy and detached generic/specialized typed execution additionally cover the list
examples; physical list lowering retains its explicit nominal-layout diagnostic.
`bunx tsc --noEmit` and `git diff --check` pass. Remote CI was not run.

Historical baselines: 918 pass / 39 skips across 30 files before temporary lenses;
927 pass / 39 skips across 31 files after the audit; 1001 pass / 39 skips across
31 files after the temporary-focus implementation.

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
   the latest baseline above and explain any new skips.
7. Update current-restriction documentation only after corresponding checking,
   retained verification, and execution paths are covered.

Report separately: language forms accepted and enforced ownership rules; retained
IR/verification coverage; actual execution by each backend; and remaining
restrictions with examples and responsible layers. Do not describe support for a
tested subset as complete scoped-lens language support.
