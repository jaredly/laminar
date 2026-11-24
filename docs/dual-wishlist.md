# Dual-mode wishlist

Language features that would have made `examples/tic-tac-toe.lm` simpler, ordered by impact.
Each item names the workaround the example uses today.

## 1. Turn a plain value into an owned one

Done: `dup(x)` on a plain value (see `dual-wishlist-plan.md`). Original notes:

- `board[square] := player` fails with `shared-into-mut`, and so does `let mut mark = player`.
  The implicit dup for `let mut x = <plain>` only seems to work for literals and call results.
- Workaround: `claim(player)` matches on the value and returns a fresh literal.
- Wanted: a `copy(x)` / `own(x)` builtin that deep-copies a plain value into an owned one, so
  `board[i] := copy(player)` works. Alternatively, apply the implicit dup to assignment and to
  `let mut` from any plain scalar.

## 2. Generalized `==` and more comparisons

- `==` is numeric only, so cells are numbers (0 empty, 1 for X, 4 for O) and a `symbol` function
  converts them back to strings. The 1/4 encoding exists so line sums are unambiguous (3 or 12).
- Wanted: equality on strings, Bools, tuples, records and unions, so the board can hold
  `"."`, `"X"` and `"O"` directly.
- Also missing: `<`, `>` and `!=` (only `>=` and `<=` exist).

## 3. Read vector elements from a shared value

- `board[a]` on a plain vector is rejected with `index-value: Vector elements are accessed
  through a lens`. Every read is `dup(~board[i])` inside an `at` helper, and `~board` is threaded
  through `row`, `render`, `lineOwner`, `winnerIn` and `winner`.
- Wanted: `v[i]` on a shared vector yields a shared element. Those helpers could then take a
  plain `board`, and `render` could be called on a frozen snapshot.

## 4. Smaller things

- **Modulo or a parity check.** `player` is a separate parameter and `other` flips it, because
  `turns % 2` isn't available.
- **Number to string.** Interpolation converts numbers, but a `toString` function would help
  elsewhere.
- **Negative literals / `Option`.** `parseSquare` returns `9` for invalid input. I didn't test
  whether `-1` parses; an `Option` type (see the commented-out `Some`/`None` in
  `examples/deep-update.lm`) would be better still.
- **`if`, `&&`, `||`.** `match (x == 9) { true -> ... false -> ... }` is heavy nesting for a
  two-way branch, as in `takeTurn`.
- **Loop or `range` helper.** The eight win lines are a hand-written list of tuples. Anything
  board-sized wants a loop; `examples/snake.lm` already hand-rolls `range`.
