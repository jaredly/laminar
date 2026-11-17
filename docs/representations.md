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
