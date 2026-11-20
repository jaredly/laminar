# Hand-off: ABI-keyed callable migration (2026-11-20)

This hand-off covers the migration described in
[abi-callable-representations.md](abi-callable-representations.md). Read that
design doc first, especially *The new model* and *Migration plan*. The user asked for
**one commit per milestone (M0–M5)**. M6 is optional phase-8 work and has not been
requested.

## Where things stand

| Milestone | State |
| --- | --- |
| M0: corpus freeze | **Committed** (`67b5781`) |
| M1: type-determined callables, whole-program member sets | **Verified and committed** (the M1 commit containing this hand-off) |
| M2: callable lenses as phase-5 lenses (delete focus machinery) | Not started |
| M3: remove callable joins and dispatch leftovers | Not started; mostly dead code after M1 |
| M4: recursion via the worklist; budgets as resource limits | Not started |
| M5: concrete verifier, C and Go cleanup | Not started |

Unrelated, existing failure, not ours: `can show original identities and source
origins for debugging` (source-identity snapshot in `test/print-concrete.test.ts`).
Never update that snapshot with `-u`. When regenerating printed snapshots, filter with
`-t "prints"`, which doesn't match it.

## M1 validation complete (2026-11-20)

- `npx tsc --noEmit -p .`: clean.
- `bun test`: **1429 pass / 1293 skip / 1 fail**; only the existing
  source-identity snapshot failure above. Its snapshot was not updated.
- `LAMINAR_EXEC=1 bun test test/c/execute.test.ts`: **1254 pass / 0 fail**,
  4379 assertions, 479.43 seconds. Native and Wasm both pass, including all four
  dynamic lens result cases that previously emitted `undefined(...)`.
- `git diff --check`: clean.

The C fix includes native wrappers used as adapter sources in `nativeEntries`.
The next implementation milestone is **M2**; M2–M5 have not been implemented.

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

## Next steps (M2–M5)

- **M2.** Delete `local-focus` / `focus-tuple` / `focus-manual`, replacement demands
  (`demand`, `resultDemand`, `pendingDemands`, `setupFocusCall` / `completeFocusCall`
  lazy completion), `callResults` / `deferredFocuses` routing, `selected-focus`
  `lensJoin` and the callable `fst` endpoint rules. These now run on type-determined
  representations and are redundant.
  - Callable lenses become ordinary `lens` shapes with type layouts. `LayoutTable.intern`
    (`src/layouts.ts`) currently throws for `fn` types ("Callable storage requires an
    explicit closure representation"). It needs a callable-record layout, and the
    concrete side must map that data layout to the type's record.
  - Concrete `local-focus` layouts and manual restoration modes
    (`local-focus` / `scattered-focus`) go too.
  - Expect another round of internal-test retirement in `callable-focus.test.ts` and
    `representation-demands.test.ts`.
- **M3.** Remove leftover dead paths:
  - `adapt-result` and `adapt-focus-arguments` wrapper kinds (lowering no longer
    produces them for differing contracts, since contracts are equal);
  - `callableJoin` in concrete IR, C and Go;
  - `ConcreteValueAdapter` `kind: 'callable'`.
- **M4.**
  - Replace the recursion hypothesis machinery (`RecursionHypothesis`,
    `RecursionPending`, `activeRoots`, completion-time fixed point) with the
    pass-based result-shape fixed point.
  - Recursive member results already contribute in the next pass via `PendingResult`;
    direct recursive lens results still use the hypothesis code.
  - Turn the 256-variant / 16-iteration / 4-nesting limits into resource-limit
    diagnostics.
- **M5.**
  - Simplify the concrete verifier and C now that only type and member records exist.
  - Possibly emit `NULL` instead of `((Lk){0}).environment` for direct calls of
    environment-free code (cosmetic).
  - Go parity.

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
