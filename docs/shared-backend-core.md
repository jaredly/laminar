# Shared imperative backend core for Go and C

Status: steps 1–4 implemented, with follow-up slices in progress before step 5. Related:
[readable compiler output](compiler-output-readability.md),
[C backend](c-backend.md), [Go plan](go-codegen-plan.md),
[Zig plan](zig-codegen-plan.md).

## Problem

The readability work recorded in
[compiler-output-readability.md](compiler-output-readability.md) improved only
the Go output. The C output still has the problems that work fixed for Go:
traversal-numbered functions (`fn0`), numbered layouts (`L4`), numbered
temporaries (`v13`), and a `(void)v13;` after every local. Most of the issues
are the same in both languages. Only some depend on the target: ownership,
closures, parallel assignment and string switches.

Readability did not transfer because of how the code is built. `src/go/lower.ts`
and `src/c/lower.ts` were forked from one lowerer. Each is one closure that goes
straight from `ConcreteProgram` to target text. They still have the same
per-instruction cases and the same `Storage`, `read`, `endpoint`, `incoming` and
`flush` helpers. Go's readability work is attached to that code in four ways:

| Mechanism | Location | How target-specific |
| --- | --- | --- |
| Name allocation, source function/parameter names | `go/names.ts` | Neutral except the reserved-word sets |
| Semantic type labels (`Tuple_Number_Number`, `Lens_…`, tags) | `go/types.ts` | Neutral except scalar spellings |
| Terminal join write-back | `go/writeback.ts` | Neutral; the parallel-assignment hook is target-specific |
| Copy propagation, folding, declaration placement | `go/locals.ts` (`GoLocals`) | Algorithm neutral, but it tracks recipes by *printed Go text* and prints Go literals itself |
| Package reachability | `backend/reachable.ts`, `go/reachable.ts` | Shared layout/ABI graph; Go still lexes functions and imports |
| Demand-driven materialization, partial aggregates, backing reuse, match simplification, direct-call signatures | interleaved in `go/lower.ts` | Mostly neutral decisions, mixed into Go string building |

Separately, `src/zig/ast.ts` already uses the intended architecture: a small
`Expr`/`Stmt` tree plus a `tidy` pass. It is a third, independent version of the
same simplification idea.

## Target architecture

```
ConcreteProgram
  → shared imperative lowering
       typed locals; field / deref / address / call / construct;
       tag tests; if / switch / case nodes; closure nodes;
       explicit drop / dup / free nodes
  → shared passes
       demand and dead values, copy/constant simplification,
       declaration placement, terminal write-back, match → if/switch,
       structural reachability, naming
  → thin printers: Go, C (and Zig)
```

Each target provides a small capability description:

- **Memory management.** Go has a GC, so `drop` and `dup` print as nothing. C
  keeps them. Dead-value elimination must never remove disposal of an owned value.
- **Parallel assignment.** Go prints the write-back form directly. C introduces
  temporaries so all right-hand sides are evaluated before any store.
- **Closures.** Go prints restoration closures as function literals. C lifts them
  to a static function plus a context record, as it already does through
  `allocate_context`.
- **Switch on strings.** Go has it. C lowers string matches to an `if` chain.
- **Spelling.** Reserved words and predeclared names, scalar type names
  (`float64` and `double`), declaration syntax, and the representation of special
  floating-point constants.

## Migration plan

A single rewrite of two 2,000-line lowerers is too risky. Each step below can
be reviewed on its own and keeps both corpora passing.

### Step 1: extract the already-neutral pieces

- Move `Storage` into `src/backend/storage.ts`, generic over the leaf data type.
  Go's leaf adds `address`, `constructed` and deferred `key` expressions; C's
  leaf is the plain `{ expression, layout }` shape.
- Move the name allocator, `functionNames`, `patternSlots` and `sourceBinding`
  into `src/backend/names.ts`. Each target supplies its own reserved names
  and generated-name pattern.
- Move semantic layout labels into `src/backend/type-names.ts`. Each target
  supplies its scalar spellings.
- Use these in C. C gets source function names and descriptive layout names
  immediately.

Validation: Go's emitted text is unchanged (regenerated `ok.go` is identical,
and the Go focused tests and corpus pass). The C corpus passes under
ASan/UBSan.

Implementation:

