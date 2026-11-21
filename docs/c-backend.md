# C backend: phases 4–6 and phase 7 nominal data

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
Callable storage records are structural: values whose ordered entry ABIs match
share one record, with an erased `void *` environment pointer, and environment
records are keyed by their capture layouts. Code identity and captures stay in the
representation analysis, so specialization and direct dispatch are unaffected, and
joins whose arms already share the record and entry fields lower to plain moves.
Captured callable values use concrete typed heap environments. Invocation copies
captures into owned locals and releases the environment before executing the body;
returned restoration contexts retain any locals needed later. Generated disposers
recursively dispose captured callable values and release unused environments.
Wildcard bindings, scope cleanup, branch normalization, and deferred cleanup results
all run the corresponding disposal paths. Compatible branch-selected user-defined
closures normalize to an erased environment pointer, the selected disposer, and
exactly typed invocation fields. Each alternative keeps its own capture layout;
only the selected branch allocates or invokes an environment. Nested joins,
returned and captured joined callees, and thin/scattered lens arguments and
returned focuses use the same ownership and restoration paths. There is no extra
join allocation or function-pointer cast.

Unsupported native imports retain explicit diagnostics. Dynamic callable entry
roots require a host adapter. Nominal union data and strings are described in
*Phase 7: nominal union data* and *Phase 7: strings* below.

Every registered runtime import is implemented (see *Phase 7: runtime import
registry*): numeric `+`, `-`, `*`, `/`, `==`, `>=`, `<=`, `round` and `heapsize`,
data `dup`, logical `fst`, `charList`, and host `print` and `getInput`. `dup` of a computed focus restores that focus after copying it.
There is no evaluator fallback. Function roots with parameters need a future host
adapter, and borrowed lenses cannot escape the test entry boundary. Raw owned-local lenses cannot escape through function returns. Borrowed matching
uses scoped reconstruction over scalar, tuple and nominal union data.
Returned contexts retain owned temporary focuses and deferred cleanup state.
Lens-valued branches normalize their focus into thin storage and retain a selector plus each
arm’s original restoration operation. Only the selected arm runs setup,
normalization, and cleanup. Deferred branch variables are initialized outside the
conditional and captured when a returned lens needs them; escaping call backing
remains heap-resident. Thin/scattered joins, nested local storage, selected setup
effects, and type-changing replacements execute on native C and Wasm. Persistent computed aliases retain their
focus and restoration operation until lexical release; thin, scattered, nested,
and type-changing cases are exercised by the execution harness.
Malformed concrete IR fails verification before storage lowering.

The execution harness builds each sample natively with strict C11 (`-Wall -Wextra
-Werror -pedantic`) twice: at `-O0` under ASan/UBSan with stack-use-after-return
detection, and at `-O2` without sanitizers. Wasm is not executed: it compiles the
same C through Emscripten, which would test that toolchain rather than the backend.
`buildAndRun` still supports `wasm: true` for manual checks. It removes inherited host include-path
injection when spawning tools, so Emscripten uses its own sysroot. Failed builds,
traps, malformed results and expected-result mismatches retain their temporary
`laminar-c-*` directory, generated C/JS/Wasm, exact command arguments and observed
compiler/runtime versions. Successful runs remove their directories.

Run `bun test test/c` for the backend tests, `bun test` for all regressions, and
`bunx tsc --noEmit` for TypeScript checks. `test/corpus.test.ts` runs the accepted
corpus (see *Phase 7: corpus runner and backend selection*). Ordinary runs execute
it on the typed-IR reference and check C and Go emission; `LAMINAR_EXEC=1 bun test
test/corpus.test.ts` also builds and runs it natively and on Go, and
`LAMINAR_BACKENDS=native` (or any comma list of `reference`, `native`, `go`)
selects backends explicitly. Missing local toolchains produce explicit skips; `CI`
makes them failures.

`.github/workflows/backend.yml` provisions Bun 1.4.2, runs the tests and
TypeScript checks, and uploads failure artifacts. This configuration is checked
in; remote CI execution and branch-protection requirements are not established
by local verification.

Complete expected C output for tuples, thin/scattered calls, returned lenses,
and branch version joins is inline in `test/c/print.test.ts`. Execution tests
compare typed IR and native execution with the same expected results. In addition to
the phase-4 corpus, cases cover Number/Bool and small/large transitions, nested
mixed shapes, offset-changing aggregate reconstruction, `take`, `map`, native and
user-defined focus assignment, repeated and nested returned calls, alias refill,
discarded captures, computed-focus `dup`, branch changes, and empty/unit lenses.
Captured callbacks and corrupt concrete artifacts have positive execution and
negative verification tests.

