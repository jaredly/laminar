import { expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileSource } from '../src/compiler.ts';
import { goTarget } from '../src/backend/target.ts';
import { detectTarget } from '../src/backend/host.ts';
import { buildAndRunGo } from '../src/go/build.ts';
import { buildAndRun } from '../src/c/build.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
const source = `fn step(~(a, b)) {a := dup(~a) + 1
 ()}
fn other(~(a, b)) {b := dup(~b) + 2
 ()}
{let p = (1, 2)
 let a = 3
 let b = 4
 step(~p)
 step(~(a, b))
 other(~p)
 other(~(a, b))
 (p, a, b)}`;
const compile = (specializeLenses?: readonly string[]) =>
    compileSource(source, { target: goTarget('test'), specializeLenses });
const bodies = (compiled: ReturnType<typeof compile>, name: string) =>
    compiled.concrete.code.filter((c) => c.function?.startsWith(`unit/definition/${name}/`));
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('uses one body per semantic instance by default, while retaining local lens shapes', () => {
    const c = compile();
    expect(bodies(c, 'step')).toHaveLength(1);
    expect(bodies(c, 'other')).toHaveLength(1);
    expect(c.code).toContain('func step(');
    expect(c.code).not.toContain('func step_thin(');
    expect(c.concrete.analysis.shapes.some((s) => s.kind === 'thin')).toBe(true);
    expect(c.concrete.analysis.shapes.some((s) => s.kind === 'tuple')).toBe(true);
    expect(() => verifyConcreteProgram(JSON.parse(JSON.stringify(c.concrete)))).not.toThrow();
});
it('specializes only the selected source definition', () => {
    const c = compile(['step']);
    expect(bodies(c, 'step')).toHaveLength(2);
    expect(bodies(c, 'other')).toHaveLength(1);
    expect(c.code).toContain('func step_thin(');
    expect(c.code).toContain('func step_scattered(');
    expect(c.concrete.analysis.specializeLenses).toEqual(['step']);
    expect(() => verifyConcreteProgram(JSON.parse(JSON.stringify(c.concrete)))).not.toThrow();
});
it('supports exact function IDs and a global opt-in', () => {
    const id = compile().program.units.find((u) => u.definition === 'unit/definition/step')!
        .functions[0]!.id;
    expect(bodies(compile([id]), 'step')).toHaveLength(2);
    const all = compile(['*']);
    expect(bodies(all, 'step')).toHaveLength(2);
    expect(bodies(all, 'other')).toHaveLength(2);
});
it('canonicalizes selectors and rejects unknown selectors', () => {
    expect(compile(['step', 'step']).code).toBe(compile(['step']).code);
    expect(() => compile(['missing'])).toThrow('Lens specialization selectors');
});
it('validates the serialized policy instead of accepting a changed call ABI', () => {
    const c = JSON.parse(JSON.stringify(compile(['step']).concrete));
    c.analysis.specializeLenses = [];
    expect(() => verifyConcreteProgram(c)).toThrow('Call argument representations changed');
});
it('preserves semantic specialization independently of topology policy', () => {
    const c = compileSource('fn id(x) x\n(id(1), id(true))', { target: goTarget('test') });
    expect(c.code).toContain('func id_number(');
    expect(c.code).toContain('func id_bool(');
});
it('exposes targeted specialization through the command line', () => {
    const directory = mkdtempSync(join(tmpdir(), 'laminar-lens-policy-'));
    try {
        const input = join(directory, 'program.lm');
        writeFileSync(input, source);
        const run = (...flags: string[]) =>
            spawnSync(
                process.execPath,
                ['cli/laminar.ts', 'emit', input, '--target', 'go', ...flags],
                { encoding: 'utf8' },
            );
        const normal = run(),
            selected = run('--specialize-lenses', 'step');
        expect(normal.status).toBe(0);
        expect(normal.stdout).not.toContain('func step_thin(');
        expect(selected.status).toBe(0);
        expect(selected.stdout).toContain('func step_thin(');
        const invalid = run('--specialize-lenses');
        expect(invalid.status).not.toBe(0);
        expect(invalid.stderr).toContain('--specialize-lenses requires');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}, 30000);
for (const policy of [[], ['step'], ['*']]) {
    execute(
        `Go lens policy ${policy.join(',') || 'default'}`,
        async () => {
            expect(await buildAndRunGo(compile(policy).code)).toEqual([[[2, 4], 4, 6]]);
        },
        60000,
    );
    execute(
        `C lens policy ${policy.join(',') || 'default'}`,
        async () => {
            const c = compileSource(source, {
                target: detectTarget('native'),
                specializeLenses: policy,
            });
            expect(await buildAndRun(c.code, { compiler: 'clang', sanitize: true })).toEqual([
                [[2, 4], 4, 6],
            ]);
        },
        60000,
    );
}

const reconstruction =
    'fn first(~pair) ~{match ~pair {(h, rest) -> h}}\n{let a = 1\n let b = 2\n first(~(a, b)) := true\n (a, b)}';
for (const policy of [[], ['first'], ['*']])
    execute(
        `reconstruction constraints override topology tuning ${policy.join(',') || 'default'}`,
        async () => {
            const c = compileSource(reconstruction, {
                target: goTarget('test'),
                specializeLenses: policy,
            });
            expect(await buildAndRunGo(c.code)).toEqual([[true, 2]]);
            const native = compileSource(reconstruction, {
                target: detectTarget('native'),
                specializeLenses: policy,
            });
            expect(await buildAndRun(native.code, { compiler: 'clang', sanitize: true })).toEqual([
                [true, 2],
            ]);
        },
        60000,
    );
