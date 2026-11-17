# Concrete layout and lens representation foundations

`LayoutTable(target)` interns storage descriptions for `Number` (f64), `Bool`, unit, and nested tuples. `intern(type)` returns a structural, target-specific ID, `get(id)` reads a frozen record, and `snapshot()` returns a deterministic dependency-first list. The table clones semantic types rather than freezing caller-owned input. It rejects unresolved variables, nominal data without a storage definition, and functions without a closure ABI. Physical size/alignment decisions remain for later backend work.

`RepresentationTable(layouts)` interns concrete lens shapes:

- `thin(read, replacement)` describes one aggregate location with explicit read and replacement backing layouts. Equal endpoints permit same-layout access; different endpoints require separate slots. This is an access contract, not an assertion that every thin lens fits into one pointer.
- `tuple(items)` describes scattered locations recursively. Its semantic endpoints are tuples of its children's endpoints. A thin tuple and a scattered tuple have different representation IDs even when both endpoint types match.
- `project(id, index)` preserves an existing scattered child's representation or projects a thin aggregate to a thin component. This describes the resulting shape; physical reconstruction and restoration operations are still to be lowered.
- `join(ids)` returns an identical shared representation or reports `unsupported-representation-join`. It never selects a shape based on discovery order.

IDs encode complete canonical structures rather than short hashes. They are cache identities, not C identifiers. Records contain no source place IDs. A foreign table's ID is accepted only if the receiving table already contains that same canonical structure. These APIs contain concrete records only; symbolic constraints and their instantiation will be introduced by specialization.

The APIs currently stand alone. They neither transform typed IR nor establish concrete function ABIs. See [the implementation record](backend-progress.md) for remaining phase 3 work.
