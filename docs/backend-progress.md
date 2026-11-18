# Backend implementation record

## Completed slice: contracts and durable elaboration (phases 0–1)

The compiler now preserves the semantic information needed for typed lowering. This change does not emit C/Wasm or claim the native/Wasm milestone has been reached.

- [Backend contract](backend-contract.md): evaluation order, affine ownership, typed storage versions, source versus physical representation, closure ABIs, host boundaries, result protocol, and phased acceptance cases.
- `src/backend/target.ts`: explicit native/Emscripten target configurations, validation, target-specific canonical cache keys, and distinct backend diagnostics.
- `src/elaborated.ts`: frozen, serializable identified source and semantic metadata. IDs are namespaced by unit/definition, not source locations or solver-local numbers.
- `src/types.ts`: instantiation can return its quantified-variable substitution. Existing `instantiate` callers remain supported.
- `src/infer.ts`: emits immutable declarations/uses, alias projections and loan permissions, generic definition uses, closure captures, storage transitions, borrow scopes, function regions, and branch states. Exported annotation parameters are linked to inferred body variables; recursive uses carry identity type arguments.
- `src/check.ts`: keeps the same identified checked snapshot for metadata and legacy lowering, verifies metadata before issuing a handle, and tracks definition identities alongside exported schemes. The caller's source object can still be changed without changing the checked snapshot.
- `src/backend/verify-elaboration.ts`: validates identities, references, type-variable scope, parameter/place correspondence, borrow parents, and transition regions. This structural metadata verifier does not replace the phase-2 typed-IR verifier.
- `test/backend/corpus.ts`: named acceptance inputs and expected results from scalars through closures and lists. Each records its first required codegen phase. Current tests establish that all samples elaborate and match the active evaluator.

The initial Wasm profile is Emscripten/Node because that toolchain is available locally; it replaces the plan's suggested WASI-first profile. An immutable CI artifact pin still needs provisioning before phase-4 required Wasm CI. Recorded local tool versions are observations, not a claim of reproducible provisioning.

## Verification

Baseline before this slice: 285 passing tests, 39 existing skips, zero failures. After the slice: 333 passing tests, the same 39 skips, zero failures across 16 files. All 48 added tests in `test/elaborated.test.ts` pass. `bunx tsc --noEmit` passes.

New tests exercise cloning/serialization, immutable history, shadowed bindings with identical locations, generic and narrowed annotated contracts, recursive specialization links, alias/capture restoration, independent function-body regions, branch joins, wildcard lens parameters, corrupt metadata rejection, target cache separation, and reference results for the acceptance corpus. No generated C/Wasm execution test is claimed.

## Completed slice: generic typed IR (phase 2)

Phases 0–1 were committed as `f083de1` (`Retain durable typed elaboration for native and Wasm backends`). The current change adds phase 2:

- `src/typed-ir.ts` and `src/lower-typed.ts`: ordered typed temporaries, logical place operations, explicit generic instantiations, constructor patterns, closure captures, lexical loans, deferred cleanup, and branch-edge disposal. Lowering consumes retained elaboration and does not rerun inference.
- `src/verify-ir.ts`: independent type/resource verification on serialized IR, including SSA use, generic schemas, loan permissions, scoped places, capture ownership, branch availability, and restoration obligations. It rejects functions that fail to restore lens parameters even if cleanup annotations have been removed.
- `src/eval-typed.ts`: reference execution directly on a detached typed-IR snapshot, with no AST or legacy-evaluator fallback. It covers thin/scattered logical lenses, type changes, returned views, recursion, captures/refills, registered constructor patterns, strings, and lists. Physical layouts/ABIs remain undecided.
- `Checker.lowerTyped` and `checkTypedFile`: owned checked lowering handles and a whole-file checked/verified path alongside the existing execution path.
- `test/typed-ir.test.ts`: 54 tests spanning corpus verification/execution, legacy differential comparisons, corrupted IR rejection before effects, branch-sensitive closure disposal, numeric JSON round trips, constructor schemas, and lifetime/order regressions.

Verification after phase 2: 387 passing tests, the same 39 existing skips, zero failures across 17 files; `bunx tsc --noEmit` passes. Reference tests normalize the legacy evaluator's deleted sentinel to logical unit. `dup` on an empty focus has a separate expected-unit test because the old evaluator cannot clone that sentinel. No generated C/Wasm execution is claimed.

