import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { referenceRun } from './backend/reference-run.ts';
import { typedProgram } from './backend/typed-program.ts';

// `%` is the ECMAScript remainder; the others are IEEE-754 comparisons.
const expected = [2, -2, 2, 1.5, true, false, true, false, true, false, true, false, true, false];

it('computes remainder and the new comparisons in the reference evaluator', () => {
    expect(
        referenceRun(
            typedProgram(
                `{let z = 0 - 5\n (5 % 3, z % 3, 5 % (0 - 3), 5.5 % 2, 1 < 2, 2 < 1, 2 > 1, 1 > 2, 1 != 2, 1 != 1, 0 / 0 != 0 / 0, 0 / 0 < 1, not 1 == 2, not 1 < 2)}`,
            ),
            '',
        ),
    ).toEqual({ output: '', result: expected });
});

const execute = (name: 'native' | 'go'): string => {
    const target = detectTarget(name);
    const compiled = compileSource(
        `{let z = 0 - 5\n (5 % 3, z % 3, 5 % (0 - 3), 5.5 % 2, 1 < 2, 2 < 1, 2 > 1, 1 > 2, 1 != 2, 1 != 1, 0 / 0 != 0 / 0, 0 / 0 < 1, not 1 == 2, not 1 < 2)}`,
        { target },
    );
    const directory = mkdtempSync(join(tmpdir(), 'laminar-numeric-'));
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
            expect(JSON.parse(execute(name))).toEqual(expected);
        },
        60000,
    );

it('treats `not` as a prefix over the whole infix expression, in both modes', () => {
    for (const mode of ['pure', 'dual'] as const) {
        expect(() => checkSource('{not 1 == 2}', { mode })).not.toThrow();
        expect(() => checkSource('{let not = 1\n not}', { mode })).toThrow();
        expect(() => checkSource('{not 1}', { mode })).toThrow();
    }
});
