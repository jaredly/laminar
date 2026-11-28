import { describe, expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import { checkSource } from '../src/compiler.ts';
import { policyFor, type Mode } from '../src/mode.ts';
import { TypeDiagnostic, printScheme } from '../src/types.ts';

/** `accepted`, or the code of the first diagnostic. */
const code = (source: string, mode: Mode = 'dual') => {
    const checker = new Checker(undefined, undefined, undefined, policyFor(mode));
    let declaration: Decl | undefined;
    try {
        for (const node of readLines(source).nodes) {
            const parsed = grammar.parse<FileItem>('FileItem', node);
            if (parsed.type === 'failure') return 'syntax';
            const item = parsed.value;
            if (item.type === 'decl') declaration = item;
            else if (item.type === 'union' || item.type === 'type-alias') checker.addType(item);
            else {
                const checked = checker.check(item, declaration);
                declaration = undefined;
                if (item.type === 'fn' && item.name) checker.publish(checked);
                printScheme(checked.scheme, mode === 'dual');
            }
        }
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    return 'accepted';
};

const ticket = 'type linear Ticket { Ticket(Number) }\nfn close(mut h) { match h { Ticket(_) -> () } }\n';
const shared = 'fn same(s) { s }\n';
const owned = 'fn make(s) { "x ${s}" }\n';
/** `value` must be owned here. */
const keeps = (value: string) => `fn main() { let mut k = ${value}\n  k := "y"\n  () }`;

/** The printed scheme of each definition, in order. */
const schemes = (source: string, mode: Mode) => {
    const checker = new Checker(undefined, undefined, undefined, policyFor(mode));
    let declaration: Decl | undefined;
    const printed: string[] = [];
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        const item = parsed.value;
        if (item.type === 'decl') declaration = item;
        else if (item.type === 'union' || item.type === 'type-alias') checker.addType(item);
        else {
            const checked = checker.check(item, declaration);
            declaration = undefined;
            if (item.type === 'fn' && item.name) checker.publish(checked);
            printed.push(printScheme(checked.scheme, mode === 'dual'));
        }
    }
    return printed;
};

describe('printed types', () => {
    it.each<[Mode, string, string]>([
        ['dual', 'fn f(n) { n + 1 }', '(Number) => mut Number'],
        ['dual', 'fn f(mut s) { s }', '(mut a) => mut a'],
        ['dual', 'fn f(g) { g("a") }', '((mut String) ={a}> mut b) ={a}> mut b'],
        ['dual', 'fn f() { [:"a":] }', '() => mut Vector(String)'],
        ['dual', 'fn f(~x) {x := x + 1}', '(~Number) => mut ()'],
        ['dual', 'fn f(mut ~x) ~x', '(mut a/b) => mut a/b'],
        ['dual', 'fn f(~x) ~x', '(a/b) => a/b'],
        ['dual', 'fn f(~(x, y)) ~x', '((a, b)/(c, b)) => a/c'],
        ['pure', 'fn f(~x) {x := x + 1}', '(~Number) => ()'],
        ['pure', 'fn f(g, x) { g(x) }', '((a) ={b}> c, a) ={b}> c'],
    ])('%s: %s', (mode, definition, expected) => {
        const printed = schemes(definition, mode)[0]!;
        expect(printed).toBe(expected);
        // Written as the signature, it names the same type.
        expect(schemes(`f :: ${printed}\n${definition}`, mode)[0]).toBe(printed);
    });
});

describe('written results', () => {
    it.each([
        // A signature may freeze an owned result, but not claim one it lacks.
        [`${owned}f :: (String) => mut String\nfn f(s) { make(s) }\n${keeps('f("a")')}`, 'accepted'],
        [`${shared}f :: (String) => mut String\nfn f(s) { same(s) }\n0`, 'shared-into-mut'],
        [`${owned}f :: (String) => String\nfn f(s) { make(s) }\nf("a")`, 'accepted'],
        [`${owned}f :: (String) => String\nfn f(s) { make(s) }\n${keeps('f("a")')}`, 'shared-into-mut'],
        [`${shared}f :: (String) => String\nfn f(s) { same(s) }\nf("a")`, 'accepted'],
        // Recursion is held to what the body really returns.
        ['f :: (Number) => Number\nfn f(n) { if n == 0 then 0 else f(n - 1) }\nf(3)', 'accepted'],
        // A shared result cannot be linear.
        [`${ticket}f :: (Number) => Ticket\nfn f(n) { Ticket(n) }\n0`, 'linear-plain'],
        [`${ticket}f :: () => mut Ticket\nfn f() { Ticket(1) }\nfn main() { close(f()) }`, 'accepted'],
        [`${ticket}f :: (Number) => (Number, Ticket)\nfn f(n) { (n, Ticket(n)) }\n0`, 'linear-plain'],
        // The requirement stays on a generic result.
        [`${ticket}f :: (mut a) => a\nfn f(mut x) { x }\nfn main() { f(Ticket(1))\n  () }`, 'dup-linear'],
        [`f :: (mut a) => a\nfn f(mut x) { x }\nfn main() { f(1)\n  () }`, 'accepted'],
        // Nor can it be a closure with state.
        [
            'f :: () => () => Vector(Number)\nfn f() {\n let mut v = [:0:]\n fn () {\n  let mut w = v\n  w[0] := 1\n  w\n }\n}\n0',
            // The written result type is a reusable function.
            'stateful-closure-mismatch',
        ],
    ])('%s', (source, expected) => {
        expect(code(source)).toBe(expected);
    });

    // A function whose written result matches fits the written slot.
    it.each([
        ['union field', 'type Op { Op((String) => String) }\n', 'Op(F)'],
        ['union field, owned', 'type Op { Op((String) => mut String) }\n', 'Op(G)'],
        ['alias', 'type R = (String) => String\nr :: (R) => ()\nfn r(f) { f("a")\n  () }\n', 'r(F)'],
        ['alias, owned', 'type R = (String) => mut String\nr :: (R) => ()\nfn r(f) { f("a")\n  () }\n', 'r(G)'],
    ])('%s', (_, types, use) => {
        expect(code(`${types}${shared}${owned}fn main() { ${use.replace('F', 'same').replace('G', 'make')}\n  () }`)).toBe('accepted');
    });

    it.each([
        ['type Op { Op(() => Ticket) }\n0', 'linear-plain'],
        ['type R = () => Ticket\n0', 'linear-plain'],
        ['type Op { Op(() => mut Ticket) }\n0', 'accepted'],
        ['type Tree { Leaf(Number)\n Node(() => Tree) }\n0', 'accepted'],
        ['type Op(a) { Op(() => a) }\n0', 'accepted'],
    ])('checks a result written in a type declaration: %s', (source, expected) => {
        expect(code(`${ticket}${source}`)).toBe(expected);
    });

    it('checks a written callback result against its uses', () => {
        const ap = (result: string) => `ap :: ((String) => ${result}) => ()\nfn ap(f) { let mut k = f("a")\n  k := "y"\n  () }\n0`;
        expect(code(ap('mut String'))).toBe('accepted');
        expect(code(ap('String'))).toBe('shared-into-mut');
    });

    it('is dual-only in pure mode', () => {
        expect(code('f :: (Number) => mut Number\nfn f(n) { n }\n0', 'pure')).toBe('dual-only');
        expect(code('f :: (Number) => Number\nfn f(n) { n }\n0', 'pure')).toBe('accepted');
    });
});

describe('using a function as another type of function', () => {
    const fns = `type linear Ticket {
    Ticket(Number)
}
fn show(s) { "x \${s}" }
fn take(mut s) { "x \${s}" }
fn same(s) { s }
fn ignore(s) { 0 }
fn mint(n) { Ticket(dup(n)) }
fn writer() {
 let mut v = [:0:]
 fn () {
  let mut w = v
  w[0] := 1
  w
 }
}
owns :: ((mut String) => String) => String
fn owns(f) { f("o") }
reads :: ((String) => String) => String
fn reads(f) { f("r") }
`;
    const use = (body: string, top = '') => `${fns}${top}fn go() {\n ${body}\n }\ngo()`;

    it.each([
        ['a writer where a reader goes', use('reads(take)'), 'mode-mismatch'],
        ['in a branch', use('reads(if true then show else take)'), 'mode-mismatch'],
        [
            'in a constructor',
            use('let o = Op(take)\n 0', 'type Op {\n Op((String) => String)\n }\n'),
            'mode-mismatch',
        ],
        [
            'in a dependency',
            use(
                'inject step = take\n u()',
                'u :: () ={step: (String) => String}> String\nfn u() { #step("e") }\n',
            ),
            'mode-mismatch',
        ],
        [
            'a shared result where an owned one goes',
            use(
                'y(same)',
                'y :: ((String) => mut String) => mut String\nfn y(f) { f("a") }\n',
            ),
            'mode-mismatch',
        ],
        [
            'the reversal of an unsafe use',
            use(
                'needsAny(readerCallback)',
                'readerCallback :: ((String) => String) => String\nfn readerCallback(f) { f("a") }\nneedsAny :: (((mut String) => String) => String) => String\nfn needsAny(g) { g(take) }\n',
            ),
            'mode-mismatch',
        ],
        ['a branch and a list of both', use('let v = [take, show]\n 0'), 'accepted'],
        ['a later assignment of a writer', use('let mut g = show\n g := take\n g("z")'), 'accepted'],
        [
            'ownership of a linear value to a function that only reads',
            use(
                'g(ignore)',
                'g :: ((mut Ticket) => Number) => Number\nfn g(f) { f(Ticket(1)) }\n',
            ),
            'dup-linear',
        ],
        [
            'a linear result frozen',
            use('h(mint)', 'h :: ((Number) => Ticket) => ()\nfn h(f) { () }\n'),
            'linear-plain',
        ],
        [
            'a linear result frozen where it is generic',
            use('let _ = h(mint)\n 0', 'h :: ((Number) => a) => a\nfn h(f) { f(1) }\n'),
            'dup-linear',
        ],
        [
            'a closure with state is still not a reusable function',
            use('h(writer())', 'h :: (() => Vector(Number)) => ()\nfn h(f) { () }\n'),
            'shared-closure',
        ],
        // A join counted as owned must not hold a part that turns out to be shared.
        [
            'a join decided before what it joins',
            use(
                'let kept = [:1:]\n let mut z = through(echo, kept, true)\n z[0] := 9\n kept',
                'sink :: ((Vector(Number)) => Vector(Number)) => Number\nfn sink(f) { 0 }\nfn echo(s) { s }\nfn through(h, keep, c) {\n if c then (if c then h(keep) else [:0:]) else (if sink(h) == 0 then [:0:] else [:0:])\n }\n',
            ),
            'shared-into-mut',
        ],
    ])('%s', (_, source, expected) => {
        expect(code(source)).toBe(expected);
    });
});

describe('written kinds', () => {
    const fns = `type linear Ticket {
    Ticket(Number)
}
fn spend(mut t) { match t { mut Ticket(n) -> n } }
fn two() { 2 }
`;
    const withTicket = (body: string) => `fn main() {\n let mut t = Ticket(1)\n ${body}\n }\nmain()`;
    const once = 'o :: (once () => mut Number) => mut Number\nfn o(mut f) { f() }\n';
    const must = 'l :: (linear () => mut Number) => mut Number\nfn l(mut f) { f() }\n';

    it.each([
        ['a once parameter takes a reusable function', `${once}fn main() { o(two) }`, 'accepted'],
        ['a linear parameter takes one', `${must}fn main() { l(two) }`, 'accepted'],
        // The definition also calls it exactly once, which is what lets this one through.
        ['a once parameter that always calls', `${once}${withTicket('o(fn () { spend(t) })')}`, 'accepted'],
        [
            'a once parameter that may drop',
            `d :: (once () => mut Number) => mut Number\nfn d(mut f) { 0 }\n${withTicket('d(fn () { spend(t) })')}`,
            'linear-unconsumed',
        ],
        ['dropping a once function', 'd :: (once () => Number) => mut Number\nfn d(mut f) { 0 }\n0', 'accepted'],
        ['dropping a linear one', 'd :: (linear () => Number) => mut Number\nfn d(mut f) { 0 }\n0', 'linear-unconsumed'],
        ['calling a once function twice', 'd :: (once () => mut Number) => mut Number\nfn d(mut f) { f() + f() }\n0', 'use-after-move'],
        ['a linear union field', 'type linear J {\n J(linear () => mut Number)\n }\nfn main() {\n match J(two) {\n  mut J(f) -> f()\n }\n }', 'accepted'],
        ['a linear field in a union that is not', 'type J {\n J(linear () => Number)\n }\n0', 'linear-field'],
        ['a once field', 'type J {\n J(once () => mut Number)\n }\nfn main() {\n match J(two) {\n  mut J(f) -> f()\n }\n }', 'accepted'],
        ['an alias', 'type R = linear () => Number\nk :: (R) => R\nfn k(mut f) { f }\n0', 'accepted'],
        ['a vector', 'k :: (mut Vector(once () => Number)) => mut Vector(once () => Number)\nfn k(mut v) { v }\n0', 'accepted'],
        ['pure mode', 'o :: (once () => Number) => Number\nfn o(f) { f() }\n0', 'dual-only'],
    ])('%s', (name, source, expected) => {
        expect(code(name === 'pure mode' ? source : `${fns}${source}`, name === 'pure mode' ? 'pure' : 'dual')).toBe(expected);
    });

    it.each([
        ['(once () => Number) => mut Number', 'fn k(mut f) { f() + 1 }'],
        ['(linear () => Number) => linear () => Number', 'fn k(mut f) { f }'],
        ['(mut Vector(once () => Number)) => mut Vector(once () => Number)', 'fn k(mut v) { v }'],
    ])('prints %s as written', (written, definition) => {
        const printed = schemes(`k :: ${written}\n${definition}`, 'dual')[0]!;
        expect(schemes(`k :: ${printed}\n${definition}`, 'dual')[0]).toBe(printed);
        expect(printed).not.toContain('mut once');
        expect(printed).not.toContain('mut linear');
    });
});

describe('the kind of function a channel carries', () => {
    const inferred = (body: string) => schemes(`fn w(c) { ${body} }`, 'dual')[0]!;
    // Where nothing says, it is what accepts the most senders among what the body allows.
    it.each([
        ['calls it on every path', 'let mut f = chanRecv(c)\n f()', 'Chan(linear ()'],
        ['may drop it', 'let mut f = chanRecv(c)\n 0', 'Chan(a)'],
        ['calls it on one path', 'let mut f = chanRecv(c)\n if true then f() else 0', 'Chan(once ()'],
        ['copies it', 'let mut f = chanRecv(c)\n let mut g = dup(~f)\n (f(), g())', 'Chan(()'],
        ['only sends and receives', 'chanSend(c, fn () { 1 })\n let mut f = chanRecv(c)\n f()', 'Chan(linear ()'],
    ])('a receiver that %s', (_, body, expected) => {
        expect(inferred(body)).toContain(expected);
    });

    const fns = `type linear Ticket {
    Ticket(Number)
}
fn spend(mut t) { match t { mut Ticket(n) -> n } }
fn two() { 2 }
`;
    const receives = (kind: string) =>
        `w :: (Chan(${kind}() => mut Number)) => mut Number\nfn w(c) { let mut f = chanRecv(c)\n f() }\n`;
    const sends = (job: string) =>
        `fn main() {\n let c = chanNew()\n let mut t = Ticket(1)\n spawn(fn () { chanSend(c, ${job}) })\n let n = spend(t)\n w(c)\n }`;

    it.each([
        ['a reusable channel refuses a must-call closure', `${receives('')}fn main() {\n let c = chanNew()\n let mut t = Ticket(1)\n spawn(fn () { chanSend(c, fn () { spend(t) }) })\n w(c)\n }`, 'linear-closure-mismatch'],
        ['a linear channel takes a reusable function', `${receives('linear ')}${sends('two')}`, 'accepted'],
        ['a once channel takes a reusable function', `${receives('once ')}${sends('two')}`, 'accepted'],
        ['a reusable channel is not a linear one', `${receives('linear ')}u :: (Chan(() => mut Number)) => mut Number\nfn u(c) { w(c) }\n0`, 'linear-closure-mismatch'],
        ['nor a linear one a reusable one', `${receives('')}u :: (Chan(linear () => mut Number)) => mut Number\nfn u(c) { w(c) }\n0`, 'linear-closure-mismatch'],
        // A send in the same definition forces nothing, so this receiver takes must-call jobs.
        ['an inferred receiver needs an annotation for a reusable channel', `fn w(c) { let mut f = chanRecv(c)\n f() }\nu :: (Chan(() => mut Number)) => mut Number\nfn u(c) { w(c) }\n0`, 'linear-closure-mismatch'],
    ])('%s', (_, source, expected) => {
        expect(code(`${fns}${source}`)).toBe(expected);
    });
});

describe('annotating a parameter with a function type', () => {
    it.each([
        'fn ap(f: (String) => String) { f("a") }\nfn same(s) { s }\nap(same)',
        'fn ap(f: ((String) => String)) { f("a") }\nfn same(s) { s }\nap(same)',
        'fn ap(mut f: (mut String) => mut String) { f("a") }\nfn same(mut s) { s }\nap(same)',
    ])('checks %s', (source) => {
        expect(code(source)).toBe('accepted');
        expect(code(source.replace(/mut /g, ''), 'pure')).toBe('accepted');
    });
});

describe('an ownership mismatch', () => {
    it('names the position and shows both types', () => {
        const source = `// laminar: dual
fn take(mut s) { "x \${s}" }
reads :: ((String) => String) => String
fn reads(f) { f("r") }
reads(take)`;
        expect(() => checkSource(source)).toThrow(
            '(mut String) => mut String differ in who owns parameter 1',
        );
    });
});

describe('calling a plain binding', () => {
    const top = 'fn two() { 2 }\nfn run(f) { f() }\n';
    const main = (body: string) => `${top}fn go() {\n ${body}\n }\ngo()`;

    it.each([
        ['twice', main('let g = two\n (g(), g())')],
        ['a lambda, twice', main('let g = fn () { 2 }\n (g(), g())')],
        ['a record field, twice', main('let r = {f: two}\n match r { {f: g} -> (g(), g()) }')],
        ['a parameter, twice', `${top}fn use(g) { (g(), g()) }\nuse(two)`],
        ['and then passing it', main('let g = two\n let a = g()\n (a, run(g))')],
        // An inferred parameter used after a call of it used to be a confusing `type-mismatch`.
        [
            'an inferred parameter, then passing it',
            'fn sink(f) { f([:2:]) }\nfn through(h) {\n let a = h([:1:])\n (a, sink(h))\n }\n0',
        ],
    ])('leaves it to be used again: %s', (_, source) => {
        expect(code(source)).toBe('accepted');
    });

    it.each([
        ['a `mut` binding', main('let mut g = two\n (g(), g())'), 'use-after-move'],
        ['a `mut` parameter', `${top}fn use(mut g) { (g(), g()) }\nuse(two)`, 'use-after-move'],
        [
            'a closure with state, which cannot be plain',
            'fn go() {\n let mut v = [:0:]\n let g = fn () {\n  let mut w = v\n  w[0] := 1\n  w\n }\n (g(), g())\n }\ngo()',
            'shared-closure',
        ],
    ])('is still once for %s', (_, source, expected) => {
        expect(code(source)).toBe(expected);
    });

    it('does not change pure mode, where every binding is used once', () => {
        expect(code(main('let g = two\n (g(), g())'), 'pure')).toBe('use-after-move');
    });
});
