import { expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem, Linear, TypeDecl } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import { checkSource } from '../src/compiler.ts';
import { dualMode } from '../src/mode.ts';
import { TypeDiagnostic } from '../src/types.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { net as printing } from './backend/owned-lens-samples.ts';

/** The checker alone, so a rejection is the checker's. */
const code = (source: string) => {
    const checker = new Checker(undefined, undefined, undefined, dualMode);
    let declaration: Decl | undefined;
    try {
        for (const node of readLines(source).nodes) {
            const parsed = grammar.parse<FileItem>('FileItem', node);
            if (parsed.type === 'failure') return 'syntax';
            const item = parsed.value;
            if (item.type === 'decl') declaration = item;
            else if (item.type === 'type-alias' || item.type === 'union') checker.addType(item);
            else {
                const checked = checker.check(item, declaration);
                if (item.type === 'fn' && item.name) checker.publish(checked);
                declaration = undefined;
            }
        }
    } catch (error) {
        if (error instanceof TypeDiagnostic) return error.code;
        throw error;
    }
    return 'ok';
};

/** `connection` borrows no lens, so its lens is owned. `handle` ends it and `peek` borrows it. */
const net = `fn connection(listener) ~{
    lens fd <- accept(listener)
    closeHandle(fd)
}
fn peek(~conn) { recv(dup(~conn)) }
fn handle(text, mut ~conn) {
    let request = peek(~conn)
    send(dup(~conn), text)
}
`;
/** The same shape over a linear type. */
const conn = `type linear Conn {
    Conn(Number)
}
fn finish(mut c) {match c {mut Conn(fd) -> closeHandle(fd)}}
fn connection(listener) ~{
    lens c <- Conn(accept(listener))
    finish(c)
}
fn peek(~c) {match ~c {Conn(fd) -> recv(dup(~fd))}}
fn end(mut ~c) {peek(~c)}
`;
const program = (body: string, prelude = net) => code(`${prelude}{${body}}`);

it('moves a produced lens into a task that ends it', () => {
    expect(program('let conn = ~connection(1)\n spawn(fn () { handle("hi", ~conn) })\n 0')).toBe('ok');
    expect(program('let c = ~connection(1)\n spawn(fn () { end(~c) })\n 0', conn)).toBe('ok');
});

it('lets the new holder reborrow before moving or ending it', () => {
    expect(program('let conn = ~connection(1)\n let a = peek(~conn)\n handle(a, ~conn)\n 0')).toBe('ok');
    expect(program('let conn = ~connection(1)\n spawn(fn () { let a = peek(~conn)\n let b = peek(~conn)\n () })\n 0')).toBe('ok');
});

it('ends an owned lens that never moves at the end of its scope', () => {
    expect(program('let conn = ~connection(1)\n let a = peek(~conn)\n 0')).toBe('ok');
});

it('moves a temporary straight from its producer', () => {
    expect(program('handle("hi", ~connection(1))\n 0')).toBe('ok');
});

it('serves from an accept loop', () => {
    const serve = `fn serve(listener, text) {
    let conn = ~connection(listener)
    spawn(fn () { handle(text, ~conn) })
    serve(listener, text)
}
0`;
    expect(code(net + serve)).toBe('ok');
});

it('uses nothing after the move', () => {
    expect(program('let conn = ~connection(1)\n handle("a", ~conn)\n peek(~conn)')).toBe('use-after-move');
    expect(program('let conn = ~connection(1)\n handle("a", ~conn)\n handle("b", ~conn)')).toBe('use-after-move');
    expect(program('let conn = ~connection(1)\n spawn(fn () { handle("a", ~conn) })\n peek(~conn)')).toBe('use-after-move');
    expect(program('let conn = ~connection(1)\n spawn(fn () { handle("a", ~conn) })\n spawn(fn () { handle("b", ~conn) })\n 0')).toBe('use-after-move');
    expect(program('let conn = ~connection(1)\n handle("a", ~conn)\n conn := 3\n 0')).toBe('use-after-move');
    expect(program('let conn = ~connection(1)\n spawn(fn () { handle("a", ~conn)\n peek(~conn)\n () })\n 0')).toBe('use-after-move');
});