See [the typed IR documentation](typed-ir.md) for API and invariants.

## Next slice: representation specialization (phase 3)

Consume verified generic typed IR, retain generic code for diagnostics, infer recursive lens representation shapes, and specialize the reachable call graph using concrete semantic types and representation arguments. Validate concrete call ABIs and target-specific cache keys before introducing a C emitter. Preserve explicit unsupported diagnostics for unresolved representation joins until their adapters exist.

Subsequent phases remain as described in [the plan](c-codegen-plan.md): representation specialization, the first native/Wasm execution milestone, type-changing backing/restoration, affine closure ABIs and joins, then heap data/runtime integration. No emitter or untyped fallback has been introduced in this slice.

## Started slice: concrete representation vocabulary (phase 3)

- `src/layouts.ts`: target-specific interning of concrete scalar/unit/tuple storage descriptions, immutable detached semantic types, explicit dependencies, and deterministic dependency-first snapshots. Keys use structural semantic types and canonical target configuration; insertion order and source place identities do not participate. These descriptions do not calculate C sizes, alignment, or field offsets.
- `src/representations.ts`: interned thin locations and recursive tuples of locations, including nested mixed shapes. Backing records retain independent read/replacement layout IDs and distinguish same-layout access from separate typed slots. Projection preserves scattered child shapes. Joins accept identical representations and explicitly diagnose shapes that need adapters.
- `test/representations.test.ts`: layout reuse, semantic distinctions, immutability, deterministic dependency ordering, target separation, thin/scattered distinction, mixed nested projection, type-changing/unit backing, and unsupported layout/join diagnostics.

This is the first foundation of phase 3, not its exit gate. The tables are standalone and are not yet wired into generic typed lowering. Representation constraints, reachable specialization and recursion budgets, callable ABIs/wrappers, recursive nominal data definitions, deterministic emitted names, and independent concrete-IR verification remain to be implemented. Reachable type variables, functions without a closure representation, and nominal types without a storage definition are explicitly rejected by the layout API; no generic erasure or opaque pointer fallback is provided.

Verification: `bun test` passes with 394 passing tests, 39 existing skips, and zero failures across 18 files; `bunx tsc --noEmit` passes. No generated C/Wasm execution is claimed.

## Continued slice: reachable semantic specialization (phase 3)

The representation vocabulary was committed as `8ea051b` (`Add concrete layout and recursive lens representation tables`). The next slice adds:

- `src/specialize.ts`: explicit entry roots, retained semantic substitutions, a target-specific cache of reachable definition/import instances, deterministic SHA-256 names, dependency-first emission, and monomorphic user-definition references. Cache entries are reserved before body traversal for ordinary recursion. Changing-specialization recursion and instance-budget exhaustion report the definition chain. Generic IR remains frozen and available for diagnostics; unused top-level definitions/imports are omitted.
- Specialized user units pass the existing typed-IR verifier. Global binding schemes are provenance-only metadata and are kept in the generic snapshot, rather than copied as unresolved storage annotations. Native/constructor import schemas remain generic for compatibility with typed verification/reference execution; the instance graph records their concrete uses separately.
- `test/specialize.test.ts`: 27 tests covering reference execution of all acceptance cases after semantic specialization, instance reuse, numeric/boolean separation, recursion, first-class functions, reachability, deterministic target separation, explicit root/budget errors, unresolved local annotations, and verified generic IR with changing-specialization recursion.

This slice does not connect representation constraints to specialization keys or establish physical call ABIs. Thin/scattered specialization variants, recursive nominal layouts, callable wrappers, and the independent concrete-IR verifier remain open. The semantic output is not the phase-3 exit artifact. API details and limitations are documented in [representations.md](representations.md).

Verification: 421 passing tests, 39 existing skips, zero failures across 19 files; `bunx tsc --noEmit` passes. No C/Wasm execution is claimed.

## Continued slice: reachable representation analysis (phase 3)

Semantic specialization was committed as `d78dbe7` (`Specialize reachable typed IR definitions by concrete semantic arguments`). The next slice adds:

