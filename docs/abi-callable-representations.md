# Design: ABI-keyed callable representations

Status: **migration complete; M6 closed** (2026-11-20). M0–M5 are implemented and
verified. Optional M6 measured code size and added bounded known-callee direct calls;
flow-class ABI sets and wider known-callee propagation are deliberately deferred (see
*M6* below). This replaces the identity-precise callable model that phase 6 of the
[C codegen plan](c-codegen-plan.md) had been extending. The migration plan and
progress notes below record the work.

## Summary

Today the representation analysis describes a callable value by *which code it is*:
`{ kind: 'callable', unit, function, captures }`. That identity does two jobs at
once. It is the program's closure-flow analysis, because it tells each call site which bodies to
specialize and each closure which entry points to carry. It is also part of every storage
contract that holds a callable. The second job is what makes callable lenses,
joins, dispatch, recursion and demands so elaborate, and the first job does not
need it.

The new model represents a callable value by its **semantic type** alone. Its
physical layout is a struct with one entry point per **ABI** at which values of
that type are ever invoked. An ABI is the lens *shapes* of the call's lens-typed
arguments and lens-typed result. Every value representation then becomes a function of its
semantic type. The only representation parameter left is the lens shape
(thin, scattered, nested), which is finite because it is built from finite types.

Consequences:

- The representation domain is finite by construction, so every fixed point
  terminates without semantic budgets. Programs like `nest` below, rejected today,
  are accepted.
- Lenses over callables become ordinary phase-5 lenses. The `local-focus`,
  `focus-tuple` and `focus-manual` endpoint machinery, replacement demands,
  `callable-choice`, dispatch helpers and adapters, and the completion-time
  recursion fixed point are all deleted.
- Closure calls are indirect through the entry field, as they already are in C.
  Direct calls to top-level definitions are unaffected. Direct calls to known
  closures become a later, optional optimization.

This is a return to the plan's original intent. Phase 3 says to key specialization on
"concrete representation arguments, including representations nested in function
types", and the plan sketches `LensRep = thin | tuple | parameter` with values given
layouts. It never asked for closure identity in representations.

## Background: the current model

`ValueRepresentation` (in `src/infer-representations.ts`) has these callable-related
forms:

| Form | Meaning |
| --- | --- |
| `callable { unit, function, captures }` | exactly this lambda/definition with these capture representations |
| `native { definition }` | a native intrinsic used as a value |
| `callable-choice { options }` | one of several identities, selected at runtime |
| `local-focus { read, replacement }` | a lens over storage holding callables, with independent endpoint provenance |
| `focus-tuple { read, replacement, items }` | a scattered lens with callable members |
| `focus-manual { read, replacement, frontend }` | a manual (`@`) wrapper over a scattered callable focus |

Identity is used for:

1. **Call specialization.** At `f()`, the analysis knows which bodies `f` may be, and
   specializes each on the call's argument representations.
2. **Entry tables.** Physical callable records (`lower-concrete.ts`, `callable()`)
   carry one code pointer per call contract collected for that identity's group.
3. **Storage contracts.** Every slot, parameter, lens endpoint and join records
   *which* closure it holds. A lens over a callable cannot use a type-determined
   layout, so it needs explicit read/replacement provenance (`local-focus`), and the
   analysis has to track where the replacement goes (owners, `callResults`,
   `deferredFocuses`) and what it is (demands).

The third use accounts for most of phase 6. In `infer-representations.ts` and
`verify-representations.ts` (about 4,200 lines together) there are roughly 380
references to `local-focus`, `focus-tuple`, `focus-manual`, `callable-choice`,
`deferredFocuses`, `callResults`, demands and recursion hypotheses. The concrete
layer adds `dispatch`, `adapt-result`, `adapt-focus-arguments`, callable join
adapters and the `selected-focus` lens join.

## Problems

### The domain is unbounded

Captures can contain callables, so identities nest without limit:

```lm
fn nest(k, f) {match k {0 -> f; j -> nest(j - 1, fn () f())}}
{let g = nest(3, fn () 1)
 g()}
```

Each level produces `callable<λ>[callable<λ>[…]]`. This well-typed program is rejected
today with `Changing representation recursion`. The analysis terminates only because
of budgets:

- the representation and demand variant budget (256 variants);
- 16 iterations for the setup and completion fixed points;
- at most four nested fixed points per function;
- the "stable recursive inputs" rule for lens results.

Each one turns "may not converge" into "reject the program". That conflicts with the
plan's rule that specialization on representation must not change which source
programs pass semantic checking.

### Precision that buys no runtime work

Since callable storage became structural (`631684f`), most identity-level
distinctions disappear physically:

- **Dispatch argument adapters.** These stage and copy values whose layouts already
  agree. For `ex1`/`ex2` writing `fn () 7` and `fn () 9` into the same slot, the
  "conversion" is a struct copy.
- **Duplicated variants.** One callee specialized twice because callers install
  different closures with the same ABI (the `demand callable distinct replacement
  variants` sample produces two variants).
- **Scattered dispatch.** Rejected only because the scattered adapter tree for
  identity-differing contracts was never built.

### Complexity

Supporting identity in contracts needed:

- lazy demand completion;
- private and deferred result routing;
- per-arm selected-focus completion;
- a two-phase (setup and completion) recursive fixed point with seeding by divergence;
- a guard against interleaved nested fixed points.

Each of these is independently verified, but together they form the most intricate
part of the backend, and they exist only because a lens over a callable could not
have a type-determined layout.

## Key observation

If callable values are represented by type and ABI, then **every value
representation is a function of its semantic type**:

- data and tuples already have type-determined layouts (`LayoutTable.intern`);
- callables get a type-determined record (below);
- aggregates of callables are tuples of those.

Lenses remain the one place where representation varies: thin vs scattered vs
nested shapes, and type-changing read/replacement layouts. Both are already handled
for data by phase 5 (`RepresentationTable`, backings, residual contexts, selected
lenses with a runtime tag). A lens over a callable then *is* a phase-5 lens whose
layouts happen to be callable records. No endpoint provenance is needed, because the
endpoint layouts follow from the lens's semantic `read`/`write` types.

## The new model

### Values

| Semantic type | Representation |
| --- | --- |
| scalar, string, constructor | data layout, as today |
| tuple | record of member layouts, as today |
| `fn(A₁ … Aₙ) -> R` | callable record `T(fn …)`: `{ void *environment; dispose; entry₀ … entryₖ }`, one entry per ABI in `ABIs(fn …)`, in canonical order |

`LayoutTable.intern` stops rejecting `fn` types
(`Callable storage requires an explicit closure representation`) and interns the
callable record once `ABIs(T)` is known.

### ABIs

For a callable type `fn(A₁ … Aₙ) -> R`, an **ABI** fixes the lens shape of each
lens-typed parameter and, if `R` is a lens type, of the result. Non-lens parts are
type-determined and need no choice.

- Lens shapes are trees over the finite tuple structure of the parameter's semantic
  type, so each callable type has finitely many possible ABIs.
- `ABIs(T)` is the program-wide set of ABIs at which values of type `T` are invoked.
  It is computed by the global analysis below.

The result shape is part of the ABI's contract, not a free choice. At a given
argument ABI every lambda of type `T` must expose the same result shape (see
*Result shapes*).

### Specialization keys

| Code | Key |
| --- | --- |
| top-level definition, called directly | `(definition, semantic type arguments, argument lens shapes)`, as in phase 3 |
| lambda or definition used as a value | `(code, semantic type arguments, ABI)` for every ABI in `ABIs(T)` |
| native intrinsic used as a value | a reified wrapper per ABI (existing native reification) |

Capture representations are type-determined, so they no longer appear in keys.

### Indirect calls and joins

- A call through a callable value of type `T` at ABI `a` invokes entry `a` of the
  record: `(f).entryₐ((f).environment, args…)`. This is the same code C emits today,
  with exact typed function pointers and typed `call_indirect` on Wasm.
- Every value of type `T` has the same record layout, so branch joins, storage joins,
  aggregate joins and dispatch are plain moves. `callable-choice`, `dispatch`
  wrappers, callable join adapters and `adapt-focus-arguments` are deleted.

### Result shapes

At one ABI, different lambdas of type `T` may return lenses of different shapes, for
example `fn (~p) ~p` (thin) and `fn (~(x, y)) ~(x, y)` (scattered).