## Owned temporary focuses and borrowed reconstruction

The C lowering implements `aslens` with a private logical storage cell. On
restoration its deferred block moves the final value into the cleanup pattern.
The adapter disposes the result and the block disposes residual owned locals.
Borrowed reconstruction uses the same operation with an independently verified
selected-pattern and owner contract. See [owned temporary lenses](aslens-core-ir.md).

The milestone sections below retain descriptions of earlier restoration adapters.

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


## Private scattered backing through lexical completion

Scattered callable/manual focuses now survive private lexical storage scopes
within one C function. Verified retention records cover unique private owners;
existing C logical cells, scope callbacks and ordered drops keep their backing
alive through restoration and dispose the current version afterward. Extracted old
callables retain independent environment ownership. Three new shared samples cover
captured private values, mixed storage and cleanup; no C lowering or concurrent
scheduler change is required. This does not implement callable lens function-return
ABIs or choose semantics for the diagnosed native manual-argument cleanup boundary.
Phase 6 remains incomplete.


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

## Phase 7: nominal union data

Union storage is derived, not registered. `deriveNominalLayoutDefinitions`
(`src/layout-definitions.ts`) groups the generic program's constructor imports by
result type. The checker imports every constructor of every union in declaration
order, so each group is the union's complete variant list and its order is the tag
order. Explicit `layoutDefinitions` still override derivation. A variant payload
is its single argument, a tuple of several, or unit. A variant is boxed when its
generic payload mentions any nominal type; every recursive cycle passes through such
a payload, so by-value layouts stay finite and the choice depends only on the
declaration. A layout's identity includes only the schemas its type reaches, so
the always-derived `List` and `Option` leave scalar, tuple and callable layout IDs
unchanged.

C lowers a union to `struct { uint32_t tag; union { P0 v0; P1 *v1; ... } as; }`.
Construction allocates boxed payloads with `allocate_context`. Matching tests the
tag and nested payload patterns; binding copies a boxed payload out and frees its
box, which is sound because the case already selected that variant. Borrowed
matches need nothing extra: typed IR moves the owner out, binds owned parts and
reconstructs through explicit manual cleanup. Per-layout recursive helpers are
generated on first use: `drop_L` frees boxes (wildcards, block cleanup, branch
normalization and the entry result all use it), `dup_L` deep-copies for `dup`, and
`print_L` writes the test protocol (`nil`/`cons` as a JSON array, other variants as
`{"kind":"variant","name":…,"items":[…]}`). The entry adapter now drops its result
before the live-allocation check, so leaked boxes trap.

Go uses the same tagged struct with `*P` boxes. Payloads are never written in place
(binding copies them out; construction allocates), so moves and `dup` share boxes
under the garbage collector.

Entry expressions whose type stays generic (for example a bare `[]`) are
instantiated at unit, matching the phase-6 rule for unconstrained body types.
Definition roots still require explicit type arguments.

## Phase 7: strings

`String` is a primitive layout (`string` storage and physical kind), like `Number`
and `Bool`. Its value is owned, immutable UTF-8 text.

C represents a string as `laminar_string *`, pointing to one
`allocate_context` cell holding the length and the bytes. The empty string is
`NULL`, so a zeroed slot is a valid string and `""` never allocates. Literals
evaluate to fresh cells (`string_new`), so drop is a uniform `string_drop` and
`dup` copies (`string_dup`). Leaked strings therefore trip the entry adapter's
live-allocation check. Literal bytes are emitted with three-digit octal escapes
for everything outside printable ASCII, plus `"`, `\` and `?` (no trigraphs).
Source text with an unpaired surrogate has no UTF-8 form and is rejected.
The string runtime and `<string.h>` are emitted only when a program reaches a
string layout, so other programs' C is unchanged.

Interpolation appends the head, then each part and its tail, in source order into
a growable builder, consuming each string part. Parts may be `String`, `Number`
or `Bool`. Numbers use ECMAScript `Number::toString`: the shortest round-tripping
digits (found by increasing `%.*e` precision until `strtod` returns the value),
laid out positionally for decimal exponents from -7 to 20 and in `1.5e-7` /
`1e+21` form otherwise, with `NaN`, `Infinity` and `0` for both zeros. Other part
types (tuples, lists, variants), whose evaluator text is JavaScript's
`String(...)`, are rejected with `String interpolation supports String, Number and
Bool parts`.

String literal patterns compare length and bytes (`string_equals`); a matched
literal pattern consumes its string like a wildcard. `charList` consumes its
argument and builds the list of its code points from the end, stepping back over
UTF-8 continuation bytes, so it agrees with the evaluator's code-point iteration.
The test protocol prints strings as JSON strings, escaping `"`, `\` and control
bytes.