- `src/infer-representations.ts`: expression-rooted analysis over verified semantic-specialized IR. Layout/shape annotations cover temporaries, captures, arguments, results, and calls. Function variants are cached by target, semantic function identity, and incoming argument/capture representations, so thin and scattered calls at identical semantic types remain distinct. Ordinary recursive variants are reserved before body analysis; changing-representation recursion and budget exhaustion produce call-chain diagnostics.
- Lens acquisitions retain incoming parameter topology through projection and typed backing changes; owned acquisitions remain thin. Mixed recursive lens tuples and user-returned lens results propagate to consumers. `native/fst` has an explicit projection contract. Known first-class functions pass through places, higher-order parameters, captures, and results without being rewritten into direct source calls. Divergent callable joins require adapters and are explicitly unsupported.
- `RepresentationTable.backingSnapshot()` exposes immutable backing records alongside layout/shape snapshots. `test/backend/typed-program.ts` shares source-to-typed-IR setup between semantic specialization and representation tests.
- `test/infer-representations.test.ts`: 26 tests covering phase 4–6 corpus shape analysis, equivalent-call reuse, thin/scattered variants at identical endpoint types, mixed shapes and type-changing backing, known higher-order calls, ordinary and changing-shape recursion, user-returned lenses, target separation, serialization determinism, budgets, and explicit unsupported cases.

This is a representation analysis graph, not emitted concrete IR or the phase-3 exit gate. Physical closure/native ABIs, callable wrappers, symbolic generic-body constraints, recursive nominal layouts, rewriting code records to representation variants, and independent concrete-IR verification remain open. Unsolved recursive returned representations, callable entry roots without an argument contract, and nominal data layouts are diagnosed explicitly. No C/Wasm emitter or fallback was added.

Verification: 447 passing tests, 39 existing skips, zero failures across 20 files; `bunx tsc --noEmit` passes. These checks establish analysis behavior, not native/Wasm execution.

## Continued slice: independent representation analysis verification (phase 3)

Reachable representation analysis was committed as `5f86933` (`Infer reachable lens shapes and representation-specific function variants`). The next slice adds:

- `src/verify-representations.ts`: independent validation of serialized analysis against verified semantic IR, without calling inference. It checks canonical target-specific layout/backing/shape identities, concrete storage kinds, layout dependency order, recursive shape endpoints, backing access conventions, variant names/keys, complete temporary/call coverage, type correspondence, callable provenance/captures, lens topology, call variant contracts, root coverage, and variant reachability.
- `inferRepresentations` now verifies its completed analysis before returning its immutable snapshot. Representation consistency failures use `invalid-representation-analysis` diagnostics; semantic ownership/lifetime checking remains the typed-IR verifier's responsibility.
- `test/verify-representations.test.ts`: 58 tests including serialized corpus analyses, higher-order/returned-lens/multiple-shape contracts, object-property reordering, target mismatch, malformed/missing/duplicate records, corrupted annotations and call contracts, unreachable variants, and adversarial same-type topology/callable substitutions. A coherent thin lens cannot replace a scattered tuple merely because its endpoint types match; a forged same-type callable branch join is independently rejected.

This verifies the analysis graph, not physical executable concrete IR. The phase-3 exit gate remains open: representation-specific code records, physical callable/native ABIs and wrappers, recursive nominal layouts, and concrete-IR verification still need implementation before C/Wasm emission. API and limits are recorded in [representations.md](representations.md).

Verification: 505 passing tests, 39 existing skips, zero failures across 21 files; `bunx tsc --noEmit` and `git diff --check` pass. No C/Wasm execution is claimed.

## Completed slice: concrete typed IR and phase 3 handoff

The independent analysis verifier was committed as `8cdbf29` (`Verify serialized representation analysis independently`). Phase 3 now has its concrete output and independent exit-gate verification:

