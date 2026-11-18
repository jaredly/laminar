/** Exact typed code-pointer calls with affine environments and lens backing. */
export const indirectCallSamples = [
    {
        name: 'returned closure invoked through parameter',
        source: 'fn make(x) {fn (y) (x + y)}\nfn apply(f, x) f(x)\napply(make(2), 3)',
        expected: 5,
    },
    ...(['~pair', '~(a, b)'] as const).map((argument) => ({
        name: `captured indirect lens call ${argument}`,
        source: `fn apply(f, ~p) f(~p)
{let offset = 3
 let f = fn (~(x, y)) {x := x + offset}
 let pair = (1, 2)
 let a = 1
 let b = 2
 apply(f, ${argument})
 ${argument === '~pair' ? 'pair' : '(a, b)'}}`,
        expected: [4, 2],
    })),
    {
        name: 'indirect returned lens',
        source: 'fn apply(f, ~p) ~f(~p)\n{let f = fn (~(x, y)) ~x\n let pair = (1, 2)\n apply(f, ~pair) := true\n pair}',
        expected: [true, 2],
    },
];
