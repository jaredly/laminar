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
/** Closures whose parameter types no use constrains; specialization defaults them to unit. */
export const unconstrainedClosureSamples = [
    {
        name: 'unused closure argument with unconstrained parameter',
        source: 'fn apply(f, g, x) f(x)\napply(fn (y) y, fn (z) 1, 3)',
        expected: 3,
    },
    {
        name: 'unused local closure with unconstrained parameter',
        source: 'fn outer(x) {let f = fn (y) y\n x}\nouter(1)',
        expected: 1,
    },
    {
        name: 'unused lens closure with unconstrained component',
        source: 'fn apply(f, g, ~p) {f(~p)}\n{let pair = (1, 2)\n let f = fn (~(x, y)) {x := 9}\n let g = fn (~(x, y)) {y := 8}\n apply(f, g, ~pair)\n pair}',
        expected: [9, 2],
    },
    {
        name: 'dropped tuple closure with unconstrained parameter',
        source: 'fn first(p) {let (a, b) = p\n a}\nfirst((1, fn (z) z))',
        expected: 1,
    },
];
