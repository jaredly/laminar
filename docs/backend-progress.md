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

## Phase 6 slice: direct owned-local callable exchanges

Direct whole-owned-local swaps now carry a `local-focus` representation with
independent read and replacement value descriptors. This covers callable/data
transitions as well as different capture structs, callable choices, empty-slot
refill and whole callable tuples. Acquisition retains owned read provenance;
analysis resolves replacement provenance after the ordered RHS and transfers the
old descriptor to the swap result and the replacement descriptor to the logical
place. Scope completion propagates current descriptors back to enclosing places.
Branches that change enclosing callable storage representations still diagnose
that a storage-version adapter is required.

Concrete lowering derives typed read/replacement pointers and a restoration
signature from these independent physical layouts. Independent analysis
verification checks semantic endpoints, owned-place provenance, the direct
same-block swap boundary, old-result provenance, replacement provenance and
subsequent versions. Concrete verification independently checks record identity,
both pointers and the exact restoration ABI. The focus descriptor contains no
source-local place identity, so storage addresses do not select cache keys.

The existing C logical swap adapter saves the old value, installs the RHS in a
new typed logical version, and transfers affine ownership without copying an
environment or disposing the extracted result. Scope disposal releases whichever
version remains; old values have their own invocation/disposal fields. Local
acquisitions retain logical views, so no physical pointer to an obsolete aggregate
or stack temporary is introduced.

Ten shared samples cover different captures, callable/data changes, empty refill,
unused old/replacement values, repeated replacement, tuple replacement, nested
scope propagation and both runtime selections of a joined RHS. Serialized
corruption tests reject forged endpoint provenance and physical pointer layouts.
Existing borrowed/manual callable focus tests still reject with the new explicit
boundary diagnostic. This slice does not implement projected focuses, persistent
aliases, callable focus parameters/results, manual restoration, scattered callable
focus tuples, or divergent branch storage versions. Those require descriptor-aware
restoration and representation adapters; phase 6 remains open.

Validation: **1,499 passes, 39 existing skips, zero failures across 37 files**:
997 non-execution tests and 502 native/Wasm execution cases. The full harness
passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries.
Commands: `bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and
`git diff --check`. Remote CI was not run.

## Phase 6 slice: convergent branch storage versions

Investigation found that projected source focuses require the still unsupported
borrowed restoration contract. The selected smaller boundary is branch storage:
previous analysis rejected any arm changing an enclosing descriptor, even when
all arms agreed on the final representation. Analysis now compares final arm
states and propagates their common descriptor. Independent verification performs
its own comparison and continuation propagation without invoking inference.

The existing C typed branch merge already handles the selected physical version;
no new pointer casts, environment copies, allocations or restoration lifetimes
are introduced. Four shared samples exercise both runtime selections for
callable-to-data and data-to-captured-callable transitions. Serialized corruption
coverage rejects forged continuation provenance before C emission. Divergent
branch versions keep their explicit diagnostic. General callable restoration and
differing aggregate joins remain separate work; phase 6 remains open.

Validation: **1,512 passes, 39 existing skips, zero failures across 37 files**:
1,002 non-execution tests and 510 native/Wasm execution cases. The full execution
harness passed strict C11, optimized native builds, supported native sanitizers,
and Emscripten/Node at both optimization levels without retries (666.64 seconds).
`bunx tsc --noEmit` and `git diff --check` pass. Commands:
`bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and `git diff --check`.
Remote CI was not run.

## Phase 6 slice: recursive callable tuple branch-result joins

Representation inference now joins corresponding members of owned tuple branch
results, retaining each canonical callable alternative set and unchanged data
member. The aggregate join is enabled only for branch results: differing tuple
results of dynamic calls still report the unsupported adapter diagnostic rather
than reaching inconsistent call annotations.

Concrete `aggregateJoin` contracts retain per-arm recursive move/aggregate/callable
adapters, exact endpoint layouts, typed entry mappings and
`transfer-selected-result` ownership. Independent analysis verification checks the
recursive member alternatives. Independent concrete verification derives every
adapter separately, including original callable ABIs. Callable descriptor discovery
now recurses through aggregates and local-focus endpoints, covering unused joined
members that are never invoked. The printer marks selected aggregate adapters.

C emission reconstructs the selected tuple using typed compound literals. Each
environment, disposer and entry field transfers once; no environment copy,
additional allocation, function-pointer cast or storage address retention is
introduced. Existing recursive disposal releases unused or partially consumed
normalized aggregates. Fourteen shared samples cover both branch selections,
nested tuples/subset joins, partial and whole disposal, capture/parameter transfer,
returned tuples and native/user lens callable members. Corruption tests reject
missing adapters, wrong ownership, layouts, member order, callable IDs, entry
mappings and forged analysis provenance.

General callable focus restoration, divergent branch storage versions and differing
tuple results of dynamic calls remain open. Phase 6 is incomplete.

Validation: **1,563 passes, 39 existing skips, zero failures across 38 files**:
1,025 non-execution tests and 538 native/Wasm execution cases. The full harness
passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries (706.18 seconds).
After the final ownership-contract and diagnostic refinements, all 28 new
native/Wasm cases also passed a targeted rerun. TypeScript and diff checks pass.
Commands: `bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`,
`bun test test/c/execute.test.ts -t 'aggregate join'`,
`bunx tsc --noEmit`, and `git diff --check`. Remote CI was not run.

