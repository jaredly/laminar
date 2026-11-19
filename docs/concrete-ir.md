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

## Dynamic callable tuple results

Dynamic calls may now return different recursive owned tuple descriptors.
Analysis joins each member's callable alternatives, while each selected body
retains its original tuple result ABI. An `adapt-aggregate-result` wrapper calls
that original ABI and transfers the materialized result through the same recursive
value adapter used by tuple branch joins. It allocates no additional environment
and disposes no extracted result. Invocation pointers retain exact concrete types.

Independent verification checks the original source wrapper/ABI, recursive endpoint
layouts and entry mappings, common member alternatives and `transfer-result`
ownership. C emission reuses the recursive typed compound-literal transfer path.
Sixteen shared cases cover both selections, nested/subset results, partial and
whole disposal, capture/parameter transfer, native members and returned lens
callees with thin/scattered arguments and type-changing restoration.

This removes the differing dynamic tuple-result restriction. Divergent branch
storage versions and callable focus aliases/projections, call/return contracts,
manual restoration and scattered focuses remain open. Phase 6 is incomplete.

## Divergent owned storage versions in ordinary branches

Ordinary value-producing branches may now leave owned locals with different
callable or recursive aggregate descriptors. Analysis retains `storageJoins` on
the case value annotation: each divergent place has ordered arm descriptors and
a canonical common result. Independent verification derives divergent-place
coverage and arm provenance from the bodies, checks the exact recursive union,
and propagates the common descriptor to subsequent reads, captures and swaps.

Concrete case `storageJoins` retain whole-place identities, exact per-arm recursive
value adapters and `transfer-selected-storage` ownership. C lowering converts live
contents of the selected arm before the existing typed storage merge. Empty
storage/projections remain empty, including values consumed or normalized away
by branch cleanup. No environment is copied, no extracted old value is disposed,
and no stale aggregate addresses or incompatible invocation-pointer casts are used.
Unused common descriptors are discovered even when no later invocation occurs.
The printer marks these contracts `selected-storage`.

Twenty-four shared samples cover both selections, unchanged arms, different capture
layouts, nested aggregates, nested joins/replacement, unused and consumed contents,
multiple owners, simultaneous callable results, captures/parameters and native/user
lens callees with thin/scattered arguments. Corruption tests cover analysis place
coverage, arm/result provenance, continuation reads, physical layouts, ownership
and invocation entry mappings.

Divergent storage inside lens-valued branches retains an explicit restoration-adapter
diagnostic. Callable focus aliases/projections, parameters/results, manual cleanup
and scattered focuses also remain open. Phase 6 is incomplete.

## Setup-only divergent storage in selected lenses

Lens-valued branches may now normalize divergent owned callable/aggregate storage
when their deferred arm restoration does not access the changed place. Inference
and independent serialized verification conservatively inspect nested cleanup,
protected manual dependencies, deferred slot accesses and restoration normalization.
Arm-specific deferred access still diagnoses
`Deferred callable storage use requires a restoration adapter`.

C setup applies the verified storage adapters before retaining each selected-arm
snapshot. Conversion temporaries participate in the existing lifting/heap-retention
machinery. Staging and completion preserve the current merged owner versions,
including replacements or consumption occurring after acquisition. Cleanup outside
the selection can use the common descriptor; arm-specific cleanup retains its
original ABI and is rejected when it depends on a divergent place.

Eighteen shared samples cover both selections, aggregate owners, intervening
replacement, unrelated selected cleanup, unused aliases, returned call backing,
outer cleanup consuming the common owner, mixed thin/scattered focuses and nested
selections. Corruption tests independently protect storage and lens adapter records
and owner provenance. No callable focus endpoint, pointer cast, environment copy or
new allocation convention is introduced. General callable focus restoration and
deferred arm access to divergent callable owners remain open; phase 6 is incomplete.

## Deferred consumption of selected callable storage

Selected lens arms may now consume or dispose divergent owned callable/aggregate
storage during deferred cleanup. Analysis marks the corresponding storage join
`restoration: 'consume'`. Independent verification derives that mode from deferred
slot accesses, cleanup actions and manual protected dependencies. Deferred
acquisition/replacement of the divergent owner retains an explicit diagnostic;
this slice does not infer new post-cleanup callable descriptors.

