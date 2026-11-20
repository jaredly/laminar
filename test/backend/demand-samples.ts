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
    {
        name: 'demand callable recursive exchange',
        source: 'fn ex(k, new, ~x) {match k {0 -> x := new\n j -> ex(j - 1, new, ~x)}}\n{let f = fn () 3\n let old = ex(2, fn () 7, ~f)\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'demand callable recursive scattered descent',
        source: 'fn ex(k, new, ~(x, y)) {match k {0 -> x := new\n j -> ex(j - 1, new, ~(x, y))}}\n{let p = (fn () 3, 4)\n let old = ex(3, fn () 7, ~p)\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'demand callable recursive data result',
        source: 'fn ex(k, new, ~x) {match k {0 -> {let o = x := new\n 1}\n j -> 1 + ex(j - 1, new, ~x)}}\n{let f = fn () 3\n let n = ex(2, fn () 7, ~f)\n (n, f())}',
        expected: [3, 7],
    },
    {
        name: 'demand callable recursive changing input',
        source: 'fn ex(k, ~x) {match k {0 -> x := fn () 1\n j -> {let o = x := fn () 9\n ex(j - 1, ~x)}}}\n{let f = fn () 3\n let old = ex(2, ~f)\n (old(), f())}',
        expected: [9, 1],
    },
    {
        name: 'demand callable dispatch common contract',
        source: 'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {x := new}\n{let f = fn () 3\n let e = match true {true -> ex1\n false -> ex2}\n let old = e(fn () 7, ~f)\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'demand callable dispatch closure alternative',
        source: 'fn ex1(new, ~x) {x := new}\n{let f = fn () 3\n let k = 5\n let e = match false {true -> ex1\n false -> fn (new, ~x) {let z = k\n x := new}}\n let old = e(fn () 7, ~f)\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'demand callable dispatch joined contract',
        source: 'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {let o = x := fn () 9\n new}\n{let f = fn () 3\n let e = match true {true -> ex1\n false -> ex2}\n let old = e(fn () 7, ~f)\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'demand callable dispatch joined contract other arm',
        source: 'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {let o = x := fn () 9\n new}\n{let f = fn () 3\n let e = match false {true -> ex1\n false -> ex2}\n let old = e(fn () 7, ~f)\n (old(), f())}',
        expected: [7, 9],
    },
    {
        name: 'demand callable dispatch joined captured contract',
        source: 'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {let o = x := fn () 9\n new}\n{let f = fn () 3\n let k = 40\n let e = match false {true -> ex1\n false -> ex2}\n let old = e(fn () k, ~f)\n (old(), f())}',
        expected: [40, 9],
    },
    {
        name: 'demand callable dispatch joined aggregate contract',
        source: 'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {let o = x := (fn () 9, 1)\n new}\n{let f = (fn () 3, 0)\n let e = match false {true -> ex1\n false -> ex2}\n let old = e((fn () 7, 2), ~f)\n let (g, n) = f\n let (h, m) = old\n (h(), m, g(), n)}',
        expected: [7, 2, 9, 1],
    },
    {
        name: 'demand callable dispatch converts entry tables',
        source: 'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {let o = x := fn (h) {let r = h()\n r + 100}\n new}\n{let f = fn (h) {let r = h()\n r + 10}\n let e = match true {true -> ex1\n false -> ex2}\n let old = e(fn (h) {let r = h()\n r + 1000}, ~f)\n (old(fn () 2), f(fn () 1))}',
        expected: [12, 1001],
    },
];
