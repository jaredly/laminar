/**
 * A closure that captured a `mut` value may change it, so two holders of one closure would see
 * each other's writes. In dual mode it is called once, and is never shared or copied
 * (docs/owned-lenses.md). In pure mode no function value is ever copied. The only functions a
 * dependency can hold, which each read of it copies, are top-level ones.
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { CompileError, buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';

const prelude = `// laminar: dual
type Box(a) {
    Box(a)
}
type Job {
    Job(() => Vector(Number))
}
`;
const code = (source: string) => {
    try {
        checkSource(source);
    } catch (e) {
        if (e instanceof CompileError) return e.code;
        throw e;
    }
    return 'accepted';
};
const go = (body: string, top = '') => `${prelude}${top}fn go() {\n ${body.trimStart()}\n}\ngo()`;

// Statements of a block line up, here by one space.
/** Adds one to its own vector each time it is called. */
const counter = ` let mut v = [:0:]
 let mut m = fn () {
  let mut w = v
  let n = dup(~w[0])
  w[0] := n + 1
  w
 }
 `;
const maker = `fn mk() {
 let mut v = [:0:]
 fn () {
  let mut w = v
  let n = dup(~w[0])
  w[0] := n + 1
  w
 }
}
`;
const nine = 'fn nine() { [:9:] }\n';

describe('stateful closures cannot be shared', () => {
    it.each<[string, string, string]>([
        ['a plain binding', `${counter}let p = m\n 0`, ''],
        ['a plain binding of a returned one', 'let p = mk()\n 0', maker],
        ['two plain names, each called', `${counter}let p = m\n let q = p\n (p(), q())`, ''],
        ['dup', `${counter}let mut g = dup(~m)\n (m(), g())`, ''],
        ['a generic function that returns it', `${counter}same(m)\n 0`, 'fn same(x) { x }\n'],
        [
            'a generic function that shares it',
            `${counter}keep(m)`,
            'fn keep(mut x) { let p = x\n 0 }\n',
        ],
        ['a plain parameter, even to call once', `${counter}once(m)`, 'fn once(f) { f() }\n'],
        [
            'a `mut` parameter that shares it',
            `${counter}keep(m)`,
            'fn keep(mut f) { let p = f\n p() }\n',
        ],
        [
            // Dropping it would be safe, but only an exactly-once parameter is recognised.
            'a `mut` parameter that might not call it',
            `${counter}maybe(m)\n 0`,
            'fn maybe(mut f) { if false then f() else [:1:] }\n',
        ],
        ['a tuple that becomes plain', `${counter}let mut t = (m, 1)\n let p = t\n 0`, ''],
        ['a record that becomes plain', `${counter}let mut t = {f: m}\n let p = t\n 0`, ''],
        ['a vector that becomes plain', `${counter}let mut t = [:m:]\n let p = t\n 0`, ''],
        ['a union that becomes plain', `${counter}let mut t = Box(m)\n let p = t\n 0`, ''],
        ['a plain tuple', `${counter}let p = (m, 1)\n 0`, ''],
        [
            'a closure around it that becomes plain',
            `${counter}let mut o = fn () { m() }\n let p = o\n 0`,
            '',
        ],
        ['a dependency', `${counter}inject f = m\n 0`, ''],
    ])('through %s', (_, body, top) => {
        expect(code(go(body, top))).toBe('shared-closure');
    });
    it('does not fit a written function type, which means a reusable one', () => {
        expect(code(go(`${counter}let mut j = Job(m)\n 0`))).toBe('stateful-closure-mismatch');
    });
    it('stays one-use through a channel', () => {
        const body = `${counter}let ch = chanNew()\n chanSend(ch, m)\n let p = chanRecv(ch)\n 0`;
        // A plain binding copies, so the channel would have to carry reusable functions.
        expect(code(go(body))).toBe('shared-closure');
    });
    it.each([
        ['a definition', `${counter}let mut r = if true then m else nine\n r()`],
        [
            'a reusable closure',
            `${counter}let mut r = match true { true -> m\n false -> fn () { [:9:] } }\n r()`,
        ],
    ])('is not yet mixed with %s', (_, body) => {
        expect(['shared-closure', 'stateful-closure-mismatch']).toContain(code(go(body, nine)));
    });
});