The concrete restoration contract records `retain-selected-storage`, exact ordered
original arm layouts and `restore-retained`, `cleanup`, `normalize` sequencing.
The common callable may have no invocation slots when all calls occur in deferred
arm code. Retaining the original typed storage preserves those original entries
without inventing dispatch slots or casting code pointers. Independent concrete
verification derives the retention layouts and ownership/order from verified
analysis and rejects altered contracts.

C setup retains each selected arm's logical storage before normalization. Staging
and completion temporarily restore that retained storage for original-ABI cleanup,
then normalize surviving contents through the existing forward adapter. Empty
slots remain empty. Staged state retains its current raw contents through outer
cleanup; returned contexts capture required original backing until completion.
There is one affine environment owner; no environment allocation/copy or extra
disposer is introduced. The printer marks these cases `retained-storage`.

Eighteen shared cases cover both selections, deferred calls, tuple consumption,
refill after cleanup, unused aliases, owned cleanup results, nested selections,
returned backing, staged outer cleanup ordering and returned staged backing.
Retention corruption tests cover original layouts, ordering, ownership and analysis
mode. Deferred replacement and general callable focus restoration remain open;
phase 6 is incomplete.

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

## Concrete cleanup storage transition contracts

Manual restoration contracts now reify analysis `cleanupStorage` as optional
`storageTransitions`: ordered whole-place identities, exact physical `before` and
`after` layouts, and `transfer-cleanup-storage` ownership. Independent concrete
verification derives this list from verified analysis, rejecting changed coverage,
places, endpoints or ownership before C emission. The diagnostic printer displays
both endpoint layouts and ownership. These describe replacement effects, not a
by-value conversion of the extracted old owner into its replacement.

The list is absent for descriptor-preserving cleanup, including consumption alone.
It does not encode availability, compose nested effects, or authorize a callable
ABI change in continuation code. See [the plan](c-codegen-plan.md) for the remaining
release-aware propagation and selected normalization requirements.

Direct lexical manual completion now applies verified descriptor transitions at
loan release or immediate swap before continuation analysis. Scope forwarding and
nested direct manuals preserve completion order. Independent verification derives
these boundaries and checks each transition's input provenance plus subsequent
reads. Lens tuples also compose captured member handlers in source order,
recursively through mixed/nested frontends and scope forwarding. This does not
generalize effects through selected cases; the corresponding restoration adapters
remain open. Calls now apply caller-side argument completion effects after plain
results and carry handlers on lens results until restoration. Forwarded results,
native `dup`/`fst`, and dynamic dispatch use the same boundaries. This does not add
callee-local effect summaries or callable focus endpoint ABIs.

Selected lens completion can now propagate enclosing owner descriptor changes
when all arm-result handlers finish with the same exact descriptor. Independent
verification derives arm agreement using current enclosing descriptors and retained
private setup state. Existing physical merge contracts suffice for equal layouts;
differing final descriptors require a post-cleanup adapter and diagnose explicitly.
The separate guard on deferred writes to divergent setup storage is unchanged.

## Post-cleanup selected storage joins

Representation case annotations carry optional `cleanupJoins` with ordered final
arm descriptors and a common result for each divergent enclosing place. Independent
verification derives coverage/provenance and the exact recursive union at completion;
records on uncompleted or unrelated instructions are rejected. Concrete case
`cleanupJoins` carry recursive per-arm adapters, `transfer-selected-cleanup-storage`
ownership, and `cleanup`, `normalize`, `merge` ordering. Verification derives these
from analysis independently. These adapters run after original-ABI cleanup and
before the final storage merge, including staged completion. The printer marks
`selected-cleanup-storage`. Setup `storageJoins` remain a separate contract;
deferred writes to divergent setup owners are still guarded.

## Retained replacement restoration

Setup storage join `restoration` can be `replace` as well as `consume`. Independent
analysis derives this mode from deferred accesses. Replacement completion uses each
retained original arm descriptor and requires a matching `cleanupJoins` entry even
when final arm descriptors are identical. An uncompleted replacement contract is
rejected. Concrete retained restoration marks replacement with
`normalization: 'post-cleanup'`: setup adapters normalize live staging contents;
final adapters normalize post-cleanup contents before merging. The setup adapter
must not be reapplied to newly acquired replacement storage. Independent concrete
verification derives the marker, retention layouts, final adapters, ownership and
ordering. Consumption restoration keeps its previous normalization convention.

