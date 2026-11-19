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
    ...(['true', 'false'] as const).flatMap((condition) => [
        {
            name: `callable focus convergent branch data ${condition}`,
            source: `{let x = 3
 let f = fn () x
 match ${condition} {true -> {let old = f := 5
 old()}; false -> {let old = f := 7
 old()}}
 f}`,
            expected: condition === 'true' ? 5 : 7,
        },
        {
            name: `callable focus convergent branch callable ${condition}`,
            source: `fn make(x) {fn () x}
{let f = 2
 match ${condition} {true -> {f := make(5)
 ()}; false -> {f := make(7)
 ()}}
 f()}`,
            expected: condition === 'true' ? 5 : 7,
        },
    ]),
    {
        name: 'callable alias replacement and owner continuation',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let old = a := fn () 5\n old()}\n f()}',
        expected: 5,
    },
    {
        name: 'callable alias unused loan',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n ()}\n f()}',
        expected: 3,
    },
    {
        name: 'callable alias aggregate replacement',
        source: '{let x = 3\n let p = (fn () x, 4)\n {let a = ~p\n let old = a := (fn () 5, true)\n let (f, n) = old\n f() + n}\n let (g, b) = p\n (g(), b)}',
        expected: [5, true],
    },
    {
        name: 'callable alias nested loans and repeated replacement',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let first = a := fn () 5\n {let b = ~a\n let second = b := fn () 7\n (first(), second())}}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias temporary data and refill',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let old = a := true\n let b = a := fn () 7\n (old(), b)}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias extraction to data',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let old = a := true\n old()}\n f}',
        expected: true,
    },
    {
        name: 'callable alias insertion from data',
        source: '{let f = 3\n {let a = ~f\n let old = a := fn () 7\n old}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias consume and refill',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let first = a\n a := fn () 7\n first()}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias unused environments',
        source: '{let x = 3\n let f = fn () x\n let y = 5\n {let a = ~f\n let old = a := fn () y\n ()}\n 7}',
        expected: 7,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `callable alias divergent branch ${condition}`,
        source: `{let x = 3
 let f = fn () x
 {let a = ~f
 match ${condition} {true -> {let old = a := fn () 5
 old()}; false -> {let y = (6, 7)
 let old = a := fn () {let (u, v) = y
 u + v}
 old()}}}
 f()}`,
        expected: condition === 'true' ? 5 : 13,
    })),
    {
        name: 'callable alias deferred scalar completion',
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{let a = ~f
 @(x, {let old = a := fn () 7
 old()
 fn () ()})}
 focus := 5}
 (f(), x)}`,
        expected: [7, 5],
    },
    {
        name: 'callable alias returned replacement',
        source: `fn make() {let v = 3
 let f = fn () v
 {let a = ~f
 let old = a := fn () 7
 old()}
 f}
{let f = make()
 f()}`,
        expected: 7,
    },
];