## Phase 6 slice: differing dynamic callable tuple results

Following `939b809`, dynamic calls can now join recursive aggregate result
descriptors. Each alternative body keeps its original result ABI. Concrete
`adapt-aggregate-result` wrappers call that source ABI and transfer its result
through the existing recursive value adapter. C lowering and independent concrete
verification now share their respective branch/result conversion helpers; the
verifier still derives expected contracts independently of lowering.

The result adapter moves environment, disposer and exact invocation fields with
no new allocation, code-pointer cast or disposal of the extracted result. Common
result alternatives propagate through nested subset choices. Independent analysis
verification checks recursive result alternatives; concrete verification checks the
source wrapper, original ABI, exact endpoint layouts, recursive member mappings
and `transfer-result` ownership. Printing exposes source and result layout IDs.

Sixteen shared samples exercise both selections, nested tuples/subsets, partial
and whole unused disposal, captured parameter transfer, native lens members and
returned lens callees using thin/scattered arguments and type-changing replacement.
Eight corruption tests reject altered source/ownership, endpoints, member order,
callable IDs, entry mappings and forged result alternatives. The former dynamic
tuple-result restriction test is replaced by positive execution coverage.

Subsequent user commit `9f83b1a` is preserved. Its `cli/c.ts:46` accesses `err.loc`
while the catch variable is `unknown`, so the default `bunx tsc --noEmit` reports
TS18046. A temporary config extending the repository config and excluding only
`cli/` (and `node_modules/`) passes; no CLI source was changed for this slice.

Validation: **1,618 passes, 39 existing skips, zero failures across 39 files**:
1,048 non-execution tests and 570 native/Wasm execution cases. The full harness
passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries (621.34 seconds).
`git diff --check` passes. The default TypeScript check has the unrelated CLI
error described above; all files outside `cli/` pass the repository's compiler
options via the temporary config. Remote CI was not run.
Commands: `bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`,
`bunx tsc --noEmit -p /tmp/laminar-backend-tsconfig.json`, and `git diff --check`.
General callable focus restoration and divergent branch storage versions remain
open; phase 6 is incomplete.

## Phase 6 slice: divergent owned branch storage versions

Following `b92b9bd`, ordinary branches may now finish with differing owned callable
or recursive aggregate descriptors. Case value annotations retain ordered
`storageJoins` for divergent places, including each arm's descriptor and their
canonical common descriptor. Analysis propagates the common descriptor outward.
Independent verification derives place coverage and arm provenance from separately
traversed branch states, verifies the exact recursive union and continuation reads,
and rejects storage annotations on unrelated instructions. Uniform recursive joins
must retain their original descriptor rather than inventing a redundant choice.

Concrete cases retain exact recursive per-arm layouts/entry mappings and
`transfer-selected-storage` ownership. Descriptor discovery includes unused storage
joins. C lowering adapts each selected live place before the existing logical
storage merge, preserving empty storage and partially consumed projections. No
new allocation, environment copy, old-result disposal, incompatible code-pointer
cast or retained aggregate address is introduced. Printing marks selected storage.

Twenty-four shared samples cover both selections, unchanged arms, capture layout
changes, nested aggregates/joins, repeated replacement, unused/consumed contents,
capture/parameter transfer, multiple owners, simultaneous callable results and
native/user lens callees with thin/scattered arguments. Twelve serialized corruption
tests cover analysis and physical contracts; a restriction test retains the
lens-valued-branch diagnostic. The previous broad branch restriction test is
replaced by positive execution coverage.

This slice handles ordinary value-producing branches. Divergent storage inside
lens-valued branches still needs restoration-aware adapters. General callable
focus aliases/projections, parameters/results, manual cleanup and scattered focuses
remain open; phase 6 is incomplete. Subsequent commit `23d0aac` and its concurrent
execution harness/build changes are preserved.

Validation: **1,702 passes, 39 existing skips, zero failures across 40 files**:
1,084 non-execution tests and 618 native/Wasm execution cases. The full concurrent
harness passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries (170.94 seconds).
`git diff --check` passes. The unrelated `cli/c.ts:46` default TypeScript error
from `9f83b1a` remains; checking all files outside `cli/` passes via the temporary
config documented in the previous slice. Remote CI was not run.
Commands: `bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`,
`bunx tsc --noEmit -p /tmp/laminar-backend-tsconfig.json`, and `git diff --check`.

## Phase 6 slice: setup-only divergent storage in lens-valued branches

Following `9785c86`, selected lens branches can normalize divergent owned callable
or aggregate descriptors during setup. The supported boundary excludes deferred
arm cleanup/restoration accessing the divergent place. Inference and independent
representation verification each conservatively traverse nested scopes/cases,
manual protected dependencies, deferred slot access and restoration normalization.
Such dependencies diagnose `Deferred callable storage use requires a restoration
adapter`; no source typing rule is changed.

C lowering shares its availability-preserving storage conversion helper between
ordinary and lens cases. Selected lens setup adapts the owners before snapshot
retention and lifts conversion temporaries with other selected-arm variables.
Existing staging/completion preserves the current merged versions rather than
restoring obsolete setup descriptors. Later replacement and outer cleanup using
the common descriptor execute correctly. Existing returned-lens contexts retain
required backing and deferred owned values through completion. No new allocation
convention, function-pointer cast, environment copy or old-value disposal is added.