- The ABI's result shape is the **normalized join** of the body result shapes. It is
  the common shape when all agree; otherwise it is the existing normalization to a
  thin runtime lens with `restore`/`context`, which dynamic lens results already use.
- A lambda whose body shape differs gets an entry wrapper that adapts its result,
  using the existing `adapt-lens-result`.
- The join is monotone over a finite lattice of shapes, so it converges.

### Lenses over callables

Callable lenses use the phase-5 machinery unchanged:

- thin and scattered shapes, with type-changing read/replacement layouts;
- persistent aliases and computed loans;
- manual (`@`) cleanup and `aslens`;
- selected lenses with a runtime arm tag and per-arm normalization;
- returned lenses with residual contexts.

Affine ownership is the same as for other owned data: a swap moves the old closure
out and the new one in, and drops use the record's `dispose`.

What is deleted: `local-focus`, `focus-tuple`, `focus-manual`, replacement demands
(`demand`, `resultDemand`, `pendingDemands`), `callResults`/`deferredFocuses`
routing, retained-callable-backing special cases, `selected-focus` lens joins and the
callable `fst` endpoint rules. Native `fst` over callable aggregates becomes ordinary
lens projection.

### Global analysis and termination

The analysis becomes a standard worklist over a finite space:

1. Seed with the entry roots and their direct callees.
2. Analyze each `(code, key)` pair once. Analysis records:
   - for each indirect call of type `T`, its ABI `a` (from the argument lens shapes
     at that site); add `a` to `ABIs(T)`;
   - for each lambda or definition used as a value of type `T`, its membership in
     `Values(T)`.
3. Whenever `ABIs(T)` or `Values(T)` grows, enqueue every `(value, a)` pair in
   `Values(T) × ABIs(T)` not yet analyzed.
4. Result shapes per `(T, a)` start at ⊥ and grow by normalized join. A pair whose
   result shape changes re-enqueues the call sites that depend on it, which covers
   recursion: a recursive call at the same key reads the current approximation.

Every set is bounded by:

- the program's lambdas and definitions;
- its monomorphized types;
- the finite shapes per type.

Every update is monotone, so the worklist terminates without iteration caps.
Remaining limits, such as a variant count for pathological programs, are resource
limits with resource-limit diagnostics, not semantic gates.

The examples that motivated this change:

| Program | Today | New model |
| --- | --- | --- |
| `nest` (capturing closures recursively) | rejected, changing representation recursion | one type `fn() -> Number`, one ABI, one variant per lambda |
| `finish(~f) := fn () 7` / `finish(~g) := fn () 8` | two variants keyed on the installed closure | one variant |
| `ex1`/`ex2` dispatch over `~(f, n)` with different installed closures | rejected (scattered dispatch adapter) | same ABI, same layout; plain indirect call |
| `deep(k, ~(x, y))` recursing on `~(y, x)` | rejected, unstable recursive inputs | same shape both times, one variant; recursion is cached |
| higher-order call with both thin and scattered lens arguments | two contracts per identity group | two ABIs in `ABIs(T)`, two entries in `T`'s record |

### Verification

Verification stays independent and needs no fixed point. It checks that the analysis
output *is* a fixed point, which is local:

- **Representation verifier**:
  - every value annotation equals the type-derived representation;
  - lens shapes and backings are checked as today;
  - every indirect call's ABI is in `ABIs(T)`;
  - every member of `Values(T)` has a variant for every ABI in `ABIs(T)`;
  - every ABI's result shape is the normalized join of its members' body results
    (`verifyJoin` over shapes);
  - recursive variants are checked against their declared result shape.
- **Concrete verifier**:
  - one callable record per type, with entries in canonical ABI order;
  - each entry's wrapper is an exact invoke or a result adapter of the declared ABI;
  - closure creation fills every entry;
  - indirect calls use the entry for their ABI.

Most of today's endpoint-provenance corruption tests target constructs that no longer
exist. They are replaced by coverage tests: a missing entry, an ABI outside
`ABIs(T)`, a forged result shape, and a member missing from `Values(T)`.

### C, Wasm and Go

