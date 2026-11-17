# Plan: typed lowering, representation specialization, and C/Wasm code generation

Status: implementation started, 2026-11-17. The phase-0 contracts/acceptance corpus, phase-1 durable elaboration, and phase-2 generic typed IR/verifier/reference execution are implemented; phases 3–8 remain. C/Wasm emission is not implemented yet. See [the implementation record](backend-progress.md), [backend contract](backend-contract.md), and [typed IR API](typed-ir.md). Each phase should be independently reviewable and leave the existing checked and unchecked execution paths working.

## Outcome and scope

Compile checked Laminar programs to readable, standalone C that can target native execution and WebAssembly, specializing reachable generic definitions on both semantic types and lens representations. Preserve the current affine language: top-level functions are reusable; first-class functions and other local values are consumed at most once; unused owned values are allowed; persistent aliases exclusively borrow their owner; lens contents must be restored at lifetime end; closures capture values by moving them at creation and cannot borrow outer storage.

The two motivating lenses have the same semantic flow type but different representations:

```lm
let x = (1, 2)
// ~x: one aggregate location

let a = 1
let b = 2
// ~(a, b): two independently located components
```

Both forms must work when passed through generic functions, returned through lens functions, and used by higher-order functions. Specialization on representation must not change which source programs pass semantic checking.

Full coverage means the currently checked language subset, not every syntax form in the parser. Manual cleanup lenses, `aslens`, lens cases, and constructor alias patterns currently lack complete semantic rules. They remain explicit unsupported cases until separately specified and checked. Do not expand source-language semantics incidentally while implementing the backend.

## Current starting point

- `src/types.ts` separates solver types, flow endpoints, and rank-1 schemes from parsed annotations.
- `src/infer.ts` records occurrence types and binding objects, but storage, availability, and borrow state are mutable analysis data. The exported binding table is `ReadonlyMap<object, object>`, rather than a durable compiler interface.
- Instantiation does not return its quantified-variable substitution. Declared contracts can have a different set of type-variable IDs from the inferred definition body.
- `src/captures.ts` identifies value captures and illegal outer lens uses. `src/decompose.ts` lowers captures, aliases, pointer tuples, and cleanup functions for the interpreter.
- `src/check.ts` clones the checked AST before lowering and does not carry the occurrence type tables into that clone or generated IR.
- `src/expr.ts` is untyped interpreter IR. JavaScript values and the evaluator's pointer representation supply information a C backend cannot assume implicitly.
- `src/value-passing/` contains another lowering/evaluation approach. It is useful prior work, but the active `Checker.lower` calls `src/decompose.ts`. Choose and document one backend contract; do not accidentally combine the semantics of both implementations.
- `src/builtins.ts` contains a limited signature registry, and `test/fixtures.ts` supplies interpreter implementations. Source signatures, native implementations, and data ownership conventions are not yet one checked registry.

## Architecture and recommended decisions

Use a generic typed representation before specialization, and a concrete typed representation afterward:

```text
parse AST
  → resolve identities + semantic inference/elaboration
  → generic typed IR
  → representation constraints + reachable specialization
  → concrete typed IR
  → target-aware C lowering and emission
  → native C compiler or C-to-Wasm toolchain
```

Inference remains on the AST, before decomposition. Generic typed IR preserves what inference established; it does not rediscover source typing. Representation constraints and specialization can iterate together because specializing a body can discover additional call and representation requirements.

### WebAssembly target strategy

Start with generated C compiled to WebAssembly, sharing the semantic checker, typed IR, specialization machinery, and emitter with native compilation. A direct Wasm emitter is optional future work. The initial Wasm memory model is ordinary linear memory with explicit allocation/disposal, not Wasm GC.

Introduce a `TargetConfig` before physical layout selection. It identifies the target triple, pointer/address width, ABI/toolchain, enabled target features, and runtime import profile. Include its identity in physical-layout and concrete-specialization caches; target-independent semantic results can still be shared. Never derive generated layout from the machine running the TypeScript compiler. Let the target C compiler determine C layout/calling conventions, using generated `sizeof`/`offsetof` expressions where possible; any offsets computed by Laminar must come from an explicit target data-layout model.

