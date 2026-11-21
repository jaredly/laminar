# Hand-off: ABI-keyed callable migration (2026-11-20)

This hand-off covers the migration described in
[abi-callable-representations.md](abi-callable-representations.md). Read that
design doc first, especially *The new model* and *Migration plan*. The user asked for
**one commit per milestone (M0–M5)**. M6 was subsequently requested; its measured scope and the flow-class deferral
are recorded below.

## Owned temporary IR

The `@(...)` syntax and the `manual` operation have been removed. Source
`lens pattern <- initial` and generated borrowed reconstruction use `aslens`.
The instruction owns backing, transfers the final value into cleanup, and
releases backing when cleanup completes. Rebuild serialized artifacts that
contain the removed operation. The migration history below describes the
previous backend. See [owned temporary lenses](aslens-core-ir.md).

## Where things stand

| Milestone | State |
| --- | --- |
| M0: corpus freeze | **Committed** (`67b5781`) |
| M1: type-determined callables, whole-program member sets | **Verified and committed** (`b77a37e`) |
| M2: callable lenses as phase-5 lenses (delete focus machinery) | **Verified and committed** (`ecfdea1`) |
| M3: remove callable joins and dispatch leftovers | **Verified and committed** (`b537fcb`) |
| M4: recursion via the worklist; budgets as resource limits | **Verified and committed** (`bb87846`) |
| M5: concrete verifier, C and Go cleanup | **Verified and committed** (`d7f95a6`) |
| M6: measured known-callee optimization | **Verified and committed** (the M6 commit containing this update); flow-class ABI sets deferred |

The previously known source-identity snapshot failure in
`test/print-concrete.test.ts` was resolved in a post-migration follow-up at the
user's request. The snapshot now reflects opaque environments, direct calls and
current identities, with explicit checks for full code IDs and source origins.
Historical validation numbers below retain the failure reported at each milestone.

## M1 validation complete (2026-11-20)

- `npx tsc --noEmit -p .`: clean.
- `bun test`: **1429 pass / 1293 skip / 1 fail**; only the existing
  source-identity snapshot failure above. Its snapshot was not updated.
- `LAMINAR_EXEC=1 bun test test/c/execute.test.ts`: **1254 pass / 0 fail**,
  4379 assertions, 479.43 seconds. Native and Wasm both pass, including all four
  dynamic lens result cases that previously emitted `undefined(...)`.
- `git diff --check`: clean.

The C fix includes native wrappers used as adapter sources in `nativeEntries`.
M2–M5 are implemented below.

## What M1 changed (orientation for M2+)

- **`src/infer-representations.ts`**
  - The `ValueRepresentation` callable is `{ kind: 'callable', type }` (type key from
    `typeKey`). `native` and `callable-choice` are gone as value kinds.
  - `CallableMember` (`closure` with type-determined captures, or `native`) describes
    code; analysis output `callables` lists members per type.
  - `typeRep(t)` gives the type-determined representation.
  - `State.known` maps SSA values from `global`/`closure` to their member. If the
    value `escapes` (`src/callable-escape.ts`, also used by the verifier), the member
    joins its type's set via `addMember`.
  - At calls, the `Callee` is the known member, a native that is its type's only
    member, or `{ kind: 'dispatch', options: membersOf(type) }`. Direct call records
    carry `callee`.
  - `invoke` dispatch skips in-progress recursive members (`PendingResult`). Plain
    results are type-determined up front.
  - The root loop runs inside a whole-program pass loop until `membersSnapshot()`
    is stable.
