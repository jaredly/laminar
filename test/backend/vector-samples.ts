/** Vectors: literals, index lenses, `array`, `size`, copies and nesting. */
export const vectorSamples = [
    { name: 'literal', source: '[:1, 2, 3:]', expected: [1, 2, 3] },
    { name: 'empty literal', source: '[::]', expected: [] },
    { name: 'string elements', source: '[:"${1}", "x":]', expected: ['1', 'x'] },
    { name: 'element write', source: '{let v = [:1, 2:]\n v[1] := 5\n v}', expected: [1, 5] },
    {
        name: 'element swap returns the old element',
        source: '{let v = [:"a":]\n let old = v[0] := "b"\n (old, v)}',
        expected: ['a', ['b']],
    },
    {
        name: 'array and size',
        source: '{let v = array(3, "a")\n v[0] := "b"\n (size(~v), v)}',
        expected: [3, ['b', 'a', 'a']],
    },
    { name: 'empty array drops its element', source: 'array(0, [:"x":])', expected: [] },
    {
        name: 'array copies nested vectors',
        source: '{let v = array(2, [:"x", "y":])\n v[1][0] := "q"\n v}',
        expected: [
            ['x', 'y'],
            ['q', 'y'],
        ],
    },
    {
        name: 'nested index',
        source: '{let v = [:[:1:], [:2, 3:]:]\n v[1][0] := 9\n (dup(~v[1][1]), v)}',
        expected: [3, [[1], [9, 3]]],
    },
    {
        name: 'tuple elements',
        source: '{let v = [:(1, true), (2, false):]\n v[1] := (3, true)\n v}',
        expected: [
            [1, true],
            [3, true],
        ],
    },
    {
        name: 'fst of an element',
        source: '{let v = [:(1, 2):]\n fst(~v[0]) := 9\n v}',
        expected: [[9, 2]],
    },
    {
        name: 'element alias',
        source: '{let v = [:1:]\n let x = ~v[0]\n x := 3\n dup(~x)}',
        expected: 3,
    },
    {
        name: 'dup copies the buffer',
        source: '{let v = [:"a", "b", "c", "d", "e":]\n let w = dup(~v)\n w[0] := "z"\n (v, w)}',
        expected: [
            ['a', 'b', 'c', 'd', 'e'],
            ['z', 'b', 'c', 'd', 'e'],
        ],
    },
    {
        name: 'dup copies nested buffers',
        source: '{let v = [:[:1, 2:]:]\n let w = dup(~v)\n w[0][0] := 9\n (v, w)}',
        expected: [[[1, 2]], [[9, 2]]],
    },
    {
        name: 'dup copies buffers inside variants',
        source: '{let o = Some([:1:])\n let p = dup(~o)\n let q = match ~p { Some(v) -> v[0] := 2 }\n (o, p)}',
        expected: [
            { kind: 'variant', name: 'Some', items: [[1]] },
            { kind: 'variant', name: 'Some', items: [[2]] },
        ],
    },
    // Boxed payloads have one owner: `dup` copies them, so updating one copy is
    // unobservable through the other.
    {
        name: 'dup copies list cells',
        source: 'fn bump(~xs) {\n match ~xs {\n [] -> ()\n [h, ...t] -> {\n h := h + 1\n bump(~t)\n }\n }\n}\n{let a = [1, 2, 3]\n let b = dup(~a)\n bump(~b)\n (a, b)}',
        expected: [
            [1, 2, 3],
            [2, 3, 4],
        ],
    },
    {
        name: 'dup copies list cells updated in the original',
        source: 'fn bump(~xs) {\n match ~xs {\n [] -> ()\n [h, ...t] -> {\n h := h + 1\n bump(~t)\n }\n }\n}\n{let a = [1, 2, 3]\n let b = dup(~a)\n bump(~a)\n bump(~a)\n (a, b)}',
        expected: [
            [3, 4, 5],
            [1, 2, 3],
        ],
    },
    {
        name: 'dup copies tree nodes',
        source: 'type Tree { Leaf(Number)\n Node(Tree, Tree) }\nfn inc(~t) {\n match ~t {\n Leaf(n) -> { n := n + 1 }\n Node(l, r) -> {\n inc(~l)\n }\n }\n}\n{let a = Node(Node(Leaf(1), Leaf(2)), Leaf(3))\n let b = dup(~a)\n inc(~b)\n (a, b)}',
        expected: [
            {
                kind: 'variant',
                name: 'Node',
                items: [
                    {
                        kind: 'variant',
                        name: 'Node',
                        items: [
                            { kind: 'variant', name: 'Leaf', items: [1] },
                            { kind: 'variant', name: 'Leaf', items: [2] },
                        ],
                    },
                    { kind: 'variant', name: 'Leaf', items: [3] },
                ],
            },
            {
                kind: 'variant',
                name: 'Node',
                items: [
                    {
                        kind: 'variant',
                        name: 'Node',
                        items: [
                            { kind: 'variant', name: 'Leaf', items: [2] },
                            { kind: 'variant', name: 'Leaf', items: [2] },
                        ],
                    },
                    { kind: 'variant', name: 'Leaf', items: [3] },
                ],
            },
        ],
    },
    {
        name: 'first-class dup copies the buffer',
        source: '{let d = dup\n let v = [:[:1:]:]\n let w = d(~v)\n w[0][0] := 2\n (v, w)}',
        expected: [[[1]], [[2]]],
    },
    {
        name: 'variant and list elements',
        source: '{let v = [:Some(1), None:]\n v[1] := Some(2)\n let w = [:[1, 2], []:]\n w[1] := [3]\n (v, w)}',
        expected: [
            [
                { kind: 'variant', name: 'Some', items: [1] },
                { kind: 'variant', name: 'Some', items: [2] },
            ],
            [[1, 2], [3]],
        ],
    },
    {
        name: 'lens parameter',
        source: 'fn set(~v) { v[0] := "s" }\n{let v = [:"a":]\n let old = set(~v)\n (old, v)}',
        expected: ['a', ['s']],
    },
    {
        name: 'returned element lens',
        source: 'fn at(~v) ~v[0]\n{let v = [:1, 2:]\n at(~v) := 7\n v}',
        expected: [7, 2],
    },
    {
        name: 'generic element read',
        source: 'fn first(~v) dup(~v[0])\n{let a = [:1, 2:]\n let b = [:"s":]\n (first(~a), first(~b))}',
        expected: [1, 's'],
    },
    {
        name: 'first-class size',
        source: '{let f = size\n let v = [:1, 2:]\n f(~v)}',
        expected: 2,
    },
    {
        name: 'recursive sum',
        source: 'fn sum(i, ~v) {\n    match (dup(~i) >= size(~v)) {\n        true -> 0\n        false -> dup(~v[dup(~i)]) + sum(i + 1, ~v)\n    }\n}\n{let v = [:1, 2, 3:]\n sum(0, ~v)}',
        expected: 6,
    },
    {
        name: 'fill a range',
        source: 'fn fillRange(n, end, ~arr) {\n    match (dup(~n) >= dup(~end)) {\n        true -> ()\n        false -> {\n            arr[dup(~n)] := dup(~n)\n            fillRange(n + 1, end, ~arr)\n        }\n    }\n}\nfn range(n) {\n    let arr = array(dup(~n), 0)\n    fillRange(0, n, ~arr)\n    arr\n}\nrange(10)',
        expected: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
    {
        name: 'branch on a vector',
        source: '{let v = [:1:]\n match true { true -> v[0] := 2; false -> 0 }\n v}',
        expected: [2],
    },
    {
        name: 'vector of functions',
        source: '{let v = [:print:]\n let f = ~v[0]\n let g = f\n f := fn (s) print(s)\n g("hi")}',
        expected: null,
        output: 'hi\n',
    },
];

/** Programs that check but trap at runtime on every backend. */
export const vectorTraps = [
    ['index past the end', '{let v = [:1:]\n v[1] := 2}'],
    ['fractional index', '{let v = [:1:]\n dup(~v[0.5])}'],
    ['negative index', '{let v = [:1:]\n dup(~v[0 - 1])}'],
    ['negative array length', 'array(0 - 1, 0)'],
    ['fractional array length', 'array(1.5, "x")'],
] as const;
