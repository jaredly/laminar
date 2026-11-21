/** Captured callbacks retain owned environments through invocation or disposal. */
export const capturedCleanupSamples = [
    {
        name: 'captured cleanup parameter',
        source: 'fn restore(f, ~x) ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n(f)()}}\n{let x = 1\n let resource = (2, true)\n restore(fn () resource, ~x) := 4\n x}',
        expected: 4,
    },
    {
        name: 'returned captured cleanup',
        source: 'fn restore(f, ~x) ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n(f)()}}\nfn callback(v) {fn () v}\n{let x = 1\n restore(callback(2), ~x) := true\n x}',
        expected: true,
    },
    {
        name: 'late captured cleanup',
        source: '{let x = 1\n {let f = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n({let v = dup(~x)\n fn () v})()}}\n f := true}\n x}',
        expected: true,
    },
    {
        name: 'nested captured callbacks',
        source: '{let x = 1\n let resource = 2\n let inner = fn () resource\n let outer = fn () inner()\n {let f = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n(outer)()}}\n f := true}\n x}',
        expected: true,
    },
    {
        name: 'captured cleanup returns owned closure',
        source: '{let x = 1\n let resource = 2\n let cleanup = fn () {fn () resource}\n {let f = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n(cleanup)()}}\n f := true}\n x}',
        expected: true,
    },
    {
        name: 'unused captured nested closure',
        source: '{let resource = 2\n let inner = fn () resource\n let unused = fn () inner()\n 4}',
        expected: 4,
    },
    {
        name: 'wildcard captured closure',
        source: '{let resource = 2\n let _ = fn () resource\n 4}',
        expected: 4,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `selected captured cleanup ${condition}`,
        source: `{let x = 1
 let resource = 2
 let cleanup = fn () resource
 {let f = ~{match ${condition} {true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n(cleanup)()}; false -> x}}
 f := true}
 x}`,
        expected: true,
    })),
];
