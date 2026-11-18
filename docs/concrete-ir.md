# Concrete IR and the phase 3 handoff

Phase 3 now produces a frozen, serializable `ConcreteProgram`. It retains generic typed IR for diagnostics and a verified semantic/representation snapshot, alongside emitted storage layouts, call ABIs, wrappers, representation-specific code records, entry names, and forward declarations. No source inference or legacy evaluator participates in this lowering.

## API

```ts
import { checkTypedFile } from '../src/check.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';

const { program } = checkTypedFile(file);
const concrete = compileConcreteProgram(program, target, [
    { unit: program.units.at(-1)!.id, arguments: [] },
]);
```

Expression roots have no incoming parameters. For a generic function root, `arguments` supplies concrete semantic types in quantified-parameter order and `parameters` supplies an incoming representation contract. Ordinary scalar/tuple arguments use `{ kind: 'data' }`. Lens arguments use `{ kind: 'lens', topology: { kind: 'thin' } }` or a recursive `{ kind: 'tuple', items: [...] }` topology. The API can export multiple representation variants of one semantic function in the same artifact. It does not guess an incoming lens topology.

Options include `maxInstances`, `maxVariants`, and `layoutDefinitions`. Generic bodies stay representation-polymorphic until concrete incoming contracts are available. `specializeProgram`, `inferRepresentations`, and `lowerConcreteProgram` remain available separately. The last accepts an already verified analysis for inspection or serialized handoff. `verifyConcreteProgram` independently validates a detached artifact; lowering invokes it before returning.

## Storage and lens ABIs

Storage descriptions select f64, boolean, unit, records, and tagged unions. Record fields explicitly distinguish by-value storage, typed data pointers, and typed code pointers. Unit and empty records have a one-byte inhabitant in C; they never require empty C structs. A tagged union has a `uint32_t` discriminator using zero-based declaration order, followed by its payload union. Emitters must use these conventions; actual C sizes, alignment, and field offsets are computed by the selected C compiler rather than invented by this pass.

Thin lenses contain a typed read pointer. Type-changing lenses additionally contain a separately typed replacement pointer. Scattered lenses contain recursively represented child lenses. Every lens also has an opaque restoration context pointer and a typed restoration code pointer accepting its concrete replacement layout and returning unit. Logical acquisition, storage operations, lexical permissions, and deferred cleanup remain explicit in the body; later phases implement their backing versions and restoration routines under this fixed ABI.

Registered nominal schemas have a name, generic parameters, record/union kind, and named typed fields. `indirect: true` makes a field a pointer edge. Layout interning reserves recursive names before expanding fields, and emits forward declarations. The verifier follows by-value edges to reject infinite storage, while permitting pointer-recursive containers. Expansion budgets reject changing generic recursion. Constructor signatures must agree with the schema's record fields or union payload types. Registration describes storage only; it does not implement allocation, destruction, or runtime constructors.

## Callable ABI and wrappers

Every invocation ABI receives an opaque environment pointer before its concrete arguments, and returns its concrete result by value under the target's C11 ABI. Environments have explicit capture field layouts. A callable value owns one environment pointer, a typed disposer pointer, and a finite set of typed invocation pointer fields. Each field corresponds to a discovered concrete call contract. A call selects a fixed field, emitted wrapper, and ABI; it never casts between incompatible code pointer types.

This finite slot representation allows one reified generic function value to supply thin and scattered invocation ABIs without erasing them. It is a concrete baseline with extra pointer fields, not the future optimized single-entry closure ABI. The invocation slots are known at compile time. Phase 6 adds `callable-choice`
analysis descriptors: sorted, deduplicated sets of user-defined or native callable
alternatives. Each dynamic call records one target variant per alternative and
requires common incoming argument representations. Returned callable descriptors
may normalize through result adapters. Nested branch joins
flatten their alternative sets; the finite slot requirements propagate into
narrower joined wrappers as well as concrete member wrappers.

