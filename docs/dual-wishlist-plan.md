# Plan for the dual-mode wishlist

Responds to `dual-wishlist.md` (what `examples/tic-tac-toe.lm` wanted). Ordered by value per unit of
work. Each stage is independently shippable and ends with the example simplified to use it.

## Findings

- `dup(~p)` on a plain binding used to be allowed as a special case, but only a `mut` binding can
  be borrowed with `~`. The wishlist's gap is that there was no way to write the copy of a plain
  value as a value: `dup(p)` was rejected (`mode-mismatch`) because a bare `p` is a shared read.
- `<`, `>`, `!=`, `%` and `!` already parse and have precedence (`src/laminar-helpers.ts`), but no
  runtime import exists, so they fail with `unbound-name`.
- `-1` is a syntax error (`0 - 1` works). `type Option<a> = ...` is a syntax error too, so
  generic unions need their real syntax checked before promising an `Option` example.
- `p[0]` on a plain vector is `index-value`: indexing is only defined as a lens.

## Decision: one `dup`, two forms

`dup(~m)` copies a `mut` binding (a place); `dup(e)` copies a value. No `copy`/`own`, and no
implicit dup: a copy of a deep structure is never cheap, so it stays visible (the earlier decision
in `mut-and-linear.md`). Source can no longer borrow a plain binding at all, so `dup(~p)` and `!p`
on a plain `p` are `plain-lens` errors that point to `dup(p)`.

- `dup(~m)` / `!m`: copies the focused data of a `mut` binding; the binding is restored.
- `dup(e)`: `e` is a plain binding or any expression; the result is an owned deep copy.
  - It lowers to the unshared flavour of what a plain read already becomes internally (the `share`
    read is the same call, flagged); that is internal IR, never source. A non-binding expression
    is bound to a plain temporary first.
  - `dup(m)` where `m` is a `mut` binding is an error (`dup-of-owned`): it would move `m` and then
    copy it, which is never what is meant. The message points to `dup(~m)`.
  - Scalars: `dup(1)` is a copy of a scalar, which the backends already make for free.

Both rewrites happen in `src/desugar-plain.ts`, which already knows binding kinds, so inference and
the backends do not change. The `shared-into-mut` message gains "use `dup(x)`".

## Stages

1. **`dup(value)`** (wishlist 1). **Done.** `dupValue` in `src/desugar-plain.ts`; `tic-tac-toe.lm` no longer has `claim`. The rewrite and the `dup-of-owned` error above. Tests in
   `test/ownership.test.ts`: plain binding, plain expression, mut binding error, `board[i] :=
   dup(player)`. Docs: `mut-and-linear.md`. Then `tic-tac-toe.lm` drops `claim`.
2. **Numeric operators** (wishlist 2 and 4). **Done.** `<`, `>`, `!=` and `%` are runtime imports
   (`src/runtime-imports.ts`) with reference, C and Go implementations. The comparisons are
   infix on every backend (`infixImports` lists them); `%` is the ECMAScript remainder (sign of
   the dividend), spelled `fmod` in C and `math.Mod` in Go. `test/numeric-operators.test.ts` checks
   negative operands, fractions and NaN against the reference evaluator on native (sanitized) and
   Go. Bool negation is the prefix
   `not` (Python style; `!x` is already the source spelling of `dup(~x)`). `not` is a reserved
   word in both modes and negates the whole infix expression after it: `not a == b` is
   `not (a == b)`. It is the `not` runtime import (`!` in C and Go). The corpus function
   `fn not` in `test/flow.test.lm` was renamed `negate`.
3. **Syntax sugar** (wishlist 4). **Done**, in both modes (pure sugar over `match` on `Bool`,
   so typing and lowering are untouched). `if c then a else b`, with `else if` chaining; each
   part may be an infix expression, and a nested `if` elsewhere needs braces. `a && b` and
   `a || b` short-circuit (`match a { true -> b  false -> false }` and the mirror); `||` binds
   looser than `&&`, which binds looser than the comparisons. `not` negates up to the next `&&` or
   `||` and may follow them (`a && not b`). `-1` and `-x` are unary minus: a literal negates in
   place, anything else is `-1 * x`, so `-0` stays right. `if`, `then` and `else` are reserved.
   The tokens are parsed flat (`IfPart` in `src/laminar.cst`, `infixOf` and `ifExpr` in
   `src/laminar-helpers.ts`). `tic-tac-toe.lm` uses `if` and `5 - player`.
4. **Reads from a shared vector** (wishlist 3). **Done**, and smaller than planned: no `get`
   native and no new import convention. A field read of a plain binding was already a `share` read
   of a borrowed place (`dup(~p.f)`, internal only), so `desugar-plain` now treats a value-position
   place under a plain root the same way, whatever mix of fields and indexes it has
   (`placeOf`/`rootOf`): `p[i]`, `p[i][j]` and `p.f[i]` become share reads of the lens place, which
   uses the existing `[]` native (so it traps out of range like the lens) and the existing share
   path in each backend (C retains the element, Go aliases it). `v[i]` on a `mut` root is still
   `index-value`; assigning through a plain root is still `plain-lens`; storing an element into
   `mut` storage needs `dup(p[i])`. Tests in `test/shared-storage.test.ts` include native
   (sanitized) and Go runs.
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