- `src/backend/storage.ts` holds the generic `Storage<L>`. The Go, C and Zig
  `storage.ts` files now only define their leaf types.
- `src/backend/names.ts` holds `NameAllocator` (rules: reserved words plus a
  generated-symbol pattern), `functionNames`, `patternSlots` and
  `sourceBinding`. `go/names.ts` keeps Go's reserved sets as `GoNames`.
  `c/names.ts` defines `CNames`, which reserves C keywords, identifiers from the
  included libc headers, runtime symbols and hidden parameter names, and the
  generated helper families such as `drop_<Type>` and `vector_<op>_<Type>`.
- `src/backend/type-names.ts` holds `layoutNames` and `fingerprint`, and takes
  each target's scalar spellings. C uses `double`, `bool` (via `<stdbool.h>`)
  and a `String` typedef. C no longer emits typedefs for `double` and `bool`.
- C function, layout and ABI names come from one `CNames` namespace. Host
  export symbols are reserved first, so a source definition can never take one.

For `ok.lm`, C now declares `step`, `game`, `nextGuess` and `handleResponse`
over `Tuple_Number_Number_Number`, `Direction` and
`Scattered_Lens_double_Lens_double_Lens_double`, instead of `fn0`–`fn4` over
`L0`–`L12`.

Go's emitted text is byte-identical to its pre-refactoring output across all
769 corpus and sample programs, `ok.lm` included. `test/c/names.test.ts` covers
source and specialization names, and escapes for keywords, libc, runtime and
generated helpers. Its execution cases run natively. The exact-text C
expectations in `test/c/print.test.ts`, `test/c/branch-print.test.ts` and
`test/captured-cleanup.test.ts` were regenerated for the new names.

At this stage, C still had numbered parameters and locals and numeric union
tags. The follow-up slices below now provide source names and named tag
constants.

### Step 2: give `GoLocals` a real expression tree

Replace the text-keyed `Recipe` map with an expression tree in the style of
`zig/ast.ts`, still printed only as Go. This is a pure refactoring, checked by
byte-identical `ok.go` and the focused Go tests.

Implementation:

- `src/go/code.ts` defines `Node` (text, ref, scalar, binary, compose, opaque),
  `Code` (a node plus its Go spelling), `Expr = string | Code`, and `same`
  for comparing spellings. A plain string in an expression position is either a
  registered local name (a read) or literal text with no reads. Nothing looks up
  structure by printed text any more.
- `GoLocals` builds `Code` values from its template, join, format, binary,
  scalar and return helpers. `simplify` and `place` read structure from the
  nodes. The `reads` and `recipes` maps keyed by text are gone.
- `go/lower.ts` passes `Expr` through its expression helpers (`read`, `zero`,
  `incoming`, `flush`, `payload`, `declare`, `defer`, call building). Package
  text that is never optimized (type declarations, signatures, generated names,
  diagnostics) uses a separate `goText` tag that returns a plain string.
- Places that compared expressions by `===`, or relied on an empty string being
  falsy, now compare spellings with `same`. The text-equality checks on storage
  addresses in `lower.ts` and `writeback.ts` were among them. Empty code is
  still `''`, so `joinCode(parts) || fallback` keeps working.

Migration check: a temporary fallback resolved unknown strings by their text and
could be switched off. Corpus output was identical with and without it, so it
was deleted.

Output: `ok.go` is byte-identical. Of the 769 corpus and sample programs, 764
are byte-identical. The other 5 now inline a literal constant they previously
kept in a local, for example `if 4.0 == 4.0` instead of `v1 := 4.0` followed by
`if v1 == 4.0`, and `seek((k - 1.0), v19)`. The old code keyed a scalar's
recipe by its spelling. A later, unrelated expression with the same spelling,
such as a one-argument call's argument list `1.0`, overwrote that recipe, so
inlining depended on unrelated code. Constant folding still prevents Go constant
arithmetic between two literals.

Still Go-specific in `GoLocals`, for step 3: scalar spellings (`math.NaN()`),
declaration printing (`var x T`, `x := v`), and control-flow structure
recovered from `head` text (`if`, `else`, `switch`).

### Step 3: move the tree and passes into `src/backend/imperative/`

Replace `{ head: string; body }` statements with structured `if`, `switch` and
`case` nodes. Base reachability on declaration dependencies instead of lexing
printed text. Go prints from the shared tree.

