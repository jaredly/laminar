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