it('does not move a lens that something still borrows', () => {
    expect(program('let conn = ~connection(1)\n let again = ~conn\n handle("a", ~conn)\n peek(~again)')).toBe('use-while-borrowed');
    // a reborrow is not the lens itself
    expect(program('let conn = ~connection(1)\n let again = ~conn\n handle("a", ~again)\n 0')).toBe('borrowed-lens-move');
    expect(program('let conn = ~connection(1)\n let again = ~conn\n spawn(fn () { peek(~again)\n () })\n 0')).toBe('borrowed-capture');
});

it('keeps borrowed lenses where they are', () => {
    // a lens argument
    expect(code(`${net}fn f(~c) { spawn(fn () { handle("a", ~c) }) }\n0`)).toBe('borrowed-capture');
    expect(code(`${net}fn f(~c) { handle("a", ~c) }\n0`)).toBe('borrowed-lens-move');
    // a lens into someone else's storage
    expect(program('let mut n = 1\n handle("a", ~n)\n n')).toBe('borrowed-lens-move');
    expect(program('let mut n = 1\n spawn(fn () { peek(~n)\n () })\n n')).toBe('borrowed-capture');
    expect(program('let mut pair = (1, 2)\n let first = ~fst(~pair)\n spawn(fn () { peek(~first)\n () })\n 0')).toBe('borrowed-capture');
    // a producer that borrows a lens returns a borrowed one
    const through = 'fn through(~listener) ~{lens fd <- accept(dup(~listener))\n closeHandle(fd)}\n';
    expect(program('let mut l = 1\n let c = ~through(~l)\n handle("a", ~c)\n 0', net + through)).toBe('borrowed-lens-move');
});

it('will not move an empty lens', () => {
    expect(program('let conn = ~connection(1)\n let n = conn\n handle("a", ~conn)\n 0')).toBe('unrestored-lens');
    expect(program('let conn = ~connection(1)\n let n = conn\n spawn(fn () { peek(~conn)\n () })\n 0')).toBe('unrestored-lens');
    // and the holder must leave it full
    expect(program('let conn = ~connection(1)\n spawn(fn () { let a = peek(~conn)\n let n = conn\n () })\n 0')).toBe('unrestored-lens');
    expect(code(`${net}fn drain(mut ~c) { let n = c\n n }\n0`)).toBe('unrestored-lens');
});

it('moves on one branch and ends at the edge of the others', () => {
    expect(program('let conn = ~connection(1)\n if true then handle("a", ~conn) else ()\n 0')).toBe('ok');
    expect(program('let conn = ~connection(1)\n if true then handle("a", ~conn) else ()\n peek(~conn)')).toBe('use-after-move');
    expect(program('let conn = ~connection(1)\n if true then handle("a", ~conn) else { let n = conn\n () }\n 0')).toBe('unrestored-lens');
});

it('checks what the new holder leaves for the producer', () => {
    expect(program('let conn = ~connection(1)\n spawn(fn () { conn := "no" })\n 0')).toBe('type-mismatch');
    expect(code(`${net}fn spoil(mut ~c) { c := "no" }\n{let conn = ~connection(1)\n spoil(~conn)\n 0}`)).toBe('type-mismatch');
});

it('makes a closure that holds a linear value or an owned lens linear', () => {
    // dropped uncalled
    expect(program('let conn = ~connection(1)\n let mut f = fn () { handle("a", ~conn) }\n 0')).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n let mut f = fn () { finish(c) }\n 0', conn)).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n let _ = fn () { finish(c) }\n 0', conn)).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n let mut f = fn () { finish(c) }\n if true then f() else ()', conn)).toBe('linear-unconsumed');
    // called once
    expect(program('let mut c = Conn(1)\n let mut f = fn () { finish(c) }\n f()', conn)).toBe('ok');
    expect(program('let mut c = Conn(1)\n let mut f = fn () { finish(c) }\n f()\n f()', conn)).toBe('use-after-move');
    // not copied
    expect(program('let mut c = Conn(1)\n let f = fn () { finish(c) }\n f()', conn)).toBe('linear-plain');
    expect(program('let mut c = Conn(1)\n let mut f = fn () { finish(c) }\n let mut g = dup(~f)\n f()\n g()', conn)).toBe('dup-linear');
    // a closure that holds it through another closure is linear too
    expect(program('let mut c = Conn(1)\n let mut f = fn () { finish(c) }\n let mut g = fn () { f() }\n 0', conn)).toBe('linear-unconsumed');
});