Implementation:

- `src/backend/imperative/code.ts`: expression nodes, `Code`, `Expr`, `same`.
- `src/backend/imperative/statements.ts`: the statement tree. It has
  declarations and assignments, `IfChain` (one node per `if`/`else if`/`else`
  chain, where an arm without a condition is the `else`), `Switch` (a case
  without a label is the default), and opaque `Block` scopes for target-specific
  loops and closures. Traversal helpers: `expressions`, `bodies`, `mapScope`,
  `visit`.
- `src/backend/imperative/locals.ts`: the `Locals` passes (simplification,
  folding, adjacency fusion, pruning, declaration placement), parameterized by a
  `Syntax` that spells scalars and binary operations. `place` returns declaration
  and assignment nodes instead of Go text. A hoisted cell becomes a
  value-less `local` at the insertion point plus a `set` at its original point.
  Placement reads an `IfChain` or `Switch` as a single statement, so no
  declaration can split its arms. It no longer recognizes `if`/`else`/`switch`
  by their spelling.
- `src/backend/imperative/writeback.ts`: terminal join write-back, generic over a
  storage leaf that has `layout` and an optional `address`.
- Go keeps only its spelling: `goSyntax` and the printer in `go/syntax.ts`, the
  `GoLocals` subclass in `go/locals.ts`, and type aliases in
  `go/writeback.ts`. Go's runtime helpers, which never go through the passes,
  still spell their own control flow as `Block` heads.

Go output is byte-identical to step 2 across all 769 corpus and sample programs.

At this stage, `go/reachable.ts` still lexed all package-level text. The
structural-declaration follow-up below now shares layout/ABI edges with C.
Function bodies and imports still need explicit dependencies before reachability
is fully structural.

### Step 4: port C onto the tree

First, emit nodes instead of strings. This removes the `(void)` suppressions and
gives C simplification and declaration placement. Then represent ownership
operations as explicit nodes, so that demand and dead-value logic can see them
and retain them. The ASan/UBSan C corpus is the safety net: a leaked or
double-freed value fails loudly.

Implementation:

- `c/syntax.ts` provides `cSyntax` (C literal spelling, shared with lowering,
  plus `return v;`) and prints the shared tree. A value-less declaration prints
  as `T x = {0};`, since C locals have no default value. A switch case ends with
  `break;`. Restore and runtime helpers still use opaque `Block` heads.
- `lowerC` builds function bodies with a per-function `Locals(cSyntax)`. A `cc`
  template tag and `joinCode` track references. Package text (typedefs, struct
  declarations, signatures, helper names) uses a plain `cText` tag.
- `declare()` emits `Locals` declarations. Only literal constants and arithmetic
  natives are marked pure, and only arithmetic is marked inlinable. Loads,
  dereferences, calls and allocations keep their sequencing points, so nothing
  is ever evaluated after a `release_context`. Arithmetic natives use
  `Locals.binary`, so constant pairs fold. Otherwise C's integer literals
  could meet inline as integer division.
- Locals that raw statements write through or address are declared with
  `cell()`, which marks them mutable: closure environments, union boxes, lens
  backing, string builders and vector element pointers. They are never
  substituted or pruned, but placement can still hoist them.
- Phis, branch results, the selected-lens index and the focus cell are written
  with `locals.assign`. That blocks them from copy substitution automatically.
- Branches, selected-lens dispatch and restore dispatch emit `IfChain` nodes.
- The selected-lens "lift" pass is gone. It regex-matched `T v = rhs;` lines to
  hoist arm-local storage that deferred cleanup uses. Declaration placement now
  does this from tracked references.
- `(void)` suppression is computed, not blanket. After placement, `suppressUnused`
  marks only parameters and locals that no expression reads. C compiles with
  `-Wall -Wextra -Werror`, which rejects unused ones.

Effect on `ok.lm`'s C: 588 → 453 lines, and 110 → 15 `(void)` suppressions.
Copy chains, single-use constants and arithmetic temporaries are gone, and
branch results are assigned directly in their arms.

Ownership: drops, frees and disposals are expression statements that read the
values they release. That makes them roots for pruning, and copy substitution
never crosses them because only aliases (not loads) are substituted. They are not
separate node kinds. Making them explicit nodes is needed only once C adopts
demand-driven materialization, which can defer a load past a release.

