import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompileError, buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { goTarget, wasm32Emscripten } from '../src/backend/target.ts';
import { detectTarget, type TargetName } from '../src/backend/host.ts';

const target = wasm32Emscripten('test');
const failure = (work: () => unknown): CompileError => {
    try {
        work();
    } catch (error) {
        if (error instanceof CompileError) return error;
        throw error;
    }
    throw Error('Expected a compile error');
};

it('checks source into verified typed IR', () => {
    const program = checkSource('fn inc(x) {x + 1}\ninc(2)');
    expect(program.units.map((u) => !!u.definition)).toEqual([true, false]);
});

it('reports type errors with stage, code and source position', () => {
    const error = failure(() => checkSource('fn f(x) x\n{let x = 1\n x + true}'));
    expect([error.stage, error.code, error.location]).toEqual([
        'type',
        'type-mismatch',
        { line: 3, column: 2 },
    ]);
    expect(error.format('a.lm')).toBe(
        'a.lm:3:2: type error [type-mismatch]: Cannot unify Number with Bool',
    );
    expect(failure(() => checkSource('{let x = 1\n (x, x)}')).code).toBe('use-after-move');
});

it('reports parse errors', () => {
    expect(failure(() => checkSource('match 1 {')).stage).toBe('parse');
    const error = failure(() => checkSource('1\n@@ ->'));
    expect([error.stage, error.location?.line]).toEqual(['parse', 2]);
});

it('emits deterministic C and Go for the last top-level expression', () => {
    const source = 'fn greet(n) {"hi ${n}"}\ngreet("a")';
    const c = compileSource(source, { target });
    expect(c.language).toBe('c');
    expect(compileSource(source, { target }).code).toBe(c.code);
    const go = compileSource(source, { target: goTarget('test') });
    expect(go.language).toBe('go');
    expect(go.code).toStartWith('package main');
    expect(compileSource(source, { target: goTarget('test') }).code).toBe(go.code);
});

it('requires an entry expression and maps backend diagnostics', () => {
    expect(failure(() => compileSource('fn f(x) x', { target })).code).toBe('missing-entry');
    const error = failure(() => compileSource('"${(1, 2)}"', { target }));
    expect([error.stage, error.code]).toEqual(['backend', 'unsupported-c']);
    expect(
        failure(() =>
            compileSource('getInput("> ")', {
                target: wasm32Emscripten('test', 'emscripten-browser'),
            }),
        ).code,
    ).toBe('unavailable-capability');
});

it('rejects unknown target names', () => {
    expect(() => detectTarget('mips' as TargetName)).toThrow('Unknown target mips');
});

const cli = (args: string[], input = '') =>
    spawnSync('bun', [join(import.meta.dir, '../cli/laminar.ts'), ...args], {
        encoding: 'utf8',
        input,
    });
const directory = mkdtempSync(join(tmpdir(), 'laminar-cli-'));
const file = (name: string, text: string) => {
    const path = join(directory, name);
    writeFileSync(path, text);
    return path;
};
const hello = file(
    'hello.lm',
    'fn greet(n) {"hi ${n}"}\n{let n = getInput("name? ")\n print(greet(dup(~n)))\n charList(n)}\n',
);

it('checks, emits and runs from the command line', () => {
    expect(cli(['check', hello]).stdout).toBe(`${hello}: ok\n`);
    const bad = file('bad.lm', '{let x = 1\n x + true}\n');
    const checked = cli(['check', bad]);
    expect([checked.status, checked.stderr]).toEqual([
        1,
        `${bad}:2:2: type error [type-mismatch]: Cannot unify Number with Bool\n`,
    ]);
    const output = join(directory, 'hello.c');
    expect(cli(['emit', hello, '--target', 'native', '-o', output]).status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('int main(void)');
    expect(cli(['run', hello, '--target', 'reference'], 'bob\n').stdout).toBe(
        'name? hi bob\n["b","o","b"]\n',
    );
    expect(cli(['emit', hello, '--concrete']).stdout).toContain('code ');
    const usage = cli(['frob', hello]);
    expect([usage.status, usage.stderr.startsWith('usage: laminar check')]).toEqual([1, true]);
    expect(cli(['run', hello, '--target', 'mips']).stderr).toBe(
        'Unknown target mips; expected native, wasm32, go, reference\n',
    );
});

// Building needs the toolchains; opt in with LAMINAR_EXEC=1.
for (const name of ['native', 'go'] as const)
    (process.env.LAMINAR_EXEC ? it : it.skip)(
        `builds and runs on ${name}`,
        () => {
            const run = cli(
                ['run', hello, '--target', name, ...(name === 'native' ? ['--sanitize'] : [])],
                'bob\n',
            );
            expect([run.status, run.stdout]).toEqual([0, 'name? hi bob\n["b","o","b"]\n']);
            const trap = cli([
                'run',
                file(`trap-${name}.lm`, 'match 1 {2 -> 3}\n'),
                '--target',
                name,
            ]);
            expect(trap.status).not.toBe(0);
        },
        60000,
    );

(process.env.LAMINAR_EXEC ? it : it.skip)('keeps failed build directories', () => {
    const error = failure(() =>
        buildCompiled({ code: 'not c', language: 'c' }, detectTarget('native')),
    );
    expect(error.code).toBe('clang-build');
    rmSync(error.message.match(/Artifacts: (.+)/)![1]!, { recursive: true });
});
