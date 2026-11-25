import { expect, it } from 'bun:test';
import { CompileError, compileSource } from '../../src/compiler.ts';
import { goTarget, wasm32Emscripten } from '../../src/backend/target.ts';
import { detectTarget } from '../../src/backend/host.ts';
import { backendAvailable, expectRun } from '../backend/backends.ts';

const execute = process.env.LAMINAR_EXEC && backendAvailable('go') ? it : it.skip;

/** Every cleanup prints, so the output shows exactly when each lens ended. */
const net = `// laminar: dual
fn connection(n) ~{
    lens fd <- n + 0
    print("close \${dup(~fd)}")
}
fn peek(~conn) { print("peek \${dup(~conn)}") }
fn handle(label, mut ~conn) {
    print("\${label} start")
    peek(~conn)
    print("\${label} done")
}
`;
const lines = (...all: string[]) => all.map((l) => `${l}\n`).join('');
const used = (label: string, n: number) => [`${label} start`, `peek ${n}`, `${label} done`];

const cases: [string, string, string, unknown?][] = [
    [
        'a temporary ends when its new holder does',
        '{handle("a", ~connection(1))\n print("after")}',
        lines(...used('a', 1), 'close 1', 'after'),
    ],
    [
        'a binding that moves ends in the callee, not at the end of its scope',
        '{let conn = ~connection(2)\n peek(~conn)\n handle("a", ~conn)\n print("after")}',
        lines('peek 2', ...used('a', 2), 'close 2', 'after'),
    ],
    [
        'a lens that never moves ends with its scope',
        'fn keep() {let conn = ~connection(3)\n peek(~conn)}\n{keep()\n print("after")}',
        lines('peek 3', 'close 3', 'after'),
    ],
    [
        'cleanup sees what was written before and after the move',
        'fn bump(mut ~c) {c := dup(~c) + 100}\n{let conn = ~connection(1)\n conn := dup(~conn) + 10\n bump(~conn)\n print("after")}',
        lines('close 111', 'after'),
    ],
    [
        'a holder can pass the lens on',
        'fn forward(mut ~c) {print("in")\n handle("a", ~c)\n print("out")}\n{forward(~connection(4))\n print("after")}',
        lines('in', ...used('a', 4), 'close 4', 'out', 'after'),
    ],
    ...[true, false].map((flag): [string, string, string] => [
        `a lens that one branch moves ends on every path (${flag})`,
        `fn choose(flag) {let conn = ~connection(5)\n if flag then handle("a", ~conn) else print("kept")\n print("joined")}\n{choose(${flag})\n print("after")}`,
        flag
            ? lines(...used('a', 5), 'close 5', 'joined', 'after')
            : lines('kept', 'close 5', 'joined', 'after'),
    ]),
    ...[true, false].map((flag): [string, string, string] => [
        `an owned parameter that one branch passes on ends on every path (${flag})`,
        `fn choose(flag, mut ~c) {if flag then handle("a", ~c) else peek(~c)\n print("joined")}\n{choose(${flag}, ~connection(6))\n print("after")}`,
        flag
            ? lines(...used('a', 6), 'close 6', 'joined', 'after')
            : lines('peek 6', 'close 6', 'joined', 'after'),
    ]),
    [
        'a closure takes the lens and ends it when it runs',
        '{let conn = ~connection(7)\n let mut task = fn () {handle("a", ~conn)}\n print("before")\n task()\n print("after")}',
        lines('before', ...used('a', 7), 'close 7', 'after'),
    ],
    [
        'a closure that only borrows its capture still ends it',
        '{let conn = ~connection(8)\n let mut task = fn () {peek(~conn)\n peek(~conn)}\n print("before")\n task()\n print("after")}',
        lines('before', 'peek 8', 'peek 8', 'close 8', 'after'),
    ],
    [
        'a lens passes through two closures',
        '{let conn = ~connection(9)\n let mut outer = fn () {let mut inner = fn () {handle("a", ~conn)}\n print("middle")\n inner()}\n outer()\n print("after")}',
        lines('middle', ...used('a', 9), 'close 9', 'after'),
    ],
    [
        'a closure goes to a function that calls it',
        'fn run(mut task) {print("running")\n task()}\n{let conn = ~connection(10)\n run(fn () {handle("a", ~conn)})\n print("after")}',
        lines('running', ...used('a', 10), 'close 10', 'after'),
    ],
    [
        'a recursive holder ends it once',
        'fn drain(n, mut ~c) {if n == 0 then handle("a", ~c) else {peek(~c)\n drain(n - 1, ~c)}}\n{drain(2, ~connection(11))\n print("after")}',
        lines('peek 11', 'peek 11', ...used('a', 11), 'close 11', 'after'),
    ],
    [
        'an owned parameter can be lent out again as the result',
        'fn wrap(mut ~c) ~c\n{let conn = ~connection(12)\n let again = ~wrap(~conn)\n handle("a", ~again)\n print("after")}',
        lines(...used('a', 12), 'close 12', 'after'),
    ],
    [
        'a handler chosen at run time takes the lens',
        'fn one(mut ~c) {handle("one", ~c)}\nfn two(mut ~c) {handle("two", ~c)}\neach :: (Number, (mut ~Number) => ()) => ()\nfn each(mut n, mut handler) {let conn = ~connection(n)\n handler(~conn)\n print("returned")}\n{each(13, if true then two else one)\n print("after")}',
        lines(...used('two', 13), 'close 13', 'returned', 'after'),
    ],
    [
        'the lens may hold a linear value',
        'type linear Conn {\n    Conn(Number)\n}\nfn open(n) ~{lens c <- Conn(n)\n match c {mut Conn(fd) -> print("shut ${fd}")}}\nfn read(~c) {match ~c {Conn(fd) -> print("read ${dup(~fd)}")}}\nfn own(mut ~c) {read(~c)}\n{let c = ~open(14)\n let mut task = fn () {own(~c)}\n task()\n print("after")}',
        lines('read 14', 'shut 14', 'after'),
    ],
    [
        'a lens over a pair moves whole',
        'fn pair(n) ~{lens p <- (n, n + 1)\n match p {(a, b) -> print("close ${a} ${b}")}}\nfn both(mut ~p) {match ~p {(a, b) -> print("both ${dup(~a)} ${dup(~b)}")}}\n{let p = ~pair(1)\n both(~p)\n print("after")}',
        lines('both 1 2', 'close 1 2', 'after'),
    ],
];

