/** Caller demands select concrete endpoint contracts before variants are interned. */
export const demandSamples = [
    {
        name: 'demand callable ordinary exchange',
        source: 'fn exchange(new, ~x) {x := new}\n{let v = 3\n let f = fn () v\n let w = 7\n let old = exchange(fn () w, ~f)\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'demand callable projected result',
        source: 'fn first(~(x, y)) ~x\n{let p = (fn () 3, 4)\n let v = (7, 8)\n let old = first(~p) := fn () {let (a, b) = v\n a + b}\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 15, 4],
    },
    {
        name: 'demand callable scattered parameter',
        source: 'fn first(~(x, y)) ~x\n{let f = fn () 3\n let n = 4\n let old = first(~(f, n)) := fn () 7\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable nested forwarding',
        source: 'fn first(~(x, y)) ~x\nfn relay(~p) ~first(~p)\n{let p = (fn () 3, 4)\n let old = relay(~p) := fn () 7\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable distinct replacement variants',
        source: `fn make(v) {fn () v}
fn finish(~x) ~{@(x, {let installed = x := fn () 9
 installed()
 fn () ()})}
{let f = make(3)
 let g = make(4)
 let old = finish(~f) := fn () 7
 let other = finish(~g) := fn () 8
 (old(), other(), f(), g())}`,
        expected: [3, 4, 9, 9],
    },
    {
        name: 'demand callable factory replacement',
        source: 'fn make(v) {fn () v}\nfn first(~(x, y)) ~x\n{let p = (make(3), 4)\n let old = first(~p) := make(7)\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable unused extracted and replacement',
        source: 'fn exchange(new, ~x) {x := new}\n{let v = 3\n let f = fn () v\n let w = 7\n let old = exchange(fn () w, ~f)\n 9}',
        expected: 9,
    },
    {
        name: 'demand callable branch replacement',
        source: 'fn first(~(x, y)) ~x\n{let p = (fn () 3, 4)\n let w = 5\n let old = first(~p) := match true {true -> fn () 7\n false -> fn () w}\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable scope replacement',
        source: 'fn first(~(x, y)) ~x\n{let p = (fn () 3, 4)\n let old = first(~p) := {let w = 5\n fn () w}\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 5, 4],
    },
    {
        name: 'demand callable replacement from focus call',
        source: 'fn first(~(x, y)) ~x\nfn ex(new, ~x) {x := new}\n{let p = (fn () 3, 4)\n let f = fn () 1\n let old = first(~p) := ex(fn () 9, ~f)\n let (g, n) = p\n (old(), g(), n, f())}',
        expected: [3, 1, 4, 9],
    },
    {
        name: 'demand callable persistent result alias',
        source: 'fn first(~(x, y)) ~x\n{let p = (fn () 3, 4)\n let r = {let l = ~first(~p)\n let old = l := fn () 7\n old()}\n let (f, n) = p\n (r, f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable unused result alias',
        source: 'fn first(~(x, y)) ~x\n{let p = (fn () 3, 4)\n {let l = ~first(~p)\n ()}\n let (f, n) = p\n (f(), n)}',
        expected: [3, 4],
    },
    {
        name: 'demand callable setup effect before result',
        source: 'fn pre(~x) ~{let old = x := fn () 5\n x}\n{let f = fn () 3\n let old = pre(~f) := fn () 7\n (old(), f())}',
        expected: [5, 7],
    },
    {
        name: 'demand callable private result backing',
        source: 'fn temp() ~{lens v <- fn () 1\n v}\n{let old = temp() := fn () 8\n old()}',
        expected: 1,
    },
    {
        name: 'demand callable private captured backing',
        source: 'fn temp(n) ~{lens v <- fn () n\n v}\n{let old = temp(5) := fn () 8\n old()}',
        expected: 5,
    },
    {
        name: 'demand callable private redirect',
        source: 'fn redirect(~dst) ~{lens v <- fn () 0\n {let old = dst := v\n ()}}\n{let f = fn () 3\n let old = redirect(~f) := fn () 7\n (old(), f())}',
        expected: [0, 7],
    },
    {
        name: 'demand callable private redirect alias',
        source: 'fn redirect(~dst) ~{lens v <- fn () 0\n {let old = dst := v\n ()}}\n{let f = fn () 3\n let r = {let l = ~redirect(~f)\n let o = l := fn () 7\n o()}\n (r, f())}',
        expected: [0, 7],
    },
    {
        name: 'demand callable result consumed by focus call',
        source: 'fn first(~(x, y)) ~x\nfn ex(new, ~x) {x := new}\n{let p = (fn () 3, 4)\n let old = ex(fn () 7, ~first(~p))\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable result forwarded into returning call',
        source: 'fn first(~(x, y)) ~x\nfn id(~x) ~x\n{let p = (fn () 3, 4)\n let old = id(~first(~p)) := fn () 7\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable joined alias replacement',
        source: 'fn first(~(x, y)) ~x\n{let p = (fn () 3, 4)\n let w = 5\n {let l = ~first(~p)\n match true {true -> {let o = l := fn () 7\n ()}\n false -> {let o = l := fn () w\n ()}}}\n let (f, n) = p\n (f(), n)}',
        expected: [7, 4],
    },
    {
        name: 'demand callable forwarded private result',
        source: 'fn temp() ~{lens v <- fn () 1\n v}\nfn relay() ~temp()\n{let old = relay() := fn () 8\n old()}',
        expected: 1,
    },
    {
        name: 'demand callable closure callee',
        source: '{let k = fn () 2\n let first = fn (~(x, y)) ~{@(x, fn () {let i = k()\n ()})}\n let p = (fn () 3, 4)\n let old = first(~p) := fn () 7\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
];
