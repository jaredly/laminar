# Readable compiler output

Generated code should preserve recognizable source structure and names while making
necessary representation and ownership operations explicit. The current Go output
exposes too much mechanical lowering detail. This work improves the emitted source;
it does not depend on proving that the downstream Go compiler misses an optimization.

## Starting example

`ok.lm` implements a number-guessing game with `nextGuess`, `handleResponse`,
`step` and `game`. The inspected `ok.go` has 854 lines, including 250 blank
assignments (`_ = ...`) and 116 `var` declarations. These counts describe the
reviewed artifact, not a permanent benchmark threshold.

The generated functions are currently:

| Generated name | Source meaning |
| --- | --- |
| `fn0` | `step`, with a scattered lens |
| `fn1` | `handleResponse` |
| `fn2` | `step`, with a thin aggregate lens |
| `fn3` | `game` |
| `fn4` | `nextGuess` |
| `fn5` | Top-level entry expression |

Two `step` implementations have different lens representations, so naming alone
cannot make them one function. Distinct specializations should remain identifiable.

## Proposed changes

### 1. Suppress only truly unused locals

The Go lowerer's `declare` helper adds a blank assignment after every assignment,
and declaration hoisting adds another after each declaration. Parameters also get
blank assignments, although Go permits unused parameters.

Track actual reads, including uses inside restoration closures. Remove blanket
suppression and emit a blank assignment only for a retained local that Go would
otherwise reject. Prefer eliminating an unused local entirely when possible.
Writes alone do not make a local used.

```go
// Before
var v27 float64
_ = v27
v27 = 1.0
_ = v27
v28 = v26 + v27

// After, before expression simplification
increment := 1.0
nextSteps := steps + increment
```

### 2. Preserve source function names

Carry source names through specialization and concrete lowering. Emit `nextGuess`,
`handleResponse` and `game`; distinguish variants with deterministic suffixes such
as `step_thin` and `step_scattered`. Use collision suffixes only where needed.

Names must remain valid Go identifiers, avoid keywords and generated helpers, and
handle shadowing and multiple semantic/representation specializations. Do not use
traversal-order numbers as the primary identity visible to readers.

### 3. Preserve parameter and local names

Use source provenance to recover names such as `direction`, `response`, `steps`,
`state`, `lastGuess` and `next`. Reserve generated names for actual compiler
intermediates. When a source binding has multiple storage versions, use a readable
base name with deterministic disambiguation rather than implying they are one cell.

Tuple field names should remain structural unless a stable semantic name is
available; a tuple can be used under different destructuring names in different
functions.

### 4. Declare locals near their first assignment

Prefer `input := hostInput(prompt)` to function-wide `var` blocks. Keep branch-local
values inside their branches. Hoist only values that cross control-flow boundaries
or whose cells must be retained by restoration closures.

The current blanket hoisting accommodates residual restoration closures, including
cells initialized in a selected branch. Any replacement must preserve those cells'
scope, identity and lifetime. Ordinary single-assignment temporaries need not pay
that readability cost.

### 5. Collapse copies and inline simple expressions

The higher-response arm currently contains this chain, interspersed with blank
assignments:

```go
v19 = false
v18 = v19
v14 = v18
v10 = v14
v8 = v10
v1 = v8
```

Assign `false` directly to the branch result. Similarly, emit `steps + 1` without
separate temporaries for the parameter, literal and arithmetic result. Return a
computed value directly when no cleanup or restoration must intervene.

Start with constants and immutable copies. Inlining a mutable lens read across a
call or write can change its value; duplicating an expression can duplicate effects.
Keep source evaluation order and ownership transfer explicit where required.

### 6. Remove dead values while preserving effects

Do not materialize unused unit values or discarded tuple components. Emit a call
as a statement when its result is unused, for example `hostPrint(message)`.
Eliminate unused pure computations entirely.

