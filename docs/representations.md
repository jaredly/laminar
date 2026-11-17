# Concrete layout and lens representation foundations

`LayoutTable(target)` interns storage descriptions for `Number` (f64), `Bool`, unit, and nested tuples. `intern(type)` returns a structural, target-specific ID, `get(id)` reads a frozen record, and `snapshot()` returns a deterministic dependency-first list. The table clones semantic types rather than freezing caller-owned input. It rejects unresolved variables, nominal data without a storage definition, and functions without a closure ABI. Physical size/alignment decisions remain for later backend work.

`RepresentationTable(layouts)` interns concrete lens shapes:

- `thin(read, replacement)` describes one aggregate location with explicit read and replacement backing layouts. Equal endpoints permit same-layout access; different endpoints require separate slots. This is an access contract, not an assertion that every thin lens fits into one pointer.
- `tuple(items)` describes scattered locations recursively. Its semantic endpoints are tuples of its children's endpoints. A thin tuple and a scattered tuple have different representation IDs even when both endpoint types match.
- `project(id, index)` preserves an existing scattered child's representation or projects a thin aggregate to a thin component. This describes the resulting shape; physical reconstruction and restoration operations are still to be lowered.
- `join(ids)` returns an identical shared representation or reports `unsupported-representation-join`. It never selects a shape based on discovery order.

IDs encode complete canonical structures rather than short hashes. They are cache identities, not C identifiers. Records contain no source place IDs. A foreign table's ID is accepted only if the receiving table already contains that same canonical structure. These APIs contain concrete records only; symbolic constraints and their instantiation will be introduced by specialization.

The APIs currently stand alone. They neither transform typed IR nor establish concrete function ABIs. See [the implementation record](backend-progress.md) for remaining phase 3 work.

## Reachable semantic specialization

`specializeProgram(program, target, roots, { maxInstances? })` consumes verified generic typed IR. Each root is `{ unit: unitId, arguments: concreteTypes }`; type arguments follow the unit signature's quantified-parameter order. Roots may select expressions or definitions. At least one explicit root is required. The result retains a detached frozen `generic` snapshot, a verified specialized `program`, root instance IDs, and a deterministic list of semantic instance records/dependencies.

The pass substitutes retained semantic arguments throughout each reachable unit, rewrites user-definition references to monomorphic definitions, and emits dependencies before consumers. It reserves cache entries before examining bodies, so ordinary recursion reuses an instance. Changing-specialization recursion is explicitly unsupported. The instance budget (default 256, including import instances and roots) reports the definition chain and aborts rather than returning an incomplete graph. Unresolved local annotations also fail; this pass has no generic-erasure rule.

Keys include the canonical target, definition identity, and structural concrete arguments in declaration order. Quantified-variable names and argument-list insertion order do not affect instance reuse. SHA-256 digests provide deterministic identifier names. Unused top-level definitions and imports are omitted. All local functions inside a reachable unit remain subject to specialization, including unused local closures.

Global binding schemes are removed from specialized unit metadata because they describe generic provenance rather than executable storage; they remain available in `generic`. Referenced native/constructor import schemas remain generic in `program` so the existing verifier and reference runner can consume it; their concrete instances are recorded separately. First-class global values remain global instructions rather than being rewritten into direct calls. With one expression root, the existing typed reference runner can execute `result.program` for differential testing. Multiple roots describe a compilation reachability set, not a new executable entry or effect-order convention.

This is semantic specialization only. Representation arguments are not yet part of its keys. Thin/scattered call variants, representation constraints, callable wrappers, physical ABIs, and the independent concrete-IR verifier remain future work. Lists, strings, and closures passing reference execution here do not establish physical layouts or native/Wasm execution support.

## Representation analysis over reachable semantic IR

`inferRepresentations(specialized, { maxVariants? })` verifies a detached semantic program and analyzes its expression roots. It returns layout, backing, and recursive lens-shape tables; per-entry temporary/call annotations; and function variants with argument, capture, temporary, call, and result representations. Equal incoming representations reuse a variant. Keys include the target, semantic unit/function identity, and recursive argument/capture representations. A thin aggregate argument and a scattered tuple argument select different variants even when their semantic endpoint types match.

Acquiring an owned place produces a thin shape. Acquiring a lens parameter projects its incoming shape; endpoint changes revise its backing layouts while preserving topology. Lens tuples preserve mixed recursive shapes. Function bodies are analyzed when a known callable is invoked, with its incoming arguments and captures. Known first-class callables can pass through bindings, parameters, captures, and results. User-returned lenses propagate their inferred shapes to consumers; `native/fst` has an explicit projection contract. Scalar/tuple results can be reserved before recursive body analysis. Recursive returned-lens/callable results that need additional constraints are diagnosed rather than guessed.

The analysis budget defaults to 256 function variants. Changing-representation recursion and budget exhaustion report a call chain. Divergent callable/value joins require adapters and fail explicitly. Callable roots require an explicit incoming argument contract and are currently unsupported. Nominal storage, including strings and lists, remains unsupported. No dead local callable bodies or dynamic joins are silently assigned an opaque ABI.

This output is an analysis graph over the semantic IR, not rewritten executable concrete IR. Callable descriptors identify known functions/environments; they do not define physical closure layouts or indirect-call ABIs. Native call targets remain named imports with concrete argument/result annotations. Symbolic generic-body constraints, reified callable wrappers, a standalone concrete-IR verifier, recursive nominal layout definitions, and emission of representation-specific code records remain open. Tests cover representation inference and graph structure; they do not execute the analysis graph or generated C/Wasm.
