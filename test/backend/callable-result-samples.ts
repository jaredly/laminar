/** Each selected body returns its own closure representation before ABI adaptation. */
export const callableResultSamples = [
    ...(['true', 'false'] as const).map((condition) => ({
        name: `dynamic callable result ${condition}`,
        source: `{let left = 2
 let right = (3, 4)
 let f = match ${condition} {true -> fn () {fn () left}; false -> fn () {fn () {let (a, b) = right
 a + b}}}
 let g = f()
 g()}`,
        expected: condition === 'true' ? 2 : 7,
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `unused dynamic callable result ${condition}`,
        source: `{let left = 2
 let right = 3
 let f = match ${condition} {true -> fn () {fn () left}; false -> fn () {let inner = fn () right
 fn () inner()}}
 let unused = f()
 4}`,
        expected: 4,
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `nested dynamic callable result ${condition}`,
        source: `{let left = 2
 let right = (3, 4)
 let f = match ${condition} {true -> fn () {fn () {fn () left}}; false -> fn () {fn () {fn () {let (a, b) = right
 a + b}}}}
 let g = f()
 let h = g()
 h()}`,
        expected: condition === 'true' ? 2 : 7,
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native dynamic callable result ${condition}`,
        source: `{let f = match ${condition} {true -> fn () dup; false -> fn () {fn (~x) (dup(~x) + 3)}}
 let g = f()
 let x = 2
 (g(~x), x)}`,
        expected: [condition === 'true' ? 2 : 5, 2],
    })),
    ...(['true', 'false'] as const).flatMap((condition) =>
        (['~pair', '~(a, b)'] as const).map((arg) => ({
            name: `lens dynamic callable result ${condition} ${arg}`,
            source: `{let offset = 3
 let f = match ${condition} {true -> fn () {fn (~(x, y)) ~{x := x + offset
 x}}; false -> fn () fst}
 let g = f()
 let pair = (1, 2)
 let a = 1
 let b = 2
 let old = g(${arg}) := (true, (3, 4))
 (old, ${arg === '~pair' ? 'pair' : '(a, b)'})}`,
            expected: [condition === 'true' ? 4 : 1, [[true, [3, 4]], 2]],
        })),
    ),
    ...(['true', 'false'] as const).flatMap((outer) =>
        (['true', 'false'] as const).map((inner) => ({
            name: `subset dynamic callable result ${outer} ${inner}`,
            source: `{let x = 2
 let y = 3
 let f = match ${outer} {true -> fn () {match ${inner} {true -> fn () x; false -> fn () y}}; false -> fn () {fn () 7}}
 let g = f()
 g()}`,
            expected: outer === 'true' ? (inner === 'true' ? 2 : 3) : 7,
        })),
    ),
    {
        name: 'dynamic callable result with both lens ABIs',
        source: `fn make(condition) {match condition {true -> fn () {fn (~(x, y)) ~x}; false -> fn () fst}}
{let f = make(true)
 let g = make(false)
 let left = f()
 let right = g()
 let pair = (1, 2)
 let a = 1
 let b = 2
 left(~pair) := true
 right(~(a, b)) := true
 (pair, a, b)}`,
        expected: [[true, 2], true, 2],
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `alias dynamic callable result ${condition}`,
        source: `{let x = 1
 let f = {let y = ~x
 let f = match ${condition} {true -> fn () {fn () y}; false -> fn () {fn () 9}}
 y := 2
 f}
 let g = f()
 (g(), x)}`,
        expected: [condition === 'true' ? 1 : 9, 2],
    })),
];