Unused results do not imply unused effects: input/output, traps, calls, disposal
and restoration must still occur. Retain required cleanup for owned values even
when their source names are unused.

### 7. Simplify control flow

Use `switch` for suitable string and union-tag matches. Emit an exhaustive Boolean
match as `if condition { ... } else { ... }`, rather than comparing against both
Boolean literals and adding an unreachable unmatched-case panic. A wildcard arm
should be `else` or `default`, rather than `else if true` followed by another arm.

Preserve arm order and retain unmatched-case traps where exhaustiveness has not
been established. Avoid introducing early returns that bypass restoration.

### 8. Remove redundant writes and initialization

`nextGuess` currently ends with writes equivalent to:

```go
*state.item0.read = *state.item0.read
*state.item1.read = *state.item1.read
*state.item2.read = *state.item2.read
```

Remove proven self-assignments. Avoid explicit zero assignments that merely repeat
Go's initial zero value, while retaining resets that execute repeatedly or refer
to reused storage. Distinguish ordinary zero initialization from logical empty-slot
and branch-availability bookkeeping.

### 9. Reduce lens staging and aggregate reconstruction

Calls repeatedly copy three fields into a `BackingN`, construct pointers to the
fields, invoke a function, read the fields back and reconstruct a tuple.

For compatible homogeneous storage, investigate forwarding an existing lens or
pointing directly into existing backing. Avoid rebuilding an aggregate when its
existing storage already holds the required result.

This is a representation/storage optimization, beyond surface cleanup. Prove
aliasing, availability, lifetime and restoration compatibility first. Preserve
separate typed storage for type-changing updates when required.

### 10. Improve type names and prune declarations

Use `float64`, `bool` and `string` directly instead of `L0`, `L8` and `L6` aliases.
Give unit, nominal data, tuple, environment and lens types descriptive names.
Name union tags after constructors rather than exposing only numeric tags.

`Backing0` through `Backing5` have identical fields in the inspected artifact;
share equivalent generated backing definitions. Compute declaration reachability
from emitted functions and helpers to omit unused layouts and ABI function types.
The artifact also contains an unused `printString` helper, which should not be
emitted for this data-only result.

Sharing structural definitions must not erase distinctions needed by the callable
ABI or introduce recursive type-definition problems. Deterministic readable names
should remain stable when unrelated declarations are added.

### 11. Simplify direct calls

The output contains calls such as:

```go
fn4((L3{}).environment, v4, v6)
```

For known environment-free callees, pass `nil` directly instead of constructing an
empty callable merely to extract its environment. A further improvement is to give
named functions ordinary direct-call signatures and generate ABI-compatible wrappers
when those functions are used as first-class values.

The wrapper approach changes internal calling conventions and needs its own review.
Preserve exact typed callable entries, capture ownership and lens-result adapters.

### 12. Format and organize the output

Run `gofmt`, remove unnecessary expression parentheses using precedence-aware
printing, and order definitions predictably. Add source-location comments for
source functions and clearly separate generated runtime helpers from program code.
Avoid moving a large block of runtime machinery ahead of the source functions a
reader is trying to inspect.

Formatting alone cannot remove lowering noise, but it should be the final step of
every emission path. Keep the entry/result protocol explicit; its printing and
number-formatting helpers implement observable semantics.

## Suggested implementation slices

1. **Usage-aware emission:** remove blanket blank assignments and unused parameter
   suppressions; eliminate dead result locals while preserving effects.
2. **Names and provenance:** retain function, parameter and local names; introduce
   deterministic specialization and collision naming.
3. **Local structure:** narrow declaration scope, collapse safe copy chains, inline
   constants and simplify branch/result plumbing.
4. **Types and presentation:** readable type/tag names, reachable declarations and
   runtime helpers, backing-definition deduplication and canonical formatting.
5. **Storage and calling conventions:** reduce lens staging/reconstruction and add
   simpler direct-call signatures where justified.

