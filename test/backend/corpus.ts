/** Shared acceptance inputs. Their phase is the first required execution milestone, not a claim of codegen support. */
export const backendCorpus = [
    { name: 'scalar', phase: 4, source: '{let x = 1\n x + 2}', expected: 3 },
    { name: 'tuple', phase: 4, source: '(1, true, ())', expected: [1, true, null] },
    { name: 'record', phase: 4, source: '{y: true, x: 1}', expected: [1, true] },
    {
        name: 'record-destructure',
        phase: 4,
        source: '{let {y, x} = {x: 1, y: 2}\n (y, x)}',
        expected: [2, 1],
    },
    {
        name: 'record-nested-case',
        phase: 4,
        source: '{match {a: Some(1), b: 5} {\n {a: Some(n), b} -> n + b\n {a: None, b} -> b\n }}',
        expected: 6,
    },
    {
        name: 'record-lens-update',
        phase: 4,
        legacy: false, // the pattern is open, which the untyped legacy lowering cannot express
        source: 'fn inc(~c) {c := c + 1}\nfn bumpx(~{x, y}) {inc(~x)\n 2}\n{let r = {y: 10, x: 1}\n (bumpx(~r), r)}',
        expected: [2, [2, 10]],
    },
    {
        name: 'record-function',
        phase: 4,
        legacy: false, // the pattern is open, which the untyped legacy lowering cannot express
        source: 'fn sum({a, b}) {a + b}\nfn mk(n) {{b: n, a: 1}}\nsum(mk(4))',
        expected: 5,
    },
    {
        name: 'record-field-move',
        phase: 4,
        legacy: false, // field access has no legacy decomposition
        source: '{let r = {a: {b: 7}, c: 2}\n (r.c, r.a.b)}',
        expected: [2, 7],
    },
    {
        name: 'record-field-lens',
        phase: 4,
        legacy: false, // field access has no legacy decomposition
        source: 'fn inc(~c) {c := c + 1}\n{let r = {y: 10, x: 1}\n inc(~r.x)\n r.x := r.x + 5\n r}',
        expected: [7, 10],
    },
    {
        name: 'record-field-alias',
        phase: 4,
        legacy: false, // field access has no legacy decomposition
        source: 'fn inc(~c) {c := c + 1}\n{let r = {y: 10, x: 1}\n {let a = ~r.x\n inc(~a)}\n r}',
        expected: [2, 10],
    },
    {
        name: 'generic-calls',
        phase: 4,
        source: 'fn id(x) x\n(id(1), id(true))',
        expected: [1, true],
    },
    {
        name: 'annotated-generic',
        phase: 4,
        source: 'id :: (a) => a\nfn id(x) x\nid(2)',
        expected: 2,
    },
    {
        name: 'narrow-contract',
        phase: 4,
        source: 'id :: (Number) => Number\nfn id(x) x\nid(2)',
        expected: 2,
    },
    {
        name: 'thin-update',
        phase: 4,
        source: 'fn inc(~x) {x := x + 1}\n{let x = 1\n inc(~x)\n x}',
        expected: 2,
    },
    {
        name: 'scattered-update',
        phase: 4,
        source: 'fn inc(~(x, y)) {x := x + 1}\n{let a = 1\n let b = 2\n inc(~(a, b))\n (a, b)}',
        expected: [2, 2],
    },
    {
        name: 'thin-pair-update',
        phase: 4,
        source: 'fn inc(~(x, y)) {x := x + 1}\n{let x = (1, 2)\n inc(~x)\n x}',
        expected: [2, 2],
    },
    {
        name: 'branch',
        phase: 4,
        source: '{let x = 1\n match true {true -> x; false -> 2}}',
        expected: 1,
    },
    {
        name: 'recursion',
        phase: 4,
        source: 'fn count(n) (match dup(~n) {0 -> 0; _ -> count(n - 1)})\ncount(3)',
        expected: 0,
    },
    { name: 'type-changing-slot', phase: 5, source: '{let x = 1\n x := true\n x}', expected: true },
    {
        name: 'returned-focus',
        phase: 5,
        source: '{let x = (1, 2)\n fst(~x) := true\n x}',
        expected: [true, 2],
    },
    {
        name: 'nested-shape',
        phase: 5,
        source: 'fn set(~(x, y)) {x := true}\n{let a = (1, 2)\n let b = 3\n set(~(a, b))\n (a, b)}',
        expected: [true, 3],
    },
    { name: 'closure', phase: 6, source: '{let x = 1\n let f = fn (()) x\n f(())}', expected: 1 },
    {
        name: 'capture-restore',
        phase: 6,
        source: '{let x = 1\n let f = {let y = ~x\n let f = fn (()) y\n y := 2\n f}\n (f(()), x)}',
        expected: [1, 2],
    },
    { name: 'list', phase: 7, source: '[1, 2, 3]', expected: [1, 2, 3] },
    { name: 'string', phase: 7, source: '"hello"', expected: 'hello' },
] as const;