it('owned closures are still callable once and droppable', () => {
    expect(program('let mut n = (1, 2)\n let mut f = fn () { n }\n 0')).toBe('ok');
    expect(program('let mut n = (1, 2)\n let mut f = fn () { n }\n f()\n f()')).toBe('use-after-move');
});

it('passes a linear closure only to a function that consumes it', () => {
    const run = (definition: string) =>
        program('let mut c = Conn(1)\n run(fn () { finish(c) })\n 0', `${conn}${definition}\n`);
    expect(run('fn run(mut task) { task() }')).toBe('ok');
    expect(run('fn run(mut task) { spawn(task) }')).toBe('ok');
    expect(run('fn run(mut task) { if true then task() else task() }')).toBe('ok');
    expect(run('fn go(mut task) { task() }\nfn run(mut task) { go(task) }')).toBe('ok');
    // drops it, sometimes or always
    expect(run('fn run(mut task) { 0 }')).toBe('linear-unconsumed');
    expect(run('fn run(mut task) { if true then task() else () }')).toBe('linear-unconsumed');
    expect(run('fn drop(mut t) { 0 }\nfn run(mut task) { drop(task) }')).toBe('linear-unconsumed');
    // may reuse it
    expect(run('fn run(task) { task() }')).toBe('linear-unconsumed');
    expect(run('fn run(mut task) { let mut again = dup(~task)\n task()\n again() }')).toBe('linear-unconsumed');
    // hands it to another closure that may be dropped
    expect(run('fn run(mut task) { let mut later = fn () { task() }\n 0 }')).toBe('linear-unconsumed');
});

it('carries exactly-once callback evidence through function values', () => {
    const source = (bind: string) =>
        `// laminar: dual
type linear Token { Token(Number) }
fn finish(mut t) { match t { mut Token(n) -> n } }
fn run(mut f) { f() }
fn maybe(mut f) { if true then f() else 0 }
{
    ${bind}
    let mut t = Token(42)
    runner(fn () { finish(t) })
}`;
    for (const bind of [
        'let runner = run',
        'let runner = fn (mut f) { f() }',
        'let first = run\n let runner = first',
        'let runner = if true then run else run',
        'let runner = fn (mut f) { let invoke = run\n invoke(f) }',
        'let invoke = run\n let runner = fn (mut f) { invoke(f) }',
        'let mut runner = maybe\n runner := run',
    ])
        expect(executeTypedProgram(checkSource(source(bind)))).toBe(42);
    for (const bind of [
        'let runner = maybe',
        'let runner = if true then run else maybe',
        'let mut runner = run\n runner := maybe',
        'let mut runner = run\n if true then {runner := maybe\n ()} else ()',
    ])
        expect(() => checkSource(source(bind))).toThrow('must be called exactly once');
});

it('drops callback evidence when a lens call may replace the function', () => {
    const use = (bind: string) =>
        code(`${conn}fn run(mut f) { f() }
fn maybe(mut f) { if true then f() else 0 }
fn clobber(~f) { f := maybe }
{
    ${bind}
    let mut c = Conn(1)
    runner(fn () { finish(c) })
}`);
    expect(use('let mut runner = run\n let copy = dup(~runner)\n let runner = copy')).toBe('ok');
    expect(use('let mut runner = run\n clobber(~runner)')).toBe('linear-unconsumed');
    expect(use('let mut runner = run\n let pair = (runner, maybe)\n let (runner, _) = pair')).toBe(
        'linear-unconsumed',
    );
    // first-class spawn has no proof of its own
    expect(use('let runner = spawn')).toBe('linear-unconsumed');
});

it('requires every lens cleanup arm to call the callback', () => {
    const pick = (other: string) =>
        code(`${conn}fn pick(mut f, flag) {
    {let g = ~{match flag {
        true -> {lens x <- 1\n { f()\n () }}
        false -> {lens y <- 2\n { ${other}\n () }}
    }}\n g := 3}
    ()
}
{
    let mut c = Conn(1)
    pick(fn () { let n = finish(c)\n () }, false)
}`);
    expect(pick('f()')).toBe('ok');
    expect(pick('()')).toBe('linear-unconsumed');
});