These are proposed slices, not completed work. The first four primarily improve
source presentation; the fifth overlaps the optimization candidates in phase 8 of
`c-codegen-plan.md`. Small direct-call simplifications such as replacing an empty
environment projection with `nil` can land earlier.

## Validation

- Keep `ok.lm` as a readable representative example and compare regenerated output
  with the inspected artifact. Compile and execute the game with scripted input.
- Test unused locals, unused parameters, effects with discarded results, shadowing,
  naming collisions, multiple specializations and deterministic emission.
- Exercise branch joins, recursion, captured cells and residual restoration closures
  when changing scopes or copy propagation.
- Run the existing checker, IR verification and backend corpus checks. Differentially
  execute affected cases against the reference and the existing lowering behavior.
- For representation or ABI changes, add focused ownership/restoration cases and
  measure emitted size and execution behavior independently of readability gains.

The immediate goal is recognizable generated code without reconstructing source
intent from numbered temporaries. Keep explicit sequencing where correctness needs
it; remove artifacts introduced solely by the emitter's implementation convenience.

## Slice 1 implementation: demand-driven Go materialization

Go lowering now resolves concrete-IR value dependencies on demand. A pure result,
logical storage snapshot, constructor payload or branch-result cell becomes a Go
local only when an emitted consumer reads it. Discarded pure results therefore
never acquire declarations or assignments. There is no generated-text usage scan
or pass that adds blank assignments to suppress compiler errors.

Materialization is a compile-time decision, not runtime lazy evaluation. Lowering
reserves a sequencing point for each operation. If a later consumer needs an old
load, its load is emitted at that original point, before intervening calls, writes
or restoration. Operand expressions are captured per lowering edge because deferred
cleanup can lower the same IR block under different storage versions.

General calls still execute when their results are unused; they become call
statements. Calls to the explicitly known pure Go natives can disappear when their
results are unused. Host I/O and traps in user-defined or indirect calls remain.
Numeric constants can appear directly in expressions, but operands of floating
arithmetic are materialized where necessary to preserve runtime IEEE-754 behavior
rather than Go constant arithmetic. Unit-only entry results need no result local,
including tuples consisting entirely of units.

Synchronous homogeneous reborrows also use existing incoming addresses when no
staging/restoration or separate replacement storage is required. Those calls do
not introduce private backing structs or copy-back snapshots. Escaping,
type-changing and restoration-bearing cases keep their explicit storage path.

Regenerating the reviewed `ok.lm` produces 431 lines of Go instead of 854, with
zero blanket blank assignments instead of 250 and one backing struct instead of
seven. The scripted responses `higher`, `higher`, `lower`, `lower`, `match` still
produce `[[75,82,79],4]`. Source naming and declaration placement are implemented below. Copy propagation is implemented in item 5 below. Declaration reachability
and control-flow simplification remain subsequent work.

Focused tests in `test/go/demand.test.ts` cover dead pure computations, discarded
constructor scrutinees, unused effectful calls, unit results, preserved load order,
forwarded writes, type-changing backing, floating-point edge cases, boxed
construction and traps in discarded calls. The shared Go corpus exercises the
existing deferred-restoration, branch-join and callable cases against reference
expectations.

Validation: TypeScript and `git diff --check` pass. The regular suite reports
3116 passed, 55 skipped, zero failures and all 39 snapshots passing.
`LAMINAR_BACKENDS=go bun test test/corpus.test.ts` passes all 1592 tests,
including 792 accepted Go cases and two expected traps. With `LAMINAR_EXEC=1`,
all 15 tests in `test/go/demand.test.ts` pass (36 assertions). The execution
workflow now includes those focused Go tests. No remote CI run was performed.


## Items 2 and 3: source names in Go output

