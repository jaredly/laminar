import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { backendCorpus } from './backend/corpus.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations, type RepresentationAnalysis } from '../src/infer-representations.ts';
import { verifyRepresentations } from '../src/verify-representations.ts';
import { wasm32Emscripten, BackendDiagnostic } from '../src/backend/target.ts';
const target = wasm32Emscripten('test');
function fixture(text = 'fn id(x) x\n(id(1), id(true))') {
    const generic = typedProgram(text);
    const source = specializeProgram(generic, target, [
        { unit: generic.units.at(-1)!.id, arguments: [] },
    ]);
    const analysis = JSON.parse(
        JSON.stringify(inferRepresentations(source)),
    ) as RepresentationAnalysis;
    return { source, analysis };
}
for (const sample of backendCorpus.filter((s) => s.phase <= 6))
    it(`verifies serialized representation analysis: ${sample.name}`, () => {
        const { source, analysis } = fixture(sample.source);
        expect(() =>
            verifyRepresentations(JSON.parse(JSON.stringify(source)), analysis),
        ).not.toThrow();
    });
function reject(label: string, mutate: (a: RepresentationAnalysis) => void, text?: string) {
    it(`rejects ${label}`, () => {
        const { source, analysis } = fixture(text);
        mutate(analysis);
        try {
            verifyRepresentations(source, analysis);
            throw Error('Verifier accepted corruption');
        } catch (e) {
            expect(e).toBeInstanceOf(BackendDiagnostic);
            expect((e as BackendDiagnostic).code).toBe('invalid-representation-analysis');
        }
    });
}
reject('unknown schema', (a) => {
    a.schemaVersion = 2 as 1;
});
reject('missing layout', (a) => {
    (a.layouts as any[]).pop();
});
reject('duplicate layout', (a) => {
    (a.layouts as any[]).push(a.layouts[0]);
});
reject('wrong storage kind', (a) => {
    a.layouts[0]!.storage = 'tuple';
});
reject('wrong layout dependencies', (a) => {
    a.layouts.find((l) => l.storage === 'tuple')!.dependencies = [];
});
reject('foreign target layout identity', (a) => {
    a.layouts[0]!.id = 'foreign';
});
reject('missing variant', (a) => {
    a.variants.pop();
});
reject('duplicate variant', (a) => {
    a.variants.push(a.variants[0]!);
});
reject('wrong variant key', (a) => {
    a.variants[0]!.key = 'wrong';
});
reject('missing temporary annotation', (a) => {
    a.entries[0]!.values.pop();
});
reject('extra temporary annotation', (a) => {
    a.entries[0]!.values.push({ value: 'extra', representation: a.roots[0]!.result });
});
reject('duplicate temporary annotation', (a) => {
    a.entries[0]!.values.push(a.entries[0]!.values[0]!);
});
reject('missing call annotation', (a) => {
    a.entries[0]!.calls.pop();
});
reject('extra call annotation', (a) => {
    a.entries[0]!.calls.push({ ...a.entries[0]!.calls[0]!, value: 'extra' });
});
reject('wrong call target', (a) => {
    a.entries[0]!.calls[0]!.target = a.entries[0]!.calls[1]!.target;
});
reject('changed call arguments', (a) => {
    a.entries[0]!.calls[0]!.arguments = [];
});
reject('changed call result', (a) => {
    a.entries[0]!.calls[0]!.result = a.roots[0]!.result;
});
reject('root result mismatch', (a) => {
    a.roots[0]!.result = a.entries[0]!.calls[0]!.result;
});
reject('missing root', (a) => {
    a.roots.pop();
});
reject('missing entry', (a) => {
    a.entries.pop();
});
const lensText = 'fn inc(~(x, y)) {x := x + 1}\n{let a = 1\n let b = 2\n inc(~(a, b))\n (a, b)}';
reject(
    'missing backing',
    (a) => {
        (a.backings as any[]).pop();
    },
    lensText,
);
reject(
    'incorrect backing access',
    (a) => {
        a.backings[0]!.access = 'separate-slots';
    },
    lensText,
);
reject(
    'tuple lens endpoints',
    (a) => {
        const s = a.shapes.find((s) => s.kind === 'tuple')!;
        s.read = a.shapes.find((s) => s.kind === 'thin')!.read;
    },
    lensText,
);
reject(
    'unknown shape kind',
    (a) => {
        (a.shapes[0] as any).kind = 'unknown';
    },
    lensText,
);
it('accepts object-property reordering after serialization', () => {
    const { source, analysis } = fixture(lensText);
    const reorder = (v: any): any =>
        Array.isArray(v)
            ? v.map(reorder)
            : v && typeof v === 'object'
              ? Object.fromEntries(
                    Object.entries(v)
                        .reverse()
                        .map(([k, x]) => [k, reorder(x)]),
                )
              : v;
    expect(() => verifyRepresentations(reorder(source), reorder(analysis))).not.toThrow();
});
it('rejects analysis paired with a different target', () => {
    const { source, analysis } = fixture();
    const changed = {
        ...source,
        target: {
            ...source.target,
            toolchain: { ...source.target.toolchain, version: 'other' },
        },
    };
    expect(() => verifyRepresentations(changed, analysis)).toThrow('wrong-target');
});
for (const [label, text] of [
    ['higher-order', 'fn apply(f, x) f(x)\nfn id(x) x\napply(id, 1)'],
    [
        'returned lens',
        'fn first(~(x, y)) ~x\n{let pair = ((1, 2), 3)\n first(~pair) := true\n pair}',
    ],
    [
        'shape variants',
        'fn inc(~(x, y)) {x := x + 1}\n{let pair = (1, 2)\n let a = 1\n let b = 2\n inc(~pair)\n inc(~(a, b))\n (pair, a, b)}',
    ],
] as const)
    it(`verifies ${label} contracts`, () => {
        const { source, analysis } = fixture(text);
        expect(() => verifyRepresentations(source, analysis)).not.toThrow();
    });