Still C-specific or text-based:

- At this stage, the returned-lens restoration helper was printed, then had its
  captured frame locals rewritten to `ctx->name` by regex. The structured
  restoration follow-up below replaces this. Its body is still not simplified.
- C still materializes every instruction eagerly. Go's demand-driven
  materialization and partial aggregates (items 1, 6, 9) live in `go/lower.ts`.
- Union tags were still numeric at this stage; the follow-up below names them.

### Follow-up: source names and redundant writes in C

`src/backend/local-names.ts` now holds the per-function naming that Go used
(readability item 3): parameter names from binding records (`min_max_lastGuess`
for a destructured parameter), the source name each bound value prefers, the
binding a move or native lens operation reads, and versioned suffixes for later
storage versions (`lastGuess_2`). `hint` returns the raw binding and `takesName`
excludes constants and capture-free callables, which Go keeps distinct for its
inlining decision. Go uses it unchanged; its output is byte-identical.

C computes each body's names before declaring signatures, from a `CNames`
namespace that reserves every package name the body can call. A local declared
after a call to `inc` becomes `inc_2`. Parameters, bound values, moved
bindings, native lens reads and captures use these names; compiler temporaries
remain `vN`.

Source names can coincide with C field names (`read`, `tag`) or words in string
literals. At this stage, the restoration helper's capture rewriting therefore skipped members
after `.` or `->` and whole string literals. Before this, every frame local was `vN` or
`argN`, so plain identifier matching was enough.

Redundant restoration (item 8): C storage leaves carry Go's live-address fact.
`incoming` marks a parameter lens's endpoint reads with their pointers,
projections extend that address, and vector element lenses mark `*at`.
`flush` and element restoration skip a write whose data is still a live read of
the destination with the same layout. Snapshots carry no address, so swaps,
updates and type-changing replacements are still written. `ok.lm`'s
`nextGuess` no longer ends with three self-assignments, and now returns
`round_double(v1)` directly.

`test/c/locals.test.ts` covers source-named and unread locals, omitted and
retained restoration writes (unchanged, partially updated and swapped scattered
lenses), captured names matching C fields, and locals that would shadow a
called function. Each execution case runs natively against the reference
interpreter.

Validation: Go output is byte-identical to step 3. The native corpus passes all
1549 cases under ASan/UBSan at `-O0` and at `-O2`. Exact-text C expectations were
regenerated. One regex was relaxed, because copy substitution now calls an
indirect callee through its parameter directly (`(arg0).invoke0(...)`).

### Follow-up: shared constructor tag names

`src/backend/type-names.ts` now provides `unionTagNames`, extracted from Go's
lowerer. Both targets allocate `<Layout>_<constructor>` constants in their
package namespace. C allocates them before local names, so parameters and locals
also avoid the constants. Reserved host exports, functions, layouts and ABI names
keep priority; colliding constants receive the allocator's usual suffix.

C emits an anonymous enum per union, for example
`enum { List_Number_nil = 0, List_Number_cons = 1 };`. The stored tag remains
`uint32_t`, and variant indices and payload fields keep their existing ABI.
Construction, pattern tests, deep copy, cleanup, list printing, nominal printing
and `charList` construction now refer to these constants.

Validation: all 768 accepted corpus and sample programs plus `ok.lm` emit
byte-identical Go against the committed compiler. The C and Go suites pass
2,052 tests (135 execution cases skipped by default). The naming cases cover
constant declarations and uses, specializations, and reserved-package collisions;
the native naming execution cases pass. The 64 native nominal and string corpus
cases pass at sanitized `-O0` and optimized `-O2`. TypeScript checking passes.
The full native corpus also passes with the structured restoration slice below.

### Follow-up: structured C restoration captures

Returned-lens cleanup stays in the shared statement and expression trees until
printing. C finds the frame locals it needs through `Locals.reads` plus explicit
assignment targets, intersected with the locals that existed before cleanup was
built. Cleanup-local declarations stay local to the restoration helper.

`Locals.rewriteReferences` replaces expression reference nodes with context-member
expressions; C walks nested statements and rewrites captured assignment targets
as stores to those members. The regex scan and printed-text replacement are gone.
Member names are literal nodes, so a captured local named `read` never changes
another value's `.read` field. String literals, type names and package symbols
also retain their spelling. Unused-local suppressions carry tracked references.

