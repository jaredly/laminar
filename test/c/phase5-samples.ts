export const phase5Samples = [
    {
        name: 'dup-computed-focus',
        source: 'fn first(~(x, y)) ~x\n{let x = (1, 2)\n (dup(~first(~x)), x)}',
        expected: [1, [1, 2]],
    },
    {
        name: 'unit-to-bool',
        source: 'fn refill(~x) {x := true}\n{let x = ()\n refill(~x)\n x}',
        expected: true,
    },
    { name: 'unit-scattered-call', source: 'fn touch(~()) ()\ntouch(~())', expected: null },
    {
        name: 'unit-returned-lens',
        source: 'fn identity(~()) ~()\nidentity(~()) := ()',
        expected: null,
    },
    {
        name: 'discarded-capture-refill',
        source: '{let x = 1\n {let y = ~x\n let f = fn (()) y\n y := (true, 2)}\n x}',
        expected: [true, 2],
    },
    {
        name: 'thin-aggregate-rebuild',
        source: 'fn change(~(x, y)) {x := (true, 2)}\n{let x = (1, 3)\n change(~x)\n x}',
        expected: [[true, 2], 3],
    },
    {
        name: 'mixed-nested-rebuild',
        source: 'fn change(~((x, y), z)) {x := (true, 4)}\n{let a = (1, 2)\n let b = 3\n change(~(a, b))\n (a, b)}',
        expected: [[[true, 4], 2], 3],
    },
    {
        name: 'repeated-returned-focus',
        source: 'fn first(~(x, y)) ~x\n{let x = (1, 2)\n first(~x) := (true, 3)\n first(~x) := false\n x}',
        expected: [false, 2],
    },
    {
        name: 'branch-aggregate-rebuild',
        source: '{let x = (1, 2)\n match false {true -> {fst(~x) := true}; false -> {fst(~x) := false}}\n x}',
        expected: [false, 2],
    },
    {
        name: 'take-thin',
        source: 'fn take(~x) {let y = x\n x := ()\n y}\n{let x = 1\n (take(~x), x)}',
        expected: [1, null],
    },
    {
        name: 'take-scattered',
        source: 'fn take(~(x, y)) {let old = (x, y)\n x := ()\n y := ()\n old}\n{let x = 1\n let y = 2\n (take(~(x, y)), x, y)}',
        expected: [[1, 2], null, null],
    },
    {
        name: 'map-thin',
        source: 'fn convert(x) (x, true)\nfn map(f, ~x) {x := f(x)}\n{let x = 1\n map(convert, ~x)\n x}',
        expected: [1, true],
    },
    {
        name: 'map-scattered',
        source: 'fn convert((x, y)) (true, (x, y))\nfn map(f, ~(x, y)) {(x, y) := f((x, y))}\n{let x = 1\n let y = 2\n map(convert, ~(x, y))\n (x, y)}',
        expected: [true, [1, 2]],
    },
    {
        name: 'saved-alias-refill',
        source: '{let x = 1\n let old = {let y = ~x\n let old = y\n y := (true, 2)\n old}\n (old, x)}',
        expected: [1, [true, 2]],
    },
    {
        name: 'returned-scattered',
        source: 'fn both(~(x, y)) ~(x, y)\n{let x = 1\n let y = 2\n both(~(x, y)) := (true, (3, 4))\n (x, y)}',
        expected: [true, [3, 4]],
    },
    {
        name: 'branch-returned-focus',
        source: 'fn first(b, ~(x, y)) ~{let _ = match b {true -> {y := 3}; false -> {y := 4}}\n x}\n{let x = (1, 2)\n first(false, ~x) := true\n x}',
        expected: [true, 4],
    },
    {
        name: 'grow-slot',
        source: '{let x = 1\n x := (true, (2, 3), ())\n x}',
        expected: [true, [2, 3], null],
    },
    {
        name: 'user-focus-thin',
        source: 'fn first(~(x, y)) ~x\n{let x = (1, 2)\n first(~x) := true\n x}',
        expected: [true, 2],
    },
    {
        name: 'user-focus-scattered',
        source: 'fn first(~(x, y)) ~x\n{let x = 1\n let y = 2\n first(~(x, y)) := true\n (x, y)}',
        expected: [true, 2],
    },
    {
        name: 'nested-return',
        source: 'fn first(~(x, y)) ~x\nfn again(~p) ~first(~p)\n{let x = ((1, 2), 3)\n first(~again(~x)) := true\n x}',
        expected: [[true, 2], 3],
    },
    {
        name: 'changed-field-offset',
        source: 'fn first(~(x, y)) ~x\n{let x = (1, (2, 3))\n first(~x) := (true, (4, 5, 6))\n x}',
        expected: [
            [true, [4, 5, 6]],
            [2, 3],
        ],
    },
    {
        name: 'type-changing-thin-call',
        source: 'fn change(~x) {x := (true, 2)}\n{let x = 1\n change(~x)\n x}',
        expected: [true, 2],
    },
    {
        name: 'type-changing-scattered-call',
        source: 'fn change(~(x, y)) {x := (true, 2)}\n{let x = 1\n let y = 3\n change(~(x, y))\n (x, y)}',
        expected: [[true, 2], 3],
    },
    {
        name: 'alias-after-change',
        source: '{let x = (1, 2)\n {let y = ~x\n fst(~y) := (true, 3)\n fst(~y) := false}\n x}',
        expected: [false, 2],
    },
    {
        name: 'branch-change',
        source: '{let x = 1\n match true {true -> {x := true}; false -> {x := false}}\n x}',
        expected: true,
    },
];
