/**
 * Programs in which a function is used as another type of function. A conversion adds no code,
 * so only the checker keeps a backend from writing a value something else still holds: each
 * of these must run the same compiled as in the reference evaluator, which copies.
 */
export const conversionPrelude = `// laminar: dual
fn show(s) { "x \${s}" }
fn take(mut s) { "x \${s}" }
fn same(s) { s }
fn make(s) { "m \${s}" }
fn first(v) {
 let mut w = dup(v)
 dup(~w[0])
 }
fn echo(v) { v }
owns :: ((mut String) => String) => String
fn owns(f) { f("o") }
reads :: ((String) => String) => String
fn reads(f) { f("r") }
`;
const main = (body: string, top = '') =>
    `${conversionPrelude}${top}fn go() {\n ${body}\n }\ngo()`;

export const conversionSamples: { name: string; source: string; expected: unknown }[] = [
    { name: 'a definition that reads takes ownership', source: main('owns(show)'), expected: 'x o' },
    {
        name: 'a lambda that reads takes ownership',
        source: main('owns(fn (s) { "l ${s}" })'),
        expected: 'l o',
    },
    {
        name: 'one local is used both ways',
        source: main('let g = show\n (owns(g), reads(g))'),
        expected: ['x o', 'x r'],
    },
    {
        name: 'one local is used both ways, the other way round',
        source: main('let g = show\n (reads(g), owns(g))'),
        expected: ['x r', 'x o'],
    },
    { name: 'branches join', source: main('owns(if true then take else show)'), expected: 'x o' },
    {
        name: 'a record field',
        source: main('let r = {f: show}\n match r { {f: g} -> owns(g) }'),
        expected: 'x o',
    },
    {
        name: 'a returned function',
        source: main('owns(pick())', 'fn pick() { show }\n'),
        expected: 'x o',
    },
    {
        name: 'a constructor argument',
        source: main(
            'match Op(show) { Op(f) -> f("c") }',
            'type Op {\n Op((mut String) => String)\n }\n',
        ),
        expected: 'x c',
    },
    { name: 'an owned result is frozen', source: main('reads(make)'), expected: 'm r' },
    {
        name: 'an entry that reads takes ownership',
        source: main(
            'inject step = show\n use()',
            'use :: () ={step: (mut String) => String}> String\nfn use() { #step("e") }\n',
        ),
        expected: 'x e',
    },
    {
        name: 'an entry freezes an owned result',
        source: main(
            'inject step = make\n use()',
            'use :: () ={step: (String) => String}> String\nfn use() { #step("e") }\n',
        ),
        expected: 'm e',
    },
    {
        name: 'a reader takes a fresh boxed value apart',
        source: main(
            'give(first)',
            'give :: ((mut Vector(String)) => mut String) => mut String\nfn give(f) { f([:"a", "b":]) }\n',
        ),
        expected: 'a',
    },
    {
        name: 'a reader hands back what it was given',
        source: main(
            'let v = give(echo)\n dup(v)',
            'give :: ((mut Vector(String)) => Vector(String)) => Vector(String)\nfn give(f) { f([:"a", "b":]) }\n',
        ),
        expected: ['a', 'b'],
    },
    {
        name: 'a function that accepts any callback goes where only readers are given',
        source: main(
            'wants(anyCallback)',
            'anyCallback :: ((mut String) => String) => String\nfn anyCallback(f) { f("a") }\nwants :: (((String) => String) => String) => String\nfn wants(g) { g(show) }\n',
        ),
        expected: 'x a',
    },
    {
        name: 'an injected function with dependencies writes its own argument',
        source: main(
            'inject suffix = "!"\n inject shout = shout\n let mut kept = [:"a":]\n let sent = use(dup(~kept))\n (kept, sent)',
            'fn shout(mut v) {\n v[0] := "${#suffix}"\n v\n }\nuse :: (mut Vector(String)) ={shout: (mut Vector(String)) => mut Vector(String)}> mut Vector(String)\nfn use(mut v) { #shout(v) }\n',
        ),
        expected: [['a'], ['!']],
    },
    {
        name: 'a plain closure holding heap data is called again, then passed on',
        source: main(
            'let g = greeter([:"a", "b":])\n let a = g("1")\n let b = g("2")\n (a, b, reads(g))',
            'fn greeter(names) { fn (s) { "${names[1]} ${s}" } }\n',
        ),
        expected: ['b 1', 'b 2', 'b r'],
    },
    {
        name: 'a function parameter is called again',
        source: main(
            'twice(greeter([:"a", "b":]))',
            'fn greeter(names) { fn (s) { "${names[0]} ${s}" } }\nfn twice(g) { (g("1"), g("2"), reads(g)) }\n',
        ),
        expected: ['a 1', 'a 2', 'a r'],
    },
    {
        name: 'pure: a built-in that reads goes where a callback is inferred',
        source: 'fn ap(f) { f(2.5) }\nap(round)',
        expected: 3,
    },
];
