/** Runtime selected affine callees normalize code pointers, never capture storage. */
export const callableJoinSamples = [
    ...(['true', 'false'] as const).map((condition) => ({
        name: `returned joined closure ${condition}`,
        source: `fn choose(condition) {let left = 2
 let right = (3, 4)
 match condition {true -> fn (()) left; false -> fn (()) {let (x, y) = right
 x + y}}}
{let f = choose(${condition})
 f(())}`,
        expected: condition === 'true' ? 2 : 7,
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `unused joined closure ${condition}`,
        source: `fn choose(condition) {let left = 2
 let inner = fn () 7
 match condition {true -> fn () left; false -> fn () inner()}}
{let unused = choose(${condition})
 4}`,
        expected: 4,
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `joined closed and captured callee ${condition}`,
        source: `fn apply(f, x) f(x)
{let offset = 2
 let f = match ${condition} {true -> fn (x) (x + offset); false -> fn (x) (x + 3)}
 apply(f, 4)}`,
        expected: condition === 'true' ? 6 : 7,
    })),
    ...(['true', 'false'] as const).flatMap((condition) =>
        (['~pair', '~(a, b)'] as const).map((argument) => ({
            name: `joined lens callee ${condition} ${argument}`,
            source: `fn apply(f, ~p) f(~p)
{let offset = 3
 let f = match ${condition} {true -> fn (~(x, y)) {x := x + offset}; false -> fn (~(x, y)) {x := x + 7}}
 let pair = (1, 2)
 let a = 1
 let b = 2
 apply(f, ${argument})
 ${argument === '~pair' ? 'pair' : '(a, b)'}}`,
            expected: [condition === 'true' ? 4 : 8, 2],
        })),
    ),
    ...(['true', 'false'] as const).flatMap((condition) =>
        (['~pair', '~(a, b)'] as const).map((argument) => ({
            name: `joined returned lens ${condition} ${argument}`,
            source: `fn apply(f, ~p) ~f(~p)
{let offset = 3
 let f = match ${condition} {true -> fn (~(x, y)) ~{x := x + offset
 x}; false -> fn (~(x, y)) ~{x := x + 7
 x}}
 let pair = (1, 2)
 let a = 1
 let b = 2
 let old = (apply(f, ${argument}) := true)
 (old, ${argument === '~pair' ? 'pair' : '(a, b)'})}`,
            expected: [condition === 'true' ? 4 : 8, [true, 2]],
        })),
    ),
    ...(['true', 'false'] as const).flatMap((outer) =>
        (['true', 'false'] as const).map((inner) => ({
            name: `nested joined closure ${outer} ${inner}`,
            source: `fn choose(outer, inner) {let x = 2
 let y = 3
 let z = (4, 5)
 match outer {true -> match inner {true -> fn () x; false -> fn () y}; false -> fn () {let (a, b) = z
 a + b}}}
{let f = choose(${outer}, ${inner})
 let g = fn () f()
 g()}`,
            expected: outer === 'true' ? (inner === 'true' ? 2 : 3) : 9,
        })),
    ),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `joined capture and alias refill ${condition}`,
        source: `{let x = 1
 let f = {let y = ~x
 let f = match ${condition} {true -> fn () y; false -> fn () 9}
 y := 2
 f}
 (f(), x)}`,
        expected: [condition === 'true' ? 1 : 9, 2],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `joined deferred cleanup ${condition}`,
        source: `fn restore(f, ~x) ~{{lens finalFocus <- x\nx := finalFocus\n(f)()}}
{let resource = 2
 let f = match ${condition} {true -> fn () resource; false -> fn () 3}
 let x = 1
 restore(f, ~x) := true
 x}`,
        expected: true,
    })),
    {
        name: 'joined callable with both lens ABIs',
        source: `fn choose(condition) {let offset = 3
 match condition {true -> fn (~(x, y)) {x := x + offset}; false -> fn (~(x, y)) {x := x + 7}}}
{let pair = (1, 2)
 let a = 1
 let b = 2
 let f = choose(true)
 let g = choose(false)
 f(~pair)
 g(~(a, b))
 (pair, a, b)}`,
        expected: [[4, 2], 8, 2],
    },
];