- `src/concrete-ir.ts`, `src/lower-concrete.ts`: `compileConcreteProgram` accepts verified generic IR with explicit expression/function roots, semantic arguments, and incoming lens topology contracts. It emits concrete layout/ABI tables, typed invocation/disposer/native wrappers, reified callable construction, representation-specific code bodies, and forward declarations. Generic IR remains attached for diagnostics. Multiple thin/scattered exports of the same semantic function are supported.
- `src/concrete-layouts.ts`, `src/layout-definitions.ts`: structural C storage kinds, typed pointer/code fields, normalized generic nominal schemas, recursive forward references, and separate by-value cycle verification. Both semantic and physical layout tables support registered recursive containers and diagnose infinite by-value storage or unbounded expansion. Constructor signatures are checked against registered storage payloads. Failed expansions do not leave partial cache records.
- Every invocation selects a fixed typed slot, wrapper, and concrete ABI. A callable owns one environment plus a finite set of statically discovered invocation fields; this conservative representation avoids incompatible function-pointer casts while supporting distinct thin/scattered call contracts. Unused callables retain concrete capture/disposer storage and erase only unreachable invocation entries/bodies under an explicit tested rule. Later optimization can shrink single-entry cases.
- `src/verify-concrete.ts`: independent serialized-artifact validation of physical fields, by-value cycles, ABIs, wrapper ownership, environment/capture layouts, code and parameter contracts, full instruction correspondence, output layouts, call targets, entries, and forward declarations. It does not call concrete lowering. Lowering runs it before returning frozen output.
- Concrete cache identities include the target, normalized schemas, physical callable fields, and reachable ABI graph. Tests establish target separation, property-order independence, source-local place-ID independence, recursive reuse, and equivalent-call sharing.
- `test/concrete-ir.test.ts`: 53 tests covering all phase 4–6 corpus inputs at the concrete-IR boundary, explicit function exports, multiple lens-shape exports, higher-order functions, returned closures/lenses, disposal-only callables, registered recursive list layouts, corruption rejection, infinite-layout/expansion diagnostics, and the acceptance matrix above.

The phase-3 exit gate is met for accepted inputs: every emitted value/function has a concrete storage/ABI contract, and every call selects emitted wrapper/code records with matching arguments and result. Unsupported joins, unknown layouts, unsolved local types or recursive returned representations, and host-callable root arguments without a host contract remain explicit diagnostics. No incomplete artifact or untyped fallback is emitted.

Verification: 558 passing tests, the same 39 existing skips, zero failures across 22 files; `bunx tsc --noEmit` and `git diff --check` pass. This is concrete-IR verification, not generated C/Wasm execution. Phase 4 is next. See [concrete-ir.md](concrete-ir.md) for API, ABI conventions, erasure rules, and the later-phase boundary.

The concrete IR also has a lexer-node diagnostic printer (`src/print-concrete.ts`): `lconcrete` composes with the lexer's `stringify`, and `printConcreteProgram` is its convenience API. Compact source/SSA names, typed invocation slots, captures, loans, and deferred cleanup are visible by default; full canonical IDs and source origins are optional. All expected printer outputs are inline in `test/print-concrete.test.ts` (22 tests, 23 inline snapshots). Final verification including the printer: 580 passing tests, 39 existing skips, zero failures across 23 files; TypeScript and diff checks pass.

## Completed slice: first native C and Emscripten/Node execution (phase 4)

Phase 3 was committed as `c312abb`; its baseline is 580 passing tests and 39
existing skips. Phase 4 adds:

- `src/c/lower.ts`: independently verifies the concrete input, then resolves
  logical places, homogeneous thin/scattered lens backing, projections, moves,
  refills and swaps into explicit ordered statements. Empty swap results produce
  unit without loading storage; full swaps preserve the old value before writing.
  Homogeneous restoration updates caller storage directly. Type-changing backing,
  returned lenses, captured/indirect callables and heap/runtime data retain explicit
  backend diagnostics.
- `src/c/syntax.ts`, `src/c/emit.ts`: syntax-only statement-tree printing and its
  composition with storage lowering. Emission declares concrete types, exact ABI
  pointer types, prototypes, capture-free direct function definitions, and an entry
  adapter. Direct calls preserve the opaque environment argument, use verified
  concrete wrapper contracts, and do not allocate callable environments.
- `src/c/build.ts`: separate strict C11 compilation/execution, optimized builds,
  optional native ASan/UBSan, Emscripten/Node builds, tagged special-number results,
  toolchain metadata, and retained C/JS/Wasm/commands/runtime diagnostics on failure.
- `test/c/`: full inline expected printer output for tuple/thin/scattered examples;
  typed-IR/native/Wasm differential execution of all phase-4 acceptance cases;
  lexical alias restoration, empty swaps, full/nested assignment order, fractional
  division and special-double regressions; native sanitizer execution; actual
  unmatched-case traps on both targets; explicit later-phase/corrupt-IR rejection.
