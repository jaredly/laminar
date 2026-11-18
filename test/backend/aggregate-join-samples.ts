/** Each selected tuple member transfers its own ABI and affine environment. */
export const aggregateJoinSamples = (['true', 'false'] as const).flatMap((condition) => [
    {
        name: `aggregate join nested ${condition}`,
        source: `{let x = 3
 let y = (4, 5)
 let packed = match ${condition} {true -> ((fn () x, 6), true); false -> ((fn () {let (a, b) = y
 a + b}, 7), false)}
 let ((f, n), b) = packed
 (f(), n, b)}`,
        expected: condition === 'true' ? [3, 6, true] : [9, 7, false],
    },
    {
        name: `aggregate join partial disposal ${condition}`,
        source: `{let x = 3
 let y = 5
 let packed = match ${condition} {true -> (fn () x, fn () 6); false -> (fn () y, fn () 7)}
 let (f, _) = packed
 f()}`,
        expected: condition === 'true' ? 3 : 5,
    },
    {
        name: `aggregate join captured parameter ${condition}`,
        source: `fn run(pair) {let (f, n) = pair
 f() + n}
{let x = 3
 let y = 5
 let packed = match ${condition} {true -> (fn () x, 6); false -> (fn () y, 7)}
 let g = fn () run(packed)
 g()}`,
        expected: condition === 'true' ? 9 : 12,
    },
    {
        name: `aggregate join unused ${condition}`,
        source: `{let x = 3
 let y = 5
 let packed = match ${condition} {true -> (fn () x, 6); false -> (fn () y, 7)}
 8}`,
        expected: 8,
    },
    {
        name: `aggregate join nested choices ${condition}`,
        source: `{let x = 3
 let y = 5
 let z = 7
 let packed = match ${condition} {true -> match false {true -> (fn () x, 1); false -> (fn () y, 2)}; false -> (fn () z, 3)}
 let (f, n) = packed
 f() + n}`,
        expected: condition === 'true' ? 7 : 10,
    },
    {
        name: `aggregate join native lens member ${condition}`,
        source: `{let offset = 3
 let packed = match ${condition} {true -> (dup, 1); false -> (fn (~x) {dup(~x) + offset}, 2)}
 let (f, n) = packed
 let x = 4
 (f(~x), x, n)}`,
        expected: condition === 'true' ? [4, 4, 1] : [7, 4, 2],
    },
    {
        name: `aggregate join returned ${condition}`,
        source: `fn make(flag, x, y) {match flag {true -> (fn () x, 1); false -> (fn () y, 2)}}
{let (f, n) = make(${condition}, 3, 5)
 f() + n}`,
        expected: condition === 'true' ? 4 : 7,
    },
]);
