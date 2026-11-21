# Plan: typed lowering, representation specialization, and C/Wasm code generation

Status: phases 0–6 are complete for the checked subset (phase 6 closed
2026-11-20). Phases 0–3 are implemented through the concrete-IR exit gate; phases
4–5 execute the documented scalar/tuple native C and Emscripten/Node subset. Phase 6
executes affine closures, typed indirect calls and representation joins through
[ABI-keyed, type-determined callable representations](abi-callable-representations.md);
see [*Phase 6 completion*](#phase-6-completion-2026-11-20). Phase 7 runtime and host
integration and phase 8 optimization remain broader work. Phase 7 is in progress:
slices 1 (nominal union data), 2 (strings), 3 (runtime import registry) and 4 (compiler command/API) are complete (see
[*Phase 7 progress*](#phase-7-progress)).

The scoped lens extensions are complete as of `707521c`; see the
[completion record and follow-up mapping](checker-completeness-handoff.md).
Latest local verification (phase 6 close): **2072 pass / 1303 skip / 0 failures
across 48 files**, all 38 snapshots passing; TypeScript and diff checks pass. The
native/Wasm corpus passes 1262 cases and the Go tests 662, without retries. Remote
CI was not run for these slices. See also [the implementation record](backend-progress.md),
[backend contract](backend-contract.md), [typed IR API](typed-ir.md), and
[C backend](c-backend.md). Each further slice should be independently reviewable
and preserve checked and unchecked execution paths.

> **Direction change (2026-11-20):** phase 6 moved callables to ABI-keyed,
> type-determined representations. See
> [ABI-keyed callable representations](abi-callable-representations.md). The
> identity-precise callable machinery recorded in the historical phase-6 sections
> below (focus endpoints, demands, dispatch and join adapters, recursion hypotheses)
> was removed by that migration; the shared execution samples remain the
> behavioral corpus.

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

Full coverage means the currently checked language subset, not every syntax form
in the parser. Manual cleanup lenses, `aslens` (including constructor/literal
cleanup patterns), lens cases, and borrowed constructor aliases now have checked
restoration contracts, retained verification, and reference execution. Their
documented physical subset executes through C/Wasm; remaining callable/nominal
adapters stay explicit backend restrictions. Do not expand source-language
semantics incidentally while implementing the backend.

## Original starting point (historical)

- `src/types.ts` separates solver types, flow endpoints, and rank-1 schemes from parsed annotations.
- `src/infer.ts` records occurrence types and binding objects, but storage, availability, and borrow state are mutable analysis data. The exported binding table is `ReadonlyMap<object, object>`, rather than a durable compiler interface.
- Instantiation does not return its quantified-variable substitution. Declared contracts can have a different set of type-variable IDs from the inferred definition body.
- `src/captures.ts` identifies value captures and illegal outer lens uses. `src/decompose.ts` lowers captures, aliases, pointer tuples, and cleanup functions for the interpreter.
- `src/check.ts` clones the checked AST before lowering and does not carry the occurrence type tables into that clone or generated IR.
- `src/expr.ts` is untyped interpreter IR. JavaScript values and the evaluator's pointer representation supply information a C backend cannot assume implicitly.
- `src/value-passing/` contains another lowering/evaluation approach. It is useful prior work, but the active `Checker.lower` calls `src/decompose.ts`. Choose and document one backend contract; do not accidentally combine the semantics of both implementations.
- `src/builtins.ts` contains a limited signature registry, and `test/fixtures.ts` supplies interpreter implementations. Source signatures, native implementations, and data ownership conventions are not yet one checked registry. (Resolved in phase 7 slice 3: `src/runtime-imports.ts`.)

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

Implemented through the concrete-IR exit gate; see [the concrete IR contract](concrete-ir.md) and [implementation record](backend-progress.md). Unsupported joins and unresolved reachable contracts remain explicit diagnostics; this milestone does not emit or execute C/Wasm.

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

Implemented for the milestone subset; see [C backend](c-backend.md) and the
[implementation record](backend-progress.md). Native and Emscripten/Node execution
are tested locally; the pinned backend CI workflow is checked in.

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

Implemented for accepted typed/concrete IR, including thin/scattered and nested
returned-lens execution on native C and Emscripten/Node. See
[C backend](c-backend.md) for storage versions, restoration lifetimes and remaining
checker/phase-6 restrictions.

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

**Exit gate:** all acceptance cases belonging to the checked subset either compile and match the reference result or have a documented, tested backend restriction scheduled for completion. Declaring full subset support requires eliminating those restrictions, not merely classifying them. Full tests, TypeScript checks, strict C builds, optimized builds, supported sanitizers, and the native execution corpus pass in CI. (Wasm execution was dropped from the corpus on 2026-11-20: it compiles the same C through Emscripten and so tested the toolchain, not the backend.)

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

*Historical (superseded by [Phase 6 completion](#phase-6-completion-2026-11-20)):*
Phases 0–5 are complete for the documented subset. Phase 6 is partially
implemented: typed code-pointer invocation and compatible branch-selected closures
work, including different capture environments, nested joins, and supported native
intrinsic alternatives, different returned callable environments, and normalized
lens results. Owned callable tuple storage executes; callable focus storage/replacement remains. Continue with that
phase-6 adapter or
phase-7 runtime/host integration,
using the [scoped completion record](checker-completeness-handoff.md#separate-broader-work-and-c-codegen-plan-mapping)
to distinguish completed restoration support from remaining backend work.
Callable focus storage/replacement needs an explicit adapter slice spanning the
phase-5 storage and phase-6 closure contracts; general closure storage in phase 6
item 3 does not by itself establish focus replacement support. `A & B` remains
separate language-design work outside this backend plan.

### Phase 6 next boundary: callable storage adapters

Owned callable tuple analysis and physical records are implemented and independently
verified; see the latest backend progress record. Recursive fields retain each
member's concrete ABI and use existing logical storage and affine disposal.
Direct whole-owned-local swaps now retain independent read/replacement descriptors.
General representation-bearing lens restoration contracts remain the next adapter
work, along with differing aggregate joins and divergent branch storage versions.
Branches with identical final descriptors now propagate that common version. Keep phase 6 open until callable focus
replacement executes with verified ownership and restoration on checked/unchecked
paths and native/Wasm targets.

## Convergent branch storage versions

Branches may now change an enclosing owned local's representation when every
arm finishes with the same exact descriptor. Analysis compares final arm states
and propagates their common descriptor into the continuation; independent
serialized verification derives and checks that agreement separately. The C
backend uses its existing typed branch storage merge, retaining the selected
value's environment ownership and original invocation ABI.

Four shared callable-focus samples cover both selections of callable-to-data and
data-to-captured-callable replacements. Divergent final descriptors still require
an explicit adapter and diagnose. Projected/borrowed callable focuses, persistent
aliases, callable focus parameters/results, manual restoration, scattered callable
focuses and differing aggregate joins remain open. Phase 6 is incomplete.

## Latest phase 6 boundary: tuple branch-result adapters

Branches returning tuples with differing callable members now normalize each
member recursively, preserving original invocation ABIs and selected environment
ownership. Concrete adapters retain exact endpoint layouts and entry mappings,
independently checked before C emission. Nested subset joins, unused members,
captures, parameters and returned normalized tuples execute through the existing
storage/disposal paths. See the latest backend progress record for validation.

Remaining aggregate work is differing tuple results of dynamic calls and divergent
branch storage versions. Callable focus aliases/projections, parameters/results,
manual restoration and scattered callable focuses still require representation-aware
restoration contracts. Phase 6 remains open.

## Latest phase 6 boundary: dynamic tuple-result adapters

Dynamic callees with differing owned tuple results now normalize recursively
through exact source-ABI wrappers and affine member transfer. Tuple branch and
call-result adapters share their physical value conversion contract and independent
verification. Remaining work includes divergent branch storage versions and general
callable focus restoration (aliases/projections, parameters/results, manual cleanup
and scattered focuses). Phase 6 remains open; see backend progress for validation.

## Latest phase 6 boundary: divergent owned branch storage

Ordinary branches now normalize differing callable/aggregate storage versions
using independently verified per-place adapters, preserving empty projections and
selected environment ownership. Later moves, captures, calls and swaps use the
common descriptor. General callable focus restoration remains open, including
divergent storage changes inside lens-valued branches: those need a deferred
restoration-aware merge and retain an explicit diagnostic. Phase 6 stays open.

## Latest phase 6 boundary: selected-lens setup storage

Lens-valued branches now normalize setup-only divergent callable/aggregate owners
before retaining selected-arm state. Independent dependency checks keep deferred
arm access to those owners explicit until representation-aware restoration exists.
Current merged versions survive staging, completion and intervening replacements;
outer cleanup can use their common descriptor. General callable focus aliases,
projections, parameters/results, manual cleanup and scattered focuses remain open.
Phase 6 is incomplete.

## Latest phase 6 boundary: deferred selected-owner consumption

Selected lens cleanup now consumes/disposes divergent callable owners through
retained original typed arm storage. Verified retention contracts preserve original
invocation slots, including when the common descriptor has none. Staging and
completion normalize surviving fields afterward and retain backing for returned
contexts. Deferred replacement/acquisition of those owners still needs a descriptor
transition adapter; callable focus aliases/projections, parameters/results, manual
restoration and scattered focuses remain open. Phase 6 is incomplete.

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

## Next phase 6 boundary: release-aware cleanup effects

Concrete manual restoration now retains independently verified `storageTransitions`
with exact endpoint layouts and affine ownership; the printer exposes them.
Investigation showed that a manual instruction can live outside the scope releasing
its alias, so applying effects only at the manual's enclosing block exit is too late.

Next, associate loans with manual restoration effects, compose nested completion
in runtime order, and propagate descriptor changes at actual release boundaries.
Include immediate swaps/discards and returned lenses. Then add exact post-cleanup
normalization adapters for divergent selected replacement. The current replacement
guard stays in place. Phase 6 remains incomplete.

## Latest phase 6 slice: selected arm-local alias handoff

Arm-local aliases returned from selected scalar/tuple lenses now retain their
underlying exclusive protections and deferred release effects. Manual escape
provenance remains separate from protected storage owners: explicit owned backing
retention must not erase protections on outer storage. The existing independent
typed-IR owner check remains unchanged. Representation analysis/verifier attach
lexical release handlers to lens block results in frontend-completion then release
order, matching C restoration.

This closes the known `Computed loan owner protection mismatch` boundary for the
covered selected aliases, including nested, scattered, divergent and returned
cases. General callable focus endpoint ABIs (direct callable aliases/projections,
parameters/results, manual and scattered callable focuses) remain separate work.
Phase 6 remains incomplete.


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


## Latest phase 6 slice: direct persistent callable aliases

Direct whole-local persistent aliases (`let a = ~f`) now execute for callable and
recursive aggregate-with-callable contents. The typed IR uses the original place
plus a loan permit for these aliases; it does not allocate a computed lens owner.
Representation state explicitly retains acquisition-to-logical-owner identities
across lexical clones. Acquisition permits one direct same-block swap or one
whole-place direct loan through lexical scopes. Computed/manual frontends and
projected acquisitions retain their restrictions.

The `local-focus` read descriptor comes from the current logical owner; direct
swaps retain independent ordered RHS descriptors and update that owner. An alias
acquisition instead derives its final replacement descriptor at loan release,
including deferred scalar-lens completion. Independent serialized verification
checks the loan's exact whole owner, the initial read, every swap and the final
replacement, then checks subsequent owner reads. Semantic lens shapes cannot
substitute for these explicit callable endpoints.

Thirteen shared samples cover nested loans, repeated replacement, consume/refill,
callable/data transitions, recursive aggregate replacement, divergent branches,
unused loans/environments, deferred scalar completion and returned ordinary
callable values. Corruption coverage rejects changed final replacement, swap read
and owner continuation descriptors. Safety/boundary coverage preserves exclusive
owner protection and explicit projected/manual callable endpoint diagnostics.
Existing C logical views keep cell/path identity across version changes; this
slice changes no C storage, environment allocation/disposal or build scheduling.

Next: projected callable focuses; computed/manual and scattered callable endpoints;
callable focus parameter/result ABIs; unmodeled deferred completion routes. A direct
persistent alias is not a general callable lens ABI. Phase 6 remains incomplete.

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


## Phase 6: immediate manual callable swaps

Immediate manual callable/aggregate swaps now retain independent endpoint
representations through cleanup, including nested manuals and projected frontends.
A manual result's replacement describes the installed RHS; its frontend's final
replacement describes storage after that manual's cleanup. Representation analysis
and independent verification derive these boundaries in cleanup order and retain
existing cleanup storage transitions. Every local callable frontend is attached to
an explicit logical owner/path. Computed persistent manual aliases remain rejected.

Concrete manual restoration uses `kind: 'local-focus'` for this route, with
`frontend` and `result` naming physical endpoint record layouts instead of semantic
lens shapes. The normal `deferred` route is unchanged. Both routes retain stage,
cleanup, owned-result disposal, restore and release ordering. Independent concrete
verification derives the mode, endpoint layouts, transitions and ordering; the
printer exposes `callable-endpoints`. C reuses existing logical manual restoration.

Six new shared samples cover direct, projected, aggregate and unused swaps,
cleanup replacement and nested cleanup order. Corruption tests reject altered
physical mode/endpoints/order and manual read provenance. General computed
persistent aliases, scattered callable focuses, selected callable lens results and
callable focus parameter/result ABIs remain open. Phase 6 is incomplete.

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


## Phase 6: persistent manual callable aliases

Persistent aliases of callable/aggregate manual focuses now execute when their
frontend is backed by enclosing logical storage. Representation state retains
semantic write endpoints alongside logical owner/path identities. Computed loans
initialize a private descriptor from the frontend read while the original owner
remains protected. At release, inference derives the final alias replacement,
restores that descriptor into the frontend owner, then applies retained manual
cleanup and lexical release handlers in order. Independent verification derives
and checks the final replacement before applying the same completion boundary.
The typed-IR owner verifier and escape/protection distinction are unchanged.

Nine shared cases cover replacement, unused aliases/environments, nested manual
ordering, projected aggregate contents and frontends, extraction to data, and
cleanup consuming the installed callable. Serialized corruption tests protect
completion descriptors and exact owner protections; a source safety case rejects
frontend owner access while the alias is live. Existing C computed-loan views and
manual restoration implement the physical behavior without new environment copies,
allocations or code-pointer casts. The concurrent execution scheduler is unchanged.

Remaining work includes scattered callable endpoints, selected callable lens
results, retained private callable backing that escapes a scope, general callable
focus parameter/result ABIs and unsupported completion routes. Phase 6 remains
incomplete.

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


## Phase 6: persistent scattered callable aliases

Computed aliases of scattered callable/aggregate focuses now retain a private
current descriptor while every original logical owner remains exclusively
protected. Release independently checks the final alias replacement, propagates
it through the recursive target tree, then completes member/manual frontends and
lexical releases in source order. Nested aliases use existing exact projection
contracts. No C storage or environment allocation/disposal convention changes.

Five shared cases cover flat aliases, nested/mixed consume/refill, manual cleanup,
unused loans and unused environments. Corruption tests reject forged final alias
provenance and missing owner protections; source safety still rejects access to
protected owners. The independent typed-IR owner verifier is unchanged.
Remaining boundaries include callable focus parameter/result ABIs, selected
callable lens results, escaping private callable backing and unmodeled completion
routes. These scattered slices do not complete phase 6.

Validation across the five scattered-callable slices: **2477 pass / 39 existing
skips / zero failures across 42 files** (1409 non-execution tests and 1068
native/Wasm cases). Full strict C11, optimized native, supported sanitizers and
both Emscripten/Node optimization levels passed without retries in 405.62 seconds.
Each slice passed its focused execution cases (34 native/Wasm cases in total).
TypeScript and diff checks pass. Remote CI was not run. Phase 6 remains incomplete.


## Phase 6: owned callable projection through native fst

Direct native `fst` calls on whole owned callable aggregates now retain the
projected read/installed replacement as explicit local-focus endpoints. Completion
reconstructs and independently checks the parent replacement descriptor through
its logical owner/path. Original sibling provenance and callable ABIs are retained;
C already projects the logical view. Non-direct completion and scattered inputs
remain separate boundaries. Three shared samples and a serialized read corruption
case pass. Validation: 1413 non-execution passes / 39 existing skips; 6 focused
native/Wasm cases; TypeScript and diff checks pass. Phase 6 remains incomplete.


## Phase 6: scattered native fst callable projection

Direct native `fst` now selects explicit child descriptors and logical targets
from scattered callable inputs, including nested subtrees and projected owned
storage. Completion reconstructs the parent endpoint descriptor from current
ordered targets. Independent verification checks selected-child provenance and
parent/child replacement contracts. Existing C native projection preserves view
identity and untouched siblings. Three samples and a corruption case pass.
Validation: 1417 non-execution passes / 39 existing skips; 6 focused native/Wasm
cases; TypeScript and diff checks pass. Manual/persistent completion and general
callable lens ABIs remain open. Phase 6 is incomplete.


## Phase 6: native fst completion composition

Native callable projections now compose nested projection handlers, persistent
result aliases and manual wrappers around the returned projection. Data fields
of callable-bearing aggregates also project through exact semantic endpoints.
Projection completion reconstructs parent descriptors before enclosing argument
completion; independent verification checks each original parent ABI and final
provenance. Concrete direct-native contracts no longer assume every data result
has a semantic-lens argument. Four shared samples and a corruption case pass.
Validation: 1424 non-execution passes / 39 existing skips; 8 focused native/Wasm
cases; TypeScript and diff checks pass.

Callable manual arguments to `fst` remain explicitly rejected: investigation
found legacy and typed evaluators disagree about their argument cleanup order.
Two boundary cases retain `Callable fst argument cleanup ordering requires an
explicit adapter`. This slice does not choose a new source semantics or enable
that ambiguous route. General callable lens ABIs remain open. Phase 6 is incomplete.


## Phase 6: retained lexical callable backing

Whole/projected callable focuses may now outlive their defining lexical block
within the same function. Analysis scope annotations retain exact `retainedStorage`
place/setup-descriptor records; independent verification derives private-owner
coverage and provenance. Concrete scope records retain exact physical layouts and
`retain-through-completion` ownership. Verification rejects missing/forged records;
printing exposes `retain-storage`. Existing C scope completion keeps the logical
cell alive through restoration and disposes its current version afterward; no
function-return ABI or new heap convention is introduced. Untouched aggregate
siblings retain their original layouts and affine disposal.
Three shared samples and three corruption cases pass. Validation: 1429
non-execution passes / 39 existing skips; 6 focused native/Wasm cases; TypeScript
and diff checks pass. Scattered private backing and general callable focus
call/return ABIs remain separate work. Phase 6 is incomplete.


## Phase 6: retained recursive scattered backing

Scattered callable/manual focuses may now retain private lexical owners through
same-function completion. Recursive target traversal derives an ordered unique
owner set; existing enclosing owners stay in place and only private storage gets
`retainedStorage` contracts. Multiple projections retain their shared aggregate
owner once. Independent verification derives the same coverage, descriptors and
physical ownership/layout records. Existing C lexical cleanup restores views and
disposes current private versions after completion, preserving extracted old
values and untouched callable siblings. No new allocation convention is introduced.

Three shared samples cover captured private callables, mixed private/enclosing
storage and manual cleanup. Corruption tests reject missing owner coverage and
reordered physical retention contracts. Remaining work includes general callable
focus parameter/result ABIs, selected callable lens results, true function-return
retention and the explicitly diagnosed native argument-cleanup ordering boundary.
These slices do not complete phase 6.

Validation across the native-projection and lexical-retention slices: **2534 pass /
39 existing skips / zero failures across 42 files** (1434 non-execution tests and
1100 native/Wasm cases). Full strict C11, optimized native, supported sanitizers
and both Emscripten/Node optimization levels passed without retries in 432.71
seconds. Each slice passed focused execution (32 native/Wasm cases in total).
TypeScript and diff checks pass. Remote CI was not run. General callable lens
ABIs and the native manual-argument cleanup ordering boundary remain open;
phase 6 is incomplete.


## Phase 6: proven native callee routing

Callable acquisition may feed one same-block call whose evaluated descriptor is
independently proven to be native `fst`; a direct `global` producer is no longer
required. Stored, returned and forwarded native descriptors use existing exact
projection endpoint/restoration contracts. User-defined and dynamic callable-focus
callees still diagnose `Callable focus calls require verified native fst provenance`.
This does not relax general lens ABIs or the native argument-cleanup restriction.

The provenance implementation was incorporated in `32f436f` during this task;
follow-up coverage adds three shared execution samples and a user-call ABI boundary
test. All 6 focused native/Wasm cases and diff checks pass. The current broader
run reports 1437 passes / 39 existing skips / 1 source-identity snapshot failure;
TypeScript reports errors in cli/c.ts and src/eval-typed.ts introduced with the
concurrent game changes. Those changes are preserved. No full execution run or
remote CI is claimed for this follow-up. Phase 6 remains incomplete.


## Legacy returned-lens cleanup order correction

Legacy `lensToRvalue` call decomposition now retains final lens-argument cleanup
until returned-lens completion. It emits the callee's returned cleanup before the
argument cleanup, rather than using ordinary expression-call lowering that cleaned
the argument during setup. Callee/ordinary-argument lowering and runtime evaluation
order are preserved. This fixes both projected `aslens` backing lifetime and manual
`@` callable replacement ordering; the legacy results now agree with typed execution
for the reduced regressions. The prior legacy/typed ordering discrepancy is resolved
for these cases. The C callable manual-argument restriction remains in place pending
separate representation/restoration verification; this fix does not relax that guard.

Three checked regressions failed before the fix and pass afterward. A fourth raw
unchecked-decomposition regression verifies projected cleanup and heap release.
TypeScript and diff checks pass. Broad non-execution validation reports 1442 passes,
39 existing skips and the existing source-identity snapshot failure; no full native/
Wasm run or remote CI is claimed for this legacy-only correction. Phase 6 remains
incomplete. Concurrent evaluator, systematic fixture and developer-log work is
preserved.


## Phase 6: demand-driven callable focus parameter and result ABIs

User functions may now receive callable/aggregate-with-callable focuses and return
callable focuses. A variant's identity includes its caller's replacement demand, so
the callee is specialized on both endpoints: the setup read it exposes and the
replacement representation its completion installs. Parameter contracts carry each
focus argument's final replacement independently of its read.

Lens setup precedes analysis of the replacement, so the demand is derived lazily
rather than predicted. Representation analysis runs the callee through setup at the
call, records a pending call entry, and interns the variant only when the returned
focus completes. The completing consumer has then installed a concrete replacement:
an immediate swap (`value`), a persistent alias release (`loan`), a consuming focus
call's parameter contract (`consumer`), or a forwarding caller's own completion.
Because the real analysis supplies the demand, replacements built by branches,
scopes and focus-taking calls need no separate equation solver; the earlier
`RepresentationDemands` evaluator is removed. Alias replacements joined across
branches specialize on the resulting `callable-choice`. One call site completed with
divergent demands, or never completed, is an explicit diagnostic.

A returned focus routes either to one parameter projection or to callee-private
storage. Private backing (for example `fn temp() ~{lens v <- fn () 1\n v}`) uses
the existing retained-scope contract and the returned lens's heap residual context,
so the backing outlives the callee frame until restoration releases it. Private
results forward through relaying callees. Callee setup writes to a focus parameter
before returning a lens to it are now accepted; the read endpoint reflects the
post-setup storage.

Independent verification derives the result route (parameter projection or private)
from typed IR, checks each demand source structurally, checks the annotated focus
replacement against the demand and variant key, and checks parameter completion
inside the variant. Returned-focus arguments verify their endpoints at their own
completion. No C storage, environment or restoration convention changes.

Twenty-two shared demand samples execute on typed IR, the legacy reference and
native/Wasm C, covering exchanges, projections, scattered and forwarded parameters,
distinct replacement variants, branch/scope/call replacements, persistent and unused
result aliases, joined alias replacements, setup effects, private/captured/forwarded
private backing, results consumed by focus calls and closure callees. Corruption
tests reject forged alias/consumer sources, replacement demands and private
retention contracts.

Remaining explicit boundaries: recursive callees taking callable focuses
(`Recursive callable endpoint demands require a fixed-point constraint`, which needs
a contract fixed point), branch-selected callees taking callable focuses (`Callable
focus calls require verified native fst provenance`, which needs per-option
completion and a joined dispatch contract), native `fst` over a callable result or
manual argument (`Callable fst argument cleanup ordering requires an explicit
adapter`), and returned lenses selected by a callee branch. Phase 6 remains
incomplete.

Validation: 1510 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1150 native/Wasm
cases (strict and optimized native, supported sanitizers, both Emscripten/Node
optimization levels) in 301.89 seconds without retries. TypeScript checks pass.
Remote CI was not run. Execution tests in `test/c/execute.test.ts` are now opt-in
with `LAMINAR_EXEC=1`.


## Phase 6: recursive and branch-selected callable focus callees

Recursive callees taking callable focuses now specialize through a least fixed point
over their parameter contracts and result. A recursive call whose setup inputs
(captures, data arguments and focus reads, excluding replacements) match an
enclosing call reuses that call's hypothesis. The seeding pass treats a plain-valued
branch arm reaching the unsolved recursive call as divergent, so the seed is the
base-case contract; later passes answer the recursive call with the current
hypothesis until contract and result are stable (at most 16 iterations). Discarded
passes roll back the variants and pending demands they interned, and the final
recursive call entries name the solved variant itself. Recursion that changes setup
inputs (for example thin to scattered, or a different read after a setup swap)
starts a nested fixed point, bounded to four per function in one call chain.
Unconditional recursion is diagnosed as lacking a base case.

Independent verification needs no fixed point: it checks the self-call against the
variant's declared argument contract and result, and each body against its own
completion. A forged recursive contract changes the canonical variant key.

Branch-selected (`callable-choice`) callees may receive callable focuses when every
alternative reaches the same parameter contract. Each alternative is specialized
independently; matching contracts let the existing dispatch wrapper, argument
checks and C dispatch helper apply unchanged, with one caller write-back.

Six new shared samples (28 total) cover recursive exchange, scattered descent,
recursive data results, changing recursive inputs, and dispatch to top-level and
capturing-closure alternatives. Tests also check the precise seeded contract.

Remaining explicit boundaries: alternatives with differing parameter contracts
(`Branch-selected callable focus callees require a common parameter contract`; this
needs an argument-adapting dispatch wrapper in concrete IR and C), branch-selected
or dispatched callable lens results, which also gate recursive lens results, and
native `fst` over callable results or manual arguments. Phase 6 remains incomplete.

Validation: 1518 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1162 native/Wasm
cases in 309.62 seconds without retries. TypeScript checks pass. Remote CI was not run.


## Phase 6: callable fst over manual and returned-lens frontends

The `Callable fst argument cleanup ordering requires an explicit adapter` guard is
removed. It existed because the legacy and typed evaluators disagreed on whether a
lens argument's cleanup ran before returned-lens completion; `47ddf1b` aligned
legacy decomposition with the typed order (projection completion, then argument
cleanup), and representation analysis already composes finishes in that order.

Native `fst` now accepts every callable focus frontend:

- Manual frontends over local storage keep their existing owner/path projection;
  cleanup observes the projected replacement.
- Scattered manual frontends project the first child beneath any wrappers. The
  projection keeps its own replacement endpoint, because manual completion later
  rewrites the frontend's children to post-cleanup descriptors; verification
  compares the child's read endpoint and checks the replacement at its swap.
- Returned-lens frontends project the routed `callResults` target, or remain
  callee-private. On completion the parent replacement is rebuilt from its setup
  read with the projected component (siblings are exclusively borrowed), and the
  parent's lazy demand completion consumes it. Verification derives the same
  reconstruction independently.

Eight shared samples cover local and scattered manual frontends, with and without
observing cleanup, returned callable lenses, data siblings, persistent aliases and
callee-private backing. The two former guard tests are now execution samples; a
corruption test checks that forged parent replacements are rejected.

Remaining explicit boundaries: dispatch alternatives with differing parameter
contracts, and branch-selected or dispatched callable lens results. Phase 6
remains incomplete.

Validation: 1525 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1178 native/Wasm
cases in 311.28 seconds without retries. TypeScript checks pass. Remote CI was not run.


## Structural callable storage layouts

Physical callable records were interned per representation, keyed by code identity
and captures, with the environment pointer typed by that callable's own environment
record. Two capture-free closures with the same signature, such as `fn () 7` and
`fn () 9`, therefore had distinct but identical C structs, differing only in the
pointee type of an empty environment, and every join repacked fields between them.

Callable records are now keyed by their ordered entry ABIs, the environment field is
an erased pointer (code bodies and disposers already received `void *`), and
environment records are keyed by capture layouts. Callable descriptors, wrappers,
disposers and entry tables are unchanged, as is representation identity, which
still drives specialization, result representations and dispatch. The concrete
verifier derives the same structural identities. C emits a plain move for callable
adapters and joins whose source and target share a record and map every entry to the
same field.

This narrows the planned dispatch argument adapter: alternatives with differing
parameter contracts need a physical conversion only when their entry tables
differ, not merely when their representations differ.

Layout-forgery tests that copied one adapter endpoint onto the other now use an
explicitly forged layout, because those endpoints can legitimately coincide.
Printed concrete IR and C expectations were regenerated; their only changes are
erased environment pointers, merged records and renumbering.

Validation: 1525 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1178 native/Wasm
cases (strict and optimized native, supported sanitizers, both Emscripten/Node
optimization levels) in 310.17 seconds without retries. TypeScript checks pass.
Remote CI was not run.


## Phase 6: dispatch focus argument adapters

Branch-selected callees may now receive a whole callable focus when their
alternatives install different replacements. Each alternative keeps its exact
variant. The call-site argument carries the same read and the join of the
alternatives' replacements, which becomes the caller's storage after the call.
Representation verification allows dispatch alternatives to differ from the call
site only in that replacement endpoint and checks it with `verifyJoin`.

Concrete IR adds an `adapt-focus-arguments` wrapper: a dispatch member entry whose
exact variant arguments differ from the joined contract. It names the exact
invocation as its source (which may itself be a result adapter) and, per argument,
the variant and joined focus layouts plus a value adapter from the variant's
replacement to the joined replacement. The concrete verifier re-derives the source
key, adapters and ownership (`stage-and-convert-replacements`), checks the staged
source as an entry, and unwraps adapter chains when matching invocation slots.
`invoke` wrappers now also require their contract's argument representations to
match the exact variant, so differing contracts cannot pass merely because their
structural layouts coincide.

C emits each adapter as a function with the joined ABI. It stages a slot in the
variant's replacement layout, passing the caller's read pointer when the variant
has a separate replacement endpoint, and otherwise moving the read into the slot.
It calls the source, then converts the staged value into the caller's replacement
(or read) endpoint. With structural callable storage most conversions are moves.
When entry tables differ, the existing callable join adapter repacks the fields.
The Go backend reports this wrapper as explicitly unsupported.

Seven shared dispatch samples (33 demand samples total) cover common and joined
contracts on both arms, captured environments, aggregate replacements, and a
two-entry to one-entry callable conversion. Corruption tests reject forged
adapter sources, ownership, exactness and replacement layouts.

Remaining explicit boundaries: dispatch alternatives over scattered focuses with
differing contracts, and branch-selected or dispatched callable lens results,
whose conversion must run inside restoration. Phase 6 remains incomplete.

Validation: 1536 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1188 native/Wasm
cases in 411.71 seconds without retries. TypeScript checks pass. Remote CI was not run.


## Phase 6: branch-selected callable focuses within a function

A `case` whose lens result carries callables, for example
`~{match c {true -> f; false -> g}}`, now produces a `local-focus` instead of being
rejected. Arms may yield callable focuses (local owners, projections, forwarded or
private call results). The selected focus's read is the join of the arm reads; its
replacement comes from its consumer (swap, persistent alias or forwarding) through
the existing completion path. Swaps and aliases do not write storage directly. On
completion, each arm's restored state receives the replacement in that arm's own
target, and the existing post-completion union records `cleanupJoins`: the
selected arm's owner holds the replacement, the others keep their old values, and
the continuation sees the join. The state set formerly named `privateCallResults`
is now `deferredFocuses`, covering every focus whose replacement is installed only
by its own completion.

Representation verification mirrors this: arms are verified with focus results
allowed, the joined read is checked with `verifyJoin`, each arm's annotated
replacement must equal the selected focus replacement, and the existing
cleanup-join provenance check confirms only the selected arm's owner was written.

Concrete IR adds a `selected-focus` `lensJoin` with arm focus layouts, the joined
focus layout and per-arm read adapters, derived independently by the concrete
verifier. C reuses the existing selected-lens lowering (runtime arm tag, staged
frontends, per-arm cleanup normalization) and converts each arm's read into the
joined focus with its adapter. With structural callable storage this is usually a
move. Arms with different entry tables repack through the existing callable join
adapter.

Same-owner and sibling-projection arms need no special handling: the join of the
replacement with itself is the replacement, and siblings update their own paths.
A whole owner and a projection of that owner cannot both be arms, because their
types differ.

Ten shared samples cover both arms, captured environments, projected arms,
aggregate focuses, unused aliases, forwarded swaps, same-owner arms and an
entry-table conversion. Corruption tests reject forged read adapters, arm and
result layouts, and completions that write the wrong arm owner.

Callee-returned selected focuses (`fn pick(c, ~(x, y)) ~{match c {...}}`) and
recursive selected results (`walk`) now report `Branch-selected callable lens
results require a selected return route`; they need the arm tag to cross the
function boundary in the returned lens's residual context. Dispatched callable lens
results remain separate work. Phase 6 remains incomplete.

Validation: 1550 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1206 native/Wasm
cases in 433.86 seconds without retries. TypeScript checks pass. Remote CI was not run.


## Phase 6: callee-selected callable lens results

Functions may now return branch-selected callable focuses, for example
`fn pick(c, ~(x, y)) ~{match c {true -> x; false -> y}}`. No per-arm return route
is needed at the caller: the result is a deferred focus, like callee-private
backing. When its consumer installs the demand, the callee's completion runs the
selected-focus finish against its own parameter places, writing the replacement
into each arm's restored state and joining them. The resulting parameter contract
(for example the selected component's join of old value and replacement) is what
the caller writes back to its storage, through the existing completion path.
Independent result-route derivation treats a `case` result as deferred.

C needed no change. The callee's returned lens already carries the selected-arm
tag, staged frontends and per-arm normalization in its restore context, so
restoration writes only the selected arm, normalizes owners to the joined layouts,
and flushes the parameters to the caller.

Nine shared samples cover both arms, scattered arguments, persistent result
aliases, forwarding through another callee, results consumed by focus calls,
captured arms, a callee-private arm and an entry-table conversion across the
function boundary. Corruption tests reject callee completions that write the wrong
arm owner and forged result demands.

Recursive selected results (`walk`) need a fixed point whose parameter contracts
depend on the replacement demand, which arrives only at completion. They now
report `Recursive callable lens results require a demand-dependent fixed point`.
Dispatched callable lens results remain separate work. Phase 6 remains incomplete.

Validation: 1557 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1224 native/Wasm
cases in 451.77 seconds without retries. TypeScript checks pass. Remote CI was not run.


## Phase 6: dispatched callable lens results

Branch-selected callees may now return callable focuses, for example
`let e = match c {true -> first; false -> second}; e(~p) := r`. Analysis sets up
every alternative, exposes a deferred `local-focus` whose read joins the
alternatives' reads, and records the consumer's demand source (shared with
single-callee calls). On completion every alternative is specialized on the same
demand, and the caller writes back the join of their parameter contracts, as for
plain dispatch. Representation verification checks every alternative's demand,
the joined read and each alternative's replacement endpoint, and treats the
dispatched result as deferred.

The member wrapper extends `adapt-focus-arguments` with a `result` part (the
variant's and the joined focus layouts and a read adapter) and ownership
`stage-until-restoration`, which the concrete verifier derives independently.
A lens-returning callee writes its parameters during restoration, after the call
has returned, so the C adapter stages arguments in a heap context. It calls the
variant, converts the variant's read into the joined focus, and returns a lens
whose restore runs the variant's own restore before converting staged parameters
into the caller's backing and releasing the context. Reads usually move. Differing
entry tables repack through the callable join adapter.

Six shared samples cover both alternatives, persistent aliases, a callee-private
alternative, captured contents and an entry-table read conversion. Corruption
tests reject forged result adapters, ownership and demands. Scattered arguments
whose alternatives install differing contracts keep the existing explicit
diagnostic.

The remaining callable lens-result boundary is recursive selected results, which
need a demand-dependent fixed point. Phase 6 remains incomplete.

Validation: 1570 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1236 native/Wasm
cases in 437.42 seconds without retries. TypeScript checks pass. Remote CI was not run.


## Phase 6: recursive callable lens results

Recursive callees returning branch-selected callable focuses now specialize, for
example `fn walk(k, ~x) ~{match k {0 -> x; j -> walk(j - 1, ~x)}}`. Their
parameter contracts depend on the replacement demand, which is known only when the
returned focus completes, so the fixed point is split in two:

- Setup: the existing least fixed point now lets a lens-valued selected `case`
  treat an arm reaching the unsolved recursive call as divergent. The returned
  focus's read converges from the base arms.
- Completion: once the demand is known, the solved variant re-completes fresh
  copies of its setup state. The seed pass treats the recursive arm's completion
  as divergent and the selected-focus finish excludes it; later passes answer the
  recursive call with the current contract, until the contract is stable. The
  stable pass's storage is kept, and recursive call entries name the solved
  variant. For `walk` the contract is exactly the demanded closure.

Verification needs no fixed point: the self-call is checked against the variant's
declared contract and demand, and the body against its own completion. A
lens-valued selected `case` now gives each arm the selected focus's replacement as
its forwarded demand, and call-result arms verify their endpoints at their own
completion. This also fixes non-recursive selected cases whose arms are
lens-returning calls (`~{match c {true -> first(~p); false -> second(~p)}}`),
which previously failed with `Unbound forwarded replacement demand`.

Recursion whose inputs change once and then stabilize, such as re-forming
`~(x, y)` as a scattered tuple, solves as a nested fixed point. A hypothesis
answering a call inside a different nested fixed point (for example alternating
`~(y, x)`) would interleave completion-time passes, so it reports
`Recursive callable lens results require stable recursive inputs`.

Six shared samples cover recursive swaps and aliases, recursion that selects
between arms, a recursive result consumed by a focus call, captured replacements
and selected call arms. Tests check the exact solved contract and reject forged
recursive contracts.

This completes the branch-selected, callee-selected, dispatched and recursive
callable lens-result plan. Remaining phase-6 boundaries are scattered dispatch
arguments with differing contracts and recursion with alternating inputs. Phase 6
remains incomplete.

Validation: 1578 non-execution passes with only the existing source-identity
snapshot failure; the full `LAMINAR_EXEC=1` execution file passed 1248 native/Wasm
cases in 468.82 seconds without retries. TypeScript checks pass. Remote CI was not run.

## Phase 6 completion (2026-11-20)

Phase 6 is closed. The sections above starting at *Phase 6 next boundary* are a
historical record of the identity-precise model; the
[ABI migration](abi-callable-representations.md) (M0–M5, with M6 measured and
closed) replaced it. The two boundaries the last section left open, scattered
dispatch arguments with differing contracts and recursion with alternating inputs,
compile and execute under that model.

Work items against the current implementation:

1. Capture structs move contents at closure creation; captured lens values move
   contents and the caller refills the alias. No closure keeps a borrowed address.
2. Each callable type has one record with one exact typed entry per ABI. Members
   fill entries with exact invoke wrappers or lens-result normalizers; there are no
   function-pointer casts.
3. Environments are heap-allocated and disposed when invoked or dropped, including
   closures returned from functions, stored in tuples and captured by other closures.
4. Branch, storage and aggregate joins of callables are record moves; differing
   lens results normalize to thin runtime lenses.
5. Tagged selected lenses cover runtime-selected lens shapes; callable values need
   no tagged representation because their layout is type-determined.
6. Indirect calls carrying or returning lenses run natively and on Wasm, including
   branch-selected callees with different capture environments.

**Closing gap: unconstrained closure types.** A closure that no use constrains,
such as `g` in `apply(fn (y) y, fn (z) 1, 3)` or an unused local `fn (y) y`, left
an unsolved type variable, so specialization rejected a checked program with
`unsolved-specialization`. That conflicted with this plan's rule that
specialization must not change which programs pass checking. Body variables still
unsolved after instance substitution now default to unit (`src/specialize.ts`):
no value of such a type is ever produced, and choosing unit uniformly keeps every
occurrence and dependent instance consistent. Explicit root type arguments must
still be concrete. Four execution samples (`unconstrainedClosureSamples`) and
three specializer tests cover this; the earlier test that asserted the rejection
was rewritten.

The plain-value join in `infer-representations.ts` can no longer meet differing
representations (plain values are type-determined; lens joins normalize first), so
it now reports an internal `invalid-representation` invariant failure instead of
an unsupported-program diagnostic. The C/Go `Storage version join requires an
adapter` check remains as a defensive lowering error; branch probes covering
whole versus component replacement, type-changing arms, nested changes, callable
tuples and single-arm updates did not reach it.

**Exit gate evidence.** The representation and concrete verifiers independently
check callable signatures, ABI slots, member sets, environment ownership and
restoration. Every shared execution sample runs natively under
AddressSanitizer/UndefinedBehaviorSanitizer with `detect_stack_use_after_return`,
at `-O0` and `-O2`, and under Emscripten/Node at both levels; Go runs the same
corpus. Phase 7 owns the remaining runtime-data restrictions, for example closures
capturing strings (`No storage definition for String`).

Validation: TypeScript and `git diff --check` pass. The regular suite reports 2072
passed, 1303 skipped, no failures, all 38 snapshots passing (4644 assertions).
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes all 1262 native/Wasm cases
(4407 assertions, 338.77 seconds); `LAMINAR_EXEC=1 bun test test/go` passes 662
tests (701 assertions, 95.52 seconds). Remote CI was not run.

## Phase 7 progress

Slices, in order: (1) nominal unions, (2) strings, (3) a runtime import registry,
(4) a compiler command/API, (5) backend selection in the test runner, (6) host
exports, then documentation and the CI exit gate.

### Slice 1: nominal union data (2026-11-20)

Work item 1 for nominal data and item 2's owned operations for it: user unions and
the builtin `List`/`Option` compile and execute on native C, Wasm and Go.
Storage schemas are derived from constructor imports, recursive variants are boxed,
and C has recursive drop, deep `dup` and protocol printing. Borrowed constructor
matches and `aslens` constructor patterns execute through their existing explicit
reconstruction IR. See [the C backend](c-backend.md#phase-7-nominal-union-data)
for the representation.

Layout identities now include only the schemas a type reaches, so derived builtins
do not perturb existing layout IDs or printed expectations. Entry expressions with an
unconstrained result type (such as `[]`) are instantiated at unit.

Tests: 28 nominal execution samples (`test/backend/nominal-samples.ts`), 17 list
borrowed-pattern and `aslens` samples moved into
`test/backend/nominal-pattern-samples.ts` and added to the shared corpus, the
corpus `list` entry, and five unit tests in `test/nominal-data.test.ts` for
derivation, schema-keyed identity, C/Go emission and reconstruction. Three tests
that asserted `No storage definition for List` now check successful lowering, or
assert the remaining string restriction instead; two diagnostics for a generic
`id` entry now expect the callable-root contract.

Remaining phase-7 restrictions: strings (`No storage definition for String`),
natives beyond arithmetic, comparisons, `dup` and `fst`, and the compiler command,
runner integration and host exports. Lenses projecting *into* a union value
without a pattern are not a source form; constructor fields are reached only
through patterns.

Validation: TypeScript and `git diff --check` pass. The regular suite reports 2152
passed, 1395 skipped, no failures, all 38 snapshots passing (4721 assertions).
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes all 1354 native/Wasm cases
(4729 assertions, 362.23 seconds), under ASan/UBSan at `-O0` and `-O2` natively;
`LAMINAR_EXEC=1 bun test test/go` passes 708 tests (747 assertions, 104.94
seconds). Remote CI was not run.

### Slice 2: strings (2026-11-20)

Work item 1 for strings, item 2's owned operations for them, and item 4's
interpolation and comparison: `String` is a primitive owned layout on C (native
execution; Wasm builds the same C) and Go. Literals, interpolation, literal patterns, drop, `dup`, captures,
strings inside tuples, lists and user unions, borrowed and `aslens` patterns over
them, `charList`, and JSON result printing execute. See
[the C backend](c-backend.md#phase-7-strings) for the representation.

Documented semantics: interpolation accepts `String`, `Number` and `Bool` parts.
Numbers follow ECMAScript `Number::toString`, matching the evaluator; other part
types, whose evaluator text is JavaScript `String(...)`, are a tested backend
restriction. Literal patterns compare bytes. Strings have no `==` import, so
patterns are the only comparison. `charList` splits at code points, as the
evaluator does.

The C runtime is emitted only for programs with a string layout, so existing
snapshots are unchanged. Large integral number literals beyond the safe-integer
range are now emitted as C floating literals; previously they failed to compile.

Tests: 36 string execution samples (`test/backend/string-samples.ts`); the corpus
`string` entry and the `aslens` string-literal sample join the shared corpus; and
seven unit tests in `test/strings.test.ts` cover layouts, conditional runtime
emission, literal byte encoding, interpolation order, the part restriction,
literal-pattern drops and the deferred `print`. Three tests that asserted
`No storage definition for String` now check successful lowering. Number
formatting was also checked against the evaluator on 150 random decimals of 1–19
digits across 50 decimal exponents, on C and Go.

Remaining phase-7 restrictions after this slice: `print` and `getInput` (done in
slice 3), interpolation of non-scalar parts, and the compiler command, runner
integration and host exports.

The execution harness now runs native C only (sanitized `-O0` and plain `-O2`);
Wasm execution compiled the same C through Emscripten and was dropped.

Validation: TypeScript and `git diff --check` pass. The regular suite reports 2203
passed, 756 skipped, no failures, all 38 snapshots passing (4750 assertions).
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes all 715 native cases
(2141 assertions, 265.92 seconds); `LAMINAR_EXEC=1 bun test test/go` passes 746
tests (785 assertions, 153.48 seconds). Remote CI was not run.

### Slice 3: runtime import registry (2026-11-20)

Work item 3: `src/runtime-imports.ts` unifies each import's source signature,
ownership conventions, host capability, backend implementations and semantics.
Type checking derives signatures from it, and the evaluator, C and Go all check
imports through `requireImport`, C and Go against the program's target runtime.
Every registered import is now implemented on all three: this slice adds `round`
(ECMAScript `Math.round`, exact for all doubles), `heapsize` (0), `print` and
`getInput` to C and Go. Host output shares stdout with the result protocol; programs
with host imports mark result lines with U+001E. Browser Emscripten has no `stdin`
capability, so `getInput` is rejected there at compile time. See
[the C backend](c-backend.md#phase-7-runtime-import-registry).

The evaluator's `print` now returns unit as `null`, as other unit values are; it
returned `[]`.

Tests: 16 runtime-import execution samples (`test/backend/runtime-import-samples.ts`),
whose `stdin` and expected `output` the harness checks on the reference, native C
and Go; and 19 unit tests in `test/runtime-imports.test.ts`: signature derivation,
convention checking, one probe per import for every claimed backend, capability and
unknown-import diagnostics, result marking and reference capture. A runtime-join test
that asserted `round` was unsupported now checks that it is reified.

Remaining phase-7 restrictions: interpolation of non-scalar parts, and the compiler
command, runner integration and host exports.

Validation: TypeScript and `git diff --check` pass. The regular suite reports 2237
passed, 772 skipped, no failures, all 38 snapshots passing (4803 assertions).
`LAMINAR_EXEC=1 bun test test/c/execute.test.ts` passes all 731 native cases
(2918 assertions, 276.10 seconds); `LAMINAR_EXEC=1 bun test test/go` passes 762
tests (801 assertions, 162.10 seconds). Remote CI was not run.

### Slice 4: compiler command and API (2026-11-20)

Work item 5: `src/compiler.ts` checks, specializes and emits C or Go
(`checkSource`, `compileSource`), and builds separately (`buildCompiled`).
`cli/laminar.ts` exposes `check`, `emit` and `run` with
`--target native|wasm32|go` (plus `reference` for `run`), `--optimize`,
`--sanitize` and `-o`. Targets are detected from their toolchains
(`src/backend/host.ts`). Errors are `CompileError`s with stage, stable code and
source position, reported as `file:line:column: stage error [code]: message`;
emitted symbol names are deterministic. See
[the C backend](c-backend.md#phase-7-compiler-command-and-api).

A sample program reading input, printing and returning a list ran with the same
output and result on the reference evaluator, native C, Go and Wasm through
`laminar run`.

Tests: ten in `test/compiler.test.ts`: typed IR from source, type and parse error
positions, deterministic C and Go emission, missing entries, mapped backend and
capability diagnostics, unknown targets, and the command line (`check`, `emit`,
reference `run` with stdin, usage errors). Native and Go builds and runs, runtime
traps and retained failed builds run under `LAMINAR_EXEC=1`.

This slice adds no lowering changes, so the execution corpora were not rerun.
Validation: TypeScript and `git diff --check` pass. The regular suite reports 2244
passed, 775 skipped, no failures, all 38 snapshots passing (4825 assertions);
`LAMINAR_EXEC=1 bun test test/compiler.test.ts` passes all 10 tests.

Remaining phase-7 work: backend selection in the test runner (slice 5), host
exports (slice 6), then documentation and the CI exit gate. Interpolation of
non-scalar parts remains a tested restriction.
