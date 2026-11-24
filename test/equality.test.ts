import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompileError, buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { referenceRun } from './backend/reference-run.ts';
import { typedProgram } from './backend/typed-program.ts';

const tree = `type Tree {
    Leaf(Number)
    Node(Tree, Tree)
}
`;
// Dual mode: plain bindings can be read more than once.
const program = `${tree}{
    let a = Node(Leaf(1), Node(Leaf(2), Leaf(3)))
    let b = Node(Leaf(1), Node(Leaf(2), Leaf(3)))
    let c = Node(Leaf(1), Leaf(2))
    let s = "hi"
    let v = [:"a", "b":]
    let w = [:"a", "b":]
    let nan = 0 / 0
    ("x" == "x", "x" == "y", true == false, true == true, (1, "a") == (1, "a"), (1, "a") != (1, "b"), a == b, a == c, a != c, s == "hi", v == w, v == [:"a":], () == (), s == s, (nan, 1) == (nan, 1), [::] == [:1:], not 1 == 2)
}`;
const expected = [
    true,
    false,
    false,
    true,
    true,
    true,
    true,
    false,
    true,
    true,
    true,
    false,
    true,
    true,
    false,
    false,
    true,
];

it('compares any data structurally in the reference evaluator', () => {
    expect(
        referenceRun(
            typedProgram(
                `${tree}{(Node(Leaf(1), Leaf(2)) == Node(Leaf(1), Leaf(2)), Leaf(1) == Leaf(2), "a" == "a", [:1, 2:] == [:1, 2:])}`,
            ),
            '',
        ),
    ).toEqual({
        output: '',
        result: [true, false, true, true],
    });
});

const errorCode = (source: string, mode: 'pure' | 'dual' = 'dual'): string => {
    try {
        checkSource(source, { mode });
        return 'ok';
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
};

it('rejects comparing functions, linear values and mismatched types', () => {
    for (const mode of ['pure', 'dual'] as const) {
        expect(errorCode('fn f(x) {x}\n{f == f}', mode)).toBe('not-comparable');
        expect(errorCode('{1 == "a"}', mode)).toBe('type-mismatch');
        expect(errorCode('{"a" == "a"}', mode)).toBe('ok');
    }
    expect(
        errorCode(
            'type linear L {\n    L(Number)\n}\n{let mut a = L(1)\n let mut b = L(1)\n a == b}',
        ),
    ).toBe('dup-linear');
});

it('generalizes a function that compares its arguments', () => {
    expect(errorCode('fn eq(a, b) {a == b}\n{(eq(1, 2), eq("a", "b"))}')).toBe('ok');
    expect(errorCode('fn eq(a, b) {a == b}\n{eq(1, "b")}')).toBe('type-mismatch');
});

const execute = (name: 'native' | 'go'): string => {
    const target = detectTarget(name);
    const compiled = compileSource(program, { target, mode: 'dual' });
    const directory = mkdtempSync(join(tmpdir(), 'laminar-equality-'));
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
        `compares trees, strings, vectors, tuples and unit on ${name}`,
        () => {
            expect(JSON.parse(execute(name))).toEqual(expected);
        },
        60000,
    );
