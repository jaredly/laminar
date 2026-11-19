# C backend: phases 4–6 subset

`src/c/lower.ts` consumes independently verified concrete IR. It resolves logical
places, projections, thin/scattered lenses, typed storage versions, and restoration
into a statement tree. `src/c/storage.ts` retains logical cell/path identities
independently of C aggregate versions. `src/c/syntax.ts` only formats that tree; it does not infer
storage, inspect source, or execute language code. `emitC` composes these passes.
Building and running are separate operations in `src/c/build.ts`.

```ts
import { emitC } from '../src/c/emit.ts';
import { buildAndRun } from '../src/c/build.ts';

const source = emitC(concrete);
const results = await buildAndRun(source, {
    compiler: 'clang',
    optimize: true,
});
// For a concrete program compiled with wasm32Emscripten(actualVersion):
// buildAndRun(source, { compiler: 'emcc', wasm: true, node: 'node' });
```

The generated translation unit includes concrete scalar/record types, typed ABI
pointer declarations, prototypes, direct function bodies with the
opaque environment argument, and a test-only `main` adapter. Each expression
entry prints one JSON result line. Special doubles use the backend contract's
tagged number protocol. This is not a public host ABI.

The executable subset supports Number (`double`), Bool, inhabited unit, tuples,
first-match control flow, unmatched-case aborts, direct calls and recursion,
thin and recursively scattered lenses, moves, swaps and refills. Empty swap
results become unit without loading storage. Full swaps save the old value
before installing a replacement. Ordered IR temporaries sequence all effects.

Phase 5 gives each logical place a current typed storage version. A view retains
its logical cell and projection path; replacing a field updates that mapping,
rather than leaving aliases pointing into the old physical aggregate. Reads
reconstruct aggregates from the current component versions, preserving unaffected
fields with their original types. Branches merge versions through typed temporaries.
No layout sizes, offsets, union punning or incompatible pointer casts are used.

Each lens call adapts the caller's logical view into concrete typed read and
replacement backing. Homogeneous backing can share one typed buffer; different
layouts use independent buffers. Plain-result calls use stack backing and commit
output immediately afterward. Lens-result calls allocate backing on the heap:
that backing can outlive the call frame and stays owned until restoration.

A function returning a lens allocates a concrete residual context. Its read focus
is materialized in that context; only values referenced by deferred restoration
are captured. A generated function with the exact concrete restoration ABI accepts
the replacement, rebuilds the parent aggregate, runs deferred cleanup, writes the
parameter outputs, and releases the context. Nested returned calls retain heap
backing through the whole chain, copy outputs before releasing it, and restore
in source order. Native `fst` is an explicit logical projection; user-defined
lens functions execute real calls and typed restoration routines. Lexical alias
release uses the same cleanup path.

The entry adapter checks the number of live restoration/backing allocations is
zero. Allocation failure traps. Native sanitizers additionally detect invalid
access and double disposal, with stack-use-after-return detection enabled and
undefined behavior configured to stop execution.

User-defined function values carry concrete typed code pointers, including
capture-free values (with a null environment and disposer). Calls use the verified
callable entry field and environment; there are no incompatible code-pointer casts
or static code-symbol rewrites at invocation. Native intrinsics retain their
explicit storage lowering contracts.
Captured callable values use concrete typed heap environments. Invocation copies
captures into owned locals and releases the environment before executing the body;
returned restoration contexts retain any locals needed later. Generated disposers
recursively dispose captured callable values and release unused environments.
Wildcard bindings, scope cleanup, branch normalization, and manual cleanup results
all run the corresponding disposal paths. Compatible branch-selected user-defined
closures normalize to an erased environment pointer, the selected disposer, and
exactly typed invocation fields. Each alternative keeps its own capture layout;
only the selected branch allocates or invokes an environment. Nested joins,
returned and captured joined callees, and thin/scattered lens arguments and
returned focuses use the same ownership and restoration paths. There is no extra
join allocation or function-pointer cast.

Callable focus storage/replacement, nominal/heap data, and unsupported native imports retain
explicit diagnostics. Dynamic callable entry roots require a host
adapter. This remains partial phase-6 support.

