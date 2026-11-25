import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CompileError, checkSource, compileSource } from '../../src/compiler.ts';
import { goTarget, wasm32Emscripten } from '../../src/backend/target.ts';
import { detectTarget } from '../../src/backend/host.ts';
import { expectRun } from '../backend/backends.ts';

const dual = (source: string) => `// laminar: dual\n${source}`;
const emit = (source: string) =>
    compileSource(dual(source), { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const rejection = (source: string) => {
    try {
        checkSource(dual(source));
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
    return 'ok';
};
const conn = 'type linear Conn {\n    Conn(Number)\n}\nfn finish(mut c) {match c {mut Conn(fd) -> closeHandle(fd)}}\n';

it('runs a spawned task on a goroutine, reading the task on the spawning side', () => {
    const code = emit('{let k = 7\n spawn(fn () {print("task ${k}")})\n sleep(10)}');
    expect(code).toMatch(/go func\(\) \{ closure\(v\d+\.environment\) \}\(\)/);
    expect(code).toContain('hostSleep(10.0)');
});

it('lets tasks share plain values but never borrow', () => {
    // two tasks reading one immutable table
    expect(rejection('{let table = [:10, 20:]\n spawn(fn () {print("${table[0]}")})\n spawn(fn () {print("${table[1]}")})\n 0}')).toBe('ok');
    // two tasks bumping one counter would be a data race
    expect(rejection('{let mut hits = [:0:]\n spawn(fn () {hits[0] := hits[0] + 1})\n spawn(fn () {hits[0] := hits[0] + 1})\n hits}')).toBe('borrowed-capture');
    expect(rejection('{let mut data = [:1:]\n spawn(fn () {print("${size(~data)}")})\n data}')).toBe('borrowed-capture');
});

it('moves a connection into the task that serves it', () => {
    expect(rejection(`${conn}{let mut c = Conn(1)\n spawn(fn () {finish(c)})\n 0}`)).toBe('ok');
    // used again after the move
    expect(rejection(`${conn}{let mut c = Conn(1)\n spawn(fn () {finish(c)})\n finish(c)}`)).toBe('use-after-move');
    // never consumed by anyone
    expect(rejection(`${conn}{let mut c = Conn(1)\n spawn(fn () {print("forgot")})\n 0}`)).toBe('linear-unconsumed');
});

it('is a normal name wherever the program binds it', () => {
    expect(rejection('{let spawn = fn (x) {x + 1}\n spawn(1)}')).toBe('ok');
    expect(() => emit('{let spawn = fn (x) {x + 1}\n spawn(1)}')).not.toThrow();
});

it('needs a task that returns ()', () => {
    expect(() => emit('spawn(fn () {1})')).toThrow('A spawned task must return ()');
});

it('is only a Go feature for now', () => {
    const source = dual('spawn(fn () {()})');
    expect(() => compileSource(source, { target: detectTarget('native') })).toThrow(
        'spawn has no C implementation',
    );
    expect(() =>
        compileSource(source, { target: wasm32Emscripten('test', 'emscripten-node') }),
    ).toThrow('spawn has no C implementation');
});

it('keeps a server accept loop a loop', () => {
    const code = emit(
        'fn serve(n) {let mut c = [:0:]\n spawn(fn () {let mut d = c\n print("${size(~d)}")})\n serve(n + 1)}\nserve(0)',
    );
    expect(code).toContain('for {');
    expect(code).toContain('n = n + 1.0');
    expect(code).not.toMatch(/= serve\(/);
});

for (const file of ['server.lm', 'server-pool.lm'])
    it(`checks the ${file} example`, () => {
        const source = readFileSync(new URL(`../../examples/${file}`, import.meta.url), 'utf8');
        expect(() => checkSource(source)).not.toThrow();
        expect(() => compileSource(source, { target: goTarget('test') })).not.toThrow();
    });

it('cannot copy a connection or hand a borrowed one to a task', () => {
    const lens =
        'type linear Conn {\n    Conn(Number)\n}\nfn connection(l) ~{lens conn <- Conn(accept(l))\n match conn {Conn(fd) -> closeHandle(fd)}}\n';
    expect(rejection(`${lens}{let conn = ~connection(1)\n let mut copy = dup(~conn)\n copy}`)).toBe('dup-linear');
    expect(rejection(`${lens}{let conn = ~connection(1)\n spawn(fn () {let mut c = dup(~conn)\n print("x")})\n 0}`)).toBe('dup-linear');
    // a lens argument is borrowed from the caller, so it stays where it is
    expect(rejection('fn f(~n) {spawn(fn () {print("${dup(~n)}")})}\n0')).toBe('borrowed-capture');
});

for (const [name, source, expected, output] of [
    [
        'a task answers over a channel',
        '{let ch = chanNew()\n spawn(fn () {chanSend(ch, 42)})\n chanRecv(ch)}',
        42,
        '',
    ],
    [
        'many tasks, one reply each',
        'fn ask(ch, n) {if n == 0 then () else {spawn(fn () {chanSend(ch, n)})\n ask(ch, n - 1)}}\nfn total(ch, n, acc) {if n == 0 then acc else total(ch, n - 1, acc + chanRecv(ch))}\n{let ch = chanNew()\n ask(ch, 50)\n total(ch, 50, 0)}',
        1275,
        '',
    ],
    [
        'a task that owns its state',
        // the counter task owns `count`; requests and replies are the only way in
        'fn counter(requests, count) {let reply = chanRecv(requests)\n chanSend(reply, count + 1)\n counter(requests, count + 1)}\nfn next(requests) {let reply = chanNew()\n chanSend(requests, reply)\n chanRecv(reply)}\n{let requests = chanNew()\n spawn(fn () {counter(requests, 0)})\n (next(requests), next(requests), next(requests))}',
        [1, 2, 3],
        '',
    ],
    [
        'sleep lets other tasks run',
        '{let ch = chanNew()\n spawn(fn () {sleep(30)\n chanSend(ch, 2)})\n spawn(fn () {chanSend(ch, 1)})\n (chanRecv(ch), chanRecv(ch))}',
        [1, 2],
        '',
    ],
] as const)
    execute(`go runs ${name}`, () => expectRun('go', dual(source), { expected, output }), 60000);

it('explains spawn in pure mode', () => {
    expect(() => compileSource('spawn(fn () {()})', { target: goTarget('test') })).toThrow(
        'only dual mode can express',
    );
});