it('requires every lens branch arm to consume the same linear values', () => {
    const pick = (first: string, second: string) =>
        program(
            `let mut c = Conn(1)
    let flag = false
    {let g = ~{match flag {
        true -> {${first}}
        false -> {${second}}
    }}
    g := 3}
    0`,
            conn,
        );
    const idle = 'lens x <- 1\n ()';
    const inSetup = 'lens x <- { let n = finish(c)\n 1 }\n ()';
    const inCleanup = 'lens x <- 1\n { let n = finish(c)\n () }';
    for (const arm of [inSetup, inCleanup]) {
        expect(pick(arm, arm)).toBe('ok');
        expect(pick(arm, idle)).toBe('linear-unconsumed');
        expect(pick(idle, arm)).toBe('linear-unconsumed');
    }
    // cleanups start from the joined setup, so the stages cannot be mixed
    expect(pick(inSetup, inCleanup)).toBe('use-after-move');
});

it('does not count a value one lens arm lends and puts back as consumed by the others', () => {
    const pick = (first: string, second: string, after = 'finish(c)') =>
        program(
            `let mut c = Conn(1)
    let flag = false
    {let g = ~{match flag {
        true -> {${first}}
        false -> {${second}}
    }}
    let mut old = (g := Conn(3))
    finish(old)}
    ${after}`,
            conn,
        );
    const lends = 'lens x <- c\n { c := x\n () }';
    const idle = 'lens x <- Conn(2)\n { let n = finish(x)\n () }';
    expect(pick(lends, lends)).toBe('ok');
    for (const [first, second] of [
        [lends, idle],
        [idle, lends],
    ] as const) {
        expect(pick(first, second)).toBe('use-after-move');
        // left alone afterwards, the arm that never lent it would drop it
        expect(pick(first, second, '0')).toBe('linear-unconsumed');
    }
});

it('does not let a generic value be dropped by one lens branch arm', () => {
    const generic = `${conn}fn lose(mut v, flag) {
    {let g = ~{match flag {
        true -> {lens x <- 1\n { let mut kept = v\n kept }}
        false -> {lens y <- 2\n ()}
    }}
    g := 3}
}
fn keep(mut v) { v }
`;
    expect(program('let mut c = Conn(1)\n lose(c, false)\n 0', generic)).toBe('linear-unconsumed');
});

it('keeps callback evidence on schemes imported by another checker', () => {
    const parse = (source: string) => {
        const parsed = grammar.parse<FileItem>('FileItem', readLines(source).nodes[0]!);
        if (parsed.type === 'failure') throw Error('Syntax');
        return parsed.value as Linear;
    };
    const first = new Checker(undefined, undefined, 'first', dualMode);
    for (const source of ['fn run(mut f) { f() }', 'fn maybe(mut f) { if true then f() else 0 }'])
        first.publish(first.check(parse(source)));
    const second = new Checker(first.definitions, first.constructorDefinitions, 'second', dualMode);
    second.addType(parse('type linear Fd { Fd(Number) }') as unknown as TypeDecl);
    const call = (name: string) =>
        parse(`{
    let runner = ${name}
    let mut fd = Fd(1)
    runner(fn () { match fd { mut Fd(n) -> n } })
}`);
    second.lowerTyped(second.check(call('run')));
    expect(() => second.check(call('maybe'))).toThrow('must be called exactly once');
});

it('keeps a returned closure linear across definitions', () => {
    const make = `${conn}fn make(mut c) { fn () { finish(c) } }\n`;
    expect(program('let mut f = make(Conn(1))\n 0', make)).toBe('linear-unconsumed');
    expect(program('let mut f = make(Conn(1))\n f()', make)).toBe('ok');
});

it('does not let a generic function lose a linear value', () => {
    const body = 'let mut c = Conn(1)\n lose(fn () { finish(c) })\n 0';
    expect(program(body, `${conn}fn lose(mut x) { 0 }\n`)).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n lose(c)\n 0', `${conn}fn lose(mut x) { let mut f = fn () { x }\n 0 }\n`)).toBe('linear-unconsumed');
});

it('does not let a linear closure pose as an ordinary one', () => {
    expect(program('let mut c = Conn(1)\n let mut f = match true {\n true -> fn () { finish(c) }\n false -> fn () { () }\n }\n f()', conn)).toBe('linear-closure-mismatch');
});