Go function names now come from the retained generic IR's definition bindings.
For `ok.lm`, these are `nextGuess`, `handleResponse`, `game`, `step_thin` and
`step_scattered`, plus the generated entry adapter. Distinct semantic
specializations use labels such as `id_number` and `id_bool`. Local closures use
their binding names, qualified by the enclosing definition, such as `maker_add`.
Anonymous functions fall back to a closure name rather than pretending to have a
source declaration.

Parameter names come from binding records and patterns. A destructured parameter
uses a compound name such as `min_max_lastGuess`; its component reads can retain
names such as `lastGuess`. Owned locals, captures and direct alias reads use source
names where the IR records them. Shadowed bindings and different physical storage
versions receive suffixes, for example `input_2` or `next_2_2`. Unnamed compiler
intermediates still use generated names. This changes naming, not copy propagation
or declaration placement.

The allocator reserves Go keywords, required predeclared identifiers, imports,
runtime helper names, closure parameters and generated symbol families. For
example, source `func` becomes `func_2`, source `back0` becomes `back0_source`,
and a source function named `environment` cannot be shadowed by the callable ABI's
hidden environment parameter. Source declarations receive names before generated
storage versions. Assignment is deterministic and does not rewrite IR identities,
specialization keys, layouts or callable signatures.

`test/go/names.test.ts` checks function/parameter/local names, specialization
suffixes, captured closures, shadowing, escaping, repeated deterministic emission
and unchanged concrete IR. Its execution cases cover semantic and lens variants,
closures, keyword/import/runtime collisions and recursive calls. These tests are
also included in the CI execution gate.

Validation for naming: TypeScript and `git diff --check` pass. The regular suite
reports 3122 passed, 64 skipped, zero failures and all 39 snapshots passing.
The Go corpus passes all 1592 tests. With `LAMINAR_EXEC=1`, the naming,
materialization and string tests pass all 36 tests (96 assertions). Regenerated
`ok.go` builds and produces the same scripted game result. No remote CI was run.


## Item 4: declaration placement

Ordinary Go locals now use `:=` at their materialization points instead of a
function-wide `var` list. Values used only in one branch stay in that branch.
For example, `step_scattered` now begins with its actual work:

```go
lastGuess := *((min_max_lastGuess).item2).read
v3 := "My guess is " + formatNumber(lastGuess) + " (higher/lower/match): "
input := hostInput(v3)
input_2 := input
```

Compiler declaration and assignment nodes record ownership separately from
expression text. Reference metadata is preserved while constructing expressions,
joining fragments and formatting interpolated parts. Field labels and literal
text do not count as references to similarly named variables. No printed-code
usage scan is involved.

After demand-driven materialization has finished, declaration placement finds the
nearest common lexical scope of each definition, read, write and capture. A value
that stays within its original scope uses a short declaration there. A cell shared
by branch setup and later restoration gets a typed `var` before their common
control-flow boundary, with `=` at its original initialization point. Only the
declaration moves: loads, allocations, calls and other initializers keep their
original evaluation order. An entire `if/else` chain is one insertion boundary,
so a declaration can never split its arms.

Returned restoration functions remain structured statement bodies through this
placement step, allowing their captures to participate in scope decisions. The
transparent sequencing lists from item 1 do not introduce artificial Go scopes.
Copy chains are handled in item 5 below. Initial zero assignments, match
simplification and representation choices remain separate work.

Regenerated `ok.go` has 371 lines, down from 431 after naming. The scripted game
still produces `[[75,82,79],4]`. `test/go/locals.test.ts` exercises local and shared
declarations, nested common scopes, closure capture, conditional chains,
reference composition, string/field literals, branch results and returned
type-changing lenses. It is included in the CI execution gate.

Validation for declaration placement: TypeScript and scoped diff checks pass.
The regular suite passed 3132 tests with 69 skips and all 39 snapshots; the added
field-spelling regression also passes separately. The Go corpus passes all 1592
tests. With `LAMINAR_EXEC=1`, declaration placement, naming and materialization
pass all 46 focused tests (94 assertions). No remote CI was run.