Eighteen shared samples cover both selections, nested aggregate owners, intervening
replacement, unrelated selected cleanup, unused aliases, returned call backing,
outer cleanup consuming the common owner, mixed thin/scattered focuses and nested
selections. Six physical corruption tests protect independent lens/storage records;
a provenance corruption test protects the common owner; a negative source test
keeps deferred arm access explicit. The previous blanket lens-branch restriction
test is replaced by this coverage.

The subsequent CLI fix `760be7c` is preserved and the default TypeScript check now
passes. General callable focus aliases/projections, parameters/results, manual
restoration and scattered focuses, plus deferred arm access to divergent owners,
remain open; phase 6 is incomplete.

Validation: **1,763 passes, 39 existing skips, zero failures across 41 files**:
1,109 non-execution tests and 654 native/Wasm execution cases. The full concurrent
harness passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries (215.06 seconds).
Default TypeScript and diff checks pass. Commands:
`bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and `git diff --check`.
Remote CI was not run.

## Phase 6 slice: deferred consumption of divergent selected storage

Following `aa1da9b`, deferred selected-arm cleanup may consume/dispose divergent
owned callable or aggregate storage. Analysis records `restoration: 'consume'` for
such joins; independent verification derives the mode from retained semantic IR.
Deferred acquisition/replacement of the divergent place still diagnoses that a
restoration adapter is needed, preventing untracked post-cleanup descriptors.

An inverse of the forward field mapping is insufficient: the common callable can
have zero invocation entries when only deferred original-ABI code invokes it.
Instead, concrete joins record original per-arm retention layouts,
`retain-selected-storage` ownership and `restore-retained`, `cleanup`, `normalize`
ordering. Independent concrete verification derives the exact contract from
verified analysis. Printing marks retained selected storage.

C lowering saves each arm's logical storage before setup normalization. Before
stage/completion it reinstates the selected retained contents for original-ABI
cleanup, then normalizes any surviving fields with the existing forward adapter.
Staging preserves current retained contents until completion. Empty slots remain
empty, including branch-normalized disposal and refill afterward. Existing returned
contexts retain referenced original backing through cleanup. There is no new
environment allocation/copy, extra affine owner, disposer or function-pointer cast.

Eighteen shared cases exercise both selections, deferred invocation, recursive tuple
consumption, refill, unused aliases, owned cleanup results, nested selections,
returned backing, staged outer cleanup ordering and returned staged backing.
Coverage explicitly asserts original invocation slots survive a slot-free common
callable. Five physical and two analysis corruption tests reject forged retention
contracts; a source test retains the deferred-replacement boundary. The previous
blanket deferred-access restriction test is replaced by this coverage.

Deferred replacement of divergent owners and general callable focus
aliases/projections, parameters/results, manual restoration and scattered focuses
remain open. Phase 6 is incomplete.

Validation: **1,825 passes, 39 existing skips, zero failures across 42 files**:
1,135 non-execution tests and 690 native/Wasm execution cases. The full concurrent
harness passed strict C11, optimized native builds, supported native sanitizers and
Emscripten/Node at both optimization levels without retries (270.40 seconds).
Default TypeScript and diff checks pass. Commands:
`bun test --path-ignore-patterns '**/c/execute.test.ts'`,
`bun test test/c/execute.test.ts`, `bunx tsc --noEmit`, and `git diff --check`.
Remote CI was not run.

## Deferred cleanup descriptor transitions

Manual value annotations now retain optional `cleanupStorage` records with ordered
`place`, `before`, and `after` representation descriptors. Inference compares the
cleanup's cloned final state with its setup state, recording changes only to
places present in that setup state. Recursive aggregate descriptors retain exact
callable provenance. Independent serialized verification derives the endpoints
from cleanup instructions and rejects missing, extra, altered, or misplaced records.
Consumption alone does not change a descriptor and does not produce a transition;
these records do not encode availability or compose nested deferred effects.

This is a prerequisite for deferred replacement adapters, not an expansion of
selected callable restoration. Analysis still does not apply cleanup descriptor
effects to setup/continuation state. Divergent selected deferred acquisition and
replacement keep their explicit diagnostic. The next slice must compose effects
in restoration order, propagate post-cleanup descriptors at release boundaries,
and retain exact post-cleanup adapters through staging/completion and escaping
contexts before relaxing that guard. Phase 6 remains incomplete.

Validation for cleanup descriptor transitions: **1,845 pass / 39 existing skips /
0 failures across 42 files** (1,147 non-execution tests and 698 native/Wasm cases).
`bunx tsc --noEmit` and `git diff --check` pass. The full execution harness passed
strict C11, optimized native, supported sanitizers and Emscripten/Node at both
optimization levels without retries (258.91 seconds). Remote CI was not run.

## Concrete cleanup storage transition contracts

Manual restoration contracts now reify analysis `cleanupStorage` as optional
`storageTransitions`: ordered whole-place identities, exact physical `before` and
`after` layouts, and `transfer-cleanup-storage` ownership. Independent concrete
verification derives this list from verified analysis, rejecting changed coverage,
places, endpoints or ownership before C emission. The diagnostic printer displays
both endpoint layouts and ownership. These describe replacement effects, not a
by-value conversion of the extracted old owner into its replacement.

Investigation of continuation propagation found that source binding lowering can
place a manual instruction outside the scope that releases its alias. Applying
transitions only at the manual's enclosing block exit is too late: subsequent
reads still use the original callable ABI. That attempted propagation was not
retained. The next behavioral slice needs a release-aware effect model associating
loans with their manual restoration, composing nested completion in runtime order,
and applying post-cleanup provenance at the actual release boundary. It must also
handle immediate swaps/discards and returned lenses before generalizing the model.
Selected divergent replacement still requires exact post-cleanup normalization
adapters. No replacement guard is relaxed; phase 6 remains incomplete.

Validation: **1,853 pass / 39 existing skips / 0 failures across 42 files**:
1,155 non-execution tests and 698 native/Wasm cases. The full execution harness
passed strict C11, optimized native builds, supported sanitizers, and
Emscripten/Node at both optimization levels without retries (256.19 seconds).
TypeScript and diff checks pass; remote CI was not run. Eight new tests cover
physical transition endpoint layouts, ownership, missing/extra/forged records,
consumption-only omission, and diagnostic printing.

## Release-aware direct manual cleanup effects

Representation inference now associates lexical loans with direct manual completion
handlers. A plain block applies its release actions before returning its owner
state to the continuation; an immediate manual swap applies completion immediately.
Scope results forward direct handlers, and nested manual completion applies the
outer cleanup followed by the original frontend completion. Cleanup regions are
analyzed once, retaining the existing exact `cleanupStorage` and physical
`storageTransitions` contracts; completion checks input provenance before applying
the recorded descriptor effects. Independent serialized verification derives the
same releases and rejects stale continuation callable provenance without invoking
inference or concrete lowering.

Twelve shared cases cover callable/aggregate continuation reads, unused alias
release, immediate swaps, nested manual completion and repeated releases, for both
boolean replacements. Existing C versioned storage already preserves the physical
replacement through these boundaries; no C runtime or ownership convention changed.
A new corruption test rejects the original callable descriptor on a post-release
move before emission.

This expands direct lexical manual cleanup support only. Selected case effects,
lens tuples/scattered completion, call-return effects and escaping local backing
still require effect composition and representation-aware restoration adapters.
The divergent selected deferred replacement guard is unchanged. Phase 6 remains
incomplete.

Validation: **1,890 pass / 39 existing skips / 0 failures across 42 files**:
1,168 non-execution tests and 722 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (284.29 seconds). `bunx tsc --noEmit` and
`git diff --check` pass. Remote CI was not run.

## Scattered manual release effects

Lens-tuple representation analysis now captures each member's completion handler
and composes them in source order, matching existing C staging/completion. Nested
tuples recurse; ordinary members contribute no descriptor effect. Captured handlers
survive scope forwarding without requiring their original local SSA identifiers
in the eventual release state. Independent verification derives the ordered
composition separately and checks continuation provenance against the resulting
owner descriptors. Exact `cleanupStorage`/`storageTransitions` ownership and original
callable ABIs remain unchanged; no C runtime or storage change is required.

Twelve shared cases cover both boolean replacements, multiple callable owners,
unused alias release, immediate swaps, nested/mixed tuples, aggregate replacement,
and a manual wrapper around a scattered frontend. The initial two cases failed
with stale continuation ABI storage reads before the fix. Three serialized
corruption tests reject stale callable/aggregate provenance after ordinary or
nested tuple release, before emission.

This is descriptor-effect propagation through scalar/tuple lens frontends, not
callable focus endpoint storage. Selected branch effects, call/returned contexts,
selected post-cleanup normalization adapters and general callable focus ABIs remain
open. The selected divergent replacement guard remains intact; phase 6 is incomplete.

Validation: **1,929 pass / 39 existing skips / 0 failures across 42 files**:
1,183 non-execution tests and 746 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (278.16 seconds). `bunx tsc --noEmit` and
`git diff --check` pass. Remote CI was not run.

## Call argument completion effects

Representation inference now completes caller-side lens argument descriptor effects
in argument order after a plain-result call. A lens-result call instead captures
the argument handlers on its result; release, swap, outer manual completion or
further forwarding triggers them at eventual result completion. Independent
serialized verification derives these boundaries separately. This matches existing
C argument adapters, including native `dup`/`fst`, dynamic callable dispatch,
scattered backing and returned contexts. No runtime storage, allocation, affine
ownership or code-pointer ABI change was needed.

Twenty-four shared cases cover direct/native/dynamic calls, thin/scattered lens
arguments, callable/aggregate replacement, forwarded returned focuses, unused
returned aliases, and returned calls underneath outer manual cleanup. Four
corruption tests reject stale callable/aggregate continuation provenance after
plain, returned and forwarded calls. Initial plain/returned regressions failed
before the fix. Source checker restrictions on cleanup access to unrestored
computed owners remain unchanged.

This propagates caller-side argument completion effects, not arbitrary callee-local
storage effects or function effect summaries. Selected cleanup effects and exact
post-cleanup selected adapters, escaping callee-local storage, and callable focus
endpoint ABIs remain open. The divergent selected deferred replacement guard is
unchanged; phase 6 remains incomplete.

Validation: **2,005 pass / 39 existing skips / 0 failures across 42 files**:
1,211 non-execution tests and 794 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (312.01 seconds). `bunx tsc --noEmit` and
`git diff --check` pass. Remote CI was not run.

## Convergent selected cleanup effects

Lens-valued cases now retain their arm-result completion handlers. On completion,
analysis clones each arm's private setup state, overlays the current enclosing
owner descriptors, and applies the corresponding handler. All enclosing places
must have identical exact final descriptors across arms before continuation state
is updated. Independent serialized verification derives that agreement separately.
This preserves intervening owner versions and each original cleanup ABI; existing
C selected storage merging handles the convergent final layouts without new value
conversions or ownership operations.

Twelve shared samples cover both selections, callable/aggregate replacement,
unused aliases, nested selections, returned call backing, and outer manual cleanup.
The initial convergent regression failed before the fix. Three corruption tests
reject stale post-selected callable/aggregate provenance. Three negative tests
preserve an explicit adapter boundary for changed/unchanged arms and distinct
callable provenance, even with matching semantic result types.

Differing final descriptors diagnose `Selected cleanup storage transitions require
a restoration adapter`. Deferred writes to divergent setup owners keep the existing
`Deferred callable storage replacement requires a restoration adapter` guard.
Explicit post-cleanup arm descriptors/adapters through staging and returned contexts
remain next. Arm-local returned-alias experiments additionally encounter the
existing typed-IR `Computed loan owner protection mismatch` boundary; no checker or
typed-IR rules were changed for this slice. Phase 6 remains incomplete.

Validation: **2,047 pass / 39 existing skips / 0 failures across 42 files**:
1,229 non-execution tests and 818 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (321.49 seconds). `bunx tsc --noEmit` and
`git diff --check` pass. Remote CI was not run.

## Divergent post-cleanup storage joins

Selected completion now retains `cleanupJoins` on representation value annotations:
each divergent enclosing place has ordered final arm descriptors and a canonical
common result. Independent analysis verification derives final states and checks
coverage/provenance/union plus continuation reads; unused or misplaced join records
are rejected. Concrete cases retain recursive per-arm value adapters with
`transfer-selected-cleanup-storage` ownership and `cleanup`, `normalize`, `merge`
ordering. Independent concrete verification derives layouts, ownership, ordering
and exact invocation entry mappings without invoking lowering. The printer marks
these contracts `selected-cleanup-storage`.

C lowering normalizes live selected contents after arm cleanup/restored actions
and before the final typed merge, for direct completion and staged completion.
Staging itself retains the current raw contents; existing returned context retention
keeps required backing alive. Recursive adapters transfer each environment once,
preserve original cleanup ABIs, and leave empty slots/projections empty. No new
environment allocation/copy, extracted-value disposal, incompatible function-pointer
cast or aggregate-address convention is introduced.

Sixteen shared cases cover changed/unchanged arms, distinct cleanup provenance,
recursive aggregates, captured replacements, nested selections, returned backing,
staged outer cleanup and unused final contents, with both branch selections.
Fourteen added verification/printing tests reject forged analysis coverage, arm
provenance/results, physical layouts, ownership, ordering, invocation mappings and
stale continuation provenance. The three previous post-cleanup rejection cases now
check successful compilation; the original divergent-setup replacement test remains.

This supports divergent final descriptors only when setup for that owner agrees.
Deferred writes to divergent setup storage still require retained-original plus
post-cleanup restoration adapters and keep their explicit diagnostic. Escaping
callee-local effects, arm-local alias protection and general callable focus ABIs
remain open. Phase 6 is incomplete.

Validation: **2,109 pass / 39 existing skips / 0 failures across 42 files**:
1,259 non-execution tests and 850 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (333.41 seconds). The initial focused native/Wasm
run also passed (8 cases). `bunx tsc --noEmit` and `git diff --check` pass.
Remote CI was not run.

## Retained deferred replacement

Setup storage joins now distinguish `restoration: 'replace'` from consumption.
Analysis derives the mode from deferred acquisitions/writes and reinstates original
arm descriptors before running retained completion handlers. Replacement places
always appear in `cleanupJoins`, including exact final convergence. Independent
verification derives modes, original/final provenance and required post-cleanup
coverage. Uncompleted replacement contracts and unsupported completion routes still
diagnose explicitly rather than erasing the effects.

Concrete retained restoration adds `normalization: 'post-cleanup'` for replacement;
independent verification derives that marker and rejects its removal or alteration.
C retains raw original contents across staging, restores them for original-ABI
cleanup, skips the setup conversion afterward, and applies the required final value
adapter. Consumption retains its existing forward normalization. Environment
ownership transfers once; extracted old values are neither disposed by the swap
nor copied into a second owning environment. Existing returned argument backing
and nested selected state remain alive through completion.

Eighteen shared samples cover both selections, original cleanup invocation,
convergent and divergent results, aggregate replacement, unused final owners,
returned argument backing, staged outer cleanup, nested selections, consume/refill,
and owned cleanup results. Six new tests reject normalization/mode corruption,
require convergent adapters, assert original invocation slots through a slot-free
common callable, and preserve the uncompleted callee-local boundary. The previous
blanket replacement rejection test now checks successful compilation.

Escaping callee-local replacement and routes without modeled arm-result completion
still need effect summaries/contracts. Arm-local returned aliases retain their
existing typed-IR protection boundary; general callable focus endpoint ABIs remain
open. Phase 6 is incomplete.

Validation: **2,169 pass / 39 existing skips / 0 failures across 42 files**:
1,283 non-execution tests and 886 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (348.58 seconds). The focused native/Wasm run also
passed (36 cases). `bunx tsc --noEmit` and `git diff --check` pass.
Remote CI was not run.

## Returned callee-local replacement restoration completed

Scope-forwarded lens completion now retains private descriptor state. At release,
it overlays current enclosing descriptors, completes the retained handler, and
propagates effects only for enclosing owners. Private locals remain available to
restoration without escaping into caller representation state. Function variant
analysis completes returned handlers on cloned state, deriving required cleanup
joins/adapters while leaving setup descriptors and result ABIs unchanged.
Independent serialized verification performs the same private completion and checks
all retained-original/final contracts; it does not call inference or lowering.

Existing C context capture and liveness retention already keep the required backing
and private owned values alive through restoration. Sixteen shared samples now
exercise direct/unused/forwarded returned lenses, aggregate and convergent
replacement, owned cleanup results, staged returned cleanup, and late capture from
a private local, for both selections. Four added tests reject forged returned
variant post-cleanup coverage/mode and physical retention, and assert original
invocation slots survive the slot-free common callable. The previous callee-local
rejection test now requires successful compilation.

This finishes the modeled callee-local returned-restoration boundary. Unsupported
completion routes still diagnose rather than dropping effects; arm-local returned
alias protection and general callable focus endpoint ABIs remain open. Phase 6
remains incomplete.

Validation: **2,221 pass / 39 existing skips / 0 failures across 42 files**:
1,303 non-execution tests and 918 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (339.63 seconds). `bunx tsc --noEmit` and
`git diff --check` pass. Remote CI was not run.

## Selected arm-local alias handoff

Investigation reproduced a checker-accepted arm-local alias failing the independent
typed-IR `Computed loan owner protection mismatch` check. Manual lens escape
provenance can intentionally be empty to permit explicit owned backing retention.
Computed alias roots previously reused that list when selected branches derived
exclusive protection, losing the actual underlying owners. Computed roots now
retain a separate `protectedOwners` list from the view targets. Branch-local
protection follows that list; escape checks still follow the original provenance.
The independent typed-IR owner verifier is unchanged.

Lens block results also retain their lexical release handlers in representation
inference and independent verification. Completion runs the frontend handler, then
those releases, matching existing C block restoration. This preserves manual cleanup
descriptor effects when a selected arm returns an alias rather than the direct
manual lens. Existing original/final storage adapters and context backing apply.

Twelve shared cases cover both selections, direct/nested/unused aliases, divergent
setup/replacement, scattered frontends and returned callee-local restoration.
Five new safety tests reject access to protected callable/scalar owners while the
selected alias is live, reject forged/missing serialized protection, and reject
corruption before C emission. The initial two regressions failed before the fix;
24 focused native/Wasm cases pass.

This closes the covered arm-local alias handoff boundary. It does not add callable
focus endpoint ABIs: direct aliases/projections of callable contents, callable
focus parameters/results, manual callable focuses and scattered callable focuses
remain open. Phase 6 remains incomplete.

Validation: **2,262 pass / 39 existing skips / 0 failures across 42 files**:
1,320 non-execution tests and 942 native/Wasm cases. Full strict C11, optimized
native, supported sanitizer, and Emscripten/Node execution at both optimization
levels passed without retries (259.45 seconds). The focused native/Wasm run also
passed (24 cases). `bunx tsc --noEmit` and `git diff --check` pass.
Remote CI was not run.


## Callable endpoint verification boundary

The independent representation verifier now requires explicit `local-focus`
provenance for every flow with a callable endpoint, including recursive tuple
endpoints and callable/data transitions, before consulting semantic lens shapes.
Previously malformed detached annotations reached incidental shape lookup/type
errors; they now receive `Callable lens endpoints require explicit focus provenance`.
This is verification hardening, not new executable callable alias support.

Four serialized corruption cases erase the endpoint contract and check rejection
through both concrete verification and C emission. Two checker-accepted boundary
cases cover unused persistent callable aliases and aggregate-with-callable aliases;
these retain the direct whole-owned-local swap diagnostic. Persistent alias
analysis still stores semantic lens shapes and needs explicit logical-owner
tracking, independent endpoint descriptors, and restoration/update propagation
before that acquisition guard can be relaxed. Projections, callable focus call and
return ABIs, manual/scattered endpoints, and unsupported completion routes remain
open. Phase 6 is incomplete. C emission/storage and the concurrent execution build
scheduler are unchanged.

Validation for callable endpoint verification hardening: **2268 pass / 39 existing
skips / 0 failures across 42 files** (1326 non-execution tests and 942 native/Wasm
execution cases). Full execution passed in 366.66 seconds without retries,
including strict/optimized native builds, supported sanitizers, and both
Emscripten/Node optimization levels. TypeScript and diff checks passed. Remote CI
was not run.


## Direct persistent callable aliases

Whole-local direct aliases now retain explicit logical-owner identity in
representation state across lexical scopes. Their initial `local-focus` read
comes from current storage and their final replacement comes from release-time
storage; each intervening callable swap independently updates the original owner.
The serialized verifier independently derives/checks those identities, reads,
ordered RHS descriptors, release endpoints and owner continuation. Computed lenses
with private backing still use their existing representation restrictions.

Thirteen shared cases exercise nested/unused loans, repeated updates, consume/refill,
callable/data changes, aggregate contents, branch joins, deferred scalar completion,
unused environment disposal and ordinary returned callable values. Three corruption
cases check release replacement, swap read and continuation provenance; explicit
projected/manual endpoint restrictions and callable owner exclusivity remain tested.
C cell-based views already provide the required storage version behavior; no C
lowering or concurrent scheduler changes were needed. Callable focus projections,
computed/manual/scattered endpoints and call/return ABIs remain open. Phase 6 is
incomplete.

Validation for direct persistent callable aliases: **2310 pass / 39 existing skips /
0 failures across 42 files** (1342 non-execution tests; 968 native/Wasm cases).
Full strict C11, optimized native, supported sanitizers and both Emscripten/Node
optimization levels passed without retries in 359.77 seconds. The final focused
alias execution run passed all 26 cases. TypeScript and diff checks pass. Remote
CI was not run.


## Phase 6: projected callable swaps

Direct swaps through tuple aliases now retain a logical owner plus projection
path. Read provenance is projected from current storage; replacement reconstructs
the enclosing descriptor recursively and canonicalizes data-only tuples. Scalar
sibling updates also update that descriptor. Independent serialized verification
derives the same endpoints and reconstruction; physical C views retain cell/path
identity and require no C lowering change. Six shared samples cover nested paths,
callable/data transitions, sibling layout changes and disposal; corruption coverage
rejects whole-owner provenance substituted for a projected read.

Validation: full non-execution suite, 12 focused native/Wasm cases, TypeScript and
diff checks passed. General projected subloans, computed/manual/scattered callable
endpoints and callable focus call/return ABIs remain open. Phase 6 is incomplete.


## Phase 6: projected persistent callable loans

Direct persistent subloans now check exact owner/projection identity and derive
final replacement provenance from the current projected contents at release.
Nested and repeated subloans preserve sibling storage. C keeps the original root
mapping for direct loans; only computed lenses install a private backing place,
avoiding double projection. Six shared samples include nested/unused loans,
consume/refill, extraction, repeated loans and a scalar backing regression.
Serialized corruption coverage independently rejects altered final provenance.

Validation: 1355 non-execution passes / 39 existing skips / zero failures; all
12 focused native/Wasm cases, TypeScript and diff checks pass. Manual/computed and
scattered callable endpoints and callable parameter/result ABIs remain open.
Phase 6 is incomplete.


## Immediate manual callable endpoint contracts

Manual callable swaps now propagate the original read and independent installed
replacement through exact logical-owner identities. Nested cleanup derives each
frontend's post-cleanup descriptor separately from the enclosing manual's input.
Existing cleanup storage transitions and C stage/finish ordering preserve extracted
old values and final owner disposal. Projected and recursive aggregate frontends
share this route; computed persistent manual aliases remain explicitly unsupported.

Concrete restoration distinguishes physical `local-focus` endpoints from ordinary
semantic `deferred` shapes. Independent verification derives both physical records,
mode, ordered phases and storage transitions. The printer displays callable endpoint
layouts. Six shared samples and five corruption tests cover this boundary. There
are no incompatible code-pointer casts or new environment allocation conventions.
The concurrent execution build scheduler is unchanged. Phase 6 remains open.

Validation across the three projection/manual slices: **2370 pass / 39 existing
skips / zero failures across 42 files** (1366 non-execution tests and 1004
native/Wasm cases). Full strict C11, optimized native, supported sanitizers and
both Emscripten/Node optimization levels passed without retries in 369.41 seconds.
Each slice also passed its 12 focused native/Wasm cases. TypeScript and diff
checks pass. Remote CI was not run. These slices do not complete phase 6.


## Phase 6: lexical forwarding of callable focuses

Callable/aggregate local focuses backed by enclosing storage now retain logical
owner/path identities through lexical scope results. Independent verification
checks scope endpoint agreement and derives the same owner identity. Completion
retains frontend-then-lexical-release ordering for callable focuses as well as
ordinary lenses. Forwarded callable manual cleanup is analyzed against installed
storage at completion, preserving its original callable ABI. Private owners that
would escape their defining scope and callable function-result ABIs still receive
explicit diagnostics; no C storage or lifetime convention is changed.

Six shared cases cover direct/projected/nested aggregate focuses, manual cleanup,
lexical loan release and unused environments. Corruption coverage rejects altered
forwarded endpoint descriptors; a boundary test protects private backing escape.
All 12 focused native/Wasm cases, the full non-execution suite, TypeScript and diff
checks pass. Persistent computed manual aliases and general callable focus ABIs
remain open. Phase 6 is incomplete.


## Persistent manual callable aliases

Computed manual aliases now retain private read/current descriptors independently
of their protected frontend owner. Release verifies the final replacement, updates
the frontend descriptor through its logical projection, and runs existing manual
completion afterward. Scope forwarding supplies the enclosing owner identity;
semantic write endpoint metadata preserves callable/data transitions. Existing C
views and cleanup machinery execute this route without storage/ownership changes.
The independent typed owner verifier remains unchanged.

Nine shared samples and three safety/corruption tests cover cleanup replacement,
nested order, unused environments, aggregate projections, data extraction and
consumption of the installed callable. The former manual-alias rejection case is
now a shared execution regression. General scattered callable endpoints, selected
callable lens results, escaping private callable backing and callable focus
parameter/result ABIs remain open. Phase 6 is incomplete.

Validation for lexical callable-focus forwarding and persistent manual aliases:
**2418 pass / 39 existing skips / zero failures across 42 files** (1384
non-execution tests and 1034 native/Wasm cases). Full strict C11, optimized native,
supported sanitizers and both Emscripten/Node optimization levels passed without
retries in 392.67 seconds. Focused execution passed 12 forwarding cases and 16
initial manual-alias cases; the additional consumption regression passed in the
full run. TypeScript and diff checks pass. Remote CI was not run. Phase 6 remains
incomplete.


## Phase 6: flat scattered callable swaps

Flat scattered callable swaps now use an explicit `focus-tuple` representation:
ordered child endpoint descriptors plus independent aggregate read/replacement
representations. Physical records retain each child endpoint layout, an exactly
typed replacement restoration entry and context. Independent analysis/concrete
verification checks child provenance, endpoint representations and physical fields.
Logical target identities update all selected owners before member completion;
existing C lens tuples move extracted environments once without new casts.

Three shared samples and two corruption cases cover replacement, data extraction,
unused environments, child ordering and physical fields. Validation: 1389
non-execution passes / 39 existing skips; 6 focused native/Wasm passes; TypeScript
and diff checks pass. Nested/mixed tuples, manual wrappers, forwarding and
persistent scattered aliases remain separate work. Phase 6 is incomplete.


## Phase 6: recursive mixed scattered swaps

Scattered callable endpoint tuples now compose nested/mixed data and callable
members. Recursive logical targets retain exact owned place/projection identity;
scalar-only subtrees remain semantic lenses while callable-bearing nodes retain
`focus-tuple` contracts. All owners receive ordered replacements before member
completion. Independent verification checks recursive read provenance, child order
and each installed representation; C continues using logical cell/path views.
Three shared cases cover mixed nesting, scalar-only subtrees and projected owners,
with nested read corruption coverage. Validation: 1393 non-execution passes / 39
existing skips; 6 focused native/Wasm passes; TypeScript and diff checks pass.
Manual wrappers, forwarding/persistence and general callable lens ABIs remain open.
Phase 6 is incomplete.


## Phase 6: scattered manual cleanup contracts

Manual wrappers of scattered callable focuses use `focus-manual` descriptors,
retaining their own read/installed replacement independently of a recursive
frontend descriptor. Their physical record retains the frontend endpoint record,
an exact installed-replacement restoration entry and context; manual restoration
uses `scattered-focus` mode with exact frontend/result physical layouts. Independent
verification derives these records and checks installed provenance before cleanup,
then final frontend provenance after cleanup. Nested wrappers and manual members
preserve source completion order without changing C storage or ownership.
Three shared samples and a forged-mode corruption case pass. Validation: 1397
non-execution passes / 39 existing skips; 6 focused native/Wasm passes; TypeScript
and diff checks pass. Forwarded/persistent scattered focuses and general callable
lens call/return ABIs remain open. Phase 6 is incomplete.


## Phase 6: lexical scattered focus forwarding

Lexical scope results now retain recursive scattered target identities when every
leaf belongs to enclosing logical storage. Forwarded data-only subtrees retain
their targets for later mixed composition. Callable tuple/manual completion defers
lexical releases until after frontend completion, preserving installed and cleanup
endpoint descriptors. Independent verification checks scope descriptor agreement
and derives target coverage; private backing escape and callable function-result
ABIs retain explicit restrictions. C already forwards these logical views.
Three shared forwarding cases and one corruption case pass. Validation: 1401
non-execution passes / 39 existing skips; 6 focused native/Wasm passes; TypeScript
and diff checks pass. Persistent scattered aliases and general callable lens ABIs
remain open. Phase 6 is incomplete.


## Persistent scattered callable aliases

Persistent computed loans now retain private callable-tuple descriptors separately
from protected original owners. At release, representation analysis and independent
verification transfer the final representation through every recursive target
before completing member/manual cleanup. Existing C scattered views and lexical
release handlers already supply the corresponding physical order; the concurrent
execution scheduler and typed owner verifier are unchanged.
Five shared samples cover flat/nested/mixed aliases, consume/refill, manual cleanup
and unused disposal. Three corruption/safety tests protect final provenance and
all original owners. General callable lens ABIs, selected callable lens results and
escaping private backing remain open. Phase 6 is incomplete.

Validation across the five scattered-callable slices: **2477 pass / 39 existing
skips / zero failures across 42 files** (1409 non-execution tests and 1068
native/Wasm cases). Full strict C11, optimized native, supported sanitizers and
both Emscripten/Node optimization levels passed without retries in 405.62 seconds.
Each slice passed its focused execution cases (34 native/Wasm cases in total).
TypeScript and diff checks pass. Remote CI was not run. Phase 6 remains incomplete.
