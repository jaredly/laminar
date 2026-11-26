import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { specializeProgram } from '../src/specialize.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';

const label = 'fn label(x) { "${x}" }\n';
const nested = label + 'label((1, ("a\\n\\\"\\\\\\${", true), (), "é"))';
const expected = '(1, ("a\\n\\\"\\\\\\${", true), (), "é")';

it('formats tuples recursively, quoting nested strings with Laminar escapes', () => {
    expect(executeTypedProgram(checkSource(nested), {})).toBe(expected);
    expect(executeTypedProgram(checkSource(label + 'label("plain")'), {})).toBe('plain');
    expect(executeTypedProgram(checkSource(label + 'label(())'), {})).toBe('()');
});

it('instantiates and forwards Display through local and higher-order calls', () => {
    const through = label + 'fn apply(f, x) { f(x) }\nfn render(x) { apply(label, x) }\n';
    const program = checkSource(through + 'render((2, true))');
    expect(program.units[2]!.signature.bounds).toEqual([{ parameter: 0, predicate: 'Display' }]);
    for (const bad of ['Some(1)', '[1]', '{x: 1}', '(false, [:1:])', 'fn (n) n'])
        expect(() => checkSource(through + 'render(' + bad + ')')).toThrow('Display');
    expect(() => checkSource(label + '{let f = label\n f([1])}')).toThrow('Display');
    expect(() => checkSource('label :: (List(Number)) => String\n' + label)).toThrow('Display');
    const broken = structuredClone(program);
    delete broken.units[2]!.signature.bounds;
    expect(() => verifyTypedProgram(broken)).toThrow('Display');
    expect(() =>
        specializeProgram(program, wasm32Emscripten('test'), [
            {
                unit: program.units[0]!.id,
                arguments: [{ tag: 'record', fields: [] }],
            },
        ]),
    ).toThrow('Display');
});

it('exports Comparable and inspects the payloads of nominal types', () => {
    const eq = 'fn eq(x, y) {x == y}\nfn id(x) x\n';
    expect(() => checkSource(eq + 'eq(id, id)')).toThrow('cannot be compared');
    expect(() =>
        checkSource('type F { F((Number) => Number) }\n' + eq + 'eq(F(id), F(id))'),
    ).toThrow('cannot be compared');
    expect(
        checkSource(
            'type Tree(a) {\n Leaf(a)\n Node(Tree(a), Tree(a))\n}\n' + eq + 'eq(Leaf(1), Leaf(2))',
        ).units[0]!.signature.bounds,
    ).toEqual([{ parameter: 0, predicate: 'Comparable' }]);
});

it('carries distinct copy and drop bounds across definitions in dual mode', () => {
    const src =
        '// laminar: dual\nfn lose(mut x) { () }\nfn fork(mut x) { (dup(~x), x) }\nfn pass(mut x) { x }\n';
    const [lose, fork, pass] = checkSource(src).units;
    expect(lose!.signature.bounds).toEqual([{ parameter: 0, predicate: 'Droppable' }]);
    expect(fork!.signature.bounds).toEqual([{ parameter: 0, predicate: 'Copyable' }]);
    expect(pass!.signature.bounds).toBeUndefined();
});

for (const target of ['native', 'go', 'wasm32'] as const)
    (process.env.LAMINAR_EXEC ? it : it.skip)(
        `executes tuple Display on ${target}`,
        () => {
            const config = detectTarget(target);
            const compiled = compileSource(nested, { target: config });
            const directory = mkdtempSync(join(tmpdir(), 'laminar-display-'));
            try {
                const { command, args } = buildCompiled(compiled, config, {
                    directory,
                    optimize: true,
                    sanitize: target === 'native',
                });
                const run = spawnSync(command, args, { encoding: 'utf8' });
                expect(run.stderr).toBe('');
                expect(run.status).toBe(0);
                expect(JSON.parse(run.stdout)).toBe(expected);
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        },
        60000,
    );