- `.github/workflows/backend.yml`: a required-tool execution job provisions
  Emscripten 4.0.23 through emsdk commit
  `c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56`, Node 24.13.1 and Bun 1.4.2.
  Missing local tools report skips; CI treats missing backend tools as failures.
  Failed backend artifacts are uploaded. Remote CI execution/branch protection
  remain external to local verification.

The phase-4 native and Wasm acceptance corpus executes generated code with both
pointer representations and ordered effects. No JavaScript evaluator fallback is
used by emitted code or the build driver. The evaluator is used only by tests for
comparison. Full ABI/storage examples, APIs, native-import coverage and explicit
restrictions are in [c-backend.md](c-backend.md). Phase 5 is next.

Verification after phase 4: `bun test` reports 627 passing tests, the same 39
existing skips, zero failures across 26 files (47 new tests). `bunx tsc --noEmit`
and `git diff --check` pass. All 18 positive execution samples pass native strict
C11 at `-O0`, `-O2`, and ASan/UBSan, and Emscripten/Node at `-O0` and `-O2`.
Both targets also execute the unmatched-case trap test. Complete expected printer
output remains inline, with no generated snapshot files.

## Completed slice: type-changing storage and returned lenses (phase 5)

Phase 4 was committed as `35173ae`, with 627 passing tests and 39 existing skips.
Phase 5 extends that backend without changing the typed/concrete input contracts:

- `src/c/storage.ts` retains logical cells and projection paths independently of
  physical C storage. Replacements create typed versions; aliases resolve through
  the current version. Nested aggregate reconstruction preserves unaffected fields,
  and control-flow joins materialize typed merged versions.
- `src/c/lower.ts` adapts thin, scattered and mixed call arguments using independent
  typed input/output backing when layouts differ. Plain-result call backing is
  stack-resident. Lens-result call backing is heap-resident until restoration, so
  nested returned calls do not retain pointers into expired caller frames.
- Returned user lenses materialize their read focus in a concrete heap context and
  capture only values referenced by deferred restoration. Generated functions use
  the exact concrete restoration ABI, commit the replacement, reconstruct parent
  outputs, run deferred lexical/call cleanup in order, and release the context.
  Output values are copied before their backing is released. Native `fst` uses its
  explicit logical projection contract. Computed-focus `dup` also runs restoration.
- Allocation failure traps, and the entry adapter asserts that all restoration and
  backing allocations have been released. ASan/UBSan runs now enable stack-use-after-
  return detection and stop on sanitizer failures.
- Statically known capture-free function arguments support specialized `map` calls
  through verified direct contracts. Invocation-erased scalar/tuple capture
  environments preserve their explicit capture moves and need no runtime drop;
  a discarded captured-alias/refill regression covers this rule. Invoking captured
  closures and dynamic representation joins remain phase 6.
- `test/c/phase5-samples.ts` adds the growth, nested/mixed reconstruction, thin and
  scattered `take`/`map`, native/user focus assignment, nested/repeated returns,
  branch joins, alias refill, discarded capture, computed `dup`, and empty/unit
  cases. All phase-5 acceptance inputs now execute. Complete expected C output for
  returned thin/scattered lenses and branch versions is inline in printer tests;
  earlier complete expectations were updated for the new backing/runtime routines.

Existing checker boundaries remain explicit: persistent aliases bind variable
lenses, local storage cannot escape through returned lenses, and lens cases remain
unsupported. No checker rule was weakened and no evaluator fallback was added.
See [c-backend.md](c-backend.md) for APIs, ownership/lifetime rules and restrictions.

Verification: `bun test` reports 683 passing tests, the same 39 existing skips,
zero failures across 26 files. All 46 positive execution samples match typed IR
under native strict C11 at `-O0`, `-O2`, and ASan/UBSan with stack-use-after-return
checks, and under Emscripten/Node at `-O0` and `-O2`. Both targets also execute the
unmatched-case trap test. Six printer expectations contain complete output inline.
`bunx tsc --noEmit` and `git diff --check` pass. Remote CI was not required or run.
Phase 6 is next.

## Phase 6 slice: typed indirect invocation

User-defined function values now initialize their concrete ABI entry fields even
when capture-free. Calls invoke those fields with the stored environment, instead
of rewriting to a statically selected code symbol. The independent concrete
verifier still validates the entry ABI; native intrinsics keep their explicit
storage contracts. No function-pointer casts or environment ownership changes
were introduced.

