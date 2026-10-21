# Laminar

A linear/flow language, based on the paper [Flow Typing: A New Lens on Linearity](https://people.cs.nott.ac.uk/pszgmh/flow-typing.pdf) by Sky Wilshaw and [Graham Hutton](https://x.com/haskellhutt).

## Status

I'm working my way through the paper, trying to implement a language that matches all of the runtime characteristics they describe. For the moment, I'm not bothering with type checking or inference; I'm simply doing a syntactic transformation from a c-style language that has lenses to typescript. It's been going quite well!

I have many of the constructs implemented, but not yet all. Notably, `case` and `A & B` are missing, and `let pat = linear in lens` is only partially implemented.

My language uses runtime checks to guarantee linearity instead of compile-time checks. After I have the runtime working properly, I'll probably move on to doing the type checking and inference.

## Running the tests

`pnpm test` will first compile `lens.fl` into `lens.fl.test.ts` and then run `node lens.fl.test.ts` to run the suite.

## A note on all the parsing

I'm also working on a parser generator in this repo, as a little side quest. I hope to break it out into its own project at some point.