it('rejects unreachable variants even when each variant is individually valid', () => {
    const generic = typedProgram('fn id(x) x\nid(1)\nid(true)');
    const both = specializeProgram(
        generic,
        target,
        generic.units.filter((u) => !u.definition).map((u) => ({ unit: u.id, arguments: [] })),
    );
    const analysis = structuredClone(inferRepresentations(both));
    const source = { ...both, roots: both.roots.slice(0, 1) };
    analysis.roots = analysis.roots.slice(0, 1);
    analysis.entries = analysis.entries.slice(0, 1);
    expect(() => verifyRepresentations(source, analysis)).toThrow('Unreachable function variant');
});
reject('changed global callable provenance', (a) => {
    const globals = a.entries[0]!.values.filter((v) => v.representation.kind === 'callable');
    globals[0]!.representation = globals[1]!.representation;
});
reject(
    'changed capture provenance',
    (a) => {
        const member = a.callables.flatMap((c) => c.members).find((m) => m.kind === 'closure')!;
        if (member.kind !== 'closure') throw Error('Expected closure member');
        member.captures = [];
    },
    '{let x = 1\n let f = fn (()) x\n f(())}',
);
reject('missing variant result', (a) => {
    delete (a.variants[0] as any).result;
});
reject('missing annotation table', (a) => {
    delete (a.entries[0] as any).values;
});
reject('non-record table entry', (a) => {
    (a.layouts as any[]).push(null);
});
reject('missing layout type', (a) => {
    delete (a.layouts[0] as any).type;
});
reject('missing variant captures', (a) => {
    delete (a.variants[0] as any).captures;
});
reject('layout users preceding dependencies', (a) => {
    (a.layouts as any[]).reverse();
});
reject(
    'duplicate backing',
    (a) => {
        (a.backings as any[]).push(a.backings[0]);
    },
    lensText,
);
reject(
    'duplicate shape',
    (a) => {
        (a.shapes as any[]).push(a.shapes[0]);
    },
    lensText,
);
reject(
    'missing shape',
    (a) => {
        (a.shapes as any[]).pop();
    },
    lensText,
);
it('rejects a coherent thin substitute for an explicit scattered lens tuple', () => {
    const { source, analysis } = fixture(lensText);
    const tuple = analysis.shapes.find((s) => s.kind === 'tuple')!;
    const read = analysis.layouts.find((l) => l.id === tuple.read)!.type;
    const write = analysis.layouts.find((l) => l.id === tuple.replacement)!.type;
    const backing = {
        id: JSON.stringify(['backing', tuple.read, tuple.replacement]),
        read: tuple.read,
        replacement: tuple.replacement,
        access: 'same-layout' as const,
    };
    const thin = {
        id: JSON.stringify(['thin', backing.id]),
        kind: 'thin' as const,
        backing: backing.id,
        read: tuple.read,
        replacement: tuple.replacement,
    };
    expect(read).toEqual(write);
    (analysis.backings as any[]).push(backing);
    (analysis.shapes as any[]).push(thin);
    const annotation = analysis.entries[0]!.values.find(
        (v) => v.representation.kind === 'lens' && v.representation.shape === tuple.id,
    )!;
    annotation.representation = { kind: 'lens', shape: thin.id };
    expect(() => verifyRepresentations(source, analysis)).toThrow('Lens tuple lost its topology');
});
it('rejects a same-type branch whose code is not a listed member', () => {
    const text =
        'fn id(x) x\nfn other(x) x\n(other(1), {let f = match true {true -> id; false -> id}\n f(1)})';
    const { source: original, analysis } = fixture(text);
    const source = structuredClone(original);
    const other = source.instances.find((v) => v.source.endsWith('/other'))!;
    const unit = source.program.units.find((u) => u.id === source.roots[0])!;
    const findCase = (
        b: import('../src/typed-ir.ts').IRBlock,
    ): import('../src/typed-ir.ts').Instruction | undefined => {
        for (const i of b.instructions) {
            if (i.op === 'case') return i;
            if (i.op === 'scope') {
                const found = findCase(i.body);
                if (found) return found;
            }
        }
    };
    const branch = findCase(unit.entry)!;
    if (branch.op !== 'case') throw Error('Expected case');
    const global = branch.cases[1]!.body.instructions.find((i) => i.op === 'global')!;
    if (global.op !== 'global') throw Error('Expected global');
    global.instance.definition = other.id;
    const otherUnit = source.program.units.find((u) => u.id === other.id)!;
    const closure = otherUnit.entry.instructions[0]!;
    if (closure.op !== 'closure') throw Error('Expected closure');
    // Callable values are type-determined; the arm's code is a member the analysis
    // never listed for that type.
    expect(() => verifyRepresentations(source, analysis)).toThrow('Callable member sets changed');
});