for (const [name, body, output] of cases)
    execute(name, async () => {
        await expectRun('go', net + body, { expected: null, output });
    });

/** Tasks finish in any order, so each cleanup reports on a channel instead of printing. */
const reporting = `// laminar: dual
fn connection(n, closed) ~{
    lens fd <- n + 0
    chanSend(closed, dup(~fd))
}
fn double(mut ~conn) { conn := dup(~conn) * 2
    () }
`;

execute('a spawned task takes the connection and its cleanup', async () => {
    await expectRun(
        'go',
        `${reporting}{let closed = chanNew()
 let conn = ~connection(21, closed)
 spawn(fn () {double(~conn)})
 chanRecv(closed)}`,
        { expected: 42 },
    );
});

execute('an accept loop gives each connection to its own task', async () => {
    await expectRun(
        'go',
        `${reporting}fn serve(n, closed) {
    if n == 0 then () else {
        let conn = ~connection(n, closed)
        spawn(fn () {double(~conn)})
        serve(n - 1, closed)
    }
}
fn total(n, closed, sum) {if n == 0 then sum else total(n - 1, closed, sum + chanRecv(closed))}
{let closed = chanNew()
 spawn(fn () {serve(100, closed)})
 total(100, closed, 0)}`,
        { expected: 10100 },
    );
});

it('keeps the restore with the lens in emitted Go', () => {
    const code = compileSource(
        `${net}{let conn = ~connection(1)\n spawn(fn () {handle("a", ~conn)})\n sleep(1)}`,
        { target: goTarget('test') },
    ).code;
    expect(code).toContain('go func()');
    expect(code).toContain('.restore = func(');
});

it('is only a Go feature for now', () => {
    const source = `${net}handle("a", ~connection(1))`;
    for (const target of [detectTarget('native'), wasm32Emscripten('test', 'emscripten-node')])
        try {
            compileSource(source, { target });
            throw new Error('expected a rejection');
        } catch (error) {
            expect((error as CompileError).code).toBe('unsupported-owned-lens');
        }
});
