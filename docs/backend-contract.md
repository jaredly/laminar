# Backend contract, revision 1

This is the phase-0 contract for [the C/Wasm plan](c-codegen-plan.md). The compiler front end is the existing affine AST checker. The active pointer-based evaluator/decomposition is the behavior reference; `src/value-passing/` is prior work, not a second interchangeable backend contract.

## Units and identities

A compilation unit supplies a stable, caller-chosen unit ID, ordered source items, explicit entry expressions or functions, and a native import signature table. Named definitions are visible in source order, with monomorphic self-recursion while checking their bodies. Redefinition remains invalid. All definitions, bindings, places, nodes, and generic variables have namespaced IDs independent of `Loc` or JavaScript object identity. Reordering a compilation unit may change anonymous expression ordinals; cross-edit incremental identity is not promised by revision 1.

Phase-1 elaboration is a frozen, serializable DTO. Syntax snapshots carry `nodeId` properties; nodes, declared bindings, value/lens uses, instantiation arguments, captures, place transitions, scopes, and branch states refer to those IDs. Source annotations can constrain the exported scheme differently from the inferred principal type. Elaboration records the correspondence and presents body types aligned with the declared contract. A use of an imported generic definition names its canonical `definition/qN` parameters.

Empty places are not unit values. A move marks a place/path unavailable; a write replenishes it. Borrow-open and borrow-close mark lexical exclusive alias scopes. Function-body events are descriptions of the body, not actions executed when the closure is constructed; capture moves occur at construction. Branch arm event spans describe mutually exclusive paths, followed by a joined availability state. Consumers must retain those regions rather than replaying every recorded event in one flat sequence. Temporary read/write representation choices are deferred until typed IR and target lowering.

## Evaluation and resource order

- Evaluate ordinary tuples and constructor arguments from left to right. Evaluate interpolated expressions in source order.
- In a call with a final lens argument, perform its setup first, then evaluate the callee, then ordinary arguments from left to right; call once; run accumulated cleanup afterward. A lens-returning call carries restoration state until its result is restored.
- For assignment, set up the target lens before evaluating the RHS. Evaluate the RHS once, then swap: return the currently stored value, or unit if the RHS consumed it, and install the replacement. Do not reload a value consumed by the RHS.
- For a let, finish evaluating its value before adding its pattern bindings. Pattern destructuring does not reevaluate the value. Persistent aliases borrow their owner through the body and release the borrow only after verifying restoration at scope exit.
- Evaluate the case scrutinee once, choose the first matching arm, and execute only that arm. Unmatched cases trap. Join types and availability; a path moved in any arm cannot be read afterward without replenishment.
- Construct closures by moving free values into a distinct environment in deterministic capture-list order. Capture analysis distinguishes ordinary callees inside lens expressions from borrowed outer variables. Borrowing outer storage inside a closure is invalid.
- Local values are affine, including first-class functions and local copies of top-level functions. An unused owned value is dropped at its scope exit. Borrowed storage must be full at lifetime end; unused full lens contents are restored, not dropped as an owned local.

The C emitter must express sequencing through statements and temporaries. It must not depend on C argument evaluation order, pointer reinterpretation, or a read from an empty/uninitialized slot.

## Representation and ABI

The baseline uses C11, `double` numbers, `_Bool` booleans, aggregate structs, and an inhabited unit value where a value is required. Do not use an empty C struct. `Int` retains the checker's existing alias to `Number`; it is not an integer ABI.

Semantic types remain target-independent. Physical layouts and concrete callable ABIs are target-specific. `src/backend/target.ts` validates explicit target configurations and supplies canonical cache keys. A native target must specify its actual compiler identity, triple, address width, and byte order. Layouts must not be calculated from the TypeScript build host. Defer offsets and sizes to the target C compiler wherever possible.

Represent a logical place separately from its physical storage versions. An `A/B` lens has independently typed read and replacement backing, even when a homogeneous specialization can coalesce them. A thin lens addresses an aggregate; a scattered lens recursively bundles component addresses. Specialize on recursive representation shapes and types, not local addresses or place IDs. Rebuild aggregates when type changes alter their layouts. Do not leave projections pointing at an obsolete aggregate version.

Closures/restoration adapters have exact typed code pointers and a distinct opaque environment data pointer. Never cast incompatible function pointers or use a function pointer as a data address. A closure wrapper's call ABI includes all specialized argument/result representations. Environment structs are concrete per closure specialization; ABI-compatible wrappers can hide different environment layouts at joins.

## Initial target profiles

The locally available Wasm toolchain is Emscripten, so the initial executable profile is `wasm32-unknown-emscripten`, little endian, 32-bit linear-memory addresses, with Node hosting generated JavaScript. This is an explicit choice over the plan's suggested WASI profile; no WASI runtime or SDK is required for the first smoke test. A browser profile uses the same internal target but different host adapters. WASI and memory64 are separate future profiles.

Tools observed when establishing the baseline: Apple Clang 21.0.0 (`clang-2100.0.123.102`), Emscripten 6.0.5-git from the Homebrew 6.0.5 installation (bundled Clang 24.0.0git), and Node v24.13.1. These are local observations, not a reproducible CI artifact pin. Before enabling required backend CI, provision an immutable Emscripten SDK/container build and Node version and record their identities. A `-git` version string alone must not be described as an immutable artifact pin.

Revision 1 starts with explicit allocation/disposal in linear memory and native C; Wasm GC is not assumed. Printing, files, clocks, allocation, and traps use profile-specific imports. Initial host exports are scalars, length-delimited buffers, and opaque owned handles. Borrowed lenses do not escape across the host boundary. Host reentry is initially disallowed while a borrowed operation is in progress. Public exports must define ownership transfer and disposal independently of internal struct layout.

## Execution milestones and failures

`test/backend/corpus.ts` is the named positive acceptance corpus with expected values and first required execution phases. All cases must check and elaborate before code emission exists. Phase 4 requires scalar/tuple/direct-call/recursion/homogeneous thin/scattered lens execution on native C and Emscripten/Node; phase 5 adds type-changing/returned lenses; phase 6 adds closures and indirect calls; phase 7 adds heap-backed data. The existing inference tests supply move, borrow, restoration, and type-error negatives.

Source errors remain `TypeDiagnostic`. Backend configuration, unsupported-feature, unresolved-layout, verifier, build, and host failures use `BackendDiagnostic` with a stable code and source node where available. A missing tool can produce a clear local skip; required backend CI must fail rather than silently skip. No backend may fall back to evaluating JavaScript and call that a native/Wasm result.

Tests run in temporary directories and preserve generated C/Wasm and compiler commands on failure. Compare typed-IR, native, and Wasm results through a test-only protocol: booleans and finite numbers as JSON scalars, unit as `null`, tuples/lists recursively as arrays, strings as strings. Preserve special numeric values with tagged objects for `NaN`, infinities, and negative zero. This protocol is a test interface, not the public language ABI.

Phase-0 baseline: `bun test` reported 285 pass, 39 existing skips, 0 failures across 15 files; `bunx tsc --noEmit` passed. Required sanitizer support and compiler flags are checked per toolchain, not assumed identical between native and Wasm targets.
