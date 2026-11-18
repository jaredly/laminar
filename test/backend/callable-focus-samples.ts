/** Direct whole-owned-local exchanges retain both physical storage versions. */
export const callableFocusSamples = [
    {
        name: 'callable focus different captures',
        source: '{let x = 3\n let f = fn () x\n let y = (4, 5)\n let old = f := fn () {let (a, b) = y\n a + b}\n (old(), f())}',
        expected: [3, 9],
    },
    {
        name: 'callable focus extraction to data',
        source: '{let x = 3\n let f = fn () x\n let old = f := true\n (old(), f)}',
        expected: [3, true],
    },
    {
        name: 'callable focus insertion from data',
        source: '{let f = 2\n let x = 3\n let old = f := fn () x\n (old, f())}',
        expected: [2, 3],
    },
    {
        name: 'callable focus refill empty',
        source: '{let x = 3\n let f = fn () x\n let first = f\n f := fn () 5\n (first(), f())}',
        expected: [3, 5],
    },
    {
        name: 'callable focus unused old and replacement',
        source: '{let x = 3\n let f = fn () x\n let y = 5\n let old = f := fn () y\n 7}',
        expected: 7,
    },
    {
        name: 'callable focus repeated replacement',
        source: '{let x = 3\n let f = fn () x\n let y = 5\n let first = f := fn () y\n let second = f := fn () 7\n (first(), second(), f())}',
        expected: [3, 5, 7],
    },
    {
        name: 'callable focus aggregate replacement',
        source: '{let x = 3\n let packed = (fn () x, 4)\n let y = 5\n let old = packed := (fn () y, true)\n let (f, n) = old\n let (g, b) = packed\n (f(), n, g(), b)}',
        expected: [3, 4, 5, true],
    },

    {
        name: 'callable focus nested scope version',
        source: '{let x = 3\n let f = fn () x\n {let y = 5\n let old = f := fn () y\n old()}\n f()}',
        expected: 5,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `callable focus joined replacement ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 let old = f := match ${condition} {true -> fn () y; false -> fn () 7}
 (old(), f())}`,
        expected: [3, condition === 'true' ? 5 : 7],
    })),
];