Implemented imports are numeric `+`, `-`, `*`, `/`, `==`, `>=`, `<=`, data `dup`,
and logical `fst`. `dup` of a computed focus restores that focus after copying it.
There is no evaluator fallback. Function roots with parameters need a future host
adapter, and borrowed lenses cannot escape the test entry boundary. Raw owned-local lenses cannot escape through function returns. Borrowed matching
uses scoped reconstruction; its scalar/tuple subset is supported, while nominal
list/variant data still requires physical storage adapters. Explicit manual
restoration now supports the tested scalar/tuple subset on C/Wasm. Its lens
adapter separates staging from completion: final contents reach the selected
owner before cleanup reads them, and original restoration runs afterward.
Returned contexts retain owned temporary focuses and deferred cleanup state;
late callback expressions execute at restoration. Known capture-free and captured callbacks are supported for the tested subset;
callable focus storage retains its representation restriction.
The 23 shared manual samples cover tuple staging, both branch selections, nested
ordering, returned owned focuses, owned callback parameters/results, late cleanup,
and unused/duplicated focuses. Lens-valued
branches normalize their focus into thin storage and retain a selector plus each
arm’s original restoration operation. Only the selected arm runs setup,
normalization, and cleanup. Deferred branch variables are initialized outside the
conditional and captured when a returned lens needs them; escaping call backing
remains heap-resident. Thin/scattered joins, nested local storage, selected setup
effects, and type-changing replacements execute on native C and Wasm. Persistent computed aliases retain their
focus and restoration operation until lexical release; thin, scattered, nested,
and type-changing cases are exercised by the execution harness.
Malformed concrete IR fails verification before storage lowering.

The harness uses strict C11 (`-Wall -Wextra -Werror -pedantic`), `-O0` and `-O2`.
Native tests additionally use ASan/UBSan and stack-use-after-return detection. It removes inherited host include-path
injection when spawning tools, so Emscripten uses its own sysroot. Failed builds,
traps, malformed results and expected-result mismatches retain their temporary
`laminar-c-*` directory, generated C/JS/Wasm, exact command arguments and observed
compiler/runtime versions. Successful runs remove their directories.

Run `bun test test/c` for the backend tests, `bun test` for all regressions, and
`bunx tsc --noEmit` for TypeScript checks. Missing local compiler/runtime tools
produce explicit execution skips; `CI` makes them failures. Tests copy the local
Emscripten cache to writable temporary storage when `EM_CACHE` is unset, removing
relocation-sensitive build files. Set `EM_CACHE` to an existing writable cache to
reuse it. The relocated Homebrew cache disables batch library builds to avoid
its relative-path issue; assertions are enabled for Wasm runs.

`.github/workflows/backend.yml` provisions Emscripten 4.0.23 from emsdk commit
`c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56` (the release mapping selects the
compiler build), Node 24.13.1, and Bun 1.4.2. The required job executes the full
native/Wasm corpus and uploads failure artifacts. This configuration is checked
in; remote CI execution and branch-protection requirements are not established
by local verification.

Complete expected C output for tuples, thin/scattered calls, returned lenses,
and branch version joins is inline in `test/c/print.test.ts`. Execution tests
compare typed IR, native and Wasm with the same expected results. In addition to
the phase-4 corpus, cases cover Number/Bool and small/large transitions, nested
mixed shapes, offset-changing aggregate reconstruction, `take`, `map`, native and
user-defined focus assignment, repeated and nested returned calls, alias refill,
discarded captures, computed-focus `dup`, branch changes, and empty/unit lenses.
Captured callbacks and corrupt concrete artifacts have positive execution and
negative verification tests.

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
`unsupported-layout: No storage definition for List` restriction. Callable storage restrictions are unchanged.

## Captured cleanup environments

`test/backend/captured-cleanup-samples.ts` adds nine shared cases for captured
callback parameters, callbacks returned by functions, late construction, nested
callables, owned closure results, wildcard/unused disposal, and both branch
selections. They run through checked legacy and detached generic/specialized typed
execution, independent serialized concrete verification, and the strict native /
Wasm execution harness. The existing phase-6 `closure` and `capture-restore`
examples also execute in that harness. Allocation accounting checks all environment
and restoration allocations are released; native sanitizers check invalid accesses.
`test/captured-cleanup.test.ts` retains complete generated C inline and rejects
corrupted capture layouts, environments, invocation ownership, and disposal layouts.