Four new shared samples cover returned captured closures passed through a
higher-order parameter, captured lens callbacks with thin and scattered backing,
and an indirect returned lens. Differential reference tests and generated-C
assertions accompany native/Wasm execution and updated complete C snapshots.
Dynamic callable joins and callable focus storage/replacement remain open; this
slice does not complete the phase-6 exit gate.

Validation: 848 passing non-execution tests, 39 existing skips, zero failures;
292 passing existing native/Wasm execution tests plus 8 new execution cases,
zero failures. Execution uses strict C11, optimization and native sanitizers,
plus Emscripten/Node at both optimization levels. `bunx tsc --noEmit` and
`git diff --check` pass. Remote CI was not run.

## Phase 6 slice: compatible runtime callable joins

Representation inference now retains a canonical `callable-choice` alternative
set for branch-selected user-defined closures. A dynamic call specializes every
reachable alternative with the same incoming argument representations and requires
one common result representation. The call annotation records all target variants;
its identity includes their ordered IDs. Nested joins flatten and deduplicate their
members. No runtime branch is selected by monomorphization.

Concrete lowering emits an erased environment pointer, the selected concrete
disposer, and typed invocation entries. Dispatch records describe each member's
verified code entry; case adapters move the selected environment and map invocation
fields without allocation or code-pointer casts. Bodies recover their original
capture structs. Nested subset wrappers receive the slots needed by their outer
joins; a joined callable can supply both thin and scattered ABIs in one artifact.
Existing transfer-on-invoke and drop-unused ownership remains unchanged.

The independent analysis verifier validates canonical alternatives, semantic
compatibility, target coverage, capture and argument/result contracts, and
reachability. Concrete verification independently checks the erased pointer,
dispatch ownership and entries, exact ABI compatibility, and every case adapter.
Diagnostic printing exposes dispatch and selected-callable adapters.

Twenty-three shared samples cover both selections, different capture structs,
capture-free alternatives, returned/captured joined closures, deferred cleanup,
unused nested closures, nested joins, capture/refill of a borrowed alias, higher-order lens
arguments and returned focuses with both backing forms, and dual ABI slots in
one artifact. Corruption tests reject changed alternatives, targets, environments,
ownership, and entry mappings. Native-import joins, differing dynamic result
representations, dynamic callable host entries, and callable focus storage remain
explicit restrictions. This is another phase-6 slice, not the full exit gate.