const pureTop = `type Box(a) {
    Box(a)
}
type Job {
    Job((Number) => Number)
}
type Wrap {
    Wrap(Job)
}
fn mk() {
 let v = [:0:]
 fn () { v }
}
fn inc(x) { x + 1 }
`;

describe('pure mode: a function value is used once', () => {
    it.each([
        ['a capturing closure', '{\n let f = mk()\n let g = dup(~f)\n 0\n}'],
        ['a closure with no captures', '{\n let f = fn (x) { x }\n let g = dup(~f)\n 0\n}'],
        ['a definition held as a value', '{\n let f = inc\n let g = dup(~f)\n 0\n}'],
        ['a built-in held as a value', '{\n let f = round\n let g = dup(~f)\n 0\n}'],
        ['a tuple holding one', '{\n let t = (inc, 1)\n let g = dup(~t)\n 0\n}'],
        ['a record field', '{\n let t = {f: inc}\n let g = dup(~t.f)\n 0\n}'],
        ['a vector element', '{\n let t = [:inc:]\n let g = dup(~t[0])\n 0\n}'],
        ['a generic union holding one', '{\n let t = Box(inc)\n let g = dup(~t)\n 0\n}'],
        ['a union with a function field', '{\n let t = Job(inc)\n let g = dup(~t)\n 0\n}'],
        ['a union around that union', '{\n let t = Wrap(Job(inc))\n let g = dup(~t)\n 0\n}'],
        [
            'a value copied by a generic function',
            'fn two(x) { (dup(~x), x) }\nfn outer(y) { two(y) }\n{\n outer(mk())\n 0\n}',
        ],
        ['the elements of a new array', '{\n let a = array(2, inc)\n 0\n}'],
    ])('does not copy %s', (_, body) => {
        expect(code(pureTop + body)).toBe('function-copy');
    });
    it.each([
        ['calls a definition repeatedly', '{\n (inc(1), inc(2))\n}'],
        ['names a definition repeatedly', 'fn ap(f) { f(1) }\n{\n (ap(inc), ap(inc))\n}'],
        ['passes a closure on to be called', 'fn run(f) { f() }\n{\n run(mk())\n}'],
        ['copies data', '{\n let v = [:1:]\n let g = dup(~v)\n (v, g)\n}'],
    ])('still %s', (_, body) => {
        expect(code(pureTop + body)).toBe('accepted');
    });
});

describe('pure mode: the only functions a dependency holds are top-level ones', () => {
    const body = (statements: string) => `${pureTop}{\n ${statements}\n}`;
    it.each([
        ['a lambda, even one without captures', 'inject f = fn (x) { x }\n 0'],
        ['a lambda that captures', 'let n = 1\n inject f = fn () { n }\n 0'],
        ['a function from a call', 'inject f = mk()\n 0'],
        ['a local that names a definition', 'let g = inc\n inject f = g\n 0'],
        ['another dependency', 'inject f = inc\n inject g = #f\n 0'],
        [
            'a branch between definitions',
            'inject f = match true { true -> inc\n false -> inc }\n 0',
        ],
        ['a record holding a lambda', 'inject f = {a: inc, b: (fn (x) { x })}\n 0'],
        ['a pair holding a local', 'let g = inc\n inject f = (inc, g)\n 0'],
        ['a vector holding a function from a call', 'inject f = [:mk():]\n 0'],
        ['a union holding a function from a call', 'inject f = Box(mk())\n 0'],
    ])('refuses %s', (_, statements) => {
        expect(code(body(statements))).toBe('local-function-dependency');
    });
    it('refuses a function through a generic injector', () => {
        const source = `${pureTop}fn give(x) {\n inject k = x\n 0\n}\n{\n give(inc)\n}`;
        expect(code(source)).toBe('function-copy');
    });
    it('does not mistake a local for the definition it shadows', () => {
        expect(code(body('let inc = mk()\n inject f = inc\n 0'))).toBe('local-function-dependency');
    });
    it.each<[string, string, unknown]>([
        ['a definition', 'inject f = inc\n (#f(1), #f(2))', [2, 3]],
        ['a built-in', 'inject f = round\n (#f(1.2), #f(2.8))', [1, 3]],
        [
            'a record of definitions and data',
            'inject r = {f: inc, n: 4}\n let f = #r.f\n (f(1), #r.n)',
            [2, 4],
        ],
        ['a union holding a definition', 'inject j = Job(inc)\n match #j { Job(f) -> f(1) }', 2],
        ['data from a call', 'inject n = inc(1)\n (#n, #n)', [2, 2]],
    ])('accepts %s', (_, statements, result) => {
        const checked = checkSource(body(statements));
        expect(executeTypedProgram(checked, { stdout: () => {} })).toEqual(result as never);
    });
});

