// Borrowed patterns whose storage is supported by the existing scalar/tuple adapter.
export const borrowedPatternSamples = [
    {
        name: 'tuple field replacement',
        source: '{let pair = (1, 2)\n match ~pair {(h, rest) -> {h := 3}}\n pair}',
        expected: [3, 2],
    },
    {
        name: 'type-changing tuple fields',
        source: '{let pair = (1, 2)\n match ~pair {(h, rest) -> {h := true}}\n pair}',
        expected: [true, 2],
    },
    ...(['true', 'false'] as const).map((value) => ({
        name: `selected literal ${value}`,
        source: `{let flag = ${value}\n let result = match ~flag {true -> 1; false -> 2}\n (result, flag)}`,
        expected: [value === 'true' ? 1 : 2, value === 'true'],
    })),
    {
        name: 'returned tuple sublens',
        source: 'fn first(~pair) ~{match ~pair {(h, rest) -> h}}\n {let pair = (1, 2)\n first(~pair) := true\n pair}',
        expected: [true, 2],
    },
];