it('borrows through a parameter unless a declaration says it takes ownership', () => {
    const each = (declaration: string, after: string, use = '') =>
        code(`${net}fn drain(mut ~c) { handle("a", ~c) }
${declaration}
fn each(${declaration ? 'mut listener' : 'listener'}, mut handler) {
    let conn = ~connection(listener)
    handler(~conn)
    ${after}
}
${use}
0`);
    // unannotated, the call borrows, so the connection is still here afterwards
    expect(each('', 'peek(~conn)\n ()')).toBe('ok');
    expect(each('', '()', 'each(1, drain)')).toBe('lens-ownership-mismatch');
    const owned = 'each :: (mut Number, mut (mut ~Number) => ()) => ()';
    expect(each(owned, '()', 'each(1, drain)')).toBe('ok');
    expect(each(owned, 'peek(~conn)\n ()')).toBe('use-after-move');
});

it('reads a declared result as owned exactly when no lens is borrowed', () => {
    const through = 'fn through(~x) ~{lens v <- dup(~x)\n x := v}';
    expect(code(`through :: (~Number) => ~Number\n${through}\n0`)).toBe('ok');
    const made = 'fn made(mut x) ~{lens v <- x\n let _ = v\n () }';
    const moved = '{let h = ~made(1)\n handle("a", ~h)\n 0}';
    expect(code(`${net}made :: (mut Number) => mut ~Number\n${made}\n${moved}`)).toBe('ok');
    // The written ownership has to be the one the parameters give.
    expect(code(`${net}made :: (mut Number) => ~Number\n${made}\n0`)).toBe(
        'lens-ownership-mismatch',
    );
    expect(code(`through :: (~Number) => mut ~Number\n${through}\n0`)).toBe(
        'lens-ownership-mismatch',
    );
});

it('moves owned lenses through recursion and nested producers', () => {
    expect(code(`${net}fn drain(n, mut ~c) { if n == 0 then handle("a", ~c) else drain(n - 1, ~c) }\n0`)).toBe('ok');
    const wrap = 'fn wrap(mut ~c) ~c\n';
    expect(program('let conn = ~connection(1)\n let w = ~wrap(~conn)\n spawn(fn () { handle("a", ~w) })\n 0', net + wrap)).toBe('ok');
    expect(program('let conn = ~connection(1)\n let w = ~wrap(~conn)\n peek(~conn)', net + wrap)).toBe('use-after-move');
});

it('closes the older leaks that a linear closure would have gone through', () => {
    const base = `${conn}fn ignore(mut x) { 0 }\n`;
    expect(program('let _ = Conn(1)\n 0', base)).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n if true then finish(c) else ()', base)).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n pass(c)', `${base}fn pass(mut x) { ignore(x) }\n`)).toBe('linear-unconsumed');
    expect(program('let mut c = Conn(1)\n lose(c)', `${base}fn lose(mut x) { match x { _ -> 0 } }\n`)).toBe('linear-unconsumed');
});

it('runs a move on the reference evaluator', () => {
    let output = '';
    executeTypedProgram(checkSource(`${printing}handle("a", ~connection(1))`), {
        stdout: (text) => (output += text),
    });
    expect(output).toBe('a start\npeek 1\na done\nclose 1\n');
});

it('verifies in typed IR that each owned lens ends exactly once', () => {
    const source = `// laminar: dual
${net}fn choose(flag, mut ~c) { if flag then handle("a", ~c) else () }
{ choose(true, ~connection(1)) }`;
    const forged = (edit: (cleanup: { kind: string }[]) => void) => {
        const program = structuredClone(checkSource(source));
        const unit = program.units.find((u) => u.definition?.endsWith('/choose'))!;
        const branch = unit.functions[0].body.instructions.find((i) => i.op === 'case')!;
        if (branch.op !== 'case') throw new Error('expected a branch');
        edit(branch.cases[1].body.cleanup);
        return () => verifyTypedProgram(program);
    };
    expect(forged(() => {})).not.toThrow();
    // the branch that keeps the lens forgets to end it, or ends it twice
    expect(forged((c) => c.splice(c.findIndex((a) => a.kind === 'end'), 1))).toThrow();
    expect(forged((c) => c.push({ ...c.find((a) => a.kind === 'end')! }))).toThrow();
});

it('keeps pure mode as it was', () => {
    expect(() => checkSource('fn f(n) {let mut m = n\n m}\n1')).toThrow();
});
