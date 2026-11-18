/** Owned tuples transfer each callable member with its exact physical ABI. */
export const callableStorageSamples = [
    {
        name: 'callable storage projection',
        source: '{let x = 3\n let pair = (fn () x, 4)\n let (f, y) = pair\n f() + y}',
        expected: 7,
    },
    {
        name: 'callable storage nested capture',
        source: '{let x = 3\n let pair = ((fn () x, 4), 5)\n let g = fn () {let ((f, y), z) = pair\n f() + y + z}\n g()}',
        expected: 12,
    },
    {
        name: 'callable storage parameter',
        source: 'fn run(pair) {let (f, x) = pair\n f() + x}\n{let y = 3\n run((fn () y, 4))}',
        expected: 7,
    },
    {
        name: 'callable storage result',
        source: 'fn make(x) (fn () x, 4)\n{let (f, y) = make(3)\n f() + y}',
        expected: 7,
    },
    {
        name: 'callable storage unused affine member',
        source: '{let x = 3\n let pair = (fn () x, 4)\n let (_, y) = pair\n y}',
        expected: 4,
    },
    {
        name: 'callable storage joined member',
        source: '{let x = 3\n let y = 5\n let f = match false {true -> fn () x; false -> fn () y}\n let (g, z) = (f, 4)\n g() + z}',
        expected: 9,
    },

    {
        name: 'callable storage unused whole tuple',
        source: '{let x = 3\n let inner = fn () x\n let unused = ((fn () inner(), 4), 5)\n 7}',
        expected: 7,
    },
    {
        name: 'callable storage unused capturing closure',
        source: '{let x = 3\n let pair = ((fn () x, 4), 5)\n let unused = fn () {let ((f, y), z) = pair\n f() + y + z}\n 7}',
        expected: 7,
    },
    {
        name: 'callable storage partial projection',
        source: '{let x = 3\n let y = 5\n let pair = (fn () x, fn () y)\n let (f, _) = pair\n f()}',
        expected: 3,
    },

    ...(['~pair', '~(a, b)'] as const).map((arg) => ({
        name: `callable storage lens callee ${arg}`,
        source: `{let offset = 3
 let packed = (fn (~(x, y)) ~{x := x + offset
 x}, 4)
 let (f, n) = packed
 let pair = (1, 2)
 let a = 1
 let b = 2
 let old = f(${arg}) := true
 (old, ${arg === '~pair' ? 'pair' : '(a, b)'}, n)}`,
        expected: [4, [true, 2], 4],
    })),
    {
        name: 'callable storage native member',
        source: '{let packed = (dup, 4)\n let (f, n) = packed\n let x = 3\n (f(~x) + n, x)}',
        expected: [7, 3],
    },
];
