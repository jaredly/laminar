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