## Typed indirect invocation

`test/backend/indirect-call-samples.ts` covers returned captured closures passed
through higher-order parameters, captured callbacks taking thin and scattered
lenses, and an indirect lens-returning call. These share the strict native,
optimized, sanitizer and Emscripten/Node harness. The full existing execution
corpus now invokes user-defined functions through typed entry fields, including
recursive calls and restoration-bearing calls. Closure environments retain the
existing transfer-on-invoke and drop-unused ownership convention.

## Runtime callable joins

`test/backend/callable-join-samples.ts` supplies 23 shared samples covering both
branch selections, distinct capture structs, captured/capture-free alternatives,
returned joined closures, deferred cleanup callbacks, unused nested closures,
nested subset joins, alias
capture followed by refill, and higher-order thin/scattered calls carrying or
returning lenses. A single-artifact case also exercises both thin and scattered
invocation entries on the same joined callable. Callable and lens results normalize through typed result adapters. The compiler emits all reachable alternatives and uses the
selected runtime code pointer; specialization does not pick a branch. Independent
analysis/concrete verification checks canonical alternative sets, target coverage,
exact argument/result ABIs, environment ownership, and every branch entry mapping.

## Native intrinsic alternatives

Runtime callable joins also accept native intrinsics with C implementations. Native
members receive exact typed wrappers and null environments/disposers. Ordinary
intrinsic calls retain their existing storage lowering. `dup` wrappers read thin
or recursively scattered backing; `fst` wrappers return a projected view and
preserve all untouched fields in separately typed replacement backing. The
caller owns completion and the lifetime of escaping backing, using the same
restoration path as a selected user closure.

`test/backend/native-join-samples.ts` adds 19 shared differential/execution samples
for native/user selection, returned closures, capture and unused disposal,
nested subset joins, thin/scattered `dup` and `fst`, size-changing replacement,
nested returned focuses, unit focuses, and two lens ABIs in one artifact. The
nested direct `fst` regression also checks that the typed reference interpreter
lets the call boundary own argument completion, preventing duplicate restoration.
Native wrappers have the same target-aware ABI and verification as user members;
unsupported imports such as `round` still diagnose explicitly during C lowering.

## Dynamic calls returning different closures

Dynamic callees can return distinct user/native callable descriptors. Inference
joins their result alternatives while retaining each body's original result ABI.
Concrete `adapt-result` wrappers call the selected body with that ABI and move its
returned environment, disposer, and mapped invocation entries into the common
callable layout. The adapter neither allocates nor disposes the returned
environment. Both its source ABI and common destination ABI remain exact C
function-pointer types. Nested callable results and narrower result choices
compose through the same adapters. Differing lens-result shapes use the separate
restoration adapter below.

Nineteen shared samples in `test/backend/callable-result-samples.ts` cover both
selections, differing capture environments, unused results, nested results, native
results, subset joins, returned lens callees with both pointer forms, both lens
ABIs in one artifact, and alias capture/refill. Corruption tests independently
reject altered source wrappers, source/destination layouts, ownership, field
mappings, and ABIs before emission.

## Dynamic calls returning different lens shapes

Different thin/scattered result shapes normalize to a thin result ABI. A generated
`adapt-lens-result` wrapper invokes its source using the original result ABI and
allocates a context containing that result plus a materialized typed focus. Its
restoration helper sends the final replacement through the retained original
callback, or writes recursive native backing when no callback is present, then
releases the normalization context. Caller-owned escaping argument backing stays
alive until this restoration completes. Neither code-pointer casts nor pointers
to local parameter objects are used.

`test/backend/lens-result-samples.ts` supplies 18 shared samples covering both
selections, thin/scattered and native views, homogeneous and type-changing
replacements, empty focuses, captured callees, cleanup, nested forwarding, and
unused alias release. Independent verification checks the original call ABI, both
shapes and endpoint layouts, a thin normalized destination, restoration ownership
and source-before-release ordering. Corrupt contracts fail before C emission.