describe('`array` copies its value', () => {
    it('so a linear one is refused', () => {
        const source =
            '// laminar: dual\ntype linear H {\n    H(Number)\n}\nfn go() {\n let mut a = array(2, H(7))\n a\n}\ngo()';
        expect(code(source)).toBe('dup-linear');
    });
});

const programs: [name: string, source: string, result: unknown][] = [
    ['called once', go(`${counter}m()`), [1]],
    ['never called', go(`${counter}0`), 0],
    ['returned and called', go('let mut f = mk()\n f()', maker), [1]],
    [
        'passed to a parameter that calls it once',
        go(`${counter}run(m)`, 'fn run(mut f) { f() }\n'),
        [1],
    ],
    [
        'forwarded through two parameters',
        go(`${counter}outer(m)`, 'fn run(mut f) { f() }\nfn outer(mut g) { run(g) }\n'),
        [1],
    ],
    [
        'kept in a `mut` tuple',
        go(`${counter}let mut t = (m, 1)\n match t { mut (f, n) -> f() }`),
        [1],
    ],
    [
        'two made separately',
        go('let mut f = mk()\n let mut g = mk()\n (f(), g())', maker),
        [[1], [1]],
    ],
    ['captured by another closure', go(`${counter}let mut o = fn () { m() }\n o()`), [1]],
    [
        'either of two',
        go(
            `${counter}let mut u = [:5:]\n let mut o = fn () { u }\n let mut r = match true { true -> m\n false -> o }\n r()`,
        ),
        [1],
    ],
    [
        'spawned',
        go(`${counter}let out = chanNew()\n spawn(fn () { chanSend(out, m()) })\n chanRecv(out)`),
        [1],
    ],
    [
        'sent between tasks',
        go(
            `${counter}let ch = chanNew()\n spawn(fn () { chanSend(ch, m) })\n let mut f = chanRecv(ch)\n f()`,
        ),
        [1],
    ],
    // Captures that nothing can change leave a closure reusable.
    [
        'a `mut` number capture',
        go('let mut n = 4\n let mut f = fn () { n + 1 }\n let p = f\n let q = p\n (p(), q())'),
        [5, 5],
    ],
    [
        'a `mut` string capture',
        go('let mut s = "a"\n let mut f = fn () { "${s}!" }\n let p = f\n let q = p\n (p(), q())'),
        ['a!', 'a!'],
    ],
    [
        'plain captures',
        go('let v = [:3:]\n let f = fn () { v[0] + 0 }\n let g = f\n (f(), g())'),
        [3, 3],
    ],
];

describe('stateful closures: allowed uses', () => {
    it.each(programs)('%s', (_, source, result) => {
        expect(executeTypedProgram(checkSource(source), { stdout: () => {} })).toEqual(
            result as never,
        );
    });
});

// Building needs the toolchains; opt in with LAMINAR_EXEC=1.
const native = process.env.LAMINAR_EXEC ? it : it.skip;
describe('stateful closures: native execution', () => {
    for (const target of ['native', 'wasm32', 'go'] as const)
        native.each(programs.filter(([, s]) => target === 'go' || !s.includes('chanNew')))(
            `${target}: %s`,
            (_, source, result) => {
                const config = detectTarget(target);
                const built = buildCompiled(compileSource(source, { target: config }), config, {
                    sanitize: target === 'native',
                });
                const run = spawnSync(built.command, built.args, { encoding: 'utf8' });
                expect([run.status, run.stderr]).toEqual([0, '']);
                const reported = run.stdout.slice(run.stdout.lastIndexOf('\u001e') + 1);
                expect(JSON.parse(reported)).toEqual(result as never);
                rmSync(built.directory, { recursive: true, force: true });
            },
            60_000,
        );
});
