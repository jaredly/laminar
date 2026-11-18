/** Runtime result ABI normalization retains each selected restoration operation. */
export const lensResultSamples = [
    ...(['true', 'false'] as const).flatMap((condition) =>
        (['~pair', '~(a, b)'] as const).map((arg) => ({
            name: `dynamic lens result ${condition} ${arg}`,
            source: `{let f = match ${condition} {true -> fn (~p) ~{match true {true -> p; false -> p}}; false -> fn (~(x, y)) ~(x, y)}
 let pair = (1, 2)
 let a = 1
 let b = 2
 f(${arg}) := (true, (3, 4))
 ${arg === '~pair' ? 'pair' : '(a, b)'}}`,
            expected: [true, [3, 4]],
        })),
    ),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `native dynamic lens result ${condition}`,
        source: `{let f = match ${condition} {true -> fn (~(p, z)) ~{match true {true -> p; false -> p}}; false -> fst}
 let a = 1
 let b = 2
 let z = 3
 f(~((a, b), z)) := (true, (4, 5))
 (a, b, z)}`,
        expected: [true, [4, 5], 3],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `homogeneous dynamic lens result ${condition}`,
        source: `{let f = match ${condition} {true -> fn (~p) ~p; false -> fn (~(x, y)) ~(x, y)}
 let pair = (1, 2)
 let old = f(~pair) := (3, 4)
 (old, pair)}`,
        expected: [
            [1, 2],
            [3, 4],
        ],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `empty dynamic lens result ${condition}`,
        source: `{let f = match ${condition} {true -> fn (~p) ~p; false -> fn (~()) ~()}
 let x = ()
 f(~x) := ()
 x}`,
        expected: null,
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `captured dynamic lens result ${condition}`,
        source: `fn choose(condition) {let offset = 3
 match condition {true -> fn (~p) ~p; false -> fn (~(x, y)) ~{x := x + offset
 (x, y)}}}
fn relay(f, ~p) ~f(~p)
{let f = choose(${condition})
 let pair = (1, 2)
 let old = relay(f, ~pair) := (true, (3, 4))
 (old, pair)}`,
        expected: [
            [condition === 'true' ? 1 : 4, 2],
            [true, [3, 4]],
        ],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `cleanup dynamic lens result ${condition}`,
        source: `{let f = match ${condition} {true -> fn (~p) ~p; false -> fn (~(x, y)) ~(@(x, fn () {x := x + 7}), y)}
 let pair = (1, 2)
 f(~pair) := (3, 4)
 pair}`,
        expected: [condition === 'true' ? 3 : 10, 4],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `nested dynamic lens result ${condition}`,
        source: `fn choose(condition) {match condition {true -> fn (~p) ~p; false -> fn (~(x, y)) ~(x, y)}}
{let f = choose(${condition})
 let g = choose(${condition})
 let pair = ((1, 2), (3, 4))
 fst(~f(~g(~pair))) := true
 pair}`,
        expected: [true, [3, 4]],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `alias release dynamic lens result ${condition}`,
        source: `{let f = match ${condition} {true -> fn (~p) ~p; false -> fn (~(x, y)) ~(@(x, fn () {x := x + 7}), y)}
 let pair = (1, 2)
 {let focus = ~f(~pair)
 ()}
 pair}`,
        expected: [condition === 'true' ? 1 : 8, 2],
    })),
];