## Item 5: copies, constants and simple expressions

The Go expression builder now retains recipes for references, composed fragments,
scalar literals and numeric operations. Simplification operates on these recipes
and explicit declaration/assignment nodes, rather than replacing identifier text
in printed Go. It runs before declaration placement, so surviving operands still
get the required lexical scope.

Immutable copies such as `input_2 := input` and chains ending in `return next_2`
collapse to the original value. Single-use unnamed pure expressions can appear at
their consumer, for example `(steps + 1.0)` directly in the recursive call and the
prompt expression directly in `hostInput`. Canonical source bindings remain where
they help represent a value used by later work; unnecessary source aliases can
disappear along with generated ones.

Constant numeric operations use double-precision evaluation, including intermediate
rounding, infinities, NaN and signed zero. Dead pure operand declarations disappear
after folding. This avoids accidentally asking Go to evaluate source numeric
operations as arbitrary-precision constants: for example,
`9007199254740992 + 1 - 9007199254740992` produces `0`, and division by zero
produces the documented IEEE values. The constant `heapsize` import participates
under its current specified value of zero.

General calls and mutable loads retain their sequencing points. An immediately
following bare assignment or direct return can consume the initializer directly,
but forwarding never crosses cleanup, another statement, a branch boundary or an
effectful lvalue computation. Copies of reassigned values, mutable records and
addressed cells remain distinct. A pure expression is moved only when its referenced
values are stable; address-taking and field mutations are explicit optimizer facts.
Opaque external formatter fragments remain conservative, while formatters with
reconstruction recipes can participate in substitution.

The game now uses `input` and `next` directly and assigns recursive call results
directly to the branch result. `ok.go` is 339 lines, down from 371 after item 4,
and its scripted result remains `[[75,82,79],4]`.

`test/go/simplify.test.ts` covers copy chains, mutable snapshots, addressed cells,
pure expressions over stable inputs, immediate result forwarding, cleanup barriers,
double rounding, IEEE special values, overflow and effect/load order. The naming
tests now distinguish preserved source bindings from aliases that optimization can
remove. The CI execution gate includes the simplification tests.

Validation for simplification: TypeScript and scoped diff checks pass. The regular
suite passes 3142 tests with 75 skips and all 39 snapshots. The Go corpus passes
all 1592 tests. With `LAMINAR_EXEC=1`, all 61 simplification, placement, naming and
materialization tests pass (113 assertions). No remote CI was run.


## Item 6: dead values and partial aggregates

Tuple components and known constructor payloads now remain logical data through
bindings, moves, duplication, replacement and tuple joins. A consumer requests only
the components it needs. For example:

```laminar
{let (a, _) = (1, charList("discarded"))
 a}
```

The generated function returns `1.0` without building the tuple or calling the
list constructor. Matching a known constructor can inspect its logical payload
without allocating its physical union representation. Literal payload checks and
unmatched-case traps remain. Tuple joins materialize only the demanded fields.

Discarded calls still execute in their original order, including calls returning
unit, input, and closure capture effects. Explicit lens restoration also remains.
Moves and duplication snapshot demanded components at the original sequence point,
so a later write cannot change an earlier copied value. This extends the
demand-driven materialization from item 1; it does not infer call purity or remove
calls based on their unused results.

Function calls and opaque values retain their existing ABI and representation.
Passing a whole aggregate still builds that aggregate. Constructor facts are used
where locally available; dynamic values continue to use runtime tag checks.

`test/go/dead-values.test.ts` covers discarded tuple fields, nested data,
constructor payloads, joins, replacement, effects, traps, cleanup and snapshots
through thin and scattered lenses. The CI execution gate includes these tests.
Regenerated `ok.go` is 338 lines and still produces `[[75,82,79],4]` for the
scripted game.

