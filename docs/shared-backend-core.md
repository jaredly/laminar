# Shared imperative backend core for Go and C

Status: proposal, with step 1 in progress. Related:
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
| Package reachability | `go/reachable.ts` | Lexes printed Go source |
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

Still to do for C: parameter and local names (`arg0` and `v12` remain), and
named union-tag constants. The Go versions of both live in `go/lower.ts`, so
they belong with step 4 rather than this extraction.

### Step 2: give `GoLocals` a real expression tree

Replace the text-keyed `Recipe` map with an expression tree in the style of
`zig/ast.ts`, still printed only as Go. This is a pure refactoring, checked by
byte-identical `ok.go` and the focused Go tests.

### Step 3: move the tree and passes into `src/backend/imperative/`

Replace `{ head: string; body }` statements with structured `if`, `switch` and
`case` nodes. Base reachability on declaration dependencies instead of lexing
printed text. Go prints from the shared tree.

### Step 4: port C onto the tree

First, emit nodes instead of strings. This removes the `(void)` suppressions and
gives C simplification and declaration placement. Then represent ownership
operations as explicit nodes, so that demand and dead-value logic can see them
and retain them. The ASan/UBSan C corpus is the safety net: a leaked or
double-freed value fails loudly.

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