String interpolation now uses a structured formatter with both the builder and
appended value as operands. In ordinary function bodies this also lets the existing
passes substitute aliases and inline pure constants that the opaque formatter
previously kept materialized. Rewriting a referenced opaque fragment fails explicitly
rather than silently leaving a frame reference in a lifted helper. Cleanup still
keeps its existing declaration placement and evaluation order; this slice does
not add simplification inside restoration helpers.

Validation: the C/Go and captured-cleanup suites pass 2,055 tests (136 execution
cases skipped by default). Focused native locals and captured-cleanup execution
cases pass under ASan/UBSan at `-O0` and at `-O2`, including the new captured
string interpolation case. Shared expression tests cover nested rewriting,
literal syntax preservation and rejection of opaque captured references. All 768
accepted corpus and sample programs, plus `ok.lm`, retain byte-identical Go output.
The full native corpus passes all 1,549 tests, including execution at sanitized
`-O0` and optimized `-O2`. This also completes the full native validation of the
preceding constructor-tag slice. TypeScript checking passes.

### Follow-up: structural declaration reachability

`src/backend/reachable.ts` provides `Declaration` (name, printed text, dependency
names and an optional initializer-effect root), `reachableNames` (an iterative
walk that handles recursive cycles), and `typeDependencies`. The latter builds
layout edges from value/pointer fields and callable ABI slots, and ABI edges from
parameter/result layouts. It never inspects generated text.

Go now attaches explicit metadata to every generated package declaration: layouts,
ABI types, union constants, backing records and the input-reader variable. Backing
record dependencies are recorded as their fields are built. The shared graph walk
replaces Go's private reachability traversal. The Go adapter still lexes function
signatures/bodies and import uses; raw-string declarations supplied directly to
`reachableGo` retain their compatibility fallback.

C uses the same layout/ABI graph to omit unreachable typedefs, struct forwards,
struct definitions and union constants together. Executable lowering records each
`type(id)` use as a root after the initial declaration-building phase. Every C
function, runtime helper and auxiliary backing/context declaration is still kept,
so all of their type uses are roots, including host-export adapters. Roots are
conservative: constructing an expression or local later removed by simplification
can still retain its type. Naming still reserves the full program namespace before
pruning, preserving collision behavior.

For a scalar entry such as `true`, C now emits no layout or ABI declarations.
Recursive payloads, callable field signatures and exported opaque handles retain
their transitive declarations. Exact-text C expectations were regenerated.
Focused tests cover unreachable recursive cycles, opaque pointers, ABI-only
references, field names that must not create graph edges, and effectful initializer
roots. Go output is byte-identical across all 768 accepted corpus/sample programs.
Validation: 156 focused tests pass (136 execution cases skipped by default),
and the full native corpus passes all 1,549 tests at sanitized `-O0` and optimized
`-O2`. The additional type-presentation execution cases pass on Go and native C.
Native and Wasm host-export checks pass; the Wasm check used a writable temporary
Emscripten cache and omitted the shell's macOS `CPATH`. TypeScript checking passes.

Remaining before broader unification: structural function/runtime/import
references (and C function/helper pruning), plus explicit ownership effects before
adopting Go's demand-driven materialization and partial aggregates in C. The next
follow-up does the C half of the first item.

### Follow-up: structural C function and runtime pruning

`References` in `src/backend/reachable.ts` records which package symbols each
generated declaration mentions, as lowering mentions them. Lowering wraps the
construction of a declaration in `within(owner, …)` and routes every mention of
another function, helper or runtime symbol through `use(name)`. A mention made
outside any owner has no owner and is a root. `graph()` turns the recorded edges
into the graph that `reachableNames` already walks; every mentioned name is a node,
so a declaration with nothing to mention is live once reached. `reachableNames`
itself is unchanged.

C uses it for functions, prototypes and runtime helpers:

- Every generated function is named and owns its mentions: source functions,
  union and vector helpers, native entries, disposers, result adapters and their
  restoration functions, and runtime functions. Shared helpers (`drop_List`,
  `vector_push_…`) use `within` so what they call is attributed to them, not to
  whichever function first created them.