Go uses the native `string` type: drop and `dup` need no code, interpolation is
`+` concatenation through `formatNumber` (the same layout rules over
`strconv.FormatFloat(x, 'e', -1, 64)` digits) and `strconv.FormatBool`, and
`charList` slices at `range` code point offsets.

`print` and `getInput` are defined by the runtime import registry (below).
Strings have no `==` or ordering imports; literal patterns are the only comparison.

The work also fixed C number literals: integral values outside the safe-integer
range (for example `459751200000000000000`) are emitted with `.0`, since they
exceed every C integer type.

## Phase 7: runtime import registry

`src/runtime-imports.ts` is the one table of runtime imports. Each entry gives the
source signature, the ownership convention of each argument and of the result
(`owned` data or a `lens` capability), any host capability (`stdout` or `stdin`),
the backends that implement it (`reference`, `c`, `go`), and a one-line semantics.
`builtinTypes()` derives every source signature from it and checks that the
conventions restate the signature's plain/flow structure. Source arity is the
signature's arity; no backend passes the old evaluator's hidden context argument.

`requireImport` is the single availability check. The typed-IR evaluator calls it
when it materializes a native, and C and Go call it for every import the program
uses, with the program's target. It diagnoses an unregistered import
(`unknown-import`), a backend without an implementation (`unsupported-import`), and
a runtime profile without the needed capability (`unavailable-capability`).
`runtimeCapabilities` gives native, Go and Emscripten/Node both `stdout` and
`stdin`; Emscripten in the browser has `stdout` only, so `getInput` is rejected
there at compile time. A unit test exercises every backend claim with one call per
import.

Semantics added in this slice:

- `round` is ECMAScript `Math.round`: `floor(x)`, plus one when the fraction is at
  least one half, and a zero result takes the sign of `x` (so `round(-0.4)` is
  `-0`). This is exact for every double, including `0.49999999999999994`.