## Owned callable tuples

Owned source tuples now carry recursive concrete `itemN` fields selected from
member descriptors, including exact callable code/environment/disposer layouts.
The existing C storage `Cell`/`View` version model transfers these records through
parameters, captures and results, projects moved members, and recursively disposes
unused members or unused closures capturing an aggregate. Partial moves empty
their logical projection before scope disposal. Tuple storage does not require a
new allocation; each captured callable retains its existing environment ownership.

Twelve shared cases in `test/backend/callable-storage-samples.ts` cover nested
captures, parameters/results, partial moves, unused aggregates and capturing
closures, joined/native members and thin/scattered lens callees stored in tuples.
The execution harness checks strict/optimized/sanitized native C and both Wasm
optimization levels; serialized corruption tests reject altered field layouts,
kinds and order before emission.

Callable focus storage remains separate work. Its adapters need distinct
read/replacement descriptors and restoration through the current logical version,
with escaping backing retained until completion. Differing aggregate joins and
nominal storage keep their existing diagnostics. Phase 6 remains open.

## Direct callable swaps

Direct swaps of whole owned locals now preserve independent callable or aggregate
read/replacement descriptors. The existing logical C swap saves the old value
using its original layout, installs the ordered RHS with its own layout, and
updates the current cell version. Later moves and drops use that version.
Nested lexical scopes propagate descriptor changes outward. Unused extracted
values and unused replacements follow their own typed disposal paths.

Ten cases in `test/backend/callable-focus-samples.ts` cover replacement across
different closure environments, callable/data changes, empty-slot refill,
unused values, repeated swaps, whole tuple replacement, nested scope changes and
joined replacements. No C environment copy, incompatible invocation-pointer cast
or retained pointer into expired stack storage is introduced.

Persistent aliases, projected callable focuses, callable focus call/return ABIs,
manual restoration, scattered callable focuses and divergent branch storage
versions remain explicit adapter work. Phase 6 stays open.

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

Manual cleanup descriptor changes are now retained as independently verified
analysis `cleanupStorage` transitions (see [concrete IR](concrete-ir.md)). They
record endpoints for future restoration adapters; C lowering does not use them
to relax deferred replacement restrictions. Four additional shared execution
samples cover callable and aggregate cleanup replacement, old-value invocation,
and unused replacement disposal. General post-cleanup propagation and selected
replacement remain open phase-6 work.

Concrete manual restoration now carries verified `storageTransitions` with exact
physical endpoint layouts and `transfer-cleanup-storage` ownership. Printing makes
these visible; emission rejects forged contracts through independent verification.
Runtime restoration behavior is unchanged. Release-aware descriptor propagation
and selected replacement normalization remain prerequisites for expanding support.

Direct manual replacement can now be followed by callable/aggregate reads after
lexical alias release or an immediate swap. Analysis and independent verification
apply the retained descriptor transitions at completion, matching the C backend's
existing versioned storage. Nested direct manuals and repeated releases preserve
exact original and replacement ABIs. Scattered scalar/tuple frontends now compose
member descriptor effects in the same source order as existing C completion,
including nested tuples and outer manual wrappers. This does not add scattered
callable focus endpoint ABIs. Caller-side argument cleanup effects now propagate
after plain calls or at eventual lens-result completion, matching existing C
adapters and retained argument backing. Direct, dynamic and native calls, scattered
arguments, forwarded results and outer manual wrappers share that contract.
Selected divergent replacement, callee-local effect summaries and general callable
focus endpoint ABIs remain separate phase-6 work.

Selected arm-result cleanup can now replace callable/aggregate owners when final
representation descriptors converge exactly across all arms. Analysis propagates
that descriptor after selected completion; C uses its existing typed storage merge.
Nested selections, unused aliases, returned argument backing and outer manual
wrappers retain their existing restoration/ownership behavior. Differing final
representations and deferred writes to divergent setup owners still require exact
post-cleanup normalization adapters. Phase 6 remains incomplete.

