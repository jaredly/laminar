/**
 * Shape of the generated C: zero initializers and Bool constants are spelled for their
 * type, struct types generated for lens backing and restoration are printed with the
 * other types, and identical backings share one definition. Execution cases run
 * natively (under ASan/UBSan at -O0, and at -O2).
 */
import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { expectRun } from '../backend/backends.ts';

const compile = (source: string) =>
    compileSource(source, { target: wasm32Emscripten('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

const bump = 'fn bump(~x) {x := dup(~x) + 1}\n';
const twoCells = bump + '{let x = 0\n let y = 5\n bump(~x)\n bump(~y)\n (x, y)}';
const branches = 'fn pick(b) {match b {true -> 1; false -> 2}}\npick(true)';
const bools = 'fn both(a, b) {match a {true -> b; false -> false}}\nboth(true, true)';
const returned = 'fn pass(~x) ~x\n{let x = 1\n pass(~x) := 9\n x}';

it('spells a zero initializer for its type', () => {
    const code = compile(branches);
    expect(code).toMatch(/^\s+double v\d+ = 0;$/m);
    expect(code).not.toMatch(/double v\d+ = \{0\}/);
    // Aggregates keep the brace form, and a pointer is NULL.
    expect(compile(twoCells)).toMatch(/Backing_double back\d+ = \{0\};/);
    expect(compile('"a"')).not.toMatch(/\{0\};\s*$[\s\S]*String v\d+ = \{0\}/m);
});

it('spells Bool constants as true and false', () => {
    const code = compile(bools);
    expect(code).toMatch(/\bbool v\d+ = false;|\breturn (true|false);|= (true|false);/);
    expect(code).not.toMatch(/\bbool v\d+ = [01];/);
    expect(code).not.toMatch(/\b(?:v\d+) = [01];[^\n]*\n[^\n]*bool/);
});

it('prints struct types generated for backing with the other types', () => {
    const code = compile(twoCells);
    const backing = code.indexOf('} Backing_double;');
    expect(backing).toBeGreaterThan(0);
    // After the program's types, before the first prototype or definition.
    expect(backing).toBeGreaterThan(code.indexOf('struct Lens_double {'));
    expect(backing).toBeLessThan(code.indexOf('static size_t live_contexts'));
});

it('shares one definition between identical backings', () => {
    const code = compile(twoCells);
    expect(code.match(/typedef struct \{[^}]*\} Backing_/g)).toHaveLength(1);
    expect(code.match(/Backing_double back\d+ = /g)).toHaveLength(2);
});

it('keeps a restoration context beside the other types', () => {
    const code = compile(returned);
    const context = code.search(/typedef struct \{[^}]*\} Restore\d+;/);
    expect(context).toBeGreaterThan(0);
    expect(context).toBeLessThan(code.indexOf('static size_t live_contexts'));
});

for (const [name, source, expected] of [
    ['two backings of one shape', twoCells, [1, 6]],
    ['scalar zero initializers', branches, 1],
    ['Bool constants', bools, true],
    ['restoration context', returned, 9],
] as const)
    execute(`C output shape: ${name}`, () => expectRun('native', source, { expected }), 60000);