- Function mentions are spelled through `use`: calls, `.invoke`/`.dispose`/
  `.restore` entries, `wrapperFunction`, the entry call in `main` and in each host
  export, and each runtime call (`allocate_context`, `release_context`,
  `string_*`, `builder_*`, `print_*`). `appendFunction(kind)` names the
  interpolation function so the same mapping serves the mention and the call.
- The string runtime declares its own dependencies: each function in
  `stringRuntime()` has an explicit `name` and `uses`. `live_contexts`,
  `allocate_context`, `release_context` and `print_number` are declarations like
  any other. A program that never allocates no longer emits the allocator.
- Prototypes, `LensResult`/`Restore` context typedefs and helper prototypes are
  `Declaration`s named after their function or type, so they leave with it.
- The roots are `main` for a program, and for a library every host export and its
  support code (built outside any owner). `laminar_live_allocations` mentions the
  counter.

Type declarations are still pruned by the earlier, conservative rule: every
`type()` mention is a root, including mentions made while building a function that
is later dropped. Making type roots follow the kept functions needs the types a
shared helper's *signature* mentions attributed to the helper rather than to its
first caller, since the factories receive those names already computed. That is the
next refinement here.

Effect across the 773 corpus and sample programs: 260 change, and C is 10% smaller
by lines (102,848 to 92,564). `examples/ok.lm`'s C drops from 436 to 360 lines, and
`snake.lm`'s from 178 to 132. Programs without strings emit no string runtime,
those that never interpolate omit the builder, and `print_number` appears only
when a Number is printed. Go output is byte-identical to `HEAD`.

Validation: `test/c/functions.test.ts` covers what is kept and dropped for scalar,
Bool, string-literal, interpolation, `dup` and match entries, checks that every
runtime or helper function any execution sample calls is defined, covers library
mode, and runs five programs natively. The native corpus passes under ASan/UBSan at
`-O0` and at `-O2`.

Still lexical: Go's function, import and type mentions in function bodies (its
declarations already carry explicit metadata). Moving them onto `References` is
the same pattern: `type(id)`, `codes.get(id)`, helper factories, `hostHelpers`,
`charLists`, `printers` and the runtime names would each call `use`.

### Follow-up: dead values, simpler matches and NULL environments in C

Reading the generated C after the earlier slices showed that the largest remaining
noise was not the lack of demand-driven materialization. It was four smaller things
that the existing eager structure can handle, so this slice does them first.

- **Unused results.** `LocalDeclaration` has an `effect` flag, set by C lowering for
  call declarations (direct, indirect and adapter calls, and native calls that are
  not arithmetic). In `Locals.simplify`, a call whose result nothing reads and that
  nothing writes becomes an expression statement at the same point, spelled by the
  new optional `Syntax.statement` (`f(x);` in C, the bare expression by default).
  A value without effects still goes only if it is `pure`. `Unit v34 =
  host_print_Unit(v33); (void)v34;` is now `host_print_Unit(v33);`. Go never has an
  unread effectful declaration, so its output does not change.
- **Removable values.** `declare` marks a declaration `pure` (removable, never
  movable) when its initializer is the layout's zero value, and the old-value read of
  a `swap` is marked the same way. An unread projection and an unread unit value
  disappear, together with their `(void)` lines.
- **Matches.** `emitMatch` follows Go's rules. A catch-all ends ordered matching and
  becomes the `else`, and a leading catch-all emits its arm directly. A match
  covering every constructor with irrefutable payloads is a `switch` over the named
  constants with no trap, and a missing constructor adds a `default` that aborts. A
  Bool match tests its condition once as `if (c) … else …`. Only a match that can
  fall through keeps `abort()`. This replaces `else if (1) {…} else { abort(); }`.