- **C.** One record type per callable type. Closure creation fills every entry, with
  a null environment when there are no captures, as today. Branch and storage joins of
  callables are plain moves. Code emission gets simpler: dispatch helpers and
  argument adapters are removed, and result adapters remain.
- **Wasm.** No change in kind: typed indirect calls, no function-pointer casts.
- **Go.** Callable records map to a struct with one `func` field per ABI. The Go
  backend currently rejects the dispatch argument adapter; that restriction
  disappears along with the adapter.

## Costs and trade-offs

- **Code size.** Every value of type `T` carries an entry for every ABI in
  `ABIs(T)`, and every lambda used as a `T` value is compiled for each, even ABIs it
  is never actually called at. This is bounded by
  `|Values(T)| × |ABIs(T)|`, and `ABIs(T)` is small in practice: it counts distinct
  lens shapes passed at indirect calls of one type. **Flow classes** can refine it
  later (see open questions).
- **Indirect calls.** Calls through first-class closures are always indirect until a
  known-callee optimization exists. Direct calls to top-level definitions are
  unaffected. Phase 8 can reintroduce identity as a bounded optimization: specialize
  a call site when the callee is a single statically known lambda, with no effect on
  representations or contracts.
- **Whole-program ABI sets.** `ABIs(T)` depends on every use of `T`. Host exports
  and any future separate compilation must fix the ABI at the boundary; exports
  already require an explicit incoming contract.
- **Lost information.** The analysis no longer knows which closure occupies a slot.
  No code generation depends on it; only the identity-precise adapters did.

## What happens to existing work

| Area | Outcome |
| --- | --- |
| Monomorphization, typed IR, phase-4 C/Wasm emission | unchanged |
| Phase-5 lens shapes, backings, residual contexts, selected lenses, manual/`aslens` restoration | kept; now also carries callable contents |
| Structural callable records, erased environments | kept, keyed by type and ABI set instead of entry ABIs per identity |
| Closure environments, disposal, typed invocation | kept |
| Demand-driven specialization, lazy completion, private/deferred routing | deleted; replacements are type-determined |
| `local-focus` / `focus-tuple` / `focus-manual` and their verifier rules | deleted |
| `callable-choice`, dispatch wrappers, callable join adapters, `adapt-focus-arguments`, `selected-focus` | deleted |
| Recursive contract fixed points (setup and completion) | replaced by the worklist's result-shape fixed point |
| Budgets as semantic gates | removed; resource limits remain |
| Shared execution samples (about 190 callable-related samples across the callable focus, demand, callable join, callable storage and native join sets) | kept as the end-to-end regression corpus; expected results do not change |
| Internal-structure tests (about 90 rejection assertions in `callable-focus.test.ts`, `representation-demands.test.ts`, `callable-joins.test.ts` and `callable-storage.test.ts`) | rewritten or deleted per milestone |
| Boundary tests for identity-specific restrictions | flipped to execution samples where the restriction disappears |

The semantic decisions made along the way still stand: restoration order, cleanup
ordering for native `fst` arguments, and the selected-arm write discipline. They are
encoded in the samples, which keep running.

## Migration plan

Each milestone keeps the full non-execution suite and the `LAMINAR_EXEC=1`
native/Wasm corpus green, except for tests the milestone explicitly retires.

1. **M0: corpus freeze.** Tag the shared samples as the behavioral corpus. Move the
   current boundary programs (`nest`, scattered dispatch with differing contracts,
   `deep`) into an expected-to-pass list, skipped until the milestone that enables
   them.
2. **M1: type-determined callable layouts.**
   - Add `ABIs(T)` / `Values(T)` and the worklist.
   - Represent callable values as `{ kind: 'callable', type }`.
   - Let `LayoutTable` intern callable records.
   - Keep the existing focus machinery temporarily, now fed by type-determined value
     representations, so this milestone is mostly analysis plumbing.

   Exit: all samples pass; `nest` passes.
3. **M2: callable lenses as phase-5 lenses.**
   - Remove `local-focus` / `focus-tuple` / `focus-manual`, demands and routing from
     analysis and verifier.
   - Callable lenses use thin/scattered shapes and type layouts.

   Exit: all samples pass; the representation verifier no longer mentions callable
   endpoints.