Selected cleanup can now leave different callable/recursive aggregate descriptors
for owners with common setup storage. Verified post-cleanup adapters normalize the
selected live contents after cleanup/restored actions and before merging. Direct
and staged completion share this path; original cleanup ABIs, empty projections,
returned backing and affine disposal remain intact. Deferred replacement of owners
with divergent setup descriptors still requires restoration adapters and diagnoses.
Phase 6 remains incomplete.

Deferred replacement of divergent setup owners now executes when retained original
storage and a completed post-cleanup adapter are present. Staging preserves raw
contents; completion reinstates original typed storage for cleanup and uses the
final adapter, skipping the setup adapter after replacement. Convergent final
results still require that explicit route. Nested selections, consume/refill,
unused owners and owned cleanup results preserve affine disposal. Uncompleted
callee-local restoration and unsupported arm completion routes remain explicit
restrictions. General callable focus endpoint ABIs and phase 6 remain open.

Returned lenses now support retained callee-local replacement contracts. Analysis
and verification derive private completion before escape while preserving setup
state; existing C returned contexts retain backing and owned values through cleanup
and final disposal. Forwarding, unused aliases, aggregates, staged cleanup, owned
cleanup results and late private captures share that lifetime path. This completes
the modeled returned-local restoration boundary, not general callable focus ABIs
or phase 6.

Selected arms may return local aliases of scalar/tuple manual lenses, including
nested/scattered frontends and divergent callable-owner cleanup effects. Source
protection metadata retains underlying owners separately from owned-retention
escape provenance. Analysis retains block releases after frontend completion,
matching existing C cleanup order; no C storage/ABI change was required. Aliases
whose focus contents themselves require callable endpoint ABIs remain separate.


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


## Whole-local persistent callable aliases

Direct aliases of whole owned callable/recursive aggregate locals now execute.
Representation inference and independent verification track the original logical
owner through nested loans, swaps and release, retaining separate initial/final
endpoint descriptors and current versions for subsequent reads. C already aliases
the existing logical cell, so replacement follows current storage rather than an
address into an obsolete aggregate. Existing ownership transfer and disposal handle
extracted old values and unused replacements; there is no new allocation, pointer
cast or environment duplication.

Thirteen shared callable-focus samples include branch joins, consume/refill,
callable/data transitions, deferred scalar completion and ordinary callable returns.
Projected, computed/manual and scattered callable endpoints and callable focus
parameter/result ABIs remain explicit restrictions. Phase 6 stays open.


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


## Immediate manual callable restoration

Immediate manual callable/aggregate swaps, nested manuals and projected frontends
now execute through existing C logical views and stage/finish callbacks. Verified
physical endpoint contracts distinguish the installed replacement from contents
after cleanup, preserving each original invocation ABI. Cleanup can replace the
installed owner without disposing the extracted old result or duplicating an owned
environment. Six shared samples cover cleanup replacement/order, aggregate and
projected frontends and unused disposal. Computed persistent manual aliases,
scattered callable endpoints and callable focus call/return ABIs remain open.
Phase 6 is incomplete.


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


## Persistent manual callable aliases

Manual callable/aggregate focuses backed by enclosing logical storage now support
persistent computed aliases. Representation analysis and independent verification
retain private alias contents and propagate the final descriptor to the protected
frontend at release, before manual cleanup. C reuses computed-loan logical views
and existing stage/finish callbacks, preserving installed and post-cleanup callable
ABIs and affine environment ownership. Nine shared cases cover nested/projected
manuals, unused aliases, replacement/disposal, data extraction and cleanup
consumption. There is no C lowering or concurrent scheduler change. General
scattered/selected callable lenses, escaping private callable backing and callable
focus parameter/result ABIs remain open; phase 6 is incomplete.


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


## Persistent scattered callable restoration

Persistent aliases of flat/nested/mixed scattered callable focuses now execute
through the existing C view arrays and lexical release callbacks. Representation
completion checks private alias contents and restores every logical target before
manual/member cleanup. Source order, original callable ABIs and affine environment
disposal are preserved. Five shared samples include consume/refill, manual cleanup
and unused environments. No C lowering or build scheduler change is required.
Callable lens parameter/result ABIs, selected callable lens results and escaping
private callable backing remain open; phase 6 is incomplete.


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