Validation: 888 passing non-execution tests with 39 existing skips; the full
execution run passed 340 native/Wasm cases, followed by 2 dual-ABI and 4 deferred
cleanup execution cases added during validation. All 346 distinct execution cases
pass (strict C11, optimized native builds, native sanitizers, and Emscripten/Node
at both optimization levels). Combined: 1,234 passes, 39 skips, zero failures
across 35 files. `bunx tsc --noEmit` and `git diff --check` pass. Commands:
`bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, and the execution filters
`-t 'both lens ABIs'` and `-t 'joined deferred'`. Remote CI was not run.

Remaining phase-6 restrictions: native-import alternatives, dynamic calls whose
alternatives return different representations, callable focus storage/replacement,
and dynamic callable entry roots without a host adapter. This completes compatible
user-defined runtime joins, not the entire phase-6 exit gate.

## Phase 6 slice: native intrinsic callable alternatives

Canonical callable choices may now contain registered native descriptors as well
as user closures. Inference records the native definition in the corresponding
ordered target slot; independent analysis verification checks that definition and
its result/lens contract. Concrete dispatch verification accepts native wrappers
only with their original ABI, import identity and no-environment ownership.

The C backend reifies supported native members through exact typed C functions
when a runtime join needs them. The joined value carries a null native environment
and disposer. Ordinary native calls keep their existing storage lowering.
`dup` wrappers read recursive thin/scattered backing; `fst` wrappers project heap
backing owned by the caller and preserve untouched fields in distinct replacement
storage. They never retain addresses of local C parameter objects. Returning and
restoring the focus follows the existing caller adaptation/lifetime convention.

Nineteen shared samples cover both branch selections, returned/captured native
callees, unused closures, nested subset joins, both pointer forms, unit focuses,
size-changing replacements, nested returned focuses, and two ABIs in one artifact.
Additional negative tests reject forged native imports, targets, ownership and
ABIs, and keep unsupported `round` emission explicit.

The nested-focus regression also reproduced an existing typed-reference bug:
native `fst` retained the argument restoration continuation and the call boundary
ran it again. The native projection now borrows its view without owning that
continuation. Direct nested `fst` and dynamic native/user nested projections agree
with the legacy evaluator and execute through the C/Wasm harness.

Validation: `bun test --path-ignore-patterns '**/c/execute.test.ts'` passed
912 tests with 39 existing skips. The full `bun test test/c/execute.test.ts` run
passed 383 cases; one native build timed out inside `spawnSync clang`, producing
one test failure and the associated unhandled build error. Retrying that case
with `-t 'native nested direct projection'` passed both native and Wasm execution
(2 passes, zero failures), including strict/optimized/sanitizer builds. All
384 distinct execution cases are therefore validated, for 1,296 passing cases
across 35 files with no unresolved failures. The failure artifact was retained by
the harness. `bunx tsc --noEmit` and `git diff --check` pass. Remote CI was not run.

Differing dynamic result representations, callable focus storage/replacement,
unsupported native implementations, and dynamic callable entry roots without a
host adapter remain explicit restrictions. This slice completes supported native
intrinsic alternatives, not the entire phase-6 exit gate.

## Phase 6 slice: differing callable results of dynamic calls

Dynamic calls now join distinct returned user/native callable descriptors while
retaining each reachable body's original result representation. Analysis records
the canonical union, including nested subset choices. Lens results with different
shapes remain explicit diagnostics rather than selecting an arbitrary ABI.

Concrete lowering retains raw and adapted invocation contracts. An `adapt-result`
wrapper calls the original body with its exact argument/result ABI and transfers
the returned environment, disposer and typed invocation fields into the common
callable layout. There is no additional environment allocation, capture copy, or
result disposal. Callers retain the existing invoke-once/drop-unused ownership
convention. Nested result adapters and multi-slot thin/scattered callable results
compose through the existing erased-environment adapters.

Independent analysis verification checks the complete set of returned alternatives
and each original target contract. Concrete verification checks the raw wrapper,
original result ABI, source/destination layouts, every invocation entry mapping,
and `transfer-result` ownership. Diagnostic printing exposes result adapters.
Nineteen differential/execution samples cover both branch selections, nested and
unused owned results, native results, subset results, capture/refill of aliases,
lens callees and two concrete lens ABIs in a single graph. Six malformed-adapter
tests reject corrupt source wrappers, layouts, ownership, fields and signatures.

Validation: 940 passing non-execution tests and 422 passing native/Wasm execution
cases, with 39 existing skips and zero failures across 35 files (1,362 passes).
Execution includes strict C11, optimized native builds, native sanitizers, and
Emscripten/Node at both optimization levels. Commands:
`bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and `git diff --check`.
Remote CI was not run. Differing dynamic lens-result shapes and callable focus
storage/replacement remain separate phase-6 adapter work; unsupported native
implementations and host-entry contracts retain their existing diagnostics.

## Phase 6 slice: differing dynamic lens-result shapes

Dynamic lens calls now normalize differing source result shapes to an interned
thin view with the semantic read/replacement endpoints. Original body and native
projection result contracts remain available for raw invocation. Analysis verifies
the endpoint-preserving common shape independently, including native scattered
projections, rather than selecting one branch's ABI.

Concrete `adapt-lens-result` wrappers record their source, raw/common shapes,
restoration ownership and order. The C wrapper calls the original ABI and stores
its raw lens plus a materialized focus in a heap context. Its typed restoration
callback invokes the retained original restoration (or writes recursive native
replacement backing) before freeing the normalization context. Existing caller
adapters own argument backing until restoration finishes. Homogeneous and distinct
replacement storage follow the same versioned contract; no local stack addresses
escape and no incompatible code-pointer casts are emitted.

Eighteen differential/execution samples cover both runtime selections, both pointer
forms, native `fst`, homogeneous/type-changing storage, empty results, captured
callees, deferred cleanup, nested forwarding and unused alias release. Independent
concrete verification checks exact raw/common ABIs, shape endpoints, normalization,
source wrappers, ownership and restoration order. Malformed source, shape, ownership,
order and ABI records, and analyses retaining an arbitrary branch topology, fail
before emission. Callable focus storage/replacement remains separate work.