Validation: TypeScript and scoped diff checks pass. The regular suite passes
3152 tests with 97 skips and all 39 snapshots. The Go corpus passes all 1592
tests. With `LAMINAR_EXEC=1`, all 93 focused Go tests pass (165 assertions).
No remote CI was run.


## Item 7: control flow

Exhaustive Boolean matches now emit `if condition { ... } else { ... }`, including
matches that list `false` first. Individual Boolean tests also use the condition
or its negation. A wildcard ends the chain with `else`, or becomes `default` in
a switch; a leading wildcard emits its body directly.

String literal matches with distinct labels use `switch`. Dynamic union matches
use a switch on the tag when every payload pattern is irrefutable. Payload guards
and duplicate labels retain ordered tests. Locally known constructor payloads keep
item 6's logical representation rather than building a union merely to switch on
its tag. Partial matches retain an unmatched-case panic; complete Boolean and
union-tag matches omit it.

Both value matches and selected-lens matches use this lowering. Arm bodies still
join before subsequent cleanup and restoration; no early returns are introduced.
Declaration placement treats each switch clause as a scope and lifts shared cells
before the whole switch, never between case labels.

`test/go/control-flow.test.ts` covers Boolean arm order, string and union switches,
payload guards, duplicate labels, shared declarations, effects, selected-lens
restoration and partial-match traps. It is included in the CI execution gate.
Regenerated `ok.go` is 332 lines and still produces `[[75,82,79],4]` for the
scripted game.

Validation: TypeScript and scoped diff checks pass. The regular suite passes
3158 tests with all 39 snapshots. The Go corpus passes all 1592 tests.
The focused Go execution suite passes all 111
tests (200 assertions), including selected-lens restoration through string
switches. No remote CI was run.


## Item 8: redundant writes and initialization

Restoration now omits a write when the current data carries the same live storage
address and layout as the destination. This uses the lowerer's address metadata,
not a comparison of printed assignment text. Snapshot values do not carry that
live-address fact, so restoring a saved value after a mutation still writes it.
Changed owners and separate replacement endpoints also retain their writes.

Fresh zero-valued locals use typed `var` declarations. If declaration placement
hoists a cell, its original initialization remains an assignment at the original
sequence point, including a zero reset: a shared cell may be reused by later
closure invocations. Negative zero retains its explicit IEEE representation.
Logical empty-slot data and branch state tracking remain unchanged.

Adapter backing is freshly zeroed before read fields are populated, so its
replacement fields need no extra zero assignments. Read fields already containing
the default value also need no assignment. Escaping backing still allocates with
`new`, and hoisted backing retains its reset at the original sequencing point.

`test/go/redundant-writes.test.ts` covers live-address restoration, changed owners,
snapshots, thin and scattered lenses, type-changing replacements, repeated calls,
manual cleanup, negative zero and shared-cell resets. It is included in the CI
execution gate. `ok.go` no longer contains the unchanged-state writes at the ends
of `step` and `nextGuess`; the latter can now return `laminarRound(v2)` directly.
The file is 324 lines and the scripted result remains `[[75,82,79],4]`.

Validation: TypeScript and scoped diff checks pass. The regular suite passes
3163 tests with all 39 snapshots. The Go corpus passes all 1592 tests, and the
combined focused Go execution suite passes all 125 tests (216 assertions).
No remote CI was run.


## Item 9: lens staging and aggregate reconstruction

Ordinary homogeneous calls now keep their results in the backing used by the
call. Logical storage retains live endpoint addresses rather than immediately
copying out a detached aggregate. A later compatible call can point into that
backing, and returning a whole value can read the aggregate already stored there.
For example, two sequential updates of an owned scalar now share one backing cell.

When the requested lens ABI and all live endpoint addresses match an incoming
parameter, the call passes that parameter directly. The game now emits
`nextGuess(nil, v4, state)` and forwards the scattered `step` parameter
directly on recursive calls. Thin-to-scattered calls still construct the required
pointer tuple, using pointers into the existing aggregate rather than a new copy.

