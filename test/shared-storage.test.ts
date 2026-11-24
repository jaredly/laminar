import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompileError, buildCompiled, checkSource, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import type { ConcreteProgram } from '../src/concrete-ir.ts';

const compile = (source: string): ConcreteProgram => {
    const p = checkSource(source, { mode: 'dual' });
    return compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
};
const clone = (c: ConcreteProgram): ConcreteProgram => JSON.parse(JSON.stringify(c));
type Node = Record<string, unknown>;
const visit = (v: unknown, f: (n: Node) => void): void => {
    if (Array.isArray(v)) v.forEach((x) => visit(x, f));
    else if (v && typeof v === 'object') {
        f(v as Node);
        Object.values(v).forEach((x) => visit(x, f));
    }
};
const sharedOutputs = (c: ConcreteProgram) => {
    const found: Node[] = [];
    visit(c.code, (n) => {
        const out = n.out as { type?: { mode?: string } } | undefined;
        if (out?.type?.mode === 'shared') found.push(n);
    });
    return found;
};

it('flags the read of a plain binding as a shared read', () => {
    const c = compile('{let p = (1, 2)\n (p, p)}');
    verifyConcreteProgram(clone(c));
    const reads = sharedOutputs(c).filter((n) => n.op === 'invoke');
    expect(reads.length).toBe(2);
    expect(reads.every((n) => n.share === true)).toBe(true);
});

it('does not flag an explicit dup, whose result is owned', () => {
    const c = compile('{let p = (1, 2)\n let mut m = dup(p)\n m}');
    verifyConcreteProgram(clone(c));
    const dups = sharedOutputs(c).filter((n) => n.op === 'invoke' && n.share !== true);
    expect(dups).toEqual([]);
});

/** Make a value owned everywhere it is recorded, so the program stays self-consistent. */
const makeOwned = (c: ConcreteProgram, id: string): void =>
    visit(c, (n) => {
        const out = n.out as { id?: string; type?: { mode?: string } } | undefined;
        if (out?.id === id) delete out.type?.mode;
    });

it('rejects a shared read whose result is not shared', () => {
    const c = clone(compile('{let p = (1, 2)\n (p, p)}'));
    const read = sharedOutputs(c).find((n) => n.op === 'invoke')!;
    makeOwned(c, (read.out as { id: string }).id);
    expect(() => verifyConcreteProgram(c)).toThrow('shared read must produce a shared value');
});

it('rejects an owned aggregate that holds a shared value', () => {
    const c = clone(compile('{let p = (1, 2)\n (p, p)}'));
    const holder = sharedOutputs(c).find((n) => n.op === 'tuple')!;
    makeOwned(c, (holder.out as { id: string }).id);
    expect(() => verifyConcreteProgram(c)).toThrow('aggregate holding a shared value');
});

it('rejects assigning a shared value into mut storage in the checker', () => {
    const code = (source: string) => {
        try {
            checkSource(source, { mode: 'dual' });
        } catch (e) {
            if (e instanceof CompileError) return e.code;
            throw e;
        }
        return 'ok';
    };
    expect(code('{let p = 1\n let mut x = 0\n x := p\n x}')).toBe('shared-into-mut');
    expect(code('{let p = (1, 2)\n let mut x = (0, 0)\n x := dup(p)\n x}')).toBe('ok');
});

// Building needs the toolchains; opt in with LAMINAR_EXEC=1.
const execute = (source: string, name: 'native' | 'go'): string => {
    const target = detectTarget(name);
    const compiled = compileSource(source, { target, mode: 'dual' });
    const directory = mkdtempSync(join(tmpdir(), 'laminar-shared-'));
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
const tree = `type Tree {
    Leaf(Number)
    Node(Tree, Tree)
}
fn sum(t) {
    match t {
        Leaf(n) -> n
        Node(l, r) -> sum(l) + sum(r)
    }
}
`;
for (const name of ['native', 'go'] as const)
    (process.env.LAMINAR_EXEC ? it : it.skip)(
        `shares a tree between two readers on ${name}`,
        () => {
            const out = execute(
                `${tree}{let t = Node(Node(Leaf(1), Leaf(2)), Leaf(3))\n sum(t) + sum(t)}`,
                name,
            );
            expect(out.trim()).toBe('12');
            const copy = execute(
                `${tree}{let t = Node(Leaf(1), Leaf(2))\n let mut m = dup(t)\n (sum(m), sum(t))}`,
                name,
            );
            expect(copy.trim()).toBe('[3,3]');
        },
        60000,
    );

for (const name of ['native', 'go'] as const)
    (process.env.LAMINAR_EXEC ? it : it.skip)(
        `balances shared strings, vectors and returned shares on ${name}`,
        () => {
            expect(execute('{let s = "ab"\n let v = [:1, 2:]\n (s, s, v, v)}', name).trim()).toBe(
                '["ab","ab",[1,2],[1,2]]',
            );
            expect(
                execute(
                    `${tree}fn id(x) {x}\n{let t = Node(Leaf(4), Leaf(5))\n sum(id(t)) + sum(id(Node(Leaf(1), Leaf(2))))}`,
                    name,
                ).trim(),
            ).toBe('12');
        },
        60000,
    );

const bump = `fn bump(~xs) {
    match ~xs {
        [] -> ()
        [head, ...tail] -> {
            head := head + 1
            bump(~tail)
        }
    }
}
`;
for (const name of ['native', 'go'] as const)
    (process.env.LAMINAR_EXEC ? it : it.skip)(
        `updates an owned copy in place without touching the shared original on ${name}`,
        () => {
            const out = execute(
                `${bump}{let p = [1, 2, 3]\n let mut m = dup(p)\n bump(~m)\n (p, m)}`,
                name,
            );
            expect(out.trim()).toBe('[[1,2,3],[2,3,4]]');
        },
        60000,
    );