- `heapsize` is 0 on every backend: the checked subset has no explicit heap.
- `print` consumes a string and writes its bytes and a newline to stdout.
- `getInput` consumes its prompt, writes it to stdout (flushing C's buffer), and
  reads one stdin line without its newline. End of input ends the line, so
  exhausted input reads as `""`.

C emits these as lazily generated helpers (`round_L`, `host_print_L`,
`host_input_L`). Go uses `laminarRound`, `hostPrint_L` and `hostInput`, which
reads through one `bufio.Reader` and imports `bufio` and `os` only when used.

Program output shares stdout with the test result protocol. A program that uses a
host import writes a record separator (U+001E) before each result line; the
runners (`src/backend/protocol.ts`) treat everything else as program output.
Other programs' output, and so every existing snapshot, is unchanged. Both runners
accept `stdin` text and an expected `output`. The evaluator takes matching
`stdout` and `stdin` options, defaulting to the process stdout and an interactive
prompt. Execution samples may give `stdin` and `output`, and the harness checks the
reference output and both backends' output against them.

The plan also lists files and clocks. No source import uses them, so the registry
has nothing to adapt. Allocation (`allocate_context`) and traps (`abort`, Go
panics) are backend runtime, not imports.

## Phase 7: compiler command and API

`src/compiler.ts` is the programmatic entry point:

- `checkSource(source)` parses and type checks a file into verified typed IR.
- `compileSource(source, { target })` checks, specializes, analyzes
  representations and emits C or Go (chosen by the target's ABI) for the last
  top-level expression. It never invokes a compiler. Symbol names (`L0`, `fn0`, …)
  depend only on the program and target, so emission is deterministic.
- `buildCompiled(compiled, target, { optimize, sanitize })` builds emitted code
  with the target's toolchain (clang, emcc or go) using the harness's strict flags,
  and returns the command that runs it. Failed builds keep their directory.

Every failure is a `CompileError` with a stage (`usage`, `parse`, `type`,
`backend`, `build`), a stable code and, when known, a 1-based line and column.
`format(file)` renders `file:line:column: stage error [code]: message`. Type
errors carry their checker location; parse errors locate the failing top-level
item; backend diagnostics are located through the typed-IR origin table when they
name an origin.

`src/backend/host.ts` describes targets from the toolchains that build them:
`native` asks clang for its triple, pointer width and byte order, `wasm32` uses
`emcc`, and `go` uses `go`. Nothing is derived from the machine running the
compiler.

`cli/laminar.ts` (`bun run laminar`, or `bun cli/laminar.ts`):

```
laminar check <file>
laminar emit  <file> [--target native|wasm32|go] [-o <path>]
laminar run   <file> [--target native|wasm32|go|reference] [--optimize] [--sanitize]
```

`emit` writes source only. `run` builds and executes with stdin and stderr passed
through, removes the build directory afterwards, and exits with the program's
status. `--target reference` runs the typed-IR evaluator instead. Program output
streams as produced and the entry result is printed last as a JSON line; the
result-protocol record separator is stripped. Native is the default target.

## Phase 7: corpus runner and backend selection

`test/corpus.test.ts` is the one runner for the accepted corpus. It replaces the
separate native (`test/c/execute.test.ts`) and Go (`test/go/abi-migration.test.ts`)
sample loops. The corpus is:

- the shared execution samples (`test/backend/execution-samples.ts`), with their
  stdin and expected host output; and
- the test cases of the `.test.lm` snapshot files that the legacy fixture runner
  executes (`src/systematic.test.lm`, `test/flow.test.lm`). `test/backend/lm-corpus.ts`
  extracts them with the fixture runner's pairing rules. Each case's source is the
  file's checker-accepted definitions followed by its body. Its expected value is
  the literal expected expression: snapshot files write tuples with list syntax,
  which prints as the same JSON array.

`test/backend/backends.ts` defines the backends: `reference` (typed-IR
evaluator), `native` (C through clang, sanitized `-O0` and plain `-O2`) and `go`.
`LAMINAR_BACKENDS` selects them explicitly; otherwise the reference always runs and
`LAMINAR_EXEC=1` selects all three. Each compiled backend also checks two expected
runtime traps. When a compiled backend is not selected, the runner still checks
that every case emits its code.

Two groups keep failures apart. *Negative checker results* is a snapshot that
classifies the `.test.lm` corpus: accepted cases, rejected cases and rejected
definitions, each with its checker code. Most rejections name legacy fixture
builtins (`log`, `makelens`, `heap`, files) that are not runtime imports, or
definitions that depend on them. *Backend restrictions* lists programs that pass
the checker and the reference but that a backend rejects, with the expected code
for C and Go: non-scalar interpolation and callable entry results. Missing host
capabilities are tested per target.

## Phase 7: host exports

`compileLibrary(source, { target, exports })` (`src/compiler.ts`) compiles
top-level definitions into a C library with a generated header, instead of a test
program. The library has no `main` and prints nothing. From the command line:
`laminar emit <file> --export inc,greet --header laminar.h -o laminar.c`.

Each export names a definition; its symbol defaults to `laminar_<name>`, and a
generic definition needs explicit `typeArguments` (and its own `symbol` when it is
exported more than once). Exports are ordinary function entries: every parameter
gets a data representation contract, and `lowerC(program, { exports })` wraps each
entry's code in a public function with this host ABI:

| Laminar value | Argument | Result |
| --- | --- | --- |
| `Number`, `Bool` | `double`, `bool` by value | `double`, `bool` |
| `()` | omitted | `void` |
| `String` | borrowed `(const char *bytes, size_t length)`, copied; the host keeps its buffer | owned `laminar_string *`: read with `laminar_string_data`/`laminar_string_length`, free with `laminar_string_free` |
| anything else | owned handle; passing it transfers ownership | owned handle; pass it to an export or dispose with `laminar_drop_<T>` |

Strings are length-delimited, so embedded NUL bytes are data, and the empty string
is a NULL result that both accessors accept. Handle types are opaque and named from
the semantic type (`laminar_List_Number`, `laminar_Tuple_String_Number`); a handle is
one heap cell holding the value. `laminar_live_allocations()` reports live
Laminar heap cells, so a host can check that it released everything.

Rejected with diagnostics: lens parameters and lens results (`Lens parameters need
a host borrow contract`), generic exports without type arguments, unknown
definitions, duplicate symbols, and non-C targets (`unsupported-export`; the Go
backend has no host ABI).

Two tests under `LAMINAR_EXEC=1` exercise the ABI. A native C host, built with the
library under ASan/UBSan, covers scalars, a buffer with an embedded NUL, UTF-8
input, string results, handle ownership transfer (`laminar_sum(laminar_range(4))`),
disposal of kept handles, and unit, and ends with no live allocations. A
Wasm/Node host is the one relevant case for memory growth: a 24 MiB input makes an
export grow linear memory, the test checks that the view taken before the call is
stale, and it reads the result through the current `HEAPU8`. There is no browser
profile test yet; browser Emscripten is a compile-time target with `stdout` only.