Keep thin and scattered lens shapes abstract: under a wasm32 linear-memory target, a thin lens uses aggregate addresses and a scattered lens bundles component addresses. Nested shapes and type-changing input/output backing follow the same logical rules as native compilation. Do not encode “pointer = 64-bit integer” or bake a native aggregate ABI into generic IR. Represent code references and data addresses separately, even if a particular target happens to give them the same width.

Use exact typed indirect-call signatures for closures and restoration adapters. The C-to-Wasm toolchain handles function-table lowering; Laminar must not cast incompatible function pointers or treat callable references as data addresses. Emscripten documents why these casts can fail in Wasm even when they appeared to work natively: [function pointer issues](https://emscripten.org/docs/porting/guidelines/function_pointer_issues.html).

Separate the internal specialized ABI from the host interface. Export deliberate scalar operations, buffers with lengths, and opaque owned handles. Specify allocation, disposal, ownership transfer, and whether imports may reenter the module. Initially keep borrowed lenses internal; do not expose a borrow that can survive a host call or outlive its storage. A stable host ABI is not a memory dump of target-dependent internal structs. Host bindings must refresh memory views when the chosen runtime requires it after memory growth.

Choose one executable Wasm profile in phase 0. Implementation decision: the initial profile is Emscripten/Node, based on the available toolchain, as recorded in [the backend contract](backend-contract.md#initial-target-profiles). The original recommendation was: wasm32 with a pinned [WASI SDK](https://github.com/WebAssembly/wasi-sdk) and a compatible pinned runtime. Record the actual supported WASI ABI/profile rather than assuming all WASI versions are interchangeable. For browser deployment, add an [Emscripten](https://emscripten.org/docs/compiling/Building-Projects.html) or explicit JavaScript-import profile. These share source semantics but have distinct platform adapters. Do not require both profiles for the first milestone.

Printing, files, clocks, allocation, and traps belong to explicit runtime interfaces. The core language runtime should not assume POSIX access or browser globals. Wasm testing complements native warning/sanitizer builds; passing Wasm validation alone does not establish memory or ownership safety.

### Keep semantic types separate from representations

`Ty` and `FlowTy` remain source-level concepts. Introduce separate interned layout and representation IDs. A sketch, not a final interface:

```ts
type LensRep =
    | { kind: 'thin'; backing: BackingId }
    | { kind: 'tuple'; items: LensRepId[] }
    | { kind: 'parameter'; id: RepParamId };
```

`BackingId` describes read and replacement storage layouts and access conventions. It must not imply that an `A/B` lens always fits in one C pointer. A homogeneous thin lens can eventually use one pointer; a type-changing thin lens may need distinct read and replacement slots. Tuple representations recurse, allowing mixtures of aggregate pointers and component pointers. Preserve independent read/write layout information even when both endpoints happen to share a layout.

### Use typed storage versions as the correctness baseline

Represent a logical place separately from its physical C variables. A type-changing update produces a new storage version. Lens acquisition/restoration relates versions and reconstructs enclosing aggregates as necessary. Introduce thin-pointer fast paths when the physical layout stays compatible.

Do not reinterpret an existing C struct as an unrelated replacement struct, assume field offsets survive type changes, or use pointer casts to make incompatible accesses appear typed. The relevant object-access restrictions are described in [C draft N1570, §6.5](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf). The initial implementation should favor separate typed slots and reconstruction over clever shared backing storage.

A `Number/Bool` focus can therefore be implemented with a numeric input slot and a boolean output slot. For a thin aggregate lens, its replacement aggregate is reconstructed from the replacement focus and preserved components. For a tuple of pointers, each component has its own restoration destination. The source-level difference between these two cases remains available for specialization.

An empty place is a separate availability state, not an initialized unit value. Consuming a numeric slot must not make codegen read an uninitialized C object when a later swap returns unit.

### Closure and higher-order conventions

Use a typed code pointer plus an opaque data-environment pointer for first-class functions, with concrete environment structs generated per closure definition and specialization. The code pointer has the concrete specialized call signature; no incompatible function-pointer casts. Environment erasure does not erase the argument/result ABI or their lens representations.

When a closure is dropped unused, dispose of its remaining captures. When called, transfer its affine captures into the body and release its environment according to one documented convention. A canonical closure wrapper allows two different capture environments with the same call ABI to meet at a branch join without specializing callers on arbitrary runtime closure identity.

### Specialization and dynamic joins

Key a specialization by stable definition ID, concrete semantic type arguments, and concrete representation arguments, including representations nested in function types. Distinguish genuinely different ABIs, but do not key on local storage IDs or concrete caller addresses.

Different static branches can produce different layouts or lens shapes. Monomorphization cannot select a runtime branch. Prefer explicit conversion to a common representation, such as a tuple of component addresses, when this preserves lifetimes and restoration behavior. If conversion is insufficient, use a concrete tagged representation with generated access/restore operations. Initially report an explicit unsupported representation-join diagnostic until that machinery is implemented; never arbitrarily choose one branch's ABI.

## Phase 0 — Freeze backend contracts and the acceptance corpus

**Goal:** make later phases agree on semantics and physical calling conventions.

Work:

1. Record the supported subset and an explicit list of checker-accepted constructs temporarily unsupported by the backend. Backend diagnostics must be distinct from source type errors.
2. Specify exact evaluation order: final lens setup, callee evaluation, ordinary arguments, RHS evaluation, swaps, cleanup, and closure capture. Derive examples from the active decomposition/evaluator; capture any intended changes as separate decisions with tests.
3. Specify a baseline C11 target: `Number` as `double`, `Bool` as `_Bool`, an inhabited unit representation where a value is required, aggregate structs, deterministic mangled names, and explicit sequencing through temporaries. Do not depend on C argument evaluation order.
4. Define how a compilation unit supplies entry roots and native imports. A source file's expression items are not automatically a C `main` result protocol. Add a test-only result printer with an explicit expected type.
5. Specify ownership for values, stored closures, and native imports. Unused owned values require disposal where they own memory; affine checking alone is not a memory-management implementation.
6. Choose the generic typed IR contract and the versioned-storage baseline above. Review useful parts of `src/value-passing/` without replacing the active evaluator in this phase.
7. Freeze `TargetConfig`, native and wasm32 layout/ABI assumptions, and one pinned Wasm toolchain/runtime profile. Define the host import/export and error conventions separately from internal function ABIs. Record browser integration as a separate profile if not selected initially.
8. Create an acceptance matrix used throughout the plan: scalars, tuples, direct calls, recursion, both pointer forms, nested pointer forms, type changes, aliases, higher-order calls, closures, branch joins, lists, strings, and rejected programs.

**Deliverable:** a concise ABI/IR contract and named test cases with expected results/errors. Document which cases become executable in each later phase.

**Exit gate:** every subsequent phase can refer to an agreed storage, ordering, ownership, and result convention. Run the existing suite to establish the actual baseline at implementation time; do not rely on a historical test count.

## Phase 1 — Retain a durable typed elaboration

**Goal:** make checking produce all semantic information needed downstream, without changing accepted programs.

Likely files: `src/infer.ts`, `src/types.ts`, `src/check.ts`, `src/captures.ts`, and a new `src/elaborated.ts`.

Work:

1. Assign stable `NodeId`, `BindingId`, `DefinitionId`, and logical `PlaceId` values. Source locations remain diagnostic data, not identity. Shadowed names and generated bindings must stay distinct.
2. Replace opaque exported binding objects with immutable declaration/use records. Keep mutable inference state private. Preserve one checked source snapshot and its metadata; any clone must retain IDs.
3. Make instantiation return the instantiated type and explicit quantified-variable substitution. Record definition-use edges for calls and top-level function values, not just identifier spelling.
4. Preserve the relationship between exported annotated schemes and definition-body variables. A narrower contract must still specialize the body correctly. Namespace variables across definitions instead of relying on solver-local numeric IDs.
5. Record capture lists with binding IDs, types, and move sites. Preserve borrow scopes, place projections, and storage transitions with before/after type and availability. Record branch input/output states, including paths unavailable on only some branches.
6. Make empty-versus-initialized-unit explicit in this output. Retain separate facts for the value returned by a swap and the replacement installed afterward.
7. Classify unresolved variables. Generic parameters are legal in generic definitions; unresolved representation-relevant variables at a reachable concrete entry require a diagnostic or an explicit erasure policy. Do not silently default arbitrary metavariables to a primitive type.

**Tests:** metadata survives cloning; IDs distinguish shadowed bindings; instantiations are fresh and traceable; annotated identity bodies specialize; alias capture/restoration and branch availability have immutable snapshots.

**Exit gate:** downstream passes can inspect declarations, occurrences, captures, and place transitions without accessing `Inferencer` internals or rerunning inference. Existing accepted programs and diagnostics remain stable except deliberate diagnostic improvements.

## Phase 2 — Lower to generic typed IR and verify it

**Goal:** establish a typed execution model before introducing C layouts.

Likely additions: `src/typed-ir.ts`, `src/lower-typed.ts`, `src/verify-ir.ts`, and a small test interpreter or adapter.

Work:

1. Define typed values, basic blocks or explicit sequencing, calls, constructors, branch joins, closure creation, moves, drops, lens acquisition/restoration, and logical place versions. Every generated temporary has a type and source origin.
2. Lower elaborated source using the frozen evaluation order. Preserve explicit restoration/cleanup obligations even when initially implemented as simple moves.
3. Keep logical places distinct from addresses. A focus projection identifies a component of an aggregate version; it is not yet a permanently valid C field pointer.
4. Make end-of-scope drops and branch-sensitive disposal explicit. A path already moved must not be dropped again. Prefer edge-specific operations when availability is statically known; retain runtime initialization flags only when the chosen lowering needs them.
5. Add an IR verifier for type compatibility, dominance/scope, call modes and arity, move availability, capture types, version transitions, and balanced restoration obligations. Verify generated IR independently of source acceptance.
6. Execute typed IR for the supported subset and compare it with the active evaluator. Normalize logical empty slots in the comparison protocol rather than depending on the interpreter's private deleted sentinel.

**Tests:** rejected source never reaches this lowering; deliberately malformed typed IR fails verification; differential tests cover ordering, full/empty swap results, branch moves, nested aliases, and captured lens values restored before scope exit.

**Exit gate:** all supported generic IR is typed and verified, including compiler-generated functions and temporaries. The new path reproduces the evaluator for the acceptance subset without using untyped JavaScript values as its type model.

## Phase 3 — Infer representations and specialize reachable definitions

**Goal:** produce concrete typed IR with no unresolved ABI choices.

Likely additions: `src/representations.ts`, `src/layouts.ts`, `src/specialize.ts`.

Work:

1. Intern concrete semantic layouts and recursive lens shapes. Model homogeneous aggregate locations, tuples of locations, and read/replacement backing separately.
2. Generate representation constraints from lens expressions, projections, function parameters, results, and higher-order function signatures. Parameter representations inside generic bodies remain symbolic until specialized.
3. Implement a worklist rooted at explicit entry functions/expressions. Instantiate and specialize generic IR using retained substitutions. Cache a specialization before visiting its recursive body so ordinary recursion terminates.
4. Canonicalize keys independently of solver IDs, source-local place IDs, and incidental traversal order. Keep distinct shape variants for identical semantic types. Include `TargetConfig` in concrete specialization/layout cache keys, while allowing target-independent generic IR reuse.
5. Resolve direct and higher-order call ABIs. Reified top-level function values receive concrete callable wrappers; their uses are not all direct-call rewrites. Propagate result representation constraints back to consumers when needed.
6. Add layout dependencies, forward declarations for recursive data, and deterministic specialization names. Reject infinitely sized by-value layouts; recursive containers need indirection.
7. Detect unsupported changing-specialization recursion or unbounded expansion and report the definition chain. A safety budget diagnoses a failure; it must not silently emit an incomplete call graph.
8. Diagnose unresolved representation joins explicitly until phase 6 supplies adapters. Non-ABI-relevant generic remnants may only be erased under an explicit, tested rule.

**Tests:** one shared specialization for repeated equivalent calls; distinct numeric/boolean variants; distinct thin/scattered tuple variants; nested mixed shapes; recursive reuse; function values; unused generic definitions omitted; clear errors for unsolved reachable layouts; native/wasm32 builds do not accidentally reuse target-specific layouts or cached ABIs.

**Exit gate:** a concrete IR verifier confirms every emitted value and function ABI has a concrete layout/representation and every call references an emitted specialization. Generic typed IR remains available for diagnostics.

## Phase 4 — Emit and execute the first native C and Wasm subset

**Goal:** deliver an early end-to-end C backend and prove its portability by executing the same generated-language subset natively and as Wasm.

Likely additions: `src/c/emit.ts`, `src/c/names.ts`, a compile driver, and `test/c/`.

Supported at this milestone: numbers, booleans, unit, tuples, ordinary control flow, direct calls, recursion, and homogeneous lens input/output layouts in both thin and tuple-of-pointers forms. Temporarily empty slots are allowed; a numeric slot consumed and then replenished with a number does not require reading empty storage. Heap-owning values and indirect calls can remain explicit backend errors until later phases.

Work:

1. Emit type declarations, function prototypes, concrete definitions, and a small entry adapter in dependency order. Use a structured emitter rather than arbitrary source interpolation for identifiers and literals.
2. Lower ordered operations into C statements and temporaries. Lower pattern matching/control flow without reevaluating the scrutinee or reading consumed values.
3. Emit specialized thin and scattered lens ABIs; materialize tuples only when required by the chosen operation. Expose symbol/signature snapshots showing the two variants.
4. Lower homogeneous slot reads, moves, refills, and swaps. Represent empty swap results as unit without loading an uninitialized slot. Preserve an old value before overwriting a full slot.
5. Define trap behavior for unmatched cases and allocation/runtime failures that are relevant to this subset. Implement only native imports with explicit C implementations and matching signatures.
6. Add a harness that writes generated files into temporary directories, invokes a discovered C compiler, runs the executable, and compares its structured result with typed-IR execution. Preserve generated C on failure.
7. Extend that harness to compile generated C with the selected wasm32 toolchain and execute it in the selected runtime. Compare scalar, tuple, recursion, thin/scattered lens, empty-slot/refill, and ordering results against both typed IR and native execution. Store target/toolchain metadata and failing Wasm artifacts.
8. Keep code emission separate from building and running either target. Report a missing local Wasm toolchain/runtime clearly; require the pinned Wasm smoke job in backend CI rather than silently skipping it there.

**Validation:** build with strict C11 warnings, then optimization enabled; run address/undefined-behavior sanitizers where supported. Require a compiler in backend CI, while clearly reporting local compiler-dependent skips. Numeric tests must use agreed `double` semantics, not accidentally assert integer division.

**Exit gate:** the first acceptance corpus runs as native C and Wasm with both pointer representations and correct effect order. Codegen cannot silently fall back to the JavaScript evaluator.

## Phase 5 — Type-changing storage and returned lenses

**Goal:** compile the defining `A/B` behavior safely and predictably.

Work:

1. Implement distinct typed input/output storage versions and reconstruction for different read/write layouts. Reserve/initialize output slots according to control flow; a logical place changes version when restoration completes.
2. Lower thin aggregate focus updates by preserving unaffected components and rebuilding replacement aggregates. Lower scattered lenses by routing replacements to independent output places. Nested representations must compose in both directions.
3. Preserve alias identity as a logical place/projection mapping across versions. Do not leave component aliases pointing at an obsolete physical aggregate. The checker’s exclusive borrowing rules provide the boundary at which an owner becomes usable again.
4. Lower lens-returning calls to concrete focus plus restoration state. Generate restoration code and a typed environment/signature for its residual context. Separate temporary stack-resident continuations from state that genuinely escapes; establish their lifetimes explicitly.
5. Execute restoration exactly once, in the specified order. Verify that each output lens parameter and persistent borrowed focus is initialized when its lifetime ends.
6. Add adapters for type-changing calls where caller and callee use different backing conventions. Keep endpoint layouts, pointer shapes, and semantic substitutions visible in diagnostics.

**Tests:** `Number/Bool`, a small-to-large aggregate transition, nested tuple changes that alter field offsets, `take`, `map`, generic `fst` used as an assignment target, nested lens-returning calls, temporary consumption followed by restoration, and captured alias values with subsequent refill. Run each applicable case with thin and scattered backing on native and Wasm targets. Include native/wasm32 layout differences in aggregate reconstruction tests.

**Exit gate:** the type-changing corpus compiles under strict warnings and sanitizers with no incompatible-pointer access tricks, stale projections, or reads of empty storage. These cases must also pass at optimized compilation settings and match Wasm execution. Apply sanitizers on the targets/toolchains that support them; do not assume identical sanitizer availability.

## Phase 6 — Affine closures, indirect calls, and representation joins

**Goal:** support higher-order programs without requiring every runtime callee to be statically known.

Work:

1. Generate capture structs from elaboration records, moving contents at closure creation. Capturing a lens value must move its contents while preserving the caller's ability to refill the alias. The closure must not retain the borrowed storage address.
2. Emit typed code/environment wrappers for each concrete call ABI. Function bodies and adapters recover their concrete environment type; callers do not cast incompatible code pointers.
3. Implement environment lifetime and destruction for both invoked and unused closures, including closures returned from functions and stored in aggregates. Begin with heap-backed environments when escape is possible; stack allocation is a later optimization.
4. Normalize compatible branch results to a common lens/closure representation. For thin-to-scattered conversion, prove that every component address and restoration destination outlives the resulting view.
5. Where normalization cannot express a valid join, introduce a concrete tagged representation and generated dispatch helpers. Do not assume one specialization per branch eliminates the need for a runtime representation at the join.
6. Validate indirect calls carrying or returning lens representations. Ensure a closure received through a parameter has the same concrete call ABI expected at its use site. Execute closure and restoration-adapter indirect calls under the Wasm runtime as well as natively, including branch-selected callees with different capture environments.

**Tests:** captured scalars, capture and refill of a lens alias, captured first-class lens callees, returned closures, unused closures owning memory, branch-selected closures with different capture structs, higher-order calls with both pointer forms, and runtime branch-selected lens shapes supported by the checker.

**Exit gate:** concrete IR and generated C verify callable signatures, environment ownership, and restoration lifetimes. No emitted closure retains a pointer into an expired stack frame; no affine capture is duplicated or disposed twice.

## Phase 7 — Runtime data, builtin coverage, and integration

**Goal:** make C compilation a usable execution path for the checked language subset.

Work:

1. Complete registered data layouts and owned operations for strings, homogeneous lists, tuples containing owned data, and any explicitly registered nominal constructors. Define constructor family/tag metadata in addition to inference signatures.
2. Generate or register move, drop, and permitted duplication operations per concrete type. Distinguish copying a scalar from duplicating owned recursive data. Define whether each builtin can handle closures/resources; reject unsupported instantiations explicitly.
3. Unify source signature, interpreter implementation, C implementation, target/profile availability, and ownership convention metadata for runtime imports. Provide native and selected Wasm platform adapters for printing, files, clocks, allocation, and traps; unsupported host capabilities must be explicit. Audit actual source arity and hidden evaluator context arguments separately.
4. Implement string interpolation and comparison according to documented source behavior. Do not use raw C pointer equality as a substitute for a chosen language equality operation. Add missing arithmetic/comparison intrinsics only with explicit semantics.
5. Provide a compiler command/API to check, specialize, emit C, and optionally build/run it. Expose target/profile selection and separate code emission from invoking external compilers. Surface source-mapped errors and deterministic symbol names.
6. Integrate compiler tests with the existing runner through an explicit backend selection. Run the same accepted corpus on typed IR, native C, and the selected Wasm profile. Maintain negative checker tests separately from unsupported-backend tests.
7. Define and test host exports using scalars, length-delimited buffers, and opaque owned handles. Cover ownership transfer/disposal and memory-view refresh after growth where relevant. Add a minimal browser host test when a browser profile is introduced.
8. Document supported features, runtime linking/import requirements, target assumptions, and how to inspect emitted C and Wasm artifacts. Record remaining parser-only lens features separately.

**Exit gate:** all acceptance cases belonging to the checked subset either compile and match the reference result or have a documented, tested backend restriction scheduled for completion. Declaring full subset support requires eliminating those restrictions, not merely classifying them. Full tests, TypeScript checks, strict C builds, optimized builds, supported sanitizers, and the pinned Wasm execution corpus pass in CI.

## Phase 8 — Optimize after the representation contract is stable

**Goal:** improve generated code without changing source semantics or the public ABI model.

Candidates: coalesce compatible storage versions; eliminate aggregate reconstruction when only a component changes; collapse homogeneous thin input/output backing to one pointer; remove empty environments and no-op restoration; stack-allocate nonescaping closure/restoration environments; specialize indirect calls when the callee is known; share equivalent variants; eliminate unnecessary flags and moves.

Each optimization needs a concrete before/after C example, verifier preservation, and differential execution against the unoptimized backend. Measure emitted size and performance for native and Wasm targets before adding representation variants. A native-only optimization benefit does not justify breaking Wasm correctness or ABI invariants. Keep one deliberately simple, unoptimized path as a debugging reference.

**Exit gate:** semantic regressions remain covered and measured improvements justify the added complexity. This phase is not a prerequisite for a correct initial backend.

## Validation matrix and phase handoffs

| Concern | Required evidence |
| --- | --- |
| Source semantics | Existing checker tests plus move/borrow/restoration negatives; acceptance corpus typed once before lowering |
| Metadata | Stable IDs, explicit substitutions, body/contract links, immutable storage-state snapshots |
| Generic IR | Type/availability/restoration verifier and reference execution |
| Specialization | Deterministic reachable graph, deduplication, concrete call ABI verifier, bounded expansion diagnostics |
| Pointer shapes | Thin, scattered, nested mixed, returned, higher-order, and branch-joined cases |
| Storage safety | Empty versus unit, type-changing size/alignment, aggregate rebuilding, no stale projections |
| Ownership | Moves at capture, unused-value drops, branch-sensitive disposal, invocation/escape lifetimes |
| Native execution | Strict and optimized C builds, differential results, supported sanitizer runs, failure artifacts |
| Wasm execution | Phase-4 wasm32 smoke test, pinned toolchain/runtime profile, equivalent results, typed indirect calls and restoration in later phases |
| Target portability | No build-host layout assumptions, target-keyed physical caches, distinct code/data references, target-correct aggregate ABI |
| Host boundary | Explicit imports/exports, buffer/handle ownership, no escaping borrowed lenses, profile-specific capability tests |

At each handoff, include the implemented surface, remaining explicit restrictions, commands run, new regression cases, and any contract changes. Do not advance a later phase by bypassing a verifier or substituting an untyped fallback.

Suggested review units are one phase per change set, splitting a phase when it contains separable infrastructure and integration work. Phases 1–3 share identity/type/representation contracts and should proceed in order. Phase 4 is the first executable milestone for both native C and the selected Wasm profile. Phases 5–7 extend its coverage; phase 8 is optional optimization. Runtime-library work can be prepared alongside later phases only after their ownership and call ABI contracts are settled.

## Decisions to revisit with concrete prototypes

The defaults above make progress possible without additional up-front language decisions. Revisit these only with emitted IR/C examples and measured tradeoffs:

- Whether versioned input/output slots should later share union-backed storage, and under which access and lifetime rules.
- Which mixed-representation joins deserve tagged support versus normalization adapters; neither should become a source typing restriction accidentally.
- Whether a uniform allocation strategy is sufficient for the initial runtime or some resource types require explicit native destruction conventions earlier.
- How much generic code to share when specializing representation-heavy higher-order programs; correctness precedes deduplication.
- Whether a direct Wasm emitter, memory64 support, or a Wasm GC representation is warranted after the C-to-Wasm path is reliable. None is required to preserve the initial source semantics.
- Which currently unsupported semantic lens forms to implement after the checked subset has a working C backend.

The recommended first implementation task is phase 0 followed by phase 1: freeze the contract and make the checker preserve the metadata. Starting with a C pretty-printer would leave the hardest storage and specialization questions implicit.