A joined callable uses an opaque data-environment pointer and the selected
concrete disposer and invocation code pointers. `dispatch` wrapper records retain
the ordered member/wrapper coverage and `selected-environment` ownership;
`callableJoin` on each concrete case records the exact field-to-field adapter.
These records describe copying typed code pointers, not a runtime tagged union or
an incompatible function-pointer cast. Branch conversion moves the selected owned
environment without allocation. An unused choice has no invocation entries and
still carries the selected disposer. Native alternatives retain their registered import contracts and null environments.
The C backend reifies supported intrinsics into exact typed wrappers when a join
needs them. When alternative bodies return different callable descriptors,
`adapt-result` wrappers retain each source invocation ABI and move its result into
a common callable layout using verified entry mappings. The source body still
returns its original layout; the adapter has the common result ABI. Its
`transfer-result` ownership neither allocates nor drops that result. Raw invocation
contracts stay present alongside adapted contracts in the finite slot table.
Independent verification checks both ABIs, source code, canonical result members,
source/destination layouts, and every invocation field mapping.

Differing lens results normalize to a thin focus with the semantic read/replacement
endpoints. `adapt-lens-result` wrappers retain the raw source wrapper and original
lens shape, and specify `restore-source-and-release` ownership and ordering. The
C emitter stores the raw lens and normalized focus in a heap context; restoration
passes the replacement through the original callback (or writes its recursive
backing for native views), then releases the context. Source and common call ABIs
remain distinct and exact. Verification checks both shapes, identical endpoints,
the thin destination and the source wrapper/ABI. Unsupported import implementations
retain their diagnostics.

Invocation wrappers recover their exact environment type, transfer affine captures into the body, and free the environment before entering the body. Disposer wrappers drop remaining captures and free an unused environment. Native wrappers use a null environment and retain a concrete argument/result ABI. `make-callable` remains an operation even for top-level functions; these values are not all rewritten to direct calls.

If a callable is only constructed and discarded, it has a concrete environment/disposer layout and no invocation fields. Its uncalled body is omitted. This is an explicit invocation-erasure rule: it preserves construction, capture transfer, and disposal; it neither erases capture layouts nor supplies an unresolved callable ABI. Tests cover this case. Global binding schemes remain diagnostic metadata in the generic snapshot rather than executable storage.

## Cache identity and verification

Physical identities include canonical target configuration, normalized nominal definitions, semantic types, recursive lens representations, and concrete callable field ABIs. Generic parameter spelling, source-local place IDs, object property order, and reachable traversal order do not select different caches. Code and invocation-wrapper names also include the reachable representation graph, because a callable's finite invocation slot set can change across entry sets. Names are deterministic SHA-256 identifiers, and forward declaration lists cover layouts, ABIs, and code.

The independent concrete verifier first validates semantic IR and representation constraints, then checks physical layout fields and dependency cycles, canonical ABIs, wrapper ownership/environment contracts, invocation slots, code parameters/captures, complete instruction correspondence, every output layout, call targets, entries, and forward declarations. Missing or inconsistent concrete records raise `invalid-concrete-ir`. It never calls the lowering pass to recreate its answer.

The phase 3 exit gate is satisfied for accepted inputs: every emitted value and function has a resolved layout/ABI and every invocation refers to an emitted wrapper and code specialization or a declared concrete native wrapper. Unsolved reachable types, unknown nominal layouts, unsupported changing recursion, recursive returned representations without a solvable result constraint, host-callable entry arguments without a host contract, and divergent joins produce diagnostics rather than incomplete artifacts.

## Phase boundary

Tests validate the concrete transformation and its independent verifier, including the phase 4–6 acceptance inputs and a registered recursive list schema. They do not execute concrete IR or generated C/Wasm. Phase 4 now consumes this artifact through the [C backend](c-backend.md), with separate storage lowering, syntax printing, and native/Emscripten execution. Phase 5 adds typed backing versions, aggregate reconstruction and generated restoration contexts for returned lenses. Callable focus storage, general heap data/runtime coverage, and optimization remain open. The explicit unsupported recursive-result and host-callable contracts must remain diagnostics until additional constraints or host adapters are available.

## Readable output

The diagnostic printer builds lexer nodes, like `lexpr`, and uses the existing lexer's formatting rules:

