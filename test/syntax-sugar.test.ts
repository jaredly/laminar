import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { referenceRun } from './backend/reference-run.ts';
import type { ReferenceValue } from '../src/eval-typed.ts';
import { typedProgram } from './backend/typed-program.ts';

const cases: [string, ReferenceValue][] = [
    ['{-1}', -1],
    ['{let x = 2\n -x}', -2],
    ['{1 - -1}', 2],
    ['{(-1, 2)}', [-1, 2]],
    ['{true && false}', false],
    ['{true || false}', true],
    ['{false && true || true}', true],
    ['{not true || true}', true],
    ['{not 1 == 1 && true}', false],
    ['{if true then 1 else 2}', 1],
    ['{if 1 < 2 then 1 + 1 else 2}', 2],
    ['{if 2 < 1 && true then 1 else 2 + 5}', 7],
    ['{let x = 3\n if x == 3 then {let y = 1\n y} else 0}', 1],
    ['{if {if true then false else true} then 1 else 2}', 2],
    ['{if false then 1 else if false then 2 else 3}', 3],
    ['{if false then 1 else if true then 2 else 3}', 2],
    ['{if true && not false then 1 else 2}', 1],
];

it('evaluates the sugar in the reference evaluator', () => {
    for (const [source, result] of cases)
        expect(referenceRun(typedProgram(source), '')).toEqual({ output: '', result });
});

it('short-circuits && and || and only runs the chosen branch', () => {
    const run = (source: string) => referenceRun(typedProgram(source), '').output;
    const say = 'fn say(b) {print("ran")\n b}\n';
    expect(run(`${say}{false && say(true)}`)).toBe('');
    expect(run(`${say}{true && say(true)}`)).toBe('ran\n');
    expect(run(`${say}{true || say(true)}`)).toBe('');
    expect(run(`${say}{false || say(true)}`)).toBe('ran\n');
    expect(run(`${say}{if true then 1 else {say(true)\n 2}}`)).toBe('');
});

it('type-checks the sugar in both modes', () => {
    for (const mode of ['pure', 'dual'] as const) {
        for (const [source] of cases) expect(() => checkSource(source, { mode })).not.toThrow();
        expect(() => checkSource('{if 1 then 2 else 3}', { mode })).toThrow();
        expect(() => checkSource('{if true then 1 else true}', { mode })).toThrow();
        expect(() => checkSource('{1 && true}', { mode })).toThrow();
        expect(() => checkSource('{let if = 1\n if}', { mode })).toThrow();
    }
});

const execute = (source: string, name: 'native' | 'go'): string => {
    const target = detectTarget(name);
    const compiled = compileSource(source, { target, mode: 'dual' });
    const directory = mkdtempSync(join(tmpdir(), 'laminar-sugar-'));
    try {
        const { command, args } = buildCompiled(compiled, target, {
            directory,
            sanitize: name === 'native',
        });
        const run = spawnSync(command, args, { encoding: 'utf8' });
        if (run.status !== 0) throw new Error(run.stderr);
        return run.stdout;
    } finally {
        rmSync(directory, { recursive: true });
    }
};

for (const name of ['native', 'go'] as const)
    (process.env.LAMINAR_EXEC ? it : it.skip)(
        `agrees with the reference evaluator on ${name}`,
        () => {
            const source = `{let x = 3\n (-x, if x == 3 && not x < 2 then 1 else 2, false || x > 2, -1 * -2)}`;
            expect(JSON.parse(execute(source, name))).toEqual([-3, 1, true, 2]);
        },
        60000,
    );
