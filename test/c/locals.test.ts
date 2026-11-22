/**
 * C function bodies through the shared readability passes: source-named locals,
 * computed `(void)` suppression and omitted self-restoration. Execution cases run
 * natively (under ASan/UBSan at -O0, and at -O2) against the reference interpreter.
 */
import { expect, it } from 'bun:test';
import { checkSource, compileSource } from '../../src/compiler.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { expectRun } from '../backend/backends.ts';

const compile = (source: string) => compileSource(source, { target: wasm32Emscripten('test') });
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const body = (code: string, name: string) => {
    const start = code.search(new RegExp(`^\\S+ ${name}\\(void \\*environment[^;]*\\{$`, 'm'));
    return code.slice(start, code.indexOf('\n}\n', start));
};

const swapped =
    'fn swap(~(x, y)) {let t = dup(~x)\n x := dup(~y)\n y := t}\n{let a = 1\n let b = 2\n swap(~(a, b))\n (a, b)}';
const unchanged =
    'fn peek(~(x, y)) {dup(~x) + dup(~y)}\n{let a = 1\n let b = 2\n (peek(~(a, b)), a, b)}';
const bumped =
    'fn bump(~(x, y)) {x := dup(~x) + 1}\n{let a = 1\n let b = 2\n bump(~(a, b))\n (a, b)}';
// Frame locals named like C fields (`read`, `tag`), captured by a returned lens's
// restoration helper, which spells those fields too.
const fields =
    'fn both(~(read, tag)) ~(read, tag)\n{let read = 1\n let tag = 2\n both(~(read, tag)) := (true, (3, 4))\n (read, tag)}';
// Cleanup both reads a captured string named `read` and prints that word in a
// literal. Its lens parameter also has a member named `read`.
const interpolation =
    'fn restore(read, ~x) ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n"read ${read}"}}\n{let x = 1\n restore("data", ~x) := true\n x}';
// A local declared after a call to the function it is named after.
const shadow =
    'fn inc(n) {n + 1}\nfn twice(n) {let m = inc(n)\n let inc = m + 1\n dup(~inc) + inc}\ntwice(1)';

it('names locals after their source bindings and suppresses only unread ones', () => {
    const code = body(compile(swapped).code, 'swap');
    expect(code).toMatch(/double t = /);
    expect(code).not.toMatch(/\(void\)t;/);
    expect(code).toContain('(void)environment;');
});

it('omits writes that restore a lens to its own live contents', () => {
    const peek = body(compile(unchanged).code, 'peek');
    expect(peek).not.toMatch(/^\s*\*x_y\.item0\.read = /m);
    expect(peek).not.toMatch(/^\s*\*x_y\.item1\.read = /m);
    const bump = body(compile(bumped).code, 'bump');
    // The updated endpoint is written; its unchanged sibling is not.
    expect(bump).toMatch(/^\s*\*x_y\.item0\.read = /m);
    expect(bump).not.toMatch(/^\s*\*x_y\.item1\.read = /m);
    // A swap writes both endpoints from snapshots.
    const swap = body(compile(swapped).code, 'swap');
    expect(swap.match(/^\s*\*x_y\.item\d\.read = /gm)?.length).toBe(2);
});

it('never rewrites members that share a captured name', () => {
    expect(compile(fields).code).not.toMatch(/\.ctx->|->ctx->/);
});

it('rewrites captured interpolation reads while preserving members and literals', () => {
    const { code } = compile(interpolation);
    expect(code).toContain('builder_string(&');
    expect(code).toContain('String read_2 = ctx->read;');
    expect(code).toMatch(/builder_string\(&v\d+, read_2\);/);
    expect(code).toContain('"read "');
    expect(code).not.toMatch(/\.ctx->|->ctx->/);
});

it('keeps locals from shadowing the functions a body calls', () => {
    const code = body(compile(shadow).code, 'twice');
    expect(code).toMatch(/\binc\([^;]*, n\)/);
    expect(code).toMatch(/\bdouble inc_2 = /);
    expect(code).not.toMatch(/\bdouble inc = /);
});

for (const [name, source] of [
    ['swap through a scattered lens', swapped],
    ['unchanged scattered lens', unchanged],
    ['partially updated scattered lens', bumped],
    ['captured names that match C fields', fields],
    ['captured string interpolation', interpolation],
    ['locals named after called functions', shadow],
] as const)
    execute(
        `C locals: ${name}`,
        () =>
            expectRun('native', source, {
                expected: executeTypedProgram(checkSource(source)),
            }),
        60000,
    );