- **Environments.** A direct call whose callee has no captures (a wrapper of captured
  code takes its environment; an adapter takes its source's) passes `NULL` rather than
  `((Callable_…){0}).environment`. Indirect calls keep the record's environment.

Effect on the examples' C, before and after this slice: `ok.lm` 397 to 385 lines,
15 to 10 `(void)` lines and 7 to 4 `abort()` calls, with its `else if (1)` gone;
`deep-update.lm` 308 to 299 lines, 19 to 15 `(void)` and 12 to 8 `abort()`;
`snake.lm` 178 to 171; `bump.lm` 139 to 137. A `switch` adds lines for its braces
and `break`, so the gain in readability is larger than the line counts show:
`nextGuess` is a two-case `switch (direction)`, `step` and `handleResponse` call
with `NULL`, and the dead locals and their `(void)` lines are gone.

Not done, with reasons that this slice made clearer:

- Demand-driven materialization. With dead values and matches fixed, what remains
  is staged lens backing (`Backing3 back3 = {0}; back3.read0 = …`) and reconstructed
  aggregates. Those are Go's items 9 and 6, and they need Go's storage-reuse
  analysis, not just deferral. Explicit ownership nodes are not a prerequisite
  for the work done here: drops and releases already read the values they free, so
  nothing moves a read past one.
- Helpers still start with a blanket `(void)value;`.

Validation: Go output is byte-identical to `HEAD` across all 773 corpus and
sample programs. `test/c/control-flow.test.ts` covers each rule, including the
partial matches that must keep their trap, and runs ten programs natively.
Exact-text C expectations were regenerated, and one assertion that expected a tag
comparison now expects the named `case`.

### Follow-up: lens staging in C

Go's item 9 (reduce lens staging and aggregate reconstruction) is ported, with the
same rules. A call's lens argument is adapted in three tiers, tried in order:

1. **Forward.** For a synchronous call over storage that needs no restoration (not
   escaping, `finish === noFinish`, every endpoint a plain read pointer), if the
   lens denotes exactly the storage of an incoming lens parameter, the parameter is
   passed as is. "Exactly" means every endpoint has the same live address and layout;
   equal values do not count. `step` passes `min_max_lastGuess` straight to
   `handleResponse` and to its own recursive call.
2. **Point at live endpoints.** Otherwise each endpoint that already has a live address
   is pointed at directly, `(Lens){.read = (state).item0.read}`, and only the others are
   staged into a stack backing. A lens whose endpoints are all live needs no backing at
   all.
3. **Keep results in place.** A staged call's results stay in the backing: the logical
   storage keeps the backing fields' addresses rather than copying out a detached
   aggregate. A later compatible call points into the same backing, so two sequential
   updates of one scalar share one cell, and reading the result is `back0.read0`
   rather than rebuilding a tuple.

Type-changing calls keep separate typed read and replacement fields, and an escaping
lens keeps heap backing with every field written (heap memory is not zeroed). A lens
with a restoration frontend keeps the earlier copy-out path.

Two supporting changes. A `lens-tuple` whose items all need no restoration now needs
none itself, which is what let `step` be recognized; C always built a fresh closure
before. And the incoming parameters are recorded so a call can find one to forward.
The single thin-lens shortcut added for in-place boxes stays: it is the one place a
lens with a restoration frontend can still be passed by address.

Effect on the examples' C: `ok.lm` 385 to 343 lines, with one backing left (in `game`,
where `state` is an owned local that must be staged); `handleResponse` and `step` no
longer rebuild their lens. Go output is byte-identical.

Left alone: `Backing` typedefs are still one per call site rather than shared by field
layout as in Go, and a staged zero is still written over its zero-initialized backing
(`back0.read0 = 0;`), because the zero is a named constant until the passes fold it.

Validation: `test/c/lens-staging.test.ts` checks forwarding, backing reuse across
sequential calls, typed and heap staging, and runs fifteen of Go's staging cases
natively (reordered endpoints, snapshots before reuse, moved owners, branch joins,
partial projections, type changes, returned-lens restoration, cleanup order, indirect
calls).

### Step 5: unify the per-instruction lowering

Merge the two per-op lowerers behind the capability interface. Decide after
step 4 how far to go: the restoration-closure and ownership paths may differ
enough to justify keeping some per-target code. Folding Zig's `tidy` into the
shared passes should be cheap at this point.

## Risks

- **Ownership versus dead values.** Go can discard an unused aggregate. C must
  still free its owned parts. The shared demand pass must treat disposal as an
  effect.
- **Restoration closures in C.** Declaration placement keeps cells shared with
  Go closures alive by scope. In C, a lifted closure's context holds pointers to
  those cells. Their lifetime must cover every invocation of the closure.
- **Parallel write-back in C.** Temporaries must preserve the swap and aliasing
  behavior that `go/writeback.ts` tests.
- **Determinism.** Shared naming must keep each target's emitted names stable
  when unrelated declarations are added.
