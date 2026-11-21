# Laminar compiler: usage, support and restrictions

This is the user-facing summary of the compiler as of phase 7 of the
[C code generation plan](c-codegen-plan.md). The design notes live in
[the C backend](c-backend.md), [typed IR](typed-ir.md) and
[ABI-keyed callable representations](abi-callable-representations.md).

## Running the compiler

```
bun cli/laminar.ts check <file>
bun cli/laminar.ts emit  <file> [--target native|wasm32|go] [-o <path>] [--concrete]
bun cli/laminar.ts emit  <file> --export <name,...> --header <path> [-o <path>]
bun cli/laminar.ts run   <file> [--target native|wasm32|go|reference] [--optimize] [--sanitize]
```

`bun run laminar` is the same command. A file is a sequence of type
declarations, definitions and expressions; the last top-level expression is the
program's entry, and `run` prints its result as a JSON line after any program
output. `--target reference` runs the typed-IR evaluator, the semantic reference
every backend is tested against. Errors print as
`file:line:column: stage error [code]: message`.

The programmatic API is `src/compiler.ts`: `checkSource`, `compileSource`,
`buildCompiled` and `compileLibrary`.

## Targets and their assumptions

| Target | Emits | Built with | Runtime profile |
| --- | --- | --- | --- |
| `native` (default) | C11 | the installed `clang` | `native` |
| `wasm32` | C11 | `emcc` (Emscripten) | `emscripten-node` |
| `go` | Go | `go` | `go` |

A target is described from the toolchain that builds it (`src/backend/host.ts`):
the native triple, pointer width and byte order come from clang, never from the
machine running the compiler. Emitted C is strict C11 (`-Wall -Wextra -Werror
-pedantic` clean) and assumes IEEE-754 `double` for `Number`, `_Bool` for `Bool`,
and a hosted C library. It links only the C standard library and `libm`
(`-lm`, for `floor`, `copysign`, `isnan` and friends). There is no separate
runtime library: allocation (`malloc`/`free`, counted so leaks trap), traps
(`abort`), strings and host I/O are emitted into each program as needed. Go output
needs only the standard library. A browser Emscripten profile exists as a
compile-time target with stdout but no stdin; it is not executed.

## Supported language

Everything the checker accepts compiles and matches the reference, except the
backend restrictions listed below. That includes:

- `Number`, `Bool`, `String`, unit and tuples, with ordinary and type-changing
  updates (`x := ...`), persistent aliases, computed aliases, scattered tuple
  lenses, manual `@(focus, cleanup)` restoration and `aslens` patterns.
- Top-level definitions, generic definitions (specialized per use), recursion,
  first-class affine closures, typed indirect calls, and branch joins of callables
  and lenses.
- User unions and the builtin `List` and `Option`: construction, matching,
  borrowed matching and constructor patterns.
- Strings: literals, interpolation of `String`, `Number` (ECMAScript formatting)
  and `Bool` parts, and literal patterns.
- Every registered runtime import (`src/runtime-imports.ts`): arithmetic and
  numeric comparisons, `round`, `heapsize`, `fst`, `dup`, `charList`, `print` and
  `getInput`.

## Backend restrictions

Programs the checker accepts but a backend rejects, each with a tested
diagnostic (`test/corpus.test.ts`, *backend restrictions*):

- Interpolating a part that is not `String`, `Number` or `Bool` (tuples, lists,
  variants). The evaluator uses JavaScript `String(...)` text for these.
- An entry whose result is a function, or contains one: the test entry adapter
  only prints data.
- `getInput` on a runtime without stdin (browser Emscripten).
- Host exports: lens parameters and results, generic exports without type
  arguments, and any non-C target.

Programs the checker rejects are not backend restrictions; the corpus keeps them
apart (*negative checker results*).

## Lens support and defensive diagnostics

Borrowed constructor patterns, persistent aliases of computed lenses, and matching
on borrowed lenses are supported. For example, each of these programs checks and
emits C:

```lm
{let xs = [1, 2]
 let [head, ...tail] = ~xs
 dup(~head)}
```

```lm
{let pair = (1, 2)
 let a = ~fst(~pair)
 a := 3
 dup(~a)}
```

```lm
{let xs = [1, 2]
 match ~xs {
   [] -> 0
   [head, ...tail] -> dup(~head)
 }}
```

Borrowed-pattern normalization expands constructor aliases and borrowed matches
before inference; computed aliases have their own checking path. The inferencer
retains defensive diagnostics named `unsupported-lens-pattern`,
`unsupported-alias` and `unsupported-lens-case`, but their presence does not
establish a source-language restriction. No source example is currently confirmed
to reach these guards through the normal compiler pipeline. They should not be
listed as parser-only features; a reproducible example reaching one would identify
a checker gap to investigate separately from C backend restrictions.

## Host exports

`emit --export` and `compileLibrary` produce a C library and header. Numbers and
booleans pass by value, strings as length-delimited buffers, and other values as
opaque owned handles with explicit disposal. See
[the C backend](c-backend.md#phase-7-host-exports) for the ABI.

## Inspecting artifacts

- `emit` writes the generated C or Go to stdout or `-o`. Symbol names are
  deterministic for a program and target.
- `emit --concrete` prints the verified concrete IR the backends consume: layouts,
  call ABIs, callable records and code.
- For Wasm, `emit --target wasm32 -o program.c` gives the C that `emcc` builds;
  build it yourself with `emcc -std=c11 program.c -o program.js -sENVIRONMENT=node`
  to inspect the `.js`/`.wasm` pair, or let `run --target wasm32` build it.
- `run` builds in a temporary `laminar-build-*` directory and removes it
  afterwards. A failed build keeps it and names it in the error.
- Test runs keep `laminar-c-*` and `laminar-go-*` directories for failed builds,
  traps and mismatches, with the source, exact command arguments
  (`build.json`, `c-runtime.json`) and observed tool versions.

## Testing

- `bun test`: all regression tests. The corpus runs on the typed-IR reference and
  every case's C and Go emission is checked.
- `LAMINAR_EXEC=1 bun test test/corpus.test.ts`: the corpus also built and run
  natively (sanitized `-O0` and plain `-O2`) and on Go.
  `LAMINAR_BACKENDS=reference,native,go` selects backends explicitly.
- `LAMINAR_EXEC=1 bun test test/host-exports.test.ts test/compiler.test.ts`:
  native and Wasm host programs, and command-line builds.
- `bunx tsc --noEmit`: TypeScript.
