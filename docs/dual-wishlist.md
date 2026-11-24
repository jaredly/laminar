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

## 5. What a terminal game needed (snake)

`examples/snake.lm` added three runtime imports and one string escape:

- `waitKey(ms)` waits up to `ms` for one byte of stdin and returns it as a string, or `""` on a
  timeout or end of input. On a terminal it switches off line buffering and echo only for the
  duration of the call (termios in C, `stty` in Go), so a crash cannot leave the shell raw. The
  reference evaluator ignores the timeout. The Go version costs about 25ms per call for `stty`.
- `write(s)` prints without a newline and flushes.
- `random(n)` returns an integer in `[0, n)`. It is xorshift32, seeded from `LAMINAR_SEED` when set,
  so a fixed seed gives the same numbers on every backend; otherwise from the clock.
- `"\e"` in a string literal is ESC, for `"\e[H\e[2J"` (clear screen).

Still wanted:

- **Arrow keys.** They arrive as three bytes (`ESC [ A`), which `waitKey` returns one per call. A key
  union (`Up | Down | ...`) decoded in the host would be nicer than WASD.
- **Linear terminal handle.** `enterRaw()` returning a `type linear` value that `leaveRaw` consumes
  would let the compiler enforce the restore, instead of toggling raw mode inside every `waitKey`.
- **A fixed frame length.** `waitKey` returns as soon as a key arrives, so holding a key speeds the
  snake up. A `sleep(ms)` or a `waitKey` that always waits out the full time would pace frames.
- **A `"@"` string literal does not parse** (`"@"` inside a `match` arm is `Unrecognized top-level
  item`); snake draws the head as `O` for that reason. Worth a separate look at the lexer.
- **Scripted keys in `ir->` fixtures.** `setInput` and `logs()` cover line input; there is no
  equivalent for `waitKey`, so `test/examples.test.ts` drives the reference evaluator directly.

## 6. What writing a bmp needed (mandelbrot)

`examples/mandelbrot.lm` added one runtime import:

- `writeFile(path, bytes)` consumes a path and a `Vector` of numbers and writes them as bytes,
  replacing the file. Each element must be an integer in `[0, 255]`, and a failed write traps. Native
  and Go write identical files; the shared samples check the bytes on every backend.

Still wanted:

- **`%` binds looser than `-`.** `n - n % 256` parses as `(n - n) % 256`, and `7 % 4 * 2` is
  `7 % (4 * 2)`. Everything touching `%` in the example is parenthesised; the first version indexed
  out of bounds without saying why. `%` should sit with `*` and `/`.
- **Integer division and bit operations.** Splitting a number into little-endian bytes is
  `(n - (n % 256)) / 256`; `floor`, `div`, `>>` and `&` would say what is meant.
- **Building a byte vector.** There is no source-level append, so the example sizes the vector with
  `array(n, 0)` and fills it by index. Writing a computed value into an element works, but a plain
  variable needs `dup(...)` first.
- **A byte type.** Bytes are doubles in `[0, 255]`, checked at the host edge, so a 21.6 MB image is
  a 173 MB vector. After the backend fixes below, the stores into that vector are what is left:
  over half of the Go profile at 3000 x 2400, and most of the gap to hand-written C.
- **`readFile`.** Nothing reads a file back, so tests check the bytes from outside the program.
- **Slow reference evaluator.** The full 150 x 120 image exceeds the reference step limit, so the
  test shrinks it with a source substitution.

### Performance, measured

`examples/mandelbrot-comparison.c` is a hand-written C version that writes the same bytes
(checked at 150 x 120, 1500 x 1200 and 3000 x 2400). CPU seconds, best of 7, `clang -O2`:

| size | hand-written C | Laminar C | Laminar Go |
|---|---|---|---|
| 1500 x 1200 | 0.05 | 0.07 | 0.14 |
| 3000 x 2400 | 0.21 | 0.31 | 0.31 |

Fixed along the way: C `writeFile` called `fputc` per byte (now one `fwrite`: 0.15s to 0.07s at
1500 x 1200); Go made a real call for every self tail call (now a `for` loop, `src/go/tail-calls.ts`:
0.32s to 0.14s); and Go's `math.Mod` is a software loop, which `rowBytes()` paid for on every pixel
(whole numbers now take an integer path: 0.57s to 0.31s at 3000 x 2400).

Measured and left alone: bounds checks on vector access (about 3% of the Go profile) and filling
the vector in `array` (about 6%). Compute is at parity with hand-written C; what remains is the
8-byte element and, in C, the fixed cost of an extra copy into a byte buffer in `writeFile`.

