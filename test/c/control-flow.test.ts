/**
 * C control flow and dead values: matches take the simplest structure that keeps their
 * semantics, calls whose results nothing reads are plain statements, unread values
 * vanish, and direct calls of code with no captures pass NULL. Execution cases run
 * natively (under ASan/UBSan at -O0, and at -O2) against the reference interpreter.
 */
import { expect, it } from 'bun:test';
import { checkSource, compileSource } from '../../src/compiler.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { expectRun } from '../backend/backends.ts';

const compile = (source: string) =>
    compileSource(source, { target: wasm32Emscripten('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const body = (code: string, name: string) => {
    const start = code.search(new RegExp(`^\\S+ ${name}\\(void \\*environment[^;]*\\{$`, 'm'));
    return code.slice(start, code.indexOf('\n}\n', start));
};

const catchAll = 'fn pick(x) {match x {1 -> 10; 2 -> 20; _ -> 30}}\npick(2)';
const leadingCatchAll = 'fn only(x) {match x {_ -> 7; 1 -> 8}}\nonly(1)';
const partial = 'fn pick(x) {match x {1 -> 10; 2 -> 20}}\npick(2)';
const bool = 'fn flip(b) {match b {true -> 1; false -> 0}}\nflip(true)';
const boolFirstFalse = 'fn flip(b) {match b {false -> 0; true -> 1}}\nflip(false)';
const complete = 'fn t(o) {match o {Some(x) -> x; None -> 0}}\nt(Some(1))';
const incomplete = 'fn t(o) {match o {Some(x) -> x}}\nt(Some(1))';
const discarded = '{print("hi")\n 1}';
const unread = '{let (a, _) = (1, 2)\n a}';
const direct = 'fn inc(n) {n + 1}\ninc(1)';
const captured = 'fn maker(n) {let add = fn (x) {n + x}\n add}\nmaker(1)(2)';

it('makes a catch-all the else, with no trap after it', () => {
    const code = body(compile(catchAll), 'pick');
    expect(code).toMatch(/if \(x == 1\)[\s\S]*else if \(x == 2\)[\s\S]*else \{\s*v\d+ = 30;/);
    expect(code).not.toContain('abort();');
    expect(code).not.toContain('else if (1)');
});

it('emits a leading catch-all directly, and keeps a trap only where a match can fall through', () => {
    const code = body(compile(leadingCatchAll), 'only');
    expect(code).not.toMatch(/\bif\b|abort/);
    expect(body(compile(partial), 'pick')).toContain('abort();');
});

it('tests a Bool once', () => {
    for (const source of [bool, boolFirstFalse]) {
        const code = body(compile(source), 'flip');
        expect(code).not.toMatch(/== 1|== 0|abort/);
        expect(code).toMatch(/if \(!?\(?b\)?\)/);
        expect(code).toContain('else {');
    }
});

it('switches over a complete set of constructors, and only then drops the trap', () => {
    const done = body(compile(complete), 't');
    expect(done).toMatch(/switch \(o\.tag\)/);
    expect(done).toMatch(/case \w+_Some:/);
    expect(done).toMatch(/case \w+_None:/);
    expect(done).not.toMatch(/abort|default:/);
    const partialCode = body(compile(incomplete), 't');
    expect(partialCode).toMatch(/default:/);
    expect(partialCode).toContain('abort();');
});

it('runs a call whose result nothing reads as a statement', () => {
    const code = body(compile(discarded), 'entry');
    expect(code).toMatch(/^\s*host_print_Unit\(\w+\);$/m);
    expect(code).not.toMatch(/Unit v\d+ = host_print_Unit/);
    expect(code).not.toMatch(/\(void\)v\d+;/);
});

it('drops values nothing reads, without keeping a (void) for them', () => {
    const code = body(compile(unread), 'entry');
    expect(code).not.toMatch(/\(void\)v\d+;/);
    // The discarded component is never read into a local of its own.
    expect(code.match(/^\s+\S.*;$/gm)?.length).toBeLessThanOrEqual(3);
});

it('passes NULL when the callee has no captures, and its environment when it does', () => {
    expect(compile(direct)).toMatch(/\binc\(NULL, 1\)/);
    expect(compile(direct)).not.toMatch(/Callable_\w+\)\{0\}\)\.environment/);
    // A captured closure is called through its record's own environment.
    expect(compile(captured)).toMatch(/\w+\.invoke\d+\(\w+\.environment, 2\)/);
});

for (const [name, source] of [
    ['catch-all arm', catchAll],
    ['leading catch-all', leadingCatchAll],
    ['partial match', partial],
    ['Bool match', bool],
    ['Bool match, false first', boolFirstFalse],
    ['complete constructor match', complete],
    ['discarded call result', discarded],
    ['unread tuple component', unread],
    ['direct call', direct],
    ['captured closure call', captured],
] as const)
    execute(
        `C control flow: ${name}`,
        () =>
            expectRun('native', source, {
                expected: executeTypedProgram(checkSource(source)),
                // The host's print appends a newline; the entry's result follows a separator.
                ...(source === discarded ? { output: 'hi\n' } : {}),
            }),
        60000,
    );
