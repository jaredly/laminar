/** Dynamic calls keep original tuple result ABIs behind recursive transfer adapters. */
export const aggregateResultSamples = (['true', 'false'] as const).flatMap((condition) => [
    {
        name: `aggregate result nested ${condition}`,
        source: `{let x = 3
 let y = (4, 5)
 let make = match ${condition} {true -> fn () ((fn () x, 6), true); false -> fn () ((fn () {let (a, b) = y
 a + b}, 7), false)}
 let ((f, n), b) = make()
 (f(), n, b)}`,
        expected: condition === 'true' ? [3, 6, true] : [9, 7, false],
    },
    {
        name: `aggregate result partial disposal ${condition}`,
        source: `{let x = 3
 let y = 5
 let make = match ${condition} {true -> fn () (fn () x, fn () 6); false -> fn () (fn () y, fn () 7)}
 let (f, _) = make()
 f()}`,
        expected: condition === 'true' ? 3 : 5,
    },
    {
        name: `aggregate result unused ${condition}`,
        source: `{let x = 3
 let y = 5
 let make = match ${condition} {true -> fn () (fn () x, 6); false -> fn () (fn () y, 7)}
 let unused = make()
 8}`,
        expected: 8,
    },
    {
        name: `aggregate result captured parameter ${condition}`,
        source: `fn run(pair) {let (f, n) = pair
 f() + n}
{let x = 3
 let y = 5
 let make = match ${condition} {true -> fn () (fn () x, 6); false -> fn () (fn () y, 7)}
 let packed = make()
 let g = fn () run(packed)
 g()}`,
        expected: condition === 'true' ? 9 : 12,
    },
    {
        name: `aggregate result subset ${condition}`,
        source: `{let x = 3
 let y = 5
 let z = 7
 let make = match ${condition} {true -> fn () {match false {true -> (fn () x, 1); false -> (fn () y, 2)}}; false -> fn () (fn () z, 3)}
 let (f, n) = make()
 f() + n}`,
        expected: condition === 'true' ? 7 : 10,
    },
    {
        name: `aggregate result native lens ${condition}`,
        source: `{let offset = 3
 let make = match ${condition} {true -> fn () (dup, 1); false -> fn () (fn (~x) {dup(~x) + offset}, 2)}
 let (f, n) = make()
 let x = 4
 (f(~x), x, n)}`,
        expected: condition === 'true' ? [4, 4, 1] : [7, 4, 2],
    },
    ...(['~pair', '~(a, b)'] as const).map((argument) => ({
        name: `aggregate result returned lens ${condition} ${argument}`,
        source: `{let offset = 3
 let make = match ${condition} {true -> fn () (fst, 1); false -> fn () (fn (~(x, y)) ~{x := x + offset
 x}, 2)}
 let (f, n) = make()
 let pair = (1, 2)
 let a = 1
 let b = 2
 let old = f(${argument}) := true
 (old, ${argument === '~pair' ? 'pair' : '(a, b)'}, n)}`,
        expected: [condition === 'true' ? 1 : 4, [true, 2], condition === 'true' ? 1 : 2],
    })),
]);
