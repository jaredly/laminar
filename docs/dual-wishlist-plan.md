# Plan for the dual-mode wishlist

Responds to `dual-wishlist.md` (what `examples/tic-tac-toe.lm` wanted). Ordered by value per unit of
work. Each stage is independently shippable and ends with the example simplified to use it.

## Findings

- `dup(~p)` already works on a plain binding (`let mut m = dup(~p)` is fine). What the wishlist
  calls "no copy" is really that `dup(p)` is rejected: a bare `p` reads as a shared value, which
  does not match `dup`'s lens parameter (`mode-mismatch`).
- `<`, `>`, `!=`, `%` and `!` already parse and have precedence (`src/laminar-helpers.ts`), but no
  runtime import exists, so they fail with `unbound-name`.
- `-1` is a syntax error (`0 - 1` works). `type Option<a> = ...` is a syntax error too, so
  generic unions need their real syntax checked before promising an `Option` example.
- `p[0]` on a plain vector is `index-value`: indexing is only defined as a lens.

## Decision: one `dup`, two forms

`dup(~x)` stays for a place; `dup(e)` is new for a value. No `copy`/`own`, and no implicit dup:
a copy of a deep structure is never cheap, so it stays visible (the earlier decision in
`mut-and-linear.md`).

- `dup(~x)`: copies the focused data of a `mut` or plain binding; the binding is restored.
- `dup(e)`: `e` is a plain read or any expression; the result is an owned deep copy.
  - A plain binding `x` rewrites to `dup(~x)`. Any other expression `e` rewrites to
    `{ let t = e; dup(~t) }` with a fresh `t` (shared, so the existing path applies).
  - `dup(m)` where `m` is a `mut` binding is an error (`dup-of-owned`): it would move `m` and then
    copy it, which is never what is meant. The message points to `dup(~m)`.
  - Scalars: `dup(1)` is a copy of a scalar, which the backends already make for free.

Both rewrites happen in `src/desugar-plain.ts`, which already knows binding kinds, so inference and
the backends do not change. The `shared-into-mut` message gains "use `dup(x)`".

## Stages

1. **`dup(value)`** (wishlist 1). The rewrite and the `dup-of-owned` error above. Tests in
   `test/ownership.test.ts`: plain binding, plain expression, mut binding error, `board[i] :=
   dup(player)`. Docs: `mut-and-linear.md`. Then `tic-tac-toe.lm` drops `claim`.
2. **Numeric operators** (wishlist 2 and 4). Add `<`, `>`, `!=`, `%` as `numeric(...)` runtime
   imports in `src/runtime-imports.ts`, plus `!` on `Bool`. `%` is the ECMAScript remainder (sign of
   the dividend); C uses `fmod`, Go uses `math.Mod`. Every import needs the reference, C and Go
   implementations, and a probe in `test/runtime-imports.test.ts`. `tic-tac-toe.lm` can then use
   `%` for the player and `!=` for the invalid-square test.
3. **Syntax sugar** (wishlist 4). Parser-level desugarings, no new semantics:
   `if c then a else b` to `match c { true -> a  false -> b }`; `a && b` and `a || b` to nested
   matches (short-circuiting); negative literals as unary minus on a literal (`-1` is `0 - 1`).
   Decided: land these in both modes. They are pure sugar over constructs both modes already
   have (`match`, `true`/`false`, subtraction), so the grammar and desugaring are shared and pure
   programs gain syntax without any change to their typing or lowering.
4. **Reads from a shared vector** (wishlist 3). `v[i]` on a plain binding yields a *shared*
   element instead of `index-value`.
   - New native `get(reads number, reads Vector<a>) -> shared a`, which traps like `[]` when out
     of range. It is the first import with a shared result, so `ImportConvention` gains `'shared'`
     for results, `checkConventions` accepts a shared result for `plain(a, SHARED)`, and
     `checkReads` skips the result-variable rule when the result is itself shared (sharing is not
     keeping an owned copy).
   - `desugar-plain` rewrites a value-position `p[i]` rooted at a plain binding to `get(i, p)`;
     `p[i][j]` nests. `v[i]` on a `mut` root stays the lens.
   - Backends: Go aliases the element; C returns the element retained with `shareValue`
     (scalars copy). The concrete verifier needs `get` results to count as shared reads.
   - Then `tic-tac-toe.lm` helpers take a plain `board` and drop the `~board` threading.
5. **Generalized `==`** (wishlist 2). The largest change, so last. `==` becomes
   `(reads a, reads a) -> Bool` with an equality constraint: `a` must contain no function, lens or
   linear type. Numbers keep the IEEE native (NaN unequal to itself); everything else uses
   structural equality, lowered to one generated function per layout (strings, Bool, tuples,
   records, unions, vectors) in C and Go, and a structural compare in the reference evaluator.
   Delivered in two steps: (a) `String` and `Bool`, which needs the constraint mechanism and the
   string/bool equality runtime; (b) the recursive layouts. After this the board can hold `"."`,
   `"X"` and `"O"`.

## Not planned now

- **Implicit dup** for `let mut x = <plain>` or `x := <plain>`: rejected above.
- **`toString`:** interpolation already converts numbers; revisit when something needs it
  outside a string.
- **Loops and `range`:** the language is recursive and has no prelude, so a helper belongs with a
  library story rather than the compiler. `snake.lm` keeps its own.
- **`Option`:** a user-level union once the generic type syntax is confirmed; not a compiler change.

## Checks per stage

Each stage runs `bunx tsc --noEmit` and the full suite, and `LAMINAR_EXEC=1 bun test` when it
touches a backend (stages 2, 4, 5). Stages 1 to 4 also regenerate `examples/tic-tac-toe.lm` and its
C/Go output with `examples.sh`.
