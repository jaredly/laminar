import { expect, it } from 'bun:test';
import { checkSource } from '../src/compiler.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { backendAvailable, expectRun, selectedBackends } from './backend/backends.ts';
import { legacyReference } from './backend/legacy-reference.ts';

const add = 'fn add(~x, n) {x := dup(~x) + n}\n';

const samples: { name: string; source: string; expected: unknown }[] = [
    {
        name: 'first parameter',
        source: add + '{let a = 1\n add(~a, 10)\n add(~a, 100)\n a}',
        expected: 111,
    },
    {
        name: 'middle parameter',
        source: 'fn mix(a, ~x, b) {x := 100 * a + 10 * dup(~x) + b}\n{let v = 2\n mix(1, ~v, 3)\n v}',
        expected: 123,
    },
    {
        name: 'function literal and first-class call',
        source: '{let f = fn (~x, n) {x := n}\n let a = 1\n f(~a, 7)\n a}',
        expected: 7,
    },
    {
        name: 'returned lens',
        source: 'fn pick(~(a, b), left) ~{match left {true -> a; false -> b}}\n{let p = (1, 2)\n pick(~p, false) := 9\n p}',
        expected: [1, 9],
    },
    {
        name: 'producer with a later argument',
        source: 'fn shifted(~x, n) ~{lens v <- dup(~x) + n\n x := v}\n{let a = 1\n {let f = ~shifted(~a, 10)\n f := dup(~f) + 100\n ()}\n a}',
        expected: 111,
    },
    {
        name: 'constructor pattern before another parameter',
        source: 'type Box {\n    Box(Number)\n}\nfn set(~(Box(n)), v) {n := v}\n{let b = Box(1)\n set(~b, 5)\n match b {Box(n) -> n}}',
        expected: 5,
    },
    {
        name: 'recursion',
        source: 'fn count(~(total, n), done) {if dup(~n) == 0 then done else {total := dup(~total) + dup(~n)\n n := dup(~n) - 1\n count(~(total, n), done)}}\n{let s = (0, 4)\n count(~s, ())\n s}',
        expected: [10, 0],
    },
    {
        // The lens is set up first wherever it is written, so the argument sees the same place.
        name: 'setup precedes earlier arguments',
        source: 'fn keep(n, ~x) {(n, dup(~x))}\n{let x = 1\n keep({x := 5\n 0}, ~x)}',
        expected: [0, 5],
    },
];

for (const sample of samples) {
    for (const backend of selectedBackends())
        (backendAvailable(backend) ? it : it.skip)(
            `${backend} takes a lens in any position: ${sample.name}`,
            async () => {
                await expectRun(backend, sample.source, { expected: sample.expected, output: '' });
            },
        );
    it(`the legacy lowering takes a lens in any position: ${sample.name}`, () => {
        expect(legacyReference(sample.source)).toEqual(sample.expected);
    });
}

it('moves an owned lens through a parameter that is not last', () => {
    const source = `// laminar: dual
type linear Conn { Conn(Number) }
fn finish(mut c) { match c { mut Conn(n) -> n } }
fn connection(n) ~{
    lens c <- Conn(n)
    finish(c)
}
fn end(mut ~c, extra) { match ~c { Conn(n) -> dup(~n) + extra } }
{
    let mut conn = ~connection(40)
    end(~conn, 2)
}`;
    expect(() => checkSource(source)).not.toThrow();
});

const swap = 'fn swap(~a, ~b) {let t = dup(~a)\n a := dup(~b)\n b := t}\n';

const several: typeof samples = [
    {
        name: 'two locals',
        source: swap + '{let x = 1\n let y = 2\n swap(~x, ~y)\n (x, y)}',
        expected: [2, 1],
    },
    {
        name: 'forwarded through another function',
        source:
            swap +
            'fn again(~a, ~b) {swap(~a, ~b)}\n{let x = 1\n let y = 2\n again(~x, ~y)\n (x, y)}',
        expected: [2, 1],
    },
    {
        name: 'around an ordinary argument',
        source: 'fn mix(~a, n, ~b) {a := dup(~b) + n\n b := 0}\n{let x = 1\n let y = 2\n mix(~x, 10, ~y)\n (x, y)}',
        expected: [12, 0],
    },
    {
        name: 'changing both types',
        source: swap + '{let x = 1\n let y = true\n swap(~x, ~y)\n (x, y)}',
        expected: [true, 1],
    },
    {
        name: 'returned lens from either',
        source: 'fn pick(left, ~a, ~b) ~{match left {true -> a; false -> b}}\n{let x = 1\n let y = 2\n pick(false, ~x, ~y) := 9\n (x, y)}',
        expected: [1, 9],
    },
    {
        name: 'function literal',
        source: '{let f = fn (~a, ~b) {a := dup(~b)}\n let x = 1\n let y = 2\n f(~x, ~y)\n (x, y)}',
        expected: [2, 2],
    },
    {
        name: 'two constructor patterns',
        source: 'type Box {\n    Box(Number)\n}\nfn move(~(Box(a)), ~(Box(b))) {a := dup(~b)\n b := 0}\n{let x = Box(1)\n let y = Box(2)\n move(~x, ~y)\n (match x {Box(n) -> n}, match y {Box(n) -> n})}',
        expected: [2, 0],
    },
];

