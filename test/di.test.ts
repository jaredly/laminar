import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import {
    CompileError,
    buildCompiled,
    checkSource,
    compileLibrary,
    compileSource,
} from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { policyFor, type Mode } from '../src/mode.ts';
import { specializeProgram } from '../src/specialize.ts';
import { TypeDiagnostic, printScheme } from '../src/types.ts';

/** The scheme of the last definition or expression. */
const scheme = (source: string, mode: Mode = 'pure') => {
    const checker = new Checker(undefined, undefined, undefined, policyFor(mode));
    let declaration: Decl | undefined,
        last = '';
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        const item = parsed.value;
        if (item.type === 'decl') declaration = item;
        else if (item.type === 'union' || item.type === 'type-alias') checker.addType(item);
        else {
            const checked = checker.check(item, declaration);
            declaration = undefined;
            last = printScheme(checked.scheme);
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

const aliases =
    'type Http = {get: (String) => String, put: (String, String) => String}\ntype Clock = {now: () => String}\n';

describe('dependencies: syntax', () => {
    it('writes function types as record fields without extra parentheses', () => {
        expect(code(`${aliases}1`)).toBe('accepted');
    });
    it('does not make an entry a lens', () => {
        expect(() => code('fn f() { inc(~#x) }')).toThrow('Parse failed');
    });
});

describe('dependencies: inferred needs', () => {
    it.each([
        ['fn f() { (#a, #b) }', '() ={a: a, b: b, ...c}> (a, b)'],
        ['fn f() { (#b, #a) }', '() ={a: a, b: b, ...c}> (b, a)'],
        // A function that needs nothing says nothing.
        ['fn inc(x) { x + 1 }', '(Number) => Number'],
        // Callbacks share the caller's needs.
        ['fn f(g, h) { g()\n h() }', '(() ={a}> b, () ={a}> c) ={a}> c'],
        [
            'fn a() { #a }\nfn b() { #b }\nfn f(g, h) { g()\n h() }\nfn go() { f(a, b) }',
            '() ={a: a, b: b, ...c}> b',
        ],
        ['fn go() { #log("x") }', '() ={log: (String) => a, ...b}> a'],
        ['fn go() { #http.get("x") }', '() ={http: {get: (String) => a, ...b}, ...c}> a'],
        [
            'fn f() {\n let before = #a + 1\n let inner = {\n inject a = "s"\n #a\n }\n (before, inner, #a + 2)\n }',
            '() ={a: Number, ...a}> (Number, String, Number)',
        ],
        // A callback under `inject` needs the injected entry in front of the outer one.
        [
            'fn quietly(job) {\n let loud = #log\n inject log = loud\n job()\n }',
            '(() ={log: a, log: a, ...b}> c) ={log: a, ...b}> c',
        ],
        // An injected function's needs are supplied there, so they become the injector's.
        [
            'fn go() {\n inject log = fn (m) { "${#now()} ${m}" }\n #log("x")\n }',
            '() ={now: () => a, ...b}> String where Display(a), Display(String)',
        ],
        [
            'fn loop(n) { if !n > 0 then loop(n - #step) else 0 }',
            '(Number) ={step: Number, ...a}> Number',
        ],
    ])('%s', (source, expected) => {
        const found = scheme(source);
        // `Display` bounds are incidental to the needs under test.
        expect(found.split(' where ')[0]).toBe(expected.split(' where ')[0]!);
    });
});

describe('dependencies: rejections', () => {
    it.each<[string, string, Mode]>([
        ['#x', 'missing-dependency', 'pure'],
        ['fn f() { #a }\nf()', 'missing-dependency', 'pure'],
        ['fn f() { #x := 1 }', 'dependency-assignment', 'pure'],
        ['fn go() {\n inject r = {f: (fn () { #a })}\n 1\n }', 'needy-dependency', 'pure'],
        ['fn a() { #k + 1 }\nfn f() { (a(), #k == "s") }', 'type-mismatch', 'pure'],
        ['fn loop(n) {\n inject depth = n\n loop(1)\n }', 'infinite-type', 'pure'],
        ['fn c() ~{\n lens x <- 1\n print("${#a}")\n }', 'dependency-in-cleanup', 'pure'],
        [
            'fn bump(mut x) { x := x + #k\n dup(~x) }\n{\n inject k = 1\n inject f = bump\n 1\n }',
            'unsupported-dependency',
            'dual',
        ],
        [
            'type linear H {\n H(Number)\n }\nfn go() {\n inject h = H(1)\n 1\n }',
            'linear-dependency',
            'dual',
        ],
        ['fn go() {\n let mut v = #v\n v\n }', 'shared-into-mut', 'dual'],
    ])('%s', (source, expected, mode) => {
        expect(code(source, mode)).toBe(expected);
    });
    it('points at the `#name` that needs what is missing', () => {
        let found: CompileError | undefined;
        try {
            checkSource('fn log(m) {\n    "${#now()} ${m}"\n}\nfn work() { log("w") }\nwork()');
        } catch (e) {
            found = e as CompileError;
        }
        expect(found?.code).toBe('missing-dependency');
        expect(found?.location?.line).toBe(2);
        expect(found?.message).toContain('now');
    });
});

describe('dependencies: signatures', () => {
    it('limits the body of a definition to a closed list, not its callers', () => {
        expect(code('f :: (Number) ={}> Number\nfn f(n) { n + #a }')).toBe('missing-dependency');
        expect(scheme('f :: (Number) ={}> Number\nfn f(n) { n + 1 }')).toBe('(Number) => Number');
        expect(code(`${aliases}f :: (String) ={Clock}> String\nfn f(u) { #get(u) }`)).toBe(
            'missing-dependency',
        );
        expect(code('fn g() { #b }\nf :: () ={a: Number}> Number\nfn f() { g() }')).toBe(
            'missing-dependency',
        );
        expect(scheme('f :: () ={a: Number}> Number\nfn f() { #a }\nfn g() { (f(), #b) }')).toBe(
            '() ={a: Number, b: a, ...b}> (Number, a)',
        );
    });
    it('merges record aliases', () => {
        expect(scheme(`${aliases}f :: (String) ={Http, Clock}> String\nfn f(u) { #get(u) }`)).toBe(
            '(String) ={get: (String) => String, now: () => String, put: (String, String) => String, ...a}> String',
        );
        expect(code(`${aliases}f :: () ={Clock, Clock}> String\nfn f() { #now() }`)).toBe(
            'duplicate-dependency',
        );
        expect(code('f :: () ={Number}> Number\nfn f() { 1 }')).toBe('invalid-needs');
    });
    it('infers needs a signature leaves out', () => {
        expect(scheme('f :: (Number) => Number\nfn f(n) { n + #a }')).toBe(
            '(Number) ={a: Number, ...a}> Number',
        );
    });
    it('takes a row variable as the row itself', () => {
        expect(scheme('f :: (() ={e}> a) ={e}> a\nfn f(g) { g() }')).toBe('(() ={a}> b) ={a}> b');
    });
    it('holds a closed list against callbacks the body calls', () => {
        // Calling a callback is something the body does, so it may need no more than the list.
        expect(
            code(
                'f :: (() => Number) ={}> Number\nfn f(g) { g() }\nfn a() { #a }\nfn go() { f(a) }',
            ),
        ).toBe('needs-mismatch');
    });
    it('means no needs in a union, unless the union takes the row', () => {
        const union = 'type Job {\n Job(() => Number)\n }\n';
        expect(code(`${union}fn a() { #a + 0 }\nfn go() { Job(a) }`)).toBe('needs-mismatch');
        expect(
            scheme(
                'type Job(e) {\n Job(() ={e}> Number)\n }\nfn run(j) { match j { Job(f) -> f() } }\nfn a() { #a + 0 }\nfn go() { run(Job(a)) }',
            ),
        ).toBe('() ={a: Number, ...a}> Number');
    });
    it('declares dependencies in dual mode, where entry parameters are plain', () => {
        expect(
            code(
                `${aliases}f :: (String) ={Http}> String\nfn f(u) { #get(u) }\nfn get(u) { "g \${u}" }\nfn put(a, b) { "p" }\nfn go() {\n inject get = get\n inject put = put\n f("x")\n }\ngo()`,
                'dual',
            ),
        ).toBe('accepted');
        // An annotation says nothing about who owns a definition's own parameters.
        expect(code('f :: (String) => String\nfn f(u) { u }', 'dual')).toBe('accepted');
    });
});

describe('`mut` in written function types', () => {
    const dual = (source: string) => code(source, 'dual');
    const reads = 'fn show(s) { "x ${s}" }\n';
    const takes = 'fn take(mut s) { "x ${s}" }\n';
    const ap = (type: string) => `ap :: (${type}) => String\nfn ap(f) { f("a") }\n`;
    it.each([
        // An unmarked parameter only reads, as in a definition; `mut` takes ownership.
        [ap('(String) => String') + reads + 'ap(show)', 'accepted'],
        [ap('(String) => String') + 'ap(fn (s) { "x ${s}" })', 'accepted'],
        [ap('(mut String) => String') + takes + 'ap(take)', 'accepted'],
        [ap('(String) => String') + takes + 'ap(take)', 'mode-mismatch'],
        [ap('(mut String) => String') + reads + 'ap(show)', 'mode-mismatch'],
        ['type Op {\n Op((String) => String)\n }\n' + reads + 'Op(show)', 'accepted'],
        ['type Op {\n Op((mut String) => String)\n }\n' + takes + 'Op(take)', 'accepted'],
        [
            'type Op = {run: (mut String) => String}\nx :: (Op) => String\nfn x(o) { match o { {run: r} -> r("a") } }\n1',
            'accepted',
        ],
        // A signature must agree with its definition about `mut`.
        ['f :: (mut Number) => Number\nfn f(mut x) { x }\n1', 'accepted'],
        ['f :: (Number) => Number\nfn f(mut x) { x }\n1', 'mode-mismatch'],
        ['f :: (mut Number) => Number\nfn f(x) { x }\n1', 'mode-mismatch'],
        ['f :: (String) => String\nfn f(x) { x }\n1', 'accepted'],
        [
            'f :: (mut Number) => Number\nfn f(mut x) { x }\nx :: (mut Number) => mut Number\nfn x(mut n) { n }\n1',
            'syntax',
        ],
    ])('%s', (source, expected) => {
        if (expected === 'syntax') expect(() => dual(source)).toThrow();
        else expect(dual(source)).toBe(expected);
    });
    it('needs dual mode', () => {
        expect(code('f :: (mut Number) => Number\nfn f(x) { x }\n1')).toBe('dual-only');
    });
    it('is only for the parameters of a function type', () => {
        expect(dual('f :: (Chan(mut Number)) => ()\nfn f(c) { () }\n1')).toBe('invalid-mut');
    });
});

describe('dependencies: host exports', () => {
    it('rejects an export that needs anything', () => {
        expect(() =>
            compileLibrary('fn needy(x) { x + #k }', {
                target: detectTarget('native'),
                exports: [{ name: 'needy' }],
            }),
        ).toThrow('a host cannot supply');
    });
});

const dual = '// laminar: dual\n';
/** Programs with their results, as the reference evaluator reports them. */
const programs: [name: string, source: string, result: unknown][] = [
    [
        'the example from the plan',
        `fn log(message) { "\${#now()} \${message}" }
fn fetch(url) {
    (log("get \${dup(~url)}"), #get(url))
}
fn main() {
    inject now = fn () { "noon" }
    inject get = fn (url) { "contents of \${url}" }
    fetch("a")
}
main()`,
        ['noon get a', 'contents of a'],
    ],
    [
        'plain data entries',
        `fn f() { (#a + 1, #b) }
{
    inject b = "bee"
    inject a = 41
    f()
}`,
        [42, 'bee'],
    ],
    [
        'callbacks with different needs',
        `fn both(g, h) { (g(), h()) }
fn a() { #x }
fn b() { #y }
{
    inject x = "x"
    inject y = 2
    both(a, b)
}`,
        ['x', 2],
    ],
    [
        'one definition at two layouts and at none',
        `fn call(g) { g(1) }
fn plus(n) { n + #k }
fn times(n) { n * #z }
fn inc(n) { n + 1 }
{
    inject k = 10
    inject z = 3
    (call(plus), call(times), call(inc))
}`,
        [11, 3, 2],
    ],
    [
        'a definition that needs nothing where needs are expected',
        `fn apply2(g, h) { (g(1), h(2)) }
fn plus(n) { n + #k }
fn inc(n) { n + 1 }
{
    inject k = 10
    apply2(plus, inc)
}`,
        [11, 3],
    ],
    [
        'an import where needs are expected',
        `fn use(g, h) { (g(), h()) }
fn k() { #k }
{
    inject k = 1
    use(k, heapsize)
}`,
        [1, 0],
    ],
    [
        'a closure made under inject reads its caller',
        `fn mk() {
    inject a = "inner"
    fn () { #a }
}
{
    let f = mk()
    inject a = "outer"
    f()
}`,
        'outer',
    ],
    [
        'inject over an entry of another type',
        `fn f() {
    let before = #a + 1
    let inner = {
        inject a = "s"
        #a
    }
    (before, inner, #a + 2)
}
{
    inject a = 1
    f()
}`,
        [2, 's', 3],
    ],
    [
        'a callback under inject sees the injected entry',
        // The new logger captures the outer one, so pure mode would refuse it.
        `// laminar: dual
fn quietly(job) {
    let loud = #log
    inject log = fn (m) { loud("(quiet) \${m}") }
    job()
}
fn job() { #log("hi") }
{
    inject log = fn (m) { "log: \${m}" }
    (quietly(job), job())
}`,
        ['log: (quiet) hi', 'log: hi'],
    ],
    [
        'an injected function is bound at its inject',
        `fn go() {
    inject now = fn () { "noon" }
    inject log = fn (m) { "\${#now()} \${m}" }
    inject now = fn () { "night" }
    (#log("a"), #now())
}
go()`,
        ['noon a', 'night'],
    ],
    [
        'an injected definition with needs',
        `fn stamped(m) { "\${#now()} \${m}" }
fn go() {
    inject now = fn () { "noon" }
    inject log = stamped
    #log("b")
}
go()`,
        'noon b',
    ],
    [
        'a record of functions as an entry',
        `fn go() {
    inject http = {get: (fn (u) { "got \${u}" }), tag: "t"}
    #http.get("x")
}
go()`,
        'got x',
    ],
    [
        'recursion under inject with a declaration',
        `f :: (Number) ={depth: Number}> Number
fn f(n) { if !n > 0 then {
    inject depth = !n
    f(n - 1)
} else #depth }
{
    inject depth = 100
    f(3)
}`,
        1,
    ],
    [
        'a closed definition called with more entries',
        `f :: () ={a: Number}> Number
fn f() { #a }
fn g() { (f(), #b) }
{
    inject b = "b"
    inject a = 7
    g()
}`,
        [7, 'b'],
    ],
    [
        'a closed parameter called with more entries',
        `type Clock = {now: () => String}
f :: (() ={Clock}> String) ={Clock, a: String}> (String, String)
fn f(g) { (#a, g()) }
fn tick() { "tick \${#now()}" }
{
    inject a = "A"
    inject now = fn () { "noon" }
    f(tick)
}`,
        ['A', 'tick noon'],
    ],
    [
        'heap entries read twice',
        `fn first() {
    let v = #v
    dup(~v[0])
}
{
    inject v = [:"a", "b":]
    inject s = "str"
    (first(), first(), #s, #s)
}`,
        ['a', 'a', 'str', 'str'],
    ],
    [
        'dual: plain values through calls',
        dual +
            `fn log(message) { "\${#now()} \${message}" }
fn fetch(url) {
    (log("get \${url}"), #get(url))
}
fn main() {
    inject now = fn () { "noon" }
    inject get = fn (url) { "contents of \${url}" }
    (fetch("a"), fetch("b"))
}
main()`,
        [
            ['noon get a', 'contents of a'],
            ['noon get b', 'contents of b'],
        ],
    ],
    [
        'dual: a callback that takes `mut`, written and stored',
        dual +
            `fn first(mut v) { v[0] := "changed"\n v }
ap :: (mut (mut Vector(String)) => Vector(String)) ={step: (mut Vector(String)) => Vector(String)}> (Vector(String), Vector(String))
fn ap(mut f) {
    let v = [:"a", "b":]
    (f(dup(v)), #step(dup(v)))
}
fn go() {
    inject step = first
    ap(first)
}
go()`,
        [
            ['changed', 'b'],
            ['changed', 'b'],
        ],
    ],
    [
        'dual: a definition as a declared entry',
        dual +
            `fn get(u) { "g \${u}" }
f :: (String) ={get: (String) => String}> (String, String)
fn f(u) { (#get(u), #get(u)) }
fn go() {
    inject get = get
    f("x")
}
go()`,
        ['g x', 'g x'],
    ],
    [
        'dual: a shared vector entry is not written through',
        dual +
            `fn peek() {
    let v = #v
    let mut own = dup(v)
    own[0] := "changed"
    own
}
fn go() {
    inject v = [:"a", "b":]
    (peek(), #v, peek())
}
go()`,
        [
            ['changed', 'b'],
            ['a', 'b'],
            ['changed', 'b'],
        ],
    ],
    [
        'an adapter with arguments',
        `fn both(g, h) { (g(1), h(2)) }
fn plus(n) { n + #k }
fn double(n) { n * 2 }
fn go() {
    inject k = 10
    both(plus, double)
}
go()`,
        [11, 4],
    ],
    [
        'a definition that needs nothing as an entry',
        `fn noon() { "noon" }
fn pick() {
    inject now = noon
    #now()
}
pick()`,
        'noon',
    ],
    [
        'entries read in branches',
        `fn f(c) { if c then #a else #b }
{
    inject a = "A"
    inject b = "B"
    (f(true), f(false))
}`,
        ['A', 'B'],
    ],
    [
        'a dependency in the setup of a computed lens',
        dual +
            `fn conn() ~{
    lens fd <- #base + 1
    print("done")
}
fn go() {
    inject base = 10
    let c = ~conn()
    dup(~c)
}
go()`,
        11,
    ],
    [
        'a lens function with needs',
        `fn bump(~c) { c := c + #step }
{
    inject step = 5
    let n = 1
    bump(~n)
    n
}`,
        6,
    ],
    [
        'a union with an unused needs row',
        `type Job(e) {
    Job(() ={e}> Number)
}
fn run(j) { match j { Job(f) -> f() } }
fn one() { 1 }
run(Job(one))`,
        1,
    ],
    [
        'a union with a needy function',
        `type Job(e) {
    Job(() ={e}> Number)
}
fn run(j) { match j { Job(f) -> f() } }
fn needy() { #a + 0 }
{
    inject a = 5
    run(Job(needy))
}`,
        5,
    ],
    [
        'inferred recursion',
        'fn count(n) { if !n > 0 then count(n - #step) else !n }\n{\n    inject step = 2\n    count(7)\n}',
        -1,
    ],
    [
        'pure: mutate a copy of an entry',
        'fn change() {\n    let v = #v\n    v[0] := "changed"\n    dup(~v[0])\n}\n{\n    inject v = [:"a", "b":]\n    (change(), change(), #v)\n}',
        ['changed', 'changed', ['a', 'b']],
    ],
    [
        'closure escapes to another layout',
        'fn mk(tag) { fn () { "${tag} ${#a}" } }\nfn use(f) {\n    inject b = "extra"\n    inject c = "more"\n    (f(), #b)\n}\n{\n    let f = mk("t")\n    inject a = "A"\n    use(f)\n}',
        ['t A', 'extra'],
    ],
    [
        'generic over types and layouts',
        'fn get(x) { (x, #k) }\n{\n    let first = {\n        inject k = 1\n        get("s")\n    }\n    let second = {\n        inject k = "two"\n        get(true)\n    }\n    (first, second)\n}',
        [
            ['s', 1],
            [true, 'two'],
        ],
    ],
    [
        'callbacks in a list',
        'fn one() { #a }\nfn two() { #a + 1 }\nfn sum(list) {\n    match list {\n        [f, ...rest] -> f() + sum(rest)\n        [] -> 0\n    }\n}\nsums :: () ={a: Number}> Number\nfn sums() { sum([one, two]) }\n{\n    inject a = 10\n    sums()\n}',
        21,
    ],
    [
        'inject in a match arm',
        'fn f(c) {\n    match c {\n        true -> {\n            inject a = "yes"\n            #a\n        }\n        false -> #a\n    }\n}\n{\n    inject a = "no"\n    (f(true), f(false))\n}',
        ['yes', 'no'],
    ],
    [
        // Pure mode never copies a function, so this is the dual language's shared closure.
        'copy a needy closure',
        dual +
            'fn mk() { fn () { #a } }\nfn go() {\n let f = mk()\n inject a = 5\n let g = f\n (g(), f())\n }\ngo()',
        [5, 5],
    ],
    [
        'function sent over a channel needs the receiver',
        dual +
            'fn worker(jobs, replies) {\n    let mut job = chanRecv(jobs)\n    inject who = "worker"\n    chanSend(replies, job())\n}\nfn go() {\n    let jobs = chanNew()\n    let replies = chanNew()\n    spawn(fn () { worker(jobs, replies) })\n    chanSend(jobs, fn () { "job run by ${#who}" })\n    chanRecv(replies)\n}\ngo()',
        'job run by worker',
    ],
    [
        'spawn passes ambient entries',
        dual +
            'fn report(replies) {\n    let v = #v\n    let mut own = dup(v)\n    chanSend(replies, "${#name}: ${dup(~own[1])}")\n}\nfn go() {\n    inject name = "task"\n    inject v = [:"a", "b":]\n    let replies = chanNew()\n    spawn(fn () { report(replies) })\n    spawn(fn () { report(replies) })\n    (chanRecv(replies), chanRecv(replies), #name, #v)\n}\ngo()',
        ['task: b', 'task: b', 'task', ['a', 'b']],
    ],
    [
        'dual: mut copy of a need',
        dual +
            'fn go() {\n    inject v = [:1:]\n    let mut own = dup(#v)\n    own[0] := 2\n    (dup(~own), #v)\n}\ngo()',
        [[2], [1]],
    ],
    [
        'entry is record, field read twice',
        'fn f() { (#cfg.name, #cfg.n + 1) }\n{\n    inject cfg = {name: "svc", n: 1}\n    f()\n}',
        ['svc', 2],
    ],
];

describe('dependencies: execution', () => {
    it.each(programs)('%s', (_, source, result) => {
        const checked = checkSource(source);
        expect(executeTypedProgram(checked, { stdout: () => {} })).toEqual(result as never);
        // Specialized, dependencies are ordinary parameters and records are tuples.
        if (source.includes('Job(needy)')) return;
        const { program } = specializeProgram(checked, wasm32Emscripten('test'), [
            { unit: checked.units.at(-1)!.id, arguments: [] },
        ]);
        // A union constructor keeps its generic signature, row parameter and all.
        expect(JSON.stringify(program.units)).not.toMatch(
            /"needs"|"op":"(need|inject|supply|widen)"/,
        );
        expect(executeTypedProgram(program, { stdout: () => {} })).toEqual(result as never);
    });
    it('cannot yet compile a union holding a function with needs', () => {
        const source = programs.find(([, s]) => s.includes('Job(needy)'))![1];
        expect(() => compileSource(source, { target: wasm32Emscripten('test') })).toThrow(
            'cannot be compiled yet',
        );
    });
});

// Building needs the toolchains; opt in with LAMINAR_EXEC=1.
const native = process.env.LAMINAR_EXEC ? it : it.skip;
describe('dependencies: native execution', () => {
    const buildable = programs.filter(([, s]) => !s.includes('Job(needy)'));
    for (const target of ['native', 'wasm32', 'go'] as const)
        native.each(buildable.filter(([, s]) => target === 'go' || !s.includes('chanNew')))(
            `${target}: %s`,
            (_, source, result) => {
                const config = detectTarget(target);
                const built = buildCompiled(compileSource(source, { target: config }), config, {
                    // AddressSanitizer reports a dependency freed while another holder reads it.
                    sanitize: target === 'native',
                });
                const run = spawnSync(built.command, built.args, { encoding: 'utf8' });
                expect([run.status, run.stderr]).toEqual([0, '']);
                // The result follows anything the program printed, after a record separator.
                const reported = run.stdout.slice(run.stdout.lastIndexOf('\u001e') + 1);
                expect(JSON.parse(reported)).toEqual(result as never);
                rmSync(built.directory, { recursive: true, force: true });
            },
            60_000,
        );
    native(
        'spawned tasks read dependencies without racing the spawner',
        () => {
            const [, source] = programs.find(([name]) => name === 'spawn passes ambient entries')!;
            const config = detectTarget('go');
            const built = buildCompiled(compileSource(source, { target: config }), config);
            const run = spawnSync('go', ['run', '-race', 'main.go'], {
                cwd: built.directory,
                encoding: 'utf8',
            });
            expect([run.status, run.stderr]).toEqual([0, '']);
            rmSync(built.directory, { recursive: true, force: true });
        },
        120_000,
    );
});
