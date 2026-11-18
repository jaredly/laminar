const first = 'fn first(~(x, y)) ~x\n';
export const computedAliases = [
    {
        name: 'returned',
        source: first + '{let pair = (1, 2)\n {let focus = ~first(~pair)\n focus := true}\n pair}',
        expected: [true, 2],
    },
    {
        name: 'growth',
        source:
            first +
            '{let pair = (1, 2)\n {let focus = ~first(~pair)\n focus := (true, 3, 4)}\n pair}',
        expected: [[true, 3, 4], 2],
    },
    {
        name: 'tuple',
        source: '{let a = 1\n let b = 2\n {let (x, y) = ~(a, b)\n x := true\n y := false}\n (a, b)}',
        expected: [true, false],
    },
    {
        name: 'nested',
        source:
            first +
            '{let pair = (1, 2)\n {let focus = ~first(~pair)\n {let inner = ~focus\n inner := true}\n focus := false}\n pair}',
        expected: [false, 2],
    },
    {
        name: 'refill',
        source:
            first +
            '{let pair = (1, 2)\n {let focus = ~first(~pair)\n let old = focus\n focus := true}\n pair}',
        expected: [true, 2],
    },
    {
        name: 'scattered-computed-alias',
        source: first + '{let a = 1\n let b = 2\n {let f = ~first(~(a, b))\n f := true}\n (a, b)}',
        expected: [true, 2],
    },
    {
        name: 'nested-computed-alias',
        source:
            first + '{let pair = ((1, 2), 3)\n {let f = ~first(~first(~pair))\n f := true}\n pair}',
        expected: [[true, 2], 3],
    },
    {
        name: 'deferred-computed-alias',
        source:
            first +
            'fn scoped(~p) ~{let f = ~first(~p)\n f}\n{let pair = (1, 2)\n {let f = ~scoped(~pair)\n f := true}\n pair}',
        expected: [true, 2],
    },
    {
        name: 'repeated-computed-alias',
        source:
            first +
            '{let pair = (1, 2)\n {let f = ~first(~pair)\n f := (true, 3)\n f := false}\n pair}',
        expected: [false, 2],
    },
    {
        name: 'captured-computed-alias',
        source:
            first +
            '{let pair = (1, 2)\n {let f = ~first(~pair)\n let unused = fn (()) f\n f := true}\n pair}',
        expected: [true, 2],
    },
    {
        name: 'inline-deferred-computed-alias',
        source:
            first +
            '{let pair = (1, 2)\n {let f = ~{let g = ~first(~pair)\n g}\n f := true}\n pair}',
        expected: [true, 2],
    },
    {
        name: 'projected-computed-alias',
        source:
            first +
            '{let pair = ((1, 2), 3)\n {let (x, y) = ~first(~pair)\n x := (true, 4, 5)\n y := false}\n pair}',
        expected: [[[true, 4, 5], false], 3],
    },
    {
        name: 'computed-alias-setup-once',
        source:
            first +
            'fn counted(~(pair, count)) ~{count := count + 1\n first(~pair)}\n{let pair = (1, 2)\n let count = 0\n {let f = ~counted(~(pair, count))\n let copy = dup(~f)\n f := true}\n (pair, count)}',
        expected: [[true, 2], 1],
    },
    {
        name: 'disjoint-manual-cleanup',
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 {let f = ~{@(first(~a), fn () {b := b + 1})}
 f := 4}}
 pair}`,
        expected: [[4, 2], 4],
    },
    {
        name: 'disjoint-cleanup-type-change',
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 {let f = ~{@(first(~a), fn () {b := true})}
 f := 4}}
 pair}`,
        expected: [[4, 2], true],
    },
    {
        name: 'disjoint-cleanup-around-computed-branch',
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 {let f = ~{@({match true {true -> first(~a); false -> first(~a)}}, fn () {b := b + 1})}
 f := 4}}
 pair}`,
        expected: [[4, 2], 4],
    },
    {
        name: 'disjoint-cleanup-in-computed-branch',
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 {let f = ~{match false {true -> @(first(~a), fn () {b := b + 1}); false -> @(first(~a), fn () {b := b + 2})}}
 f := 4}}
 pair}`,
        expected: [[4, 2], 5],
    },
    {
        name: 'disjoint-assignment-rhs',
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 first(~a) := {b := b + 1
 4}}
 pair}`,
        expected: [[4, 2], 4],
    },
    {
        name: 'disjoint-ordinary-argument',
        source:
            first +
            `fn replace(v, ~x) {x := v}
{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 replace({b := b + 1
 4}, ~first(~a))}
 pair}`,
        expected: [[4, 2], 4],
    },
    {
        name: 'disjoint-rhs-type-change',
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 first(~a) := {b := true
 4}}
 pair}`,
        expected: [[4, 2], true],
    },
    {
        name: 'disjoint-argument-type-change',
        source:
            first +
            `fn replace(v, ~x) {x := v}
{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 replace({b := true
 4}, ~first(~a))}
 pair}`,
        expected: [[4, 2], true],
    },
    {
        name: 'disjoint-callee-evaluation',
        source:
            first +
            `fn replace(v, ~x) {x := v}
{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 ({b := b + 1
 replace})(4, ~first(~a))}
 pair}`,
        expected: [[4, 2], 4],
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `disjoint-rhs-branch-${condition}`,
        source:
            first +
            `{let pair = ((1, 2), 3)
 {let (a, b) = ~pair
 first(~a) := {match ${condition} {true -> {b := b + 1
 ()}; false -> {b := b + 2
 ()}}
 4}}
 pair}`,
        expected: [[4, 2], condition === 'true' ? 4 : 5],
    })),
];
