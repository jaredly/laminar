# Laminar

A linear/flow language, based on the paper [Flow Typing: A New Lens on Linearity](https://people.cs.nott.ac.uk/pszgmh/flow-typing.pdf) by Sky Wilshaw and [Graham Hutton](https://x.com/haskellhutt).

## Status

I'm working my way through the paper, trying to implement a language that matches all of the runtime characteristics they describe. There is now an experimental [AST type inference pass](docs/type-inference.md) with HM-style polymorphism and type-changing lenses, which runs before IR decomposition through `Checker` or `checkFile`. The snapshot runner can opt into checking; existing runtime fixtures remain unchecked by default.

I have many of the constructs implemented, but not yet all. Notably, `case` and `A & B` are missing, and `let pat = linear in lens` is only partially implemented.

The checked path enforces affine use (at most once), exclusive alias scopes, and restoration of lens contents. Closures move captured values at creation. Runtime checks remain in place, and the unchecked runner is available for experiments with lens forms that the checker does not yet support.

## What it looks like

```
fn inc(~c) { c := c + 1 }
fn fst(~(a, b)) { ~a }

{
    let x = (1, 10)
    inc(~fst(~x))
    x
}

(2, 10)

fn incfst(~x) {
    let (a, b) = ~x
    inc(~a)
    2
}

{
    let m = (4, 10)
    (incfst(~m), m)
}

(2, (5, 10))

fn alias(~x) {
    let y = ~x
    y := 5
}

{
    let x = 2
    (alias(~x), x)
}

(2, 5)
```

## Language Gotchas

- if you call a lens function as a normal function, I don't currently have a way to stop you.
  -> but I can fix that. mark functions, and verify on call.

## Running the tests

`pnpm test` will first compile `lens.fl` into `lens.fl.test.ts` and then run `node lens.fl.test.ts` to run the suite.

## A note on all the parsing

I'm also working on a parser generator in this repo, as a little side quest. I hope to break it out into its own project at some point.