- **`src/verify-representations.ts`** mirrors all of this: `fit` for callable types,
  `fitMember`, derived escaping members compared to `analysis.callables` ("Callable
  member sets changed"), callee provenance ("Call callee provenance changed"), and
  root exports via the root state's known member.
- **`src/lower-concrete.ts`**
  - Groups are `typeGroup(T)` (key `['type', T]`; entries are dispatch wrappers for
    indirect-call contracts) and `memberGroup(m, T)` (key `['member', T, memberKey]`).
  - Member records reuse T's layout and entry order, with no entries if the member is
    unlisted.
  - `typeLayout(g)` computes T's record from contract ABIs alone, avoiding cycles with
    member environments.
  - `memberEnvironment(g)` builds the environment and disposer without entries.
  - Record ids are `concreteName('callable', [groupKey])`.
  - Direct calls lower to `invoke` without `field`, using the member's exact wrapper.
  - The `graphKey` includes only type groups.
  - Raw-result contracts are no longer extra entries; adapter sources are checked and
    marked used by the verifier instead.
- **`src/verify-concrete.ts`** re-derives the same groups.
  - `checkEntry(c, w, contract)` is a standalone function that also validates adapter
    sources and dispatch member wrappers.
  - Record coverage and unreferenced-wrapper checks moved to the end, after bodies,
    because `make-callable` members and direct-call wrappers are discovered there.
- **C and Go** (`src/c/lower.ts`, `src/go/lower.ts`): a direct `invoke` calls the
  wrapper's function name. `print-concrete.ts` prints invokes without a field.
- **Tests.** 66 internal tests that forged or looked up identity-only distinctions were
  retired; the doc's M1 section lists the categories. Several others were restated in
  ABI terms. Printed snapshots and the literal C in `test/c/print.test.ts` were
  regenerated.
  - Literal-C regeneration script, if needed again: it reads the source passed to
    `compile('…')` in each named test, emits C and rewrites the `toBe(` template
    literal, escaping backslashes, backticks and `${`. The previous copy was in the
    session scratchpad and is gone; rewrite it if needed.
- All three programs in `test/backend/abi-migration-samples.ts` are enabled
  (`enabledMilestones = ['M1']`) and pass through typed IR, the legacy reference,
  verification and C emission. They also run in the native/Wasm corpus.

## M2 implementation (2026-11-20)

Callable lenses are ordinary `lens` representations with thin/scattered shapes.
`LayoutTable` has callable storage leaves, resolved to type records by concrete
lowering and independently by the concrete verifier. Aggregate callable backing
uses the same physical layout as aggregate values.

Removed focus endpoint forms, demands, lazy setup/completion, endpoint owners and
result routing, retained callable storage annotations, selected callable-focus joins,
and special manual restoration modes. Analysis state now holds only SSA value
representations, incoming/borrowed lens topology and statically known code.
Manual cleanup is analyzed directly from its restoration-time typed IR.

The demand-specific recursion hypotheses disappeared with setup/completion.
Recursive results use the previous pass's shape approximation; whole-program
passes stabilize both member sets and variant results. The pass loop is still
capped at 64 and `maxVariants` still defaults to 256. M4 must finish the worklist
and resource-limit diagnostics; do not reintroduce endpoint-demand recursion.

Validation: TypeScript clean; `bun test` reports **1422 pass / 1293 skip /
1 fail** (the known source-identity snapshot, unchanged; 4606 assertions). The final
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` run reports **1254 pass / 0 fail**,
4379 assertions, 476.82 seconds. `git diff --check` is clean. The design doc lists
the retired and rewritten internal tests. Shared execution samples are unchanged.
M3 is implemented below.

## M3 implementation (2026-11-20)

- `ConcreteWrapper` no longer has `dispatch`, `adapt-result` or
  `adapt-focus-arguments`. `callableJoin` and callable `ConcreteValueAdapter`s
  are deleted, including their C, Go and printing paths.
- Type records contain `{ abi, field }` entries without wrappers. Member records
  fill each slot directly with an exact invoke/native wrapper or lens-result
  normalizer. Generic aggregate move/result descriptors remain for M5 cleanup.
- Indirect `invoke` has `{ abi, field }`; a direct invocation has `{ abi, wrapper }`.
  The concrete IR union makes the field and wrapper mutually exclusive.
- `verify-concrete.ts` derives member entry wrappers from the type's contracts and
  member set, replacing dispatch-target validation. Type entry coverage/ABIs,
  member wrappers and indirect invocations have 12 new corruption/coverage tests.
- Native wrapper emission follows member entries and result-adapter sources. The
  representation analysis still enumerates members internally (its `dispatch`
  callee kind); no concrete/runtime dispatch wrapper is produced.
- Three printed IR expectations were updated with `-t prints`. The known source
  identity snapshot is unchanged. No tests or shared execution samples were retired.

TypeScript is clean. The regular suite reports **1434 pass / 1293 skip / 1 fail**
(the known snapshot, 4622 assertions). Full native/Wasm validation reports
**1254 pass / 0 fail**, 4379 assertions, 475.36 seconds. `git diff --check` is clean.
M4 is implemented below.

## M4 implementation (2026-11-20)

`infer-representations.ts` now schedules root/variant bodies on a dependency
worklist. Result reads and callable member-set reads register reverse edges;
changes enqueue dependents. Replays replace annotations and refresh edges.
Recursive calls use reserved result shapes. Cached topology variants which are
no longer reachable are pruned before independent verification.

The whole-program pass loop and its 64-pass cap are gone. `maxVariants` (256 by
default) and `maxWorkItems` (100,000 by default) report
`representation-resource-limit` on exhaustion. `compileConcreteProgram` forwards
both options. Added long result-propagation and work-budget tests; no behavioral
samples or snapshots were changed.

Validation: TypeScript passes; regular suite **1436 pass / 1293 skip / 1 fail**
(the known source-identity snapshot; 4627 assertions, 37 other snapshots pass).
Native/Wasm: **1254 pass / 0 fail**, 4379 assertions, 485.92 seconds.
`git diff --check` is clean. M5 is implemented below.

## M5 implementation (2026-11-20)

Removed aggregate value adapters, aggregate-result wrappers and aggregate join
metadata from concrete IR, lowering, verification, printing, C and Go. Callable
records retain one physical layout per type's ABI set; member metadata shares that
layout. Descriptor types now allow only callable types and code members.

Go now lowers captured closures, opaque environments, native `dup` and `fst`,
returned lenses, result normalization and selected lenses. Its residual cleanup
uses Go closures capturing setup cells; backing lifetime follows Go GC, while
semantic restoration and cleanup remain explicit. Function-scope cells preserve
selected-branch setup values for restoration.

The C and Go harnesses share `test/backend/execution-samples.ts` (625 unchanged
programs). New `test/go/abi-migration.test.ts` checks emission on ordinary runs and
executes all samples with `LAMINAR_EXEC=1`, plus two expected runtime traps.
Validation: TypeScript passes; regular suite **2061 pass / 1295 skip / 1 fail**
(the unchanged source-identity snapshot, 4627 assertions; all 37 other snapshots
pass). Native/Wasm: **1254 pass / 0 fail**, 4379 assertions, 721.43 seconds.
Go: **625 pass / 0 fail**, 625 assertions, 753.68 seconds, plus **2 pass / 0 fail**
for the expected runtime traps (3.97 seconds). The final regular run followed the
corpus runs, resolving compiler-contention timeouts from an earlier overlapping run.
`git diff --check` is clean. No tests or behavioral samples were retired.

**M0–M5 are complete.** M6 was subsequently requested; see its measured scope below.

## M6: measurements and bounded direct calls (2026-11-20)

M6 was requested after M5 and the snapshot repair. Added a reproducible
`cli/measure-callables.ts` benchmark and compared identity baseline `f3664b1`,
M5/snapshot baseline `b512977`, and the bounded-hint extension over the same 625
programs (622 accepted by all versions). See the design doc for metrics, toolchain,
commands and limitations. M5 is already smaller than the identity baseline; M6
reduces source size/entry metadata further but optimized host objects barely change.

Known-callee hints now survive whole local binds/moves and callable lexical-scope
results. Borrowing invalidates the slot; calls/manual regions/branches/scopes
conservatively discard local slot hints. No identity enters value representation
or specialization keys. The independent verifier checks these provenance rules.
Four focused tests cover captured/scoped direct calls, invalidation and forgeries.

Flow-class ABI sets remain deliberately deferred based on the measurements;
they are not implemented. Larger-module evidence of ABI/member cross-product
bloat is needed before changing storage contracts.

Validation: TypeScript and diff checks pass; regular suite **2066 pass / 1295 skip /
0 fail**, all 38 snapshots pass (4638 assertions). Native/Wasm: **1254 pass / 0
fail**, 4379 assertions, 433.48 seconds. Go: **627 pass / 0 fail** including the
runtime traps, 627 assertions, 475.04 seconds. Benchmark smoke accepts all 625
programs and matches the measured per-program C byte counts. The measurement and
bounded known-callee work is complete; flow-class ABI sets remain deferred.

## Gotchas learned in M1

- When rewriting a `case` range in these large files, anchor on the next case *after*
  the one you mean, and check its order. A slice that ran from `case 'global'` to
  `case 'call'` silently deleted `scope` and `case` in the verifier once.
- Python `str.index` edits fail atomically only if every assertion precedes the write.
  Check `git diff` after a failed script.
- `oxfmt` reflows code, so later string anchors may stop matching. Re-read the text
  before editing.
- Use the native/Wasm corpus as the behavioral gate; internal tests describe
  structure. Whenever you retire a test, record why in the design doc's progress
  section.