```ts
import { stringify } from '../parser-generator/lexer.ts';
import { lconcrete, printConcreteProgram } from '../src/print-concrete.ts';

console.log(stringify(lconcrete(concrete)));
// Equivalent convenience API:
console.log(printConcreteProgram(concrete));
// Trace back to canonical identities and retained source origins:
console.log(printConcreteProgram(concrete, { ids: 'full', origins: true }));
```

The default view uses `L0`, `abi0`, `wrap0`, source-named functions such as `id0`, SSA values such as `%0`, and source-named places such as `$x`. Names are local to the printed artifact/function and do not change canonical IR identities. Shadowed places get distinct names. Layouts, forward declarations, ABI signatures, callable slots, ownership conventions, captures, projections, loans, block returns, and cleanup remain visible; generic snapshots and cache keys are omitted. `cleanup after-restore` distinguishes deferred lens cleanup from ordinary block cleanup. This view is diagnostic, not a round-trip IR serialization format. Complete expected-output examples are inline in `test/print-concrete.test.ts`.

## Selected lens branches

A flow-valued `case` carries `lensJoin: { kind: 'selected', arms, result }`.
The ordered `arms` entries are the source lens shape IDs; `result` is a thin
focus with the common read/replacement contract. Shapes may differ across arms.
The arm's `setup` and `restored` normalization edges are retained alongside its
body and checked independently against typed IR. The concrete verifier derives
all adapter shapes from verified representation annotations and rejects missing
or altered contracts. The diagnostic printer shows `selected-focus`, every arm's
topology, and nonempty normalization edges.

C lowering retains the selector and original restoration operations. It copies
the selected read focus into common logical storage, commits its final contents
only through the selected restoration, then merges the owner versions. Returned
lens contexts capture the selector and required branch storage; only selected
backing is allocated or released. Owned moves now mark logical storage empty,
so setup availability normalization agrees with typed verification. Native
strict/optimized/sanitized and Emscripten/Node execution cover these adapters;
dynamic callable joins and nominal/runtime data retain their existing restrictions.

## Deferred manual restoration

A concrete `manual` operation retains its frontend lens, protected logical slot
references, and a recursively lowered cleanup block. Its `restoration` record
retains frontend/result representation shapes, the required sequence (`stage`,
`cleanup`, `dispose-result`, `restore`, `release`), and retention through enclosing
cleanup. These are serialized lowering obligations, not allocated C contexts.
Independent verification checks the contract against verified typed IR and
representation analysis, including cleanup output ownership, complete instruction
coverage, layouts, and concrete invocation wrappers. The callable indexers and
diagnostic printer include deferred cleanup regions. C lowering implements staged
manual restoration for the tested scalar/tuple subset using logical storage and
retained returned-lens contexts. Known captured cleanup callbacks execute through typed environments in the tested
C/Wasm subset; callable focus storage retains its explicit backend restriction.

## Pattern-bound temporary focuses

`aslens` cleanup patterns reuse retained manual restoration. Setup
allocates owned backing; deferred cleanup transfers the staged final contents into
owned pattern bindings and disposes its result and remaining locals before backing
release. Elaboration records the backing identity and lifetime phases. Typed IR uses
existing `scope`, `acquire`, `manual`, `move`, and `bind` instructions; representation
and concrete lowering retain the same manual contracts and physical context adapter.
The 21 shared scalar/tuple samples in `test/backend/aslens-samples.ts` cover detached verification
and execution plus native strict/optimized/sanitized C and Wasm at both optimization
levels. Constructor and literal cleanup patterns additionally use a single-arm
`case` over the final contents, trapping before the body if no pattern matches.
Constructor/list cases execute through checked legacy and detached typed paths;
nominal physical layouts and callable focus storage retain their separate
restrictions.

## Borrowed-pattern reconstruction

Borrowed matches and constructor aliases normalize to owned private pattern storage
and retained manual field focuses. The selected IR pattern retains its reconstruction
owner and identity; the deferred manual retains the corresponding pattern contract.
Independent typed verification requires exactly one matching reconstruction, preserving
constructor tags, literals, field identities and the whole-owner swap. Generic
ownership checks still require field refill and protect the original owner. Concrete
lowering retains this contract and verification checks it against semantic IR.