4. **M3: joins and dispatch.**
   - Remove `callable-choice`, dispatch wrappers, callable join adapters and
     `adapt-focus-arguments`.
   - Indirect calls go through entries, with result-shape normalization per ABI.

   Exit: all samples pass, plus the scattered-dispatch boundary programs.
5. **M4: recursion and budgets.**
   - Replace the recursive contract fixed points with the worklist's result-shape
     fixed point.
   - Turn budgets into resource limits.

   Exit: `deep` and changing-input recursion pass.
6. **M5: concrete verifier and C cleanup.**
   - One record per type.
   - Delete dispatch and adapter emission.
   - Go backend parity for callables.
7. **M6 (phase 8, optional).**
   - Known-callee direct calls.
   - Flow-class ABI sets.
   - Measure code size against the identity-precise baseline before adding either.

M1 through M3 overlap heavily in the analysis. They can land as one large change if
intermediate states prove awkward, as long as each still passes the corpus.

## Open questions

1. **ABI set granularity.** Per semantic type (simplest, chosen for M1), or per
   flow class: values unified when they meet at a join, a parameter, storage or a
   return, Steensgaard-style. That is near-linear and still finite, and it removes
   entries and variants a type never needs in a given flow. Defer until code size is
   measured.
2. **Normalization target for dynamic lens results.** Thin runtime lenses (current
   dynamic normalization), or a scattered "tuple of component addresses" when every
   member's result is scattered. Thin is simpler and already exists; scattered avoids
   staging for scattered-only callers.
3. **Natives as values.** Today natives are reified per dispatch. Under the new model
   a native used as a `T` value needs a wrapper for every ABI in `ABIs(T)`. Confirm
   every native that can be used as a value has a total ABI story, or reject
   unsupported combinations explicitly.
4. **Selected callable lenses.** These become ordinary selected lenses. Confirm that
   per-arm normalization handles callable records with no extra adapters; they share
   one layout, so it should.
5. **Host exports of callables.** An exported callable must declare the ABIs it
   supports. This fits the existing explicit export contract, but needs a test.

## Migration progress

### M0: corpus freeze (`67b5781`)

The three expected-to-pass programs are recorded in
`test/backend/abi-migration-samples.ts` and run through typed IR, the legacy
reference, concrete verification, C emission and (once enabled) native/Wasm.

### M1: type-determined callables with whole-program member sets

- **Representation.** A callable value is `{ kind: 'callable', type }`. Lambdas,
  definitions and natives are `CallableMember`s with type-determined captures, listed
  per type in `RepresentationAnalysis.callables`. `native` and `callable-choice` are
  no longer value representations.
- **Known code.** A `global`/`closure` value used only as an immediate callee stays a
  direct call to its exact variant. Any other use escapes, and the member joins its
  type's set (`src/callable-escape.ts`, shared with the verifier). A native that is the
  only member of its type is also called directly, because it is lowered as an
  intrinsic.
- **Indirect calls** dispatch over every member of the callee's type at the call's
  ABI. The analysis runs whole-program passes until the member sets stop growing; an
  in-progress recursive lens result contributes in the next pass.
- **Verification.** The representation verifier derives escaping members
  independently, requires them to equal the listed sets, and checks direct-call
  callees and dispatch targets.
- **Concrete lowering.** Concrete lowering builds one record per callable type, with
  dispatch entries for its indirect-call ABIs. Member records reuse the type's layout
  and entry order, so joins are moves. The `callableJoin` and callable `adapt-result`
  adapters are gone. Direct calls invoke the member's exact wrapper; the `invoke`
  instruction then has no `field`, and C and Go call the wrapper's function. Record
  identities derive from group keys, and the type's layout follows from its entry ABIs
  alone, so member environments can capture values of their own type.
- **Results.** All three migration programs now compile and verify: `nest`, scattered
  dispatch with differing installed closures, and alternating-input recursion. The
  last two were scheduled for M3 and M4 but follow from type-determined contracts.

**Retired internal tests (66).** All forge, or look up, distinctions that only existed
between callable identities:

- callable endpoint provenance forgeries;
- `callable-choice` analysis and join adapters;
- callable storage, aggregate and selected-lens storage join adapters;
- deferred cleanup descriptor transitions and post-cleanup joins;
- demand-identity variants;
- `adapt-result` and dispatch focus-argument adapters;
- boundary tests whose programs now compile.

