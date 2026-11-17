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

## Next slice: generic typed IR (phase 2)

Consume `checked.elaboration` without depending on solver internals or rerunning source inference. Define typed generated temporaries and explicit move/write/drop/acquire/restore operations; retain function and branch regions rather than flattening their metadata events into one execution trace. Add independent IR verification and reference execution before physical layout/specialization work.

Subsequent phases remain as described in [the plan](c-codegen-plan.md): representation specialization, the first native/Wasm execution milestone, type-changing backing/restoration, affine closure ABIs and joins, then heap data/runtime integration. No emitter or untyped fallback has been introduced in this slice.
