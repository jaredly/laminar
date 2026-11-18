// Shared checked temporary-focus corpus: all samples use scalar/tuple backing.
export const aslensSamples = [
    {
        name: 'returned temporary',
        source: 'fn temp() ~{lens v <- 1\n v}\n temp() := 8',
        expected: 1,
    },
    {
        name: 'final tuple pattern and type change',
        source: '{let seen = 0\n {let f = ~{lens (a, b) <- 1\n seen := (a, b)}\n f := (true, 4)}\n seen}',
        expected: [true, 4],
    },
    {
        name: 'cleanup consumes without refill',
        source: '{let seen = 0\n {let f = ~{lens v <- 1\n seen := v}\n f := 4}\n seen}',
        expected: 4,
    },
    {
        name: 'cleanup refills consumed temporary',
        source: '{let seen = 0\n {let f = ~{lens v <- 1\n seen := v\n v := true}\n f := 4}\n seen}',
        expected: 4,
    },
    {
        name: 'unused temporary restores once',
        source: '{let count = 0\n {let _ = ~{lens v <- 1\n count := count + v}\n ()}\n count}',
        expected: 1,
    },
    {
        name: 'duplicated temporary restores once',
        source: '{let seen = 0\n let copied = dup(~{lens v <- 1\n seen := v})\n (copied, seen)}',
        expected: [1, 1],
    },
    {
        name: 'restores emptied lens parameter',
        source: 'fn shift(~x) ~{lens v <- x + 2\n x := v - 2}\n {let x = 1\n shift(~x) := 10\n x}',
        expected: 8,
    },
    {
        name: 'tuple cleanup restores lexical storage',
        source: 'fn split(~x) ~{lens (a, b) <- x\n x := (b, a)}\n {let x = (1, 2)\n split(~x) := (true, 4)\n x}',
        expected: [4, true],
    },
    {
        name: 'setup once and cleanup late',
        source: '{let count = 0\n {let f = ~{lens v <- {count := count + 1\n 2}\n count := count + v}\n f := 4}\n count}',
        expected: 5,
    },
    {
        name: 'cleanup binding shadows lexical name',
        source: '{let v = 7\n {let f = ~{lens v <- 1\n v}\n f := true}\n v}',
        expected: 7,
    },
    {
        name: 'unconsumed cleanup contents',
        source: '{let f = ~{lens v <- (1, 2)\n ()}\n f := true}',
        expected: [1, 2],
    },
    {
        name: 'wildcard cleanup',
        source: '{let f = ~{lens (_, v) <- (1, 2)\n v}\n f := (true, 4)}',
        expected: [1, 2],
    },
    {
        name: 'manual cleanup precedes temporary cleanup',
        source: '{let count = 1\n {let f = ~{@({lens v <- 2\n count := count + v}, fn () {count := count * 2})}\n f := 4}\n count}',
        expected: 6,
    },
    {
        name: 'temporary cleanup completes nested temporary first',
        source: '{let seen = 0\n {let f = ~{lens v <- 1\n {let g = ~{lens w <- 2\n seen := w}\n g := v}\n seen := seen + 10}\n f := 4}\n seen}',
        expected: 14,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `selected temporary ${condition}`,
        source: `{let seen = 0
 {let f = ~{match ${condition} {true -> {lens v <- 1
 seen := v + 1}; false -> {lens v <- 2
 seen := v + 10}}}
 f := 4}
 seen}`,
        expected: condition === 'true' ? 5 : 14,
    })),
    {
        name: 'owned cleanup result',
        source: '{let f = ~{lens v <- 1\n fn () v}\n f := true}',
        expected: 1,
    },
    {
        name: 'numeric final pattern',
        source: '{let seen = 0\n {let f = ~{lens 4 <- 1\n seen := true}\n f := 4}\n seen}',
        expected: true,
    },
    {
        name: 'boolean final pattern',
        source: '{let f = ~{lens true <- 1\n ()}\n f := true}',
        expected: 1,
    },
    {
        name: 'nested literal final pattern',
        source: '{let seen = 0\n {let f = ~{lens (true, (4, v)) <- 1\n seen := v}\n f := (true, (4, false))}\n seen}',
        expected: false,
    },
    {
        name: 'unused literal temporary',
        source: '{let count = 0\n {let _ = ~{lens 4 <- 4\n count := count + 1}\n ()}\n count}',
        expected: 1,
    },
];