Validation: 966 passing non-execution tests and 458 passing native/Wasm execution
cases, with 39 existing skips and zero failures across 35 files (1,424 passes).
Execution includes strict C11, optimized native builds, supported native sanitizers,
and Emscripten/Node at both optimization levels. Commands:
`bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and `git diff --check`.
Remote CI was not run. Callable storage in source aggregates and focus
storage/replacement remain explicit restrictions; this is not the full phase-6
exit gate.

## Phase 6 slice: owned callable aggregate representation analysis

Owned source tuples containing callables now retain recursive `aggregate`
descriptors, rather than requesting a semantic-only data layout that cannot
describe their closure ABI. Construction retains each member's provenance;
destructuring and projected moves select that member. Parameters, captures and
returned tuples carry the descriptor through representation specialization and
canonical cache keys. Data-only tuples keep their existing layout representation.
Recursive callable aggregate results still need a solvable result constraint;
different aggregate branch representations still require an explicit adapter.

Independent serialized analysis verification checks tuple arity and semantic
types, canonical descriptor selection, exact construction operands, projection
provenance, captures and invocation contracts. Six source cases compare checked
legacy, detached typed and specialized typed execution; corruption coverage
rejects altered member provenance. Callable focus storage retains its existing
diagnostic. Concrete lowering explicitly rejects aggregate descriptors pending a
physical adapter; this slice does not add executable C/Wasm aggregate storage.

The implementation boundary follows the phase-5/phase-6 contract mismatch:
semantic lens backing IDs cannot describe callable invocation slots, and a
semantic tuple type cannot determine a member's environment/disposer or callable
choice. Next, introduce explicit recursive physical aggregate records with
representation-based identities, transfer and recursive disposal. Preserve logical
cell/projection identities across typed storage versions. For focus replacement,
retain independent read and replacement descriptors, including changed callable
alternatives, and propagate them through acquisition, swaps, branch merging and
restoration. A replacement must transfer its owned environment once; an extracted
old value must retain its own ABI and ownership. Returned focus contexts must
retain backing until restoration completes. Do not route callable focuses through
semantic-only layout interning, cast invocation pointers, or reuse a stale
aggregate's field addresses.

Validation: 974 passing non-execution tests, 39 existing skips, and 458 passing
native/Wasm execution cases: **1,432 passes, 39 skips, zero failures across 36
files**. The full execution harness passed strict C11, optimized native builds,
supported native sanitizers and Emscripten/Node at both optimization levels.
Commands: `bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and
`git diff --check`. Remote CI was not run. Phase 6 remains open.

## Phase 6 slice: physical owned callable tuples

Concrete lowering now recursively discovers callable members of aggregate
descriptors and emits by-value `itemN` records keyed by their ordered physical
member layouts. This connects the prior representation-analysis slice to exact
argument/result and capture-environment ABIs. Independent concrete verification
derives the same record identity and fields from verified analysis, without
calling lowering. Corruption tests reject altered layouts, field kinds and order
before C emission.

The existing phase-5 logical cell/projection storage model transfers aggregates,
empties moved projections and reconstructs values. Existing recursive drop paths
release unused members, complete unused aggregates and unused closures capturing
aggregates. This preserves each callable's environment, disposer and invocation
fields without allocation for the tuple itself or incompatible function-pointer
casts. No source checker or interpreter semantics changed.

Twelve shared samples compare checked legacy, detached typed and specialized
typed execution, independent serialized analysis/concrete verification and C/Wasm.
Coverage includes nested tuples and captures, parameters/results, unused and
partially consumed aggregates, joined/native callable members, and thin/scattered
lens callees whose type-changing focus remains ordinary scalar/tuple data.
Callable focus contents and replacement still require independent representation
contracts across acquisition, swaps, storage versions and restoration. Differing
aggregate joins and unsolved recursive results remain explicit diagnostics.
This completes owned tuple storage for the tested subset, not phase 6.

Validation: **1,465 passes, 39 existing skips, zero failures across 36 files**:
983 non-execution tests and 482 native/Wasm execution cases. The full harness
passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries.
Commands: `bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and
`git diff --check`. Remote CI was not run.
