/** Phase 7 nominal data: derived union layouts, boxed recursive variants, drops and deep `dup`. */
const tree = 'type tree(a) {\n    Leaf\n    Node(tree(a), a, tree(a))\n}\n';
const leaf = { kind: 'variant', name: 'Leaf', items: [] };
export const nominalSamples = [
    { name: 'list literal', source: '[1, 2, 3]', expected: [1, 2, 3] },
    { name: 'empty list entry', source: '[]', expected: [] },
    { name: 'option match', source: 'match Some(1) {Some(x) -> x; None -> 0}', expected: 1 },
    {
        name: 'option tuple payload',
        source: 'Some((1, true))',
        expected: { kind: 'variant', name: 'Some', items: [[1, true]] },
    },
    { name: 'none arm', source: 'match None {Some(x) -> x; None -> 0}', expected: 0 },
    {
        name: 'recursive tree sum',
        source: `${tree}fn sum(t) {match t {Leaf -> 0; Node(l, x, r) -> sum(l) + x + sum(r)}}\nsum(Node(Node(Leaf, 1, Leaf), 2, Node(Leaf, 3, Leaf)))`,
        expected: 6,
    },
    {
        name: 'tree value',
        source: `${tree}Node(Leaf, 1, Leaf)`,
        expected: { kind: 'variant', name: 'Node', items: [leaf, 1, leaf] },
    },
    {
        name: 'list length',
        source: 'fn len(l) {match l {[] -> 0; [x, ...rest] -> 1 + len(rest)}}\nlen([4, 5, 6])',
        expected: 3,
    },
    {
        name: 'recursively built list',
        source: 'fn range(n) {match n {0 -> []; k -> [dup(~k), ...range(k - 1)]}}\nrange(4)',
        expected: [4, 3, 2, 1],
    },
    { name: 'dropped list', source: '{let l = [1, 2, 3]\n 5}', expected: 5 },
    { name: 'wildcard drops list', source: 'match [1, 2] {_ -> 7}', expected: 7 },
    {
        name: 'payload-free enum',
        source: 'type dir {\n    Up\n    Down\n}\nfn flip(d) {match d {Up -> Down; Down -> Up}}\nflip(Up)',
        expected: { kind: 'variant', name: 'Down', items: [] },
    },
    {
        name: 'dup deep copies a list',
        source: '{let l = [1, 2]\n (dup(~l), l)}',
        expected: [
            [1, 2],
            [1, 2],
        ],
    },
    {
        name: 'swap returns the old list',
        source: '{let l = [1]\n let old = (l := [2, 3])\n (old, l)}',
        expected: [[1], [2, 3]],
    },
    {
        name: 'closure in option',
        source: 'match Some(fn (x) (x + 1)) {Some(f) -> f(2); None -> 0}',
        expected: 3,
    },
    {
        name: 'nested option',
        source: 'Some(Some(3))',
        expected: {
            kind: 'variant',
            name: 'Some',
            items: [{ kind: 'variant', name: 'Some', items: [3] }],
        },
    },
    { name: 'lists in a tuple', source: '([1], [true, false])', expected: [[1], [true, false]] },
    {
        name: 'literal inside constructor pattern',
        source: 'fn f(o) {match o {Some(1) -> 10; Some(x) -> x; None -> 0}}\n(f(Some(1)), f(Some(5)), f(None))',
        expected: [10, 5, 0],
    },
    { name: 'destructuring let over a list', source: '{let [a, b] = [1, 2]\n a + b}', expected: 3 },
    {
        name: 'closure captures a list',
        source: '{let l = [1, 2]\n let f = fn () {match l {[] -> 0; [x, ...r] -> x}}\n f()}',
        expected: 1,
    },
    {
        name: 'unused closure owns a list',
        source: '{let l = [1, 2]\n let f = fn () l\n 3}',
        expected: 3,
    },
    { name: 'dropped list of closures', source: '{let l = [fn () 1, fn () 2]\n 4}', expected: 4 },
    {
        name: 'option of list',
        source: 'Some([1, 2])',
        expected: { kind: 'variant', name: 'Some', items: [[1, 2]] },
    },
    {
        name: 'nested constructor patterns',
        source: 'match [Some(1), None] {[Some(x), None] -> x; _ -> 0}',
        expected: 1,
    },
    {
        name: 'union inside a lens tuple',
        source: 'fn set(~p) {p := (Some(2), 3)}\n{let p = (Some(1), 1)\n set(~p)\n p}',
        expected: [{ kind: 'variant', name: 'Some', items: [2] }, 3],
    },
    {
        name: 'fst replaces a union field',
        source: '{let p = (Some(1), 1)\n fst(~p) := None\n p}',
        expected: [{ kind: 'variant', name: 'None', items: [] }, 1],
    },
    {
        name: 'borrowed option field write',
        source: '{let o = Some(1)\n match ~o {Some(x) -> {x := 5\n ()}; None -> ()}\n o}',
        expected: { kind: 'variant', name: 'Some', items: [5] },
    },
    {
        name: 'borrowed tree field write',
        source: `${tree}{let t = Node(Leaf, 1, Leaf)\n match ~t {Leaf -> (); Node(l, x, r) -> {x := 9\n ()}}\n t}`,
        expected: { kind: 'variant', name: 'Node', items: [leaf, 9, leaf] },
    },
];
