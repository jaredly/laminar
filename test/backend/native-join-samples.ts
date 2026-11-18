/** Native intrinsics and user environments share exact typed invocation slots. */
export const nativeJoinSamples = [
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native joined dup ${condition}`,
        source: `fn choose(condition) {let offset = 3
 match condition {true -> fn (~x) (dup(~x) + offset); false -> dup}}
{let x = 2
 let f = choose(${condition})
 (f(~x), x)}`,
        expected: [condition === 'true' ? 5 : 2, 2],
    })),
    ...(['true', 'false'] as const).flatMap((condition) =>
        (['~pair', '~(a, b)'] as const).map((argument) => ({
            name: `native joined fst ${condition} ${argument}`,
            source: `fn first(~(x, y)) ~x
fn choose(condition) {match condition {true -> first; false -> fst}}
{let pair = (1, (2, 3))
 let a = 1
 let b = (2, 3)
 let f = choose(${condition})
 f(${argument}) := (true, (4, 5))
 ${argument === '~pair' ? 'pair' : '(a, b)'}}`,
            expected: [
                [true, [4, 5]],
                [2, 3],
            ],
        })),
    ),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native joined captured callee ${condition}`,
        source: `{let resource = 3
 let f = match ${condition} {true -> fn (~x) (dup(~x) + resource); false -> dup}
 let g = fn (~p) f(~p)
 let x = 2
 (g(~x), x)}`,
        expected: [condition === 'true' ? 5 : 2, 2],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native joined unused callee ${condition}`,
        source: `{let resource = 3
 let f = match ${condition} {true -> fn (~x) (dup(~x) + resource); false -> dup}
 let x = 2
 let unused = fn () {let x = x
 f(~x)}
 4}`,
        expected: 4,
    })),
    {
        name: 'native joined both lens ABIs',
        source: `fn first(~(x, y)) ~x
fn choose(condition) {match condition {true -> first; false -> fst}}
{let f = choose(false)
 let g = choose(false)
 let pair = (1, 2)
 let a = 1
 let b = 2
 f(~pair) := (true, (3, 4))
 g(~(a, b)) := (true, (3, 4))
 (pair, a, b)}`,
        expected: [[[true, [3, 4]], 2], [true, [3, 4]], 2],
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native joined nested subsets ${condition}`,
        source: `fn choose(outer, inner) {let offset = 3
 match outer {true -> match inner {true -> dup; false -> fn (~x) (dup(~x) + offset)}; false -> fn (~x) (dup(~x) + 7)}}
{let f = choose(true, ${condition})
 let x = 2
 (f(~x), x)}`,
        expected: [condition === 'true' ? 2 : 5, 2],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native joined scattered dup ${condition}`,
        source: `fn copy(~(x, y)) (dup(~x), dup(~y))
{let f = match ${condition} {true -> copy; false -> dup}
 let x = 1
 let y = (2, 3)
 (f(~(x, y)), x, y)}`,
        expected: [[1, [2, 3]], 1, [2, 3]],
    })),
    {
        name: 'native joined nested returned focus',
        source: `fn first(~(x, y)) ~x
fn choose(condition) {match condition {true -> first; false -> fst}}
{let f = choose(false)
 let g = choose(false)
 let pair = ((1, (2, 3)), (4, 5))
 f(~g(~pair)) := (true, (6, 7))
 pair}`,
        expected: [
            [
                [true, [6, 7]],
                [2, 3],
            ],
            [4, 5],
        ],
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native joined empty dup ${condition}`,
        source: `fn copy(~x) dup(~x)
{let f = match ${condition} {true -> copy; false -> dup}
 let x = ()
 (f(~x), x)}`,
        expected: [null, null],
    })),
    {
        name: 'native nested direct projection',
        source: `{let pair = ((1, 2), 3)
 fst(~fst(~pair)) := true
 pair}`,
        expected: [[true, 2], 3],
    },
];
