const first = 'fn first(~(x, y)) ~x\n';
export const lensBranchSamples = [
    {
        name: 'true selection',
        source: 'fn choose(b, ~(x, y)) ~{match b {true -> x; false -> y}}\n{let pair = (1, 2)\n choose(true, ~pair) := 3\n pair}',
        expected: [3, 2],
    },
    {
        name: 'false selection',
        source: 'fn choose(b, ~(x, y)) ~{match b {true -> x; false -> y}}\n{let pair = (1, 2)\n choose(false, ~pair) := 3\n pair}',
        expected: [1, 3],
    },
    {
        name: 'type changing alias',
        source: '{let x = 1\n {let f = ~{match true {true -> x; false -> x}}\n f := (true, 3)}\n x}',
        expected: [true, 3],
    },
    {
        name: 'deferred alias in selected branch',
        source:
            first +
            '{let p = (1, 2)\n {let f = ~{match false {true -> first(~p); false -> {let g = ~first(~p)\n g}}}\n f := true}\n p}',
        expected: [true, 2],
    },
    {
        name: 'branch pattern storage',
        source: '{let f = ~{match (true, 1) {(true, n) -> n; (false, n) -> n}}\n f := true}',
        expected: 1,
    },
    {
        name: 'setup availability join',
        source: '{let x = 1\n let spare = 2\n {let f = ~{match false {true -> {spare\n x}; false -> x}}\n f := true}\n spare := 3\n (x, spare)}',
        expected: [true, 3],
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `selected setup ${condition}`,
        source:
            first +
            `fn counted(~(p, count)) ~{count := count + 1\n first(~p)}\n{let p = (1, 2)\n let count = 0\n {let f = ~{match ${condition} {true -> counted(~(p, count)); false -> {count := count + 10\n first(~p)}}}\n f := true}\n (p, count)}`,
        expected: [[true, 2], condition === 'true' ? 1 : 10],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `mixed topology ${condition}`,
        source: `fn pick(b, ~p) ~{match b {true -> p; false -> {let (x, y) = ~p\n (x, y)}}}\n{let pair = ((1, 2), 3)\n pick(${condition}, ~pair) := ((true, 4, 5), false)\n pair}`,
        expected: [[true, 4, 5], false],
    })),
    {
        name: 'nested selected local storage',
        source: '{let f = ~{match true {flag -> {match flag {true -> {let n = 1\n n}; false -> {let n = 2\n n}}}}}\n f := true}',
        expected: 1,
    },
    {
        name: 'scattered branch owners',
        source: 'fn choose(b, ~(x, y)) ~{match b {true -> x; false -> y}}\n{let x = 1\n let y = 2\n choose(false, ~(x, y)) := 3\n (x, y)}',
        expected: [1, 3],
    },
];