Reuse requires a non-escaping call, no active restoration frontend or staging
completion, and no separate replacement endpoint anywhere in the lens. The ABI's
optional `restore` and `context` fields alone do not indicate an active frontend;
the logical lens's completion facts determine eligibility. Whole-lens forwarding
also checks endpoint order, identity and layout. Equal values are insufficient.

Partial reuse preserves existing endpoints and stages detached components into
fresh fields. Logical updates that replace a value lose its old live-address
fact, so subsequent calls stage the new value. Moves and duplication still
snapshot demanded data at their original sequence points, keeping earlier copies
independent of later mutations to reused backing. Declaration placement retains
the backing's required scope, and Go's GC preserves its lifetime.

Type-changing calls retain separate typed read and replacement fields. Returned
lenses keep their allocated staging, and manual, selected and other restoration
frontends retain the existing completion path. No callable ABI or public layout
changes are required.

`test/go/lens-staging.test.ts` covers whole-lens forwarding, endpoint order,
sequential calls, whole and scattered tuples, mixed storage, snapshots, moves,
branch joins, projections, type changes, returned lenses, manual cleanup and
indirect calls. It is included in the CI execution gate. Regenerated `ok.go` is
323 lines; its shorter calls and direct backing reads retain the scripted result
`[[75,82,79],4]`.

Validation: TypeScript and scoped diff checks pass. The regular suite passes
3169 tests with all 39 snapshots. The Go corpus passes all 1592 tests.
All 145 focused Go execution tests pass
(240 assertions), including reordered endpoints and restoration boundaries.
No remote CI was run.


## Item 10: type names and declaration reachability

Scalar layouts now use `float64`, `bool` and `string` directly. Other layouts use
names derived from their semantic type or physical role, such as `Unit`,
`Direction`, `Tuple_Number_Number_Number`, `Lens_float64`, and
`Scattered_Lens_float64_Lens_float64_Lens_float64`. Environments and callable
records include their capture or signature shape. ABI names include their typed
signature and a stable key fingerprint, preserving separate concrete ABI identities.
Long names are bounded; collisions are escaped and disambiguated in the Go package
namespace. Local naming reserves the generated type and tag names as well.

Union tags use typed constants such as `Direction_Higher` and `Direction_Lower`
in construction, matching and result printing. The stored numeric tag values and
payload representation remain unchanged. Recursive data still uses its original
boxed edges, and distinct nominal layouts are not structurally merged.

Backing definitions are shared only when their complete ordered field names and
Go types match. Their names describe the field types and include a fingerprint.
Individual allocations and logical storage cells remain separate. In particular,
different callable ABI types keep different backing definitions even if their
printed function signatures have the same shape.

After lowering and local simplification, a conservative package dependency graph
starts at `main` and retains reachable functions, types, tag constants and globals.
Its Go lexer ignores interpreted strings, rune literals, raw strings and comments;
spelling a helper name in source text cannot keep that helper alive. Reachable
recursive declaration cycles remain intact, unreachable cycles disappear, and
package initializer effects and `init` functions are roots. Imports are retained
only when the remaining code uses their package selectors. This is package-level
pruning; local demand and declaration placement still use expression metadata.

The game no longer emits unused callable and environment layouts, ABI types,
scalar aliases or `printString`. `ok.go` is 267 lines and still produces
`[[75,82,79],4]` for the scripted game.

`test/go/types.test.ts` covers primitive names, nominal tags, backing sharing,
recursive reachability, literal-aware pruning, initializer roots, naming stability,
collisions and callable captures. It is included in the CI execution gate. Existing
emission assertions now check descriptive types rather than numbered aliases.

Validation: TypeScript and scoped diff checks pass. The regular suite passes
3176 tests with all 39 snapshots. The Go corpus passes all 1592 tests, and all
160 focused Go execution tests pass (277 assertions). No remote CI was run.