The scalar/tuple borrowed-match cases in `test/backend/borrowed-pattern-samples.ts`
execute through the existing C/Wasm manual adapter. List patterns execute in checked
legacy and detached typed paths; physical list lowering retains the explicit
`unsupported-layout: No storage definition for List` restriction. Captured invocation
and callable storage restrictions are unchanged.

## Owned callable aggregate storage

Representation analysis retains `aggregate` descriptors for source tuples with
callable members, recursively preserving member provenance through construction,
projection, owned patterns, parameters, captures and results. These descriptors
participate in canonical specialization keys and independent serialized
verification. Data-only tuples retain semantic data layout IDs.

Concrete lowering recursively discovers member callables and interns a record
whose `itemN` fields have the corresponding concrete member layouts. Physical
identity includes the complete ordered list of member layout IDs, so different
invocation-slot requirements cannot accidentally share an aggregate ABI.
Independent concrete verification derives this identity and every field from the
verified representation descriptor; altered member layouts, pointer/value kinds
and ordering fail before emission. Typed function arguments/results and capture
environments use those exact aggregate records.

C lowering uses its existing logical cell/projection model for tuple transfer,
partial moves, reconstruction and recursive disposal. Destructuring consumes
members once; unused members and unused capturing closures dispose owned
environments through the existing typed disposer fields. No callable environment
is duplicated and no new function-pointer casts are introduced.

Callable focus read and replacement representations must still be retained
independently across logical storage versions and restoration. Existing lens
shape endpoints contain semantic data layouts only and intentionally continue to
reject callable storage. Differing aggregate joins and recursive aggregate
results requiring unsolved constraints remain diagnostics. Physical nominal
containers and callable host roots also retain their separate restrictions.

## Direct owned-local callable focus contracts

A `local-focus` analysis descriptor retains independent `read` and
`replacement` value representations for a direct whole-owned-local swap. It is
distinct from the semantic-layout lens shape table. Read provenance comes from
the current owned place; replacement provenance comes from the ordered RHS.
Both descriptors participate in canonical representation keys. Neither contains
a caller address or logical place ID. Scope exit propagates current owned
representations to enclosing places; divergent branch versions diagnose an
unsupported adapter.

Its physical record is keyed by the two concrete endpoint layout IDs. It has
typed read and optional distinct replacement pointers, an exact replacement-to-unit
restoration code pointer, and an opaque context pointer. Independent verification
derives all fields and the restoration ABI from verified descriptors, and verifies
that the acquisition has one direct same-block swap consumer on a whole owned
place. The old swap result retains the read descriptor; the place receives the
RHS descriptor. The C local swap path uses logical views without materializing
these pointers.

This descriptor is intentionally not a general lens shape: callable focus
parameters/results, persistent aliases, projections, lens tuples and manual
cleanup still require representation-aware restoration adapters. They remain
explicit diagnostics. General callable focus replacement is not complete.

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

## Branch joins of callable tuples

Owned tuple branch results may now differ recursively in callable provenance.
Analysis joins corresponding members, preserving unchanged data and canonical
callable alternative sets. A concrete `aggregateJoin` retains one recursive
adapter per arm, exact source/destination layouts, typed callable entry mappings,
and `transfer-selected-result` ownership. Independent verification derives the
expected adapter and rejects changed endpoints, member order, entries or ownership.
The diagnostic printer marks these cases `selected-aggregate`.

C lowering reconstructs only the selected result, moving each environment,
disposer and exactly typed invocation field once. It adds no allocation or
function-pointer casts. Existing aggregate capture, parameter/result transfer and
recursive disposal paths handle the normalized tuple. Fourteen shared samples
cover nested tuples, nested subset joins, partial and whole disposal, captured
parameters, returned tuples and native/user lens callable members, with both
branch selections.

Differing tuple results of dynamic calls still require a result adapter; divergent
branch storage versions and callable focus restoration retain their explicit
restrictions. This implements tuple branch-result joins, not general callable
restoration or the phase-6 exit gate.
