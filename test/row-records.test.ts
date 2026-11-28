import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem } from '../src/ast.ts';
import { Checker, checkFile } from '../src/check.ts';
import { buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { policyFor, type Mode } from '../src/mode.ts';
import { specializeProgram } from '../src/specialize.ts';
import { TypeDiagnostic, printScheme } from '../src/types.ts';

const items = (source: string): FileItem[] =>
    readLines(source).nodes.map((node) => {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        return parsed.value;
    });
/** The scheme of the last definition or expression. */
const scheme = (source: string, mode: Mode = 'pure') => {
    const checker = new Checker(undefined, undefined, undefined, policyFor(mode));
    let declaration: Decl | undefined,
        last = '';
    for (const item of items(source)) {
        if (item.type === 'decl') declaration = item;
        else if (item.type === 'union' || item.type === 'type-alias') checker.addType(item);
        else {
            const checked = checker.check(item, declaration);
            declaration = undefined;
            last = printScheme(checked.scheme, mode === 'dual');
            if (item.type === 'fn' && item.name) checker.publish(checked);
        }
    }
    return last;
};
const code = (source: string, mode: Mode = 'pure') => {
    try {
        scheme(source, mode);
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    return 'accepted';
};

const withName = 'fn withName(m) { {...m, name: "Yes"} }';
const setName = 'fn setName(m) { {...m, name = "Yes"} }';
const withoutName = 'fn withoutName(m) { {...m, -name} }';
const replaceName = 'fn replaceName(m) { {...m, -name = "Yes"} }';

describe('row records: inferred schemes', () => {
    it.each([
        [withName, '({...a}) => {name: String, ...a}'],
        [setName, '({name: String, ...a}) => {name: String, ...a}'],
        [withoutName, '({name: a, ...b}) => {...b}'],
        [replaceName, '({name: a, ...b}) => {name: String, ...b}'],
        ['fn get(m) { m.name }', '({name: a, ...b}) => a'],
        ['fn both(m) { (m.x, m.y) }', '({x: a, y: b, ...c}) => (a, b)'],
        ['fn id(m) { {...m} }', '({...a}) => {...a}'],
        ['fn rename(m) { {...m, -old, new: m.old} }', '({old: a, ...b}) => {new: a, ...b}'],
        [
            'fn mapName(f, m) { {...m, -name = f(m.name)} }',
            // The callback's needs are the caller's, so both show them.
            '((a) ={b}> c, {name: a, ...d}) ={b}> {name: c, ...d}',
        ],
        [
            'fn addX(r) { {...r, x: 1} }\nfn addY(r) { {...r, y: true} }\nfn addBoth(r) { addX(addY(r)) }',
            '({...a}) => {x: Number, y: Bool, ...a}',
        ],
        // A constraint nothing in the type shows is still part of the scheme.
        ['fn tmp(m) { {...{...m, t: 1}, -t} }', '({...a}) => {...a} where a lacks t'],
        ['fn split({name, ...rest}) { (name, rest) }', '({name: a, ...b}) => (a, {...b})'],
        [
            'fn merge(m) { {...{a: 1}, ...m, ...{z: true}} }',
            '({...a}) => {a: Number, z: Bool, ...a}',
        ],
    ])('%s', (source, expected) => {
        expect(scheme(source)).toBe(expected);
    });

    it('instantiates each use independently', () => {
        expect(scheme(`${withName}\n(withName({age: 42}), withName({zed: true}))`)).toBe(
            '({age: Number, name: String}, {name: String, zed: Bool})',
        );
    });
});

describe('row records: rejections', () => {
    it.each([
        [`${withName}\nwithName({name: 42})`, 'row-lacks'],
        [`${setName}\nsetName({name: 42})`, 'type-mismatch'],
        [`${setName}\nsetName({})`, 'type-mismatch'],
        [`${withoutName}\nwithoutName({})`, 'type-mismatch'],
        [`${replaceName}\nreplaceName({})`, 'type-mismatch'],
        ['{-a, b: 1}', undefined],
        ['{a: 1, a = 2}', 'record-literal-op'],
        ['{...1, a: 2}', 'type-mismatch'],
        ['{...{a: 1}, -b}', 'unknown-field'],
        ['{...{a: 1}, a: 2}', 'duplicate-field'],
        ['{...{a: 1}, ...{a: 2}}', 'duplicate-field'],
        ['fn f(a, b) { {...a, ...b} }', 'unknown-spread'],
        ['fn f(m) { {...{x: 1}, ...m, ...{x: 2}} }', 'duplicate-field'],
        ['fn f(~{x, ...r}) { 1 }', 'unsupported-lens-rest'],
        ['type U(r) { U({a: Number, ...r}) }', 'open-record-in-union'],
        // A moved field must be removed or replaced, and `=` keeps the type it had.
        ['fn f(m) { {...m, copy: m.name} }', 'use-after-move'],
        ['fn g(x) { 1 }\nfn f(m) { {...m, x: g(m)} }', 'use-after-move'],
        [
            'fn f() { {\n let r = {name: "a"}\n {...r, name = {\n let n = r.name\n 1\n }}\n } }',
            'type-mismatch',
        ],
        [
            'type B {\n B({a: Number, b: Number})\n}\nfn f(v) {\n match ~v {\n B({a}) -> 1\n }\n }',
            'type-mismatch',
        ],
    ])('%s', (source, expected) => {
        if (expected === undefined) expect(() => code(source)).toThrow('Parse failed');
        else expect(code(source)).toBe(expected);
    });
});

describe('row records: signatures', () => {
    it('writes open records and splices alias parameters', () => {
        expect(scheme('f :: ({name: a, ...r}) => a\nfn f(m) { m.name }')).toBe(
            '({name: a, ...b}) => a',
        );
        expect(scheme('f :: ({x: Number, ..._}) => Number\nfn f({x}) { x }')).toBe(
            '({x: Number, ...a}) => Number',
        );
        const named = 'type Named(r) = {name: String, ...r}\n';
        expect(scheme(`${named}f :: (Named({age: Number})) => Number\nfn f(m) { m.age }`)).toBe(
            '({age: Number, name: String}) => Number',
        );
        expect(code(`${named}f :: (Named({name: Number})) => Number\nfn f(m) { 1 }`)).toBe(
            'row-lacks',
        );
        expect(code(`${named}f :: (Named(Number)) => Number\nfn f(m) { 1 }`)).toBe('type-mismatch');
    });
    it('adds the lacks constraints the body needs to a declared contract', () => {
        const source = 'f :: ({...r}) => {...r}\nfn f(m) { {...{...m, tmp: 1}, -tmp} }';
        expect(scheme(source)).toBe('({...a}) => {...a} where a lacks tmp');
        expect(code(`${source}\nf({tmp: 2})`)).toBe('row-lacks');
    });
    it('does not let a body give a declared remainder new fields', () => {
        expect(code('f :: ({...r}) => Number\nfn f(m) { m.x }')).toBe('type-mismatch');
        expect(code('f :: ({...r}) => {...r}\nfn f(m) { {...m, a: 1} }')).toBe('type-mismatch');
    });
});

const closeH = 'type linear H {\n H(Number)\n}\nfn close(H(n)) { n }\n';
const holder = 'fn go() { f({h: H(1), a: 2}) }';

describe('row records: functions hidden in a row', () => {
    const worker = (body: string, job = 'fn () { 2 }', top = '') => `// laminar: dual
${top}fn worker(ch) {
    ${body}
}
{
    let ch = chanNew()
    spawn(fn () { chanSend(ch, {tag: 1, job: (${job})}) })
    worker(ch)
}`;
    const result = (source: string) => {
        try {
            return executeTypedProgram(checkSource(source));
        } catch (e) {
            return (e as { code: string }).code;
        }
    };
    const dropping = [
        'let mut m = chanRecv(ch)\n    m.tag',
        'let mut {tag, ..._} = chanRecv(ch)\n    tag',
    ];
    it('lets a receiver that drops one take any that can be dropped', () => {
        expect(result(worker('let mut {tag, job} = chanRecv(ch)\n    job() + tag'))).toBe(3);
        for (const body of dropping) expect(result(worker(body))).toBe(1);
    });
    it('must still be called when the sender needs that', () => {
        const owning = 'fn () { close(h) }';
        const spends = 'type linear H {\n H(Number)\n}\nfn close(mut h) { match h { mut H(n) -> n } }\n';
        const send = (body: string) =>
            worker(body, owning, spends).replace('spawn(', 'let mut h = H(2)\n    spawn(');
        expect(result(send('let mut {tag, job} = chanRecv(ch)\n    job() + tag'))).toBe(3);
        for (const body of dropping) expect(result(send(body))).toBe('linear-unconsumed');
    });
});

describe('row records: linear fields in dual mode', () => {
    it.each([
        ['fn f(mut r) { {...r, -h} }', 'linear-unconsumed'],
        ['fn f(mut r) { {...r, -h = 1} }', 'linear-unconsumed'],
        ['fn f(mut r) { {...r, -h, done: close(r.h)} }', 'accepted'],
        ['fn f(mut r) { {...r, -h = close(r.h)} }', 'accepted'],
        ['fn f(mut {a}) { a }', 'linear-unconsumed'],
        ['fn f(mut {a, ..._}) { a }', 'linear-unconsumed'],
        ['fn f(mut {a, ...rest}) { (a, rest) }', 'accepted'],
        // The other fields of an open record are dropped with it.
        ['fn f(mut m) { m.a }', 'linear-unconsumed'],
        ['fn f(m) { m.a }', 'dup-linear'],
    ])('%s', (source, expected) => {
        expect(code(`${closeH}${source}\n${holder}`, 'dual')).toBe(expected);
    });
    it('leaves the other fields of a lens pattern in place', () => {
        const source = `${closeH}fn f(~{a}) { a := a + 1 }
fn go() {
    let mut r = {h: H(1), a: 2}
    f(~r)
    close(r.h)
}`;
        expect(code(source, 'dual')).toBe('accepted');
    });
});

/** Programs with their results, as the reference evaluator reports them: records in name order. */
const programs: [name: string, source: string, result: unknown][] = [
    [
        'one definition at two layouts',
        'fn getx(r) { r.x }\n(getx({x: 1, y: true}), getx({a: 2, x: false, z: 3}))',
        [1, false],
    ],
    [
        'extension',
        `${withName}\n(withName({age: 42}), withName({zed: 1}))`,
        [
            [42, 'Yes'],
            ['Yes', 1],
        ],
    ],
    ['homogeneous update', `${setName}\nsetName({name: "old", z: 1})`, ['Yes', 1]],
    ['restriction', `${withoutName}\nwithoutName({name: "gone", age: 42})`, [42]],
    ['replacement', `${replaceName}\nreplaceName({name: 42, age: 42})`, [42, 'Yes']],
    [
        'rename',
        'fn rename(m) { {...m, -old, new: m.old} }\nrename({a: 1, old: "o", z: 3})',
        [1, 'o', 3],
    ],
    [
        'mapping a field in place',
        'fn inc(x) { x + 1 }\nfn mapName(f, m) { {...m, -name = f(m.name)} }\nmapName(inc, {age: "7", name: 1})',
        ['7', 2],
    ],
    [
        'subset and rest patterns',
        'fn split({name, ...rest}) { (name, rest) }\n(split({a: "a", name: 2, z: "z"}), split({name: true}))',
        [
            [2, ['a', 'z']],
            [true, []],
        ],
    ],
    [
        'dropping unnamed fields',
        'fn get({name}) { name }\n(get({a: "dropped", name: 2}), get({name: "kept", z: "dropped"}))',
        [2, 'kept'],
    ],
    [
        'field lens on open records',
        'fn inc(~c) { c := c + 1 }\nfn bump(~m) { inc(~m.count) }\n{\n let a = {count: 1, z: "z"}\n let b = {a: "a", count: 10}\n bump(~a)\n bump(~b)\n (a, b)\n}',
        [
            [2, 'z'],
            ['a', 11],
        ],
    ],
    [
        'subset lens pattern',
        'fn inc(~c) { c := c + 1 }\nfn bump(~{count}) { inc(~count) }\n{\n let b = {a: "a", count: 10, z: true}\n bump(~b)\n b\n}',
        ['a', 11, true],
    ],
    [
        'merging static records with an open one',
        'fn both(m) { {...{a: "a"}, ...m, ...{z: 2}} }\n(both({k: 3}), both({}))',
        [
            ['a', 3, 2],
            ['a', 2],
        ],
    ],
    [
        'temporary fields and temporary bases',
        'fn tmp(m) {\n let {t, ...rest} = {...m, t: "t"}\n (t, rest)\n}\ntmp({b: "b"})',
        ['t', ['b']],
    ],
    ['a call as a base', 'fn make() { {a: "gone", b: "b"} }\n{...make(), -a, c: "c"}', ['b', 'c']],
    [
        'a field of a record as a base',
        'fn nest(m) { {...m.inner, extra: m.other} }\nnest({inner: {a: "a"}, other: "o"})',
        ['a', 'o'],
    ],
    [
        'borrowed constructor pattern with fields out of order',
        'type Box {\n Box({a: Number, b: Number})\n}\n{\n let v = Box({b: 2, a: 1})\n match ~v {\n Box({b, a}) -> {\n b := b + 10\n 0\n }\n }\n v\n}',
        { kind: 'variant', name: 'Box', items: [[1, 12]] },
    ],
    [
        'recursion on an open record',
        'fn count(m) {\n if dup(~m.n) > 0 then count({...m, -n = m.n - 1}) else m\n }\ncount({n: 3, s: "s"})',
        [0, 's'],
    ],
    // Nothing constrains these rows, so specialization makes them empty.
    ['an uncalled closure that spreads', '{\n let f = fn (m) { {...m, a: 1} }\n "ok"\n }', 'ok'],
    ['an uncalled closure with a rest', '{\n let f = fn ({...r}) { r }\n "ok"\n }', 'ok'],
    ['a row that is empty at one use', 'fn f(m) { {...m} }\n(f({}), f({a: "a"}))', [[], ['a']]],
    [
        'plain values keep every field',
        '// laminar: dual\nfn setName(m) { {...m, name = "Yes"} }\nfn go() {\n let p = {age: 5, name: "Lam"}\n let q = setName(p)\n let r = {...p, copy: p.name}\n (p, q, r)\n}\ngo()',
        [
            [5, 'Lam'],
            [5, 'Yes'],
            [5, 'Lam', 'Lam'],
        ],
    ],
    [
        'mut values move into updates',
        '// laminar: dual\nfn first({name}) { name }\nfn go() {\n let mut p = {age: "5", name: "Lam"}\n let q = {...p, -name = "x"}\n (first({k: 1, name: "n"}), q)\n}\ngo()',
        ['n', ['5', 'x']],
    ],
];

const specialized = (source: string) => {
    const program = checkSource(source);
    return specializeProgram(program, wasm32Emscripten('test'), [
        { unit: program.units.at(-1)!.id, arguments: [] },
    ]).program;
};

describe('row records: execution', () => {
    it.each(programs)('%s', (_, source, result) => {
        expect(executeTypedProgram(checkSource(source))).toEqual(result as never);
        // After specialization every record is a tuple, with the same result.
        const program = specialized(source);
        expect(JSON.stringify(program)).not.toContain('"tag":"record"');
        expect(executeTypedProgram(program)).toEqual(result as never);
    });
    it('runs operands before taking a spread place', () => {
        const output: string[] = [];
        executeTypedProgram(
            checkSource(
                'fn say(s) {\n print(dup(~s))\n s\n }\nfn make() {\n print("base")\n {a: "a"}\n }\n(({...make(), b: say("one")}), {...{...make()}, c: say("two")})',
            ),
            { stdout: (text) => output.push(text.trim()) },
        );
        // A base that is not a place runs where it is written.
        expect(output).toEqual(['base', 'one', 'base', 'two']);
    });
    it('is not available to the legacy decomposition', () => {
        for (const source of [
            '{...{a: 1}, b: 2}',
            '{\n let {a} = {a: 1, b: 2}\n a\n }',
            '{\n let {...r} = {a: 1}\n r\n }',
        ])
            expect(() => checkFile(items(source)).ir).toThrow('legacy');
    });
});

// Building needs the toolchains; opt in with LAMINAR_EXEC=1.
describe('row records: native execution', () => {
    // The entry prints its result, so each program ends by comparing against the expected value.
    /** Natively an empty record is the unit tuple, and prints as one. */
    const printed = (v: unknown): unknown =>
        Array.isArray(v) ? (v.length ? v.map(printed) : null) : v;
    for (const target of ['native', 'wasm32', 'go'] as const)
        (process.env.LAMINAR_EXEC ? it : it.skip).each(programs)(
            `${target}: %s`,
            (_, source, result) => {
                const config = detectTarget(target);
                const built = buildCompiled(compileSource(source, { target: config }), config, {
                    // AddressSanitizer reports a field freed twice or used after a move.
                    sanitize: target === 'native',
                });
                const run = spawnSync(built.command, built.args, { encoding: 'utf8' });
                expect([run.status, run.stderr]).toEqual([0, '']);
                expect(printed(JSON.parse(run.stdout))).toEqual(printed(result) as never);
                rmSync(built.directory, { recursive: true, force: true });
            },
            60_000,
        );
});
