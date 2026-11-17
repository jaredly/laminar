import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Linear } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import { verifyElaboration } from '../src/backend/verify-elaboration.ts';
import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { TypeDiagnostic } from '../src/types.ts';
import { BackendDiagnostic, wasm32Emscripten } from '../src/backend/target.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';

import { lensBranchSamples as samples } from './backend/lens-branch-samples.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
const first = 'fn first(~(x, y)) ~x\n';
for (const sample of samples)
    it(`lens branch: ${sample.name}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(sample.source)));
        verifyTypedProgram(p);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
    });
for (const [source, code] of [
    [
        '{let x = 1\n let y = 2\n {let f = ~{match true {true -> x; false -> y}}\n f := true}\n ()}',
        'branch-state',
    ],
    [
        '{let x = 1\n {let f = ~{match true {true -> x; false -> x}}\n x}\n ()}',
        'use-while-borrowed',
    ],
    ['{let x = 1\n {let f = ~{match true {true -> x; false -> x}}\n f}\n ()}', 'unrestored-lens'],
    ['fn local(b) ~{match b {true -> {let x = 1\n x}; false -> {let x = 2\n x}}}', 'escaping-lens'],
])
    it(`lens branches reject ${code}`, () => {
        try {
            typedProgram(source);
            throw Error('Expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
        }
    });
it('retains a verified selected-branch adapter through concrete serialization', () => {
    const p = typedProgram(samples[0].source);
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    verifyConcreteProgram(JSON.parse(JSON.stringify(c)));
});

for (const [condition, count] of [
    ['true', 1],
    ['false', 10],
] as const)
    it(`executes only selected setup: ${condition}`, () => {
        const source =
            first +
            `fn counted(~(p, count)) ~{count := count + 1\n first(~p)}\n{let p = (1, 2)\n let count = 0\n {let f = ~{match ${condition} {true -> counted(~(p, count)); false -> {count := count + 10\n first(~p)}}}\n f := true}\n (p, count)}`;
        const p = JSON.parse(JSON.stringify(typedProgram(source)));
        expect(executeTypedProgram(p)).toEqual([[true, 2], count]);
        expect(legacyReference(source)).toEqual([[true, 2], count]);
    });

it('defers selected branch closure disposal until restoration', () => {
    const source =
        '{let x = 1\n {let f = ~{match true {flag -> {let unused = fn (()) flag\n x}}}\n f := true}\n x}';
    const events: string[] = [];
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect(
        executeTypedProgram(p, {
            onStep: (_, op) => {
                if (op === 'swap') events.push('swap');
            },
            onDisposeClosure: () => events.push('dispose'),
        }),
    ).toBe(true);
    expect(events).toEqual(['swap', 'dispose']);
    expect(legacyReference(source)).toBe(true);
});

function lensCase(p: ReturnType<typeof typedProgram>) {
    const visit = (
        b: import('../src/typed-ir.ts').IRBlock,
    ): import('../src/typed-ir.ts').Instruction | undefined => {
        for (const i of b.instructions) {
            if (i.op === 'case' && i.out.type.tag === 'flow') return i;
            if (i.op === 'scope') {
                const found = visit(i.body);
                if (found) return found;
            }
        }
    };
    return visit(p.units.at(-1)!.entry)!;
}

it('independently rejects missing setup normalization and deferred cleanup', () => {
    const availability = JSON.parse(JSON.stringify(typedProgram(samples[5].source)));
    const branch = lensCase(availability);
    if (branch.op !== 'case') throw Error('Missing branch');
    expect(branch.cases[1].setup!.length).toBe(1);
    branch.cases[1].setup = [];
    expect(() => verifyTypedProgram(availability)).toThrow(BackendDiagnostic);

    const owned = JSON.parse(JSON.stringify(typedProgram(samples[4].source)));
    const selected = lensCase(owned);
    if (selected.op !== 'case') throw Error('Missing branch');
    selected.cases[0].body.cleanup = [];
    expect(() => verifyTypedProgram(owned)).toThrow(BackendDiagnostic);
});

it('keeps ordinary unmatched cases trapping and applies the same policy to lens branches', () => {
    const p = typedProgram('{let x = 1\n {let f = ~{match false {true -> x}}\n f := true}\n x}');
    expect(() => executeTypedProgram(JSON.parse(JSON.stringify(p)))).toThrow('No case arm matched');
});

it('joins setup availability independently of the selected runtime branch', () => {
    const source =
        '{let x = 1\n let spare = 2\n {let f = ~{match false {true -> {spare\n x}; false -> x}}\n spare}\n ()}';
    try {
        typedProgram(source);
        throw Error('Expected rejection');
    } catch (e) {
        expect(e).toBeInstanceOf(TypeDiagnostic);
        expect((e as TypeDiagnostic).code).toBe('use-after-move');
    }
});

it('retains storage across nested branch selections', () => {
    const source =
        '{let f = ~{match true {flag -> {match flag {true -> {let n = 1\n n}; false -> {let n = 2\n n}}}}}\n f := true}';
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect(executeTypedProgram(p)).toBe(1);
    expect(legacyReference(source)).toBe(1);
});

it('releases owned legacy branch storage after restoration', () => {
    const source = '{{let f = ~{match true {flag -> {let n = 1\n n}}}\n f := true}\n heapsize()}';
    expect(executeTypedProgram(typedProgram(source))).toBe(0);
    expect(legacyReference(source)).toBe(0);
});

it('retains and independently validates branch restoration states', () => {
    const parsed = grammar.parse<Linear>('FileItem', readLines(samples[2].source).nodes[0]);
    if (parsed.type === 'failure') throw Error('Parse failure');
    const checked = new Checker().check(parsed.value);
    const e = JSON.parse(JSON.stringify(checked.elaboration));
    verifyElaboration(e);
    expect(e.branches[0].restored.length).toBeGreaterThan(0);
    delete e.branches[0].arms[0].restored;
    expect(() => verifyElaboration(e)).toThrow('Lens branch is missing restoration states');
});

it('independently rejects missing or corrupted selected-branch adapters', () => {
    const source = samples.find((s) => s.name === 'mixed topology false')!.source;
    const p = typedProgram(source);
    const original = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    const find = (c: typeof original) => {
        const visit = (
            b: import('../src/concrete-ir.ts').ConcreteBlock,
        ):
            | Extract<import('../src/concrete-ir.ts').ConcreteInstruction, { op: 'case' }>
            | undefined => {
            for (const i of b.instructions) {
                if (i.op === 'case' && i.lensJoin) return i;
                if (i.op === 'scope') {
                    const found = visit(i.body);
                    if (found) return found;
                }
            }
        };
        return c.code.map((code) => visit(code.body)).find(Boolean)!;
    };
    for (const damage of [
        (c: typeof original) => {
            find(c).lensJoin = undefined;
        },
        (c: typeof original) => {
            find(c).lensJoin!.arms[0] = 'forged-shape';
        },
        (c: typeof original) => {
            find(c).lensJoin!.result = find(c).lensJoin!.arms[1]!;
        },
    ]) {
        const c = JSON.parse(JSON.stringify(original));
        damage(c);
        expect(() => verifyConcreteProgram(c)).toThrow(
            'Selected-branch restoration adapter changed',
        );
    }
    const c = JSON.parse(JSON.stringify(original)) as typeof original;
    const branch = find(c);
    for (const record of [...c.analysis.entries, ...c.analysis.variants]) {
        const value = record.values.find((v) => v.value === branch.out.id);
        if (value?.representation.kind === 'lens')
            value.representation.shape = branch.lensJoin!.arms[1]!;
    }
    expect(() => verifyConcreteProgram(c)).toThrow(
        'Selected-branch adapter must expose a thin focus',
    );
});

it('rejects lost normalization at the concrete boundary', () => {
    const p = typedProgram(samples[5].source);
    const c = JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
    const visit = (b: import('../src/concrete-ir.ts').ConcreteBlock): boolean => {
        for (const i of b.instructions) {
            if (i.op === 'case' && i.lensJoin) {
                i.cases[1]!.setup = [];
                return true;
            }
            if (i.op === 'scope' && visit(i.body)) return true;
        }
        return false;
    };
    expect(
        c.code.some((code: import('../src/concrete-ir.ts').ConcreteCode) => visit(code.body)),
    ).toBe(true);
    expect(() => verifyConcreteProgram(c)).toThrow('Case setup normalization changed');
});
