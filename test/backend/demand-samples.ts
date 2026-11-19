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
];
