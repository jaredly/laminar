/** Divergent owned storage versions normalize without copying affine environments. */
export const storageJoinSamples = (['true', 'false'] as const).flatMap((condition) => [
    {
        name: `storage join unchanged arm ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 match ${condition} {true -> {let old = f := fn () y
 old()}; false -> 2}
 f()}`,
        expected: condition === 'true' ? 5 : 3,
    },
    {
        name: `storage join different captures ${condition}`,
        source: `{let f = 2
 let x = 3
 let y = (4, 5)
 match ${condition} {true -> {f := fn () x
 ()}; false -> {f := fn () {let (a, b) = y
 a + b}
 ()}}
 f()}`,
        expected: condition === 'true' ? 3 : 9,
    },
    {
        name: `storage join aggregate ${condition}`,
        source: `{let x = 3
 let packed = ((fn () x, 4), true)
 let y = 5
 match ${condition} {true -> {let old = packed := ((fn () y, 6), false)
 let ((f, n), _) = old
 f() + n}; false -> 2}
 let ((f, n), b) = packed
 (f(), n, b)}`,
        expected: condition === 'true' ? [5, 6, false] : [3, 4, true],
    },
    {
        name: `storage join unused ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 match ${condition} {true -> {let old = f := fn () y
 old()}; false -> 2}
 8}`,
        expected: 8,
    },
    {
        name: `storage join consumed ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 match ${condition} {true -> {let old = f := fn () y
 old() + f()}; false -> f()}
 8}`,
        expected: 8,
    },
    {
        name: `storage join consumed aggregate ${condition}`,
        source: `{let x = 3
 let packed = (fn () x, 4)
 let y = 5
 match ${condition} {true -> {let old = packed := (fn () y, 6)
 let (f, _) = packed
 f()}; false -> {let (f, _) = packed
 f()}}
 8}`,
        expected: 8,
    },
    {
        name: `storage join nested replacement ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 let z = 7
 match ${condition} {true -> {match false {true -> {let old = f := fn () y
 old()}; false -> {let old = f := fn () z
 old()}}}; false -> 2}
 let old = f := fn () 9
 (old(), f())}`,
        expected: [condition === 'true' ? 7 : 3, 9],
    },
    {
        name: `storage join captured parameter ${condition}`,
        source: `fn run(f) f()
{let x = 3
 let f = fn () x
 let y = 5
 match ${condition} {true -> {let old = f := fn () y
 old()}; false -> 2}
 let g = fn () run(f)
 g()}`,
        expected: condition === 'true' ? 5 : 3,
    },
    {
        name: `storage join simultaneous result ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 let old = match ${condition} {true -> {let old = f := fn () y
 old}; false -> fn () 9}
 (old(), f())}`,
        expected: condition === 'true' ? [3, 5] : [9, 3],
    },
    {
        name: `storage join multiple owners ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 let g = fn () y
 let z = 7
 match ${condition} {true -> {let old = f := fn () z
 g := old
 ()}; false -> ()}
 (f(), g())}`,
        expected: condition === 'true' ? [7, 3] : [3, 5],
    },
    ...(['~pair', '~(a, b)'] as const).map((argument) => ({
        name: `storage join lens callee ${condition} ${argument}`,
        source: `{let f = fst
 let offset = 3
 match ${condition} {true -> {let old = f := fn (~(x, y)) ~{x := x + offset
 x}
 ()}; false -> ()}
 let pair = (1, 2)
 let a = 1
 let b = 2
 let old = f(${argument}) := true
 (old, ${argument === '~pair' ? 'pair' : '(a, b)'})}`,
        expected: [condition === 'true' ? 4 : 1, [true, 2]],
    })),
]);