Returned function variants derive private completion contracts on cloned state.
Scope-forwarded completion retains private local descriptors and overlays current
enclosing versions, propagating only enclosing effects outward. Independent
verification completes the returned handler before validating mandatory post-cleanup
coverage. This supports callee-local replacement inside returned contexts without
applying restoration effects to setup descriptors or changing the result ABI.
Unmodeled completion routes still fail required-contract checks.

Selected arm-local aliases preserve exclusive owners independently of manual escape
provenance. Immutable loan `owners` retain the actual outer storage; the existing
independent typed-IR comparison rejects missing/forged protections before concrete
verification or emission. Lens block completion retains lexical releases after its
frontend completion, so cleanup descriptor effects survive returned aliases. This
reuses existing concrete original/final adapters and returned backing contracts.


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


## Direct persistent alias endpoint contracts

`local-focus` now also describes a direct whole-local persistent alias acquisition.
Its `read` is the original owner descriptor and its `replacement` is the final
release-time descriptor, independently checked against verified whole-place loan
identity and current logical storage. Each swap through the alias has a separate
`local-focus` contract for its own read and ordered replacement. Representation
state tracks acquisition-to-owner identity across lexical clones without embedding
local addresses or places in representation keys. Direct loans retain their
original place and permit; computed lens backing remains separate.

Physical endpoint records retain the existing exact typed pointers and restoration
ABI; C direct aliases use logical views without materializing those records.
Deferred scalar-lens completion reuses the existing release handlers. Projections,
computed/manual/scattered callable endpoints and callable focus parameters/results
remain unsupported adapter work. Phase 6 remains incomplete.


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


## Physical manual callable endpoints

Manual restoration `kind` is `deferred` for semantic lens shapes or `local-focus`
for immediate callable-bearing frontends. With `local-focus`, `frontend` and
`result` are concrete endpoint-record layout IDs, each retaining its independent
read/replacement layouts and exact restoration ABI. The result replacement is the
installed input; the frontend replacement is derived after the manual's cleanup.
Nested manuals may therefore retain different replacement descriptors. Independent
analysis verifies their logical owner/path and endpoint provenance; independent
concrete verification derives the mode, layouts, storage transitions and ordered
stage/cleanup/dispose-result/restore/release contract. Printing exposes the pair as
`callable-endpoints`. This does not authorize computed persistent manual aliases,
scattered callable endpoints or callable lens call/return ABIs.


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


## Persistent manual callable alias completion

Computed loans may now borrow a forwarded `local-focus` backed by enclosing
logical storage. Analysis retains a private current descriptor for the loan place
and derives its final replacement at release. The release endpoint is independently
checked, transferred into the original frontend owner/path, and completed through
its existing physical manual endpoint contract. Semantic write types are retained
internally to distinguish callable/aggregate replacements from data-only final
storage. They are independently derived from semantic outputs, not serialized
claims. Loan owner protections continue to be checked by the unchanged typed-IR
verifier. No new physical record or C pointer convention is required. Scattered
callable endpoints, selected callable lens results, escaping private backing and
general callable focus call/return contracts remain separate work.


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


## Persistent scattered endpoint completion

`focus-tuple` and `focus-manual` computed loans initialize private read descriptors
and retain semantic write contracts. Release derives and independently verifies
the final alias replacement, propagates it to ordered recursive logical targets,
and only then executes retained member/manual completions. The existing physical
endpoint records retain original child ABIs through cleanup; no runtime owned
closure environment is copied. Exact computed loan owner protections remain
independently checked by typed IR. Callable focus call/return ABIs, selected lens
results and escaping private backing remain separate work.


## Phase 6: owned callable projection through native fst

Direct native `fst` calls on whole owned callable aggregates now retain the
projected read/installed replacement as explicit local-focus endpoints. Completion
reconstructs and independently checks the parent replacement descriptor through
its logical owner/path. Original sibling provenance and callable ABIs are retained;
C already projects the logical view. Non-direct completion and scattered inputs
remain separate boundaries. Three shared samples and a serialized read corruption
case pass. Validation: 1413 non-execution passes / 39 existing skips; 6 focused
native/Wasm cases; TypeScript and diff checks pass. Phase 6 remains incomplete.