for (const sample of several) {
    for (const backend of selectedBackends())
        (backendAvailable(backend) ? it : it.skip)(
            `${backend} takes several lenses: ${sample.name}`,
            async () => {
                await expectRun(backend, sample.source, { expected: sample.expected, output: '' });
            },
        );
    it(`the legacy lowering takes several lenses: ${sample.name}`, () => {
        expect(legacyReference(sample.source)).toEqual(sample.expected);
    });
}

/** Producers that report when they are cleaned up. */
const noisy = `// laminar: dual
fn noisy(mut name) ~{
    lens v <- 0
    write(name)
}
fn both(~a, ~b) { () }
fn first(~a, ~b) ~a
fn end(mut ~a, mut ~b) { () }
fn pass(mut ~a, mut ~b) { end(~a, ~b) }
fn forward(~a, ~b) { both(~a, ~b) }
fn endFirst(mut ~a, ~b) { () }
`;

// Lenses end like nested scopes: the last one set up is the first one cleaned up.
const orders: { name: string; body: string; output: string }[] = [
    { name: 'borrowing call', body: 'both(~noisy("a"), ~noisy("b"))', output: 'ba' },
    {
        name: 'borrowed through another call',
        body: 'forward(~noisy("a"), ~noisy("b"))',
        output: 'ba',
    },
    {
        name: 'returned lens',
        body: 'first(~noisy("a"), ~noisy("b")) := 1\n write(".")',
        output: 'ba.',
    },
    { name: 'owned parameters', body: 'end(~noisy("a"), ~noisy("b"))', output: 'ba' },
    { name: 'owned parameters passed on', body: 'pass(~noisy("a"), ~noisy("b"))', output: 'ba' },
    {
        name: 'held lenses moved together',
        body: 'let mut a = ~noisy("a")\n let mut b = ~noisy("b")\n end(~a, ~b)\n write(".")',
        output: 'ba.',
    },
    // A moved lens ends with its new holder, before the caller gets its borrowed one back.
    { name: 'one moved, one borrowed', body: 'endFirst(~noisy("a"), ~noisy("b"))', output: 'ab' },
];

for (const sample of orders)
    for (const backend of selectedBackends())
        (backendAvailable(backend) ? it : it.skip)(
            `${backend} ends several lenses in order: ${sample.name}`,
            async () => {
                await expectRun(backend, `${noisy}{\n ${sample.body}\n 0\n}`, {
                    expected: 0,
                    output: sample.output,
                });
            },
        );

const rejects = (source: string, code: string) => {
    try {
        checkSource(source);
    } catch (error) {
        expect((error as { code?: string }).code ?? String(error)).toContain(code);
        return;
    }
    throw Error(`Expected ${code}`);
};

it('does not lend the same storage to two parameters', () => {
    for (const body of [
        '{let x = 1\n swap(~x, ~x)\n x}',
        '{let p = (1, 2)\n swap(~p, ~fst(~p))\n p}',
        '{let p = (1, 2)\n swap(~fst(~p), ~p)\n p}',
        // elements of one vector are not told apart
        '{let v = [:1, 2:]\n swap(~v[0], ~v[1])\n 0}',
    ])
        rejects(swap + body, 'alias-conflict');
    rejects(swap + '{let x = 1\n let a = ~x\n swap(~a, ~x)\n x}', 'use-while-borrowed');
});

it('moves each owned lens separately', () => {
    const program = (body: string) => `${noisy}{
 let mut a = ~noisy("a")
 let mut b = ~noisy("b")
 ${body}
}`;
    rejects(program('end(~a, ~b)\n dup(~a)'), 'use-after-move');
    rejects(program('end(~a, ~b)\n dup(~b)'), 'use-after-move');
    expect(() => checkSource(program('endFirst(~a, ~b)\n dup(~b)'))).not.toThrow();
});

it('verifies independently that call lenses do not overlap', () => {
    const typed = JSON.parse(
        JSON.stringify(checkSource(swap + '{let x = 1\n let y = 2\n swap(~x, ~y)\n (x, y)}')),
    );
    expect(() => verifyTypedProgram(typed)).not.toThrow();
    const entry = JSON.stringify(typed.units.at(-1));
    const places = [...entry.matchAll(/"op":"acquire","slot":\{"place":"([^"]+)"/g)].map(
        (m) => m[1]!,
    );
    expect(places).toHaveLength(2);
    typed.units[typed.units.length - 1] = JSON.parse(
        entry.replace(
            `"op":"acquire","slot":{"place":"${places[1]}"`,
            `"op":"acquire","slot":{"place":"${places[0]}"`,
        ),
    );
    expect(() => verifyTypedProgram(typed)).toThrow('Overlapping call lenses');
});