Rewritten tests check the ABI-model equivalents: one entry per call ABI on a type
record, direct versus record calls, member-set provenance, and forged native members.
Printed IR and C expectations were regenerated; known calls now name their code
directly.

M1 retained the focus endpoint machinery (`local-focus`, demands and routing) on
type-determined representations; M2 below removes it.

**Validation (2026-11-20).** `npx tsc --noEmit -p .` passes. `bun test` reports
1,429 passed, 1,293 skipped and the one pre-existing source-identity snapshot
failure (`can show original identities and source origins for debugging`); that
snapshot was not updated. `LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes
all 1,254 native/Wasm cases (4,379 assertions, 479.43 seconds), including the four
native dynamic lens result cases fixed by reifying native adapter sources in C.
`git diff --check` is clean.

### M2: callable lenses use ordinary phase-5 shapes

- **Storage and shapes.** `LayoutTable` interns function types as callable storage.
  Concrete data layouts resolve those leaves through the callable type's record;
  tuples containing callables share the same aggregate layout for values and lens
  backing. Thin, scattered and nested callable lenses now use `RepresentationTable`
  exactly like other lenses, including native `fst` projection.
- **Analysis.** Removed `local-focus`, `focus-tuple`, `focus-manual`, replacement
  demands, focus owners/targets, private and deferred result routing, and retained
  callable storage/cleanup join annotations. Plain values follow semantic types;
  only lens topology needs representation state. Manual cleanup is analyzed using
  its restoration-time typed IR, without replaying representation effects.
- **Independent verification.** The representation verifier checks semantic value
  representations, ordinary lens topology, call targets and member-set coverage.
  It no longer tracks callable endpoints or cleanup-time descriptor transitions.
  Forged physical callable-lens fields, foreign shapes and changed projection
  topology remain independently rejected.
- **Concrete lowering.** Deleted callable-focus layouts, `selected-focus` joins,
  special manual restoration modes and backing-retention/conversion metadata.
  C and Go no longer carry the unused storage conversion paths. Ordinary selected
  lenses and residual contexts preserve the existing restoration order.
- **Recursion overlap with M4.** Removing demand-driven setup/completion also removes
  its recursion hypotheses. Recursive calls now read a declared result-shape
  approximation, and whole-program passes continue until both member sets and
  results stabilize. The old changing-input recursion guard is unnecessary over
  finite lens shapes; its thin-to-scattered boundary test now expects success.
  M4 still owns replacing pass rescans with a worklist, formalizing result-shape
  propagation and turning the remaining variant/pass budgets into resource limits.

**Retired internal tests (10).** Six callable-focus tests depended on same-type
identity provenance or retained callable scope descriptors (one branch provenance
forgery and five retained-backing forgeries). Four demand-source tests depended on
replacement demands that no longer exist. Two replacements check that the complete
shared demand corpus has ordinary contracts without demands, and that obsolete
call-demand annotations are rejected. Eight endpoint/physical forgeries and three
recursive/private-result contract tests were restated in terms of ordinary lens
shapes. Callable storage interning has a new thin/scattered layout test. All shared
execution samples and their expected results are unchanged.

**Validation (2026-11-20).** `npx tsc --noEmit -p .` passes. `bun test` reports
1,422 passed, 1,293 skipped and the one pre-existing source-identity snapshot
failure (4,606 assertions; 37 other snapshots pass); no snapshot was updated.
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes all 1,254 native/Wasm
cases (4,379 assertions, 476.82 seconds). `git diff --check` is clean.

### M3: ABI-slot invocation without callable dispatch adapters

- **Concrete calls.** A callable type's entries declare only the canonical ABI and
  field name. Each listed member fills those slots with its own exact wrapper,
  including `adapt-lens-result` when its body returns a different lens shape.
  Indirect `invoke` instructions contain the ABI and field, without a synthetic
  wrapper reference. Direct calls still name their exact wrapper. The concrete IR
  makes these two forms mutually exclusive.
- **Deleted paths.** Removed concrete `dispatch`, `adapt-result` and
  `adapt-focus-arguments` wrapper kinds, `callableJoin`, and callable value adapters,
  together with their C/Go emission and concrete printing. Callable branch joins
  remain ordinary record moves. Native reification follows member entries and
  native result-adapter sources directly, without a dispatch wrapper table.
- **Independent verification.** Type slots are checked against the indirect-call
  contracts; member entries are derived independently from the member set and
  their exact contracts. Missing entries, wrong ABIs/fields, incorrect member
  wrappers and wrapper references on indirect invokes are rejected. The analysis's
  internal member enumeration still specializes every member at each call ABI;
  it does not create runtime dispatch helpers.

**Tests.** Added 12 ABI-slot/member/invocation coverage and corruption tests. No
execution samples or tests were retired. Three printed-IR expectations were
regenerated with the `prints` filter; the pre-existing source-identity snapshot
was left untouched. Generic aggregate move descriptors remain for the subsequent
concrete cleanup; differing lens results retain ordinary lens-result normalization.

**Validation (2026-11-20).** `npx tsc --noEmit -p .` passes. `bun test` reports
1,434 passed, 1,293 skipped and the one pre-existing source-identity snapshot
failure (4,622 assertions; 37 other snapshots pass).
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes all 1,254 native/Wasm
cases (4,379 assertions, 475.36 seconds), including scattered dispatch with
differing installed closures and native dynamic lens-result normalization.
`git diff --check` is clean.

### M4: dependency worklist and resource limits

Roots and representation variants are now independent work items. Calls register
reverse dependencies on callee results and callable member sets. Discovering a
member or changing a result shape queues only the affected bodies; recursive calls
read the reserved variant's current shape instead of recursively analyzing it.
Each replay replaces its SSA/call annotations and refreshes its dependency edges.
Earlier topology specializations that become unreachable are omitted from the
final analysis. The independent verifier still checks the resulting fixed point.

The whole-program rescan and 64-pass convergence gate are removed. `maxVariants`
(default 256) and the new `maxWorkItems` (default 100,000, also exposed through
`compileConcreteProgram`) are explicit resource budgets. Exhaustion reports
`representation-resource-limit`, rather than an unsupported-program diagnostic.
Invalid budget values retain `invalid-representation-budget`.

Two tests cover propagation through 81 lens-returning bodies and configurable
work-item exhaustion/recovery. Existing variant-budget tests now require the
resource-limit diagnostic. No execution samples, snapshots or tests were retired.

**Validation (2026-11-20).** TypeScript passes. `bun test` reports 1,436 passed,
1,293 skipped and the one known source-identity snapshot failure (4,627 assertions;
37 other snapshots pass). The complete native/Wasm corpus passes all 1,254 cases
(4,379 assertions, 485.92 seconds). `git diff --check` is clean.

### M5: concrete cleanup and Go callable parity

- Removed `ConcreteValueAdapter`, aggregate join descriptors, aggregate-result
  wrappers and their emission/printing/verification paths. Plain and aggregate
  callable joins are record moves. Only lens-result normalization remains.
- Concrete callable descriptors are restricted to callable types or code members;
  members share their type's physical record and canonical ABI slots. The verifier
  now checks exact invokes, native wrappers and ordinary lens-result normalizers,
  without a separate value-conversion tree.
- Go supports captured closure environments, opaque `any` environments/contexts,
  native `dup`/`fst` entries, returned thin/scattered lenses, lens-result
  normalization and selected-lens restoration. Residual restoration uses Go
  closures to retain setup cells; Go's GC retains backing and environments while
  semantic cleanup and restoration remain explicit and ordered.
- The unchanged 625 behavioral programs now live in a shared execution-sample
  module used by both the C/Wasm and Go harnesses. Go has a four-build concurrency
  limit and runs the same expected values, plus the two expected runtime traps.
  Ordinary test runs check Go emission; `LAMINAR_EXEC=1` compiles and executes it.

No behavioral samples or internal tests were retired. The source-identity snapshot
remains unchanged. M6's optional optimization and flow-class work is outside this
migration.

**Validation (2026-11-20).** TypeScript passes. The regular suite reports
2,061 passed, 1,295 skipped and only the known source-identity snapshot failure
(4,627 assertions; 37 other snapshots pass). Native/Wasm passes all 1,254 cases
(4,379 assertions, 721.43 seconds). Go executes all 625 shared programs
(625 assertions, 753.68 seconds), plus both expected runtime traps (2 assertions,
3.97 seconds). The regular suite was rerun after the corpus runs finished to avoid
compiler contention; its only remaining failure is the pre-existing snapshot.
`git diff --check` is clean. **The required M0–M5 migration is complete.**

### Post-migration: debugging snapshot refresh

At the user's request, refreshed the previously known source-identity snapshot to
reflect opaque environments, direct calls and current generated identities. Added
explicit assertions that full code IDs and source origins remain visible. No
compiler behavior changed; historical milestone validation totals above are kept
as recorded.

Validation: `bun test` passes with 2,062 passed, 1,295 skipped, no failures and
all 38 snapshots passing (4,631 assertions). TypeScript and `git diff --check`
pass.

### M6: measured code size and bounded known-callee propagation

Measured before extending the optimization. `cli/measure-callables.ts` compiles the
same 625 source programs with a selected compiler checkout. The identity-precise
baseline is `f3664b1`; the ABI baseline is `b512977` (M5 plus the snapshot repair).
The identity baseline accepts 622 programs, rejecting only the three migration
boundary programs. Both ABI versions accept all 625. Totals below include only
the 622 programs accepted by all three versions, preserving the corpus's duplicates.

| Metric | Identity baseline | M5 | M6 bounded hints |
| --- | ---: | ---: | ---: |
| Generated C bytes | 2,849,878 | 2,709,515 | 2,684,101 |
| Host `-O2` object bytes | 2,013,440 | 1,981,656 | 1,981,640 |
| Concrete code bodies | 2,179 | 2,246 | 2,246 |
| Wrapper records | 4,719 | 5,105 | 5,105 |
| Callable entry records (type and member metadata combined) | 2,291 | 2,091 | 1,710 |

Measurement uses Apple clang 21.0.0 (`clang-2100.0.123.102`) on arm64 macOS.
Objects are host `clang -std=c11 -O2 -c` outputs of generated wasm32-target C;
object-file bytes include metadata/data, and are a size proxy, **not Wasm binary
size or a runtime performance measurement**. No debug information is requested.
The 16-byte aggregate object difference from M5 is negligible; this is consistent
with the host optimizer already removing most local indirection. The report
records a corpus hash and compiler version; the measured corpus hash is
`ca6a365c1fbfc804d65b563c6dc1efa0970cb272c77c10dfd9289c266e3b7b0a`.

Reproduce from `ts/`, with a baseline checkout and dependencies available:

```sh
bun cli/measure-callables.ts /path/to/identity-baseline --objects > baseline.json
bun cli/measure-callables.ts . --objects > current.json
```

M1 already called immediate known globals/closures directly. M6 preserves that
hint through whole-slot local binds/moves and callable results of lexical scopes.
The hint is invalidated by borrowing the slot, calls, manual regions and branch
or scope boundaries. It stores only one member per slot, never joins code sets,
and never puts identity into representation/specialization keys. The independent
verifier derives the same provenance from IR and rejects forged direct callees.
Four tests cover direct captured/scoped calls, replacement invalidation and forged
provenance. Three printed expectations were refreshed; no tests or samples retired.

**Flow-class decision.** Defer flow-class ABI sets. M5 already reduces generated C
by 4.9% and aggregate object bytes by 1.6% against the identity baseline. The bounded
hint extension further reduces C by 0.9% and entry metadata by 18.2%, without a
meaningful optimized object-size improvement. These small standalone corpus
programs do not establish a payoff for new flow-class storage contracts. Revisit
with larger module workloads showing ABI/member cross-product growth; flow-class
ABI sets have **not** been implemented or claimed complete.

**Validation (2026-11-20).** TypeScript and `git diff --check` pass. The regular
suite reports 2,066 passed, 1,295 skipped, no failures and all 38 snapshots passing
(4,638 assertions). Native/Wasm passes all 1,254 cases (4,379 assertions,
433.48 seconds); Go passes all 625 programs and both runtime traps (627 assertions,
475.04 seconds). The benchmark smoke run accepts all 625 programs and reproduces
the per-program C byte counts from the object measurement run.
