import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';

const samples = [
    [
        'constructor aliases',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := 3\n rest := []}\n xs}',
        [3],
    ],
    [
        'owned replacement after aliases end',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := 3}\n xs := []\n xs}',
        [],
    ],
    [
        'borrowed match',
        '{let xs = [1, 2]\n match ~xs {[h, ...rest] -> {h := 3\n ()}; [] -> ()}\n xs}',
        [3, 2],
    ],
    [
        'empty borrowed match',
        '{let xs = []\n match ~xs {[h, ...rest] -> {h := 3\n ()}; [] -> ()}\n xs}',
        [],
    ],
    [
        'borrowed match result',
        '{let xs = [1, 2]\n let result = match ~xs {[h, ...rest] -> dup(~h); [] -> 0}\n (result, xs)}',
        [1, [1, 2]],
    ],
    [
        'type-changing fields',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := true\n rest := []}\n xs}',
        [true],
    ],
    ['borrowed tuple match', '{let xs = (1, 2)\n match ~xs {(h, rest) -> {h := 3}}\n xs}', [3, 2]],
    [
        'nested constructor patterns',
        '{let xs = [1, 2]\n {let [a, b] = ~xs\n a := 3\n b := 4}\n xs}',
        [3, 4],
    ],
    [
        'returned borrowed match',
        'fn first(~xs) ~{match ~xs {[h, ...rest] -> h}}\n {let xs = [1, 2]\n first(~xs) := 3\n xs}',
        [3, 2],
    ],
    ...(['true', 'false'] as const).map(
        (condition) =>
            [
                `branch over reconstructed field ${condition}`,
                `{let xs = [1, 2]
 {let [h, ...rest] = ~xs
 {let selected = ~{match ${condition} {true -> h; false -> h}}
 selected := 4}}
 xs}`,
                [4, 2],
            ] as const,
    ),
    [
        'reconstructed field captured and refilled',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n let f = fn () h\n h := 4\n f()}\n xs}',
        [4, 2],
    ],
    [
        'manual cleanup updates reconstructed sibling',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n {let f = ~{@(h, fn () {rest := []})}\n f := 4}}\n xs}',
        [4],
    ],
    [
        'temporary cleanup refills reconstructed field',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n {let f = ~{lens v <- h\n h := v}\n f := 4}}\n xs}',
        [4, 2],
    ],
] as const;
for (const [name, source, expected] of samples)
    it(name, () => {
        const artifact = JSON.parse(JSON.stringify(typedProgram(source)));
        verifyTypedProgram(artifact);
        expect<unknown>(executeTypedProgram(artifact)).toEqual(expected);
        expect(legacyReference(source)).toEqual(expected);
    });

import { TypeDiagnostic } from '../src/types.ts';
import { specializeProgram } from '../src/specialize.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';

for (const [source, code] of [
    [
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n {let f = ~{match true {true -> h; false -> h}}\n h := 3}}\n xs}',
        'use-while-borrowed',
    ],
    [
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n {let f = ~{match true {true -> h; false -> h}}\n f}}\n xs}',
        'unrestored-lens',
    ],
    ['{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n xs := []}\n xs}', 'use-while-borrowed'],
    ['{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h}\n xs}', 'unrestored-lens'],
    ['{let xs = [1, 2]\n match ~xs {[h, ...rest] -> h; [] -> 0}\n xs}', 'unrestored-lens'],
    ['{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := true}\n xs}', 'type-mismatch'],
    ['{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n (h, h)}\n xs}', 'use-after-move'],
    [
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n let f = fn () {h := 4}\n ()}\n xs}',
        'borrowed-capture',
    ],
    ['{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n ()}\n h}', 'unbound-name'],
    [
        '{let xs = [1, 2]\n match ~xs {[h, ...rest] -> {h := true\n rest := []\n ()}; other -> ()}\n xs}',
        'branch-state',
    ],
] as const)
    it(`borrowed patterns reject ${code}: ${source}`, () => {
        try {
            typedProgram(source);
            throw Error('Expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
            expect((e as Error).message).toBe(
                {
                    'use-while-borrowed':
                        'Binding is exclusively borrowed until its aliases leave scope',
                    'unrestored-lens': 'Lens must contain a value at the end of its lifetime',
                    'type-mismatch': 'Cannot unify Bool with Number',
                    'use-after-move': 'Value has already been consumed',
                    'borrowed-capture': 'Closure cannot borrow outer binding h',
                    'unbound-name': 'Unbound name h',
                    'branch-state':
                        'Branches leave incompatible binding types: Cannot unify Bool with Number',
                }[code],
            );
        }
    });

for (const [name, source, expected] of samples)
    it(`specialized borrowed patterns: ${name}`, () => {
        const p = typedProgram(source);
        const result = specializeProgram(p, wasm32Emscripten('test'), [
            {
                unit: p.units.at(-1)!.id,
                arguments: p.units.at(-1)!.signature.quantified.map(() => ({
                    tag: 'con' as const,
                    name: 'Number',
                    args: [],
                })),
            },
        ]);
        const detached = JSON.parse(JSON.stringify(result.program));
        verifyTypedProgram(detached);
        expect<unknown>(executeTypedProgram(detached)).toEqual(expected);
    });

function reconstructed(p: ReturnType<typeof typedProgram>) {
    const visit = (
        b: import('../src/typed-ir.ts').IRBlock,
    ): Extract<import('../src/typed-ir.ts').Instruction, { op: 'manual' }> | undefined => {
        for (const i of b.instructions) {
            if (i.op === 'manual' && i.reconstruction) return i;
            if (i.op === 'scope') {
                const v = visit(i.body);
                if (v) return v;
            }
            if (i.op === 'case')
                for (const arm of i.cases) {
                    const v = visit(arm.body);
                    if (v) return v;
                }
        }
    };
    for (const u of p.units) {
        const v = visit(u.entry);
        if (v) return v;
        for (const f of u.functions) {
            const v = visit(f.body);
            if (v) return v;
        }
    }
    throw Error('Missing reconstruction');
}
for (const mutation of ['contract', 'tag', 'fields', 'target', 'cleanup', 'permissions'] as const)
    it(`rejects corrupted reconstruction ${mutation}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(samples[0][1])));
        const m = reconstructed(p);
        if (mutation === 'contract') delete m.reconstruction;
        else if (mutation === 'cleanup') m.cleanup.instructions = [];
        else if (mutation === 'permissions') m.holds = [];
        else if (mutation === 'tag' || mutation === 'fields') {
            const c = m.cleanup.instructions.find(
                (i) => i.op === 'construct' && i.name === 'cons',
            )!;
            if (c.op !== 'construct') throw Error('Missing cons');
            if (mutation === 'tag') c.name = 'nil';
            else c.items.reverse();
        } else {
            const c = m.cleanup.instructions.find((i) => i.op === 'acquire')!;
            if (c.op !== 'acquire') throw Error('Missing restoration target');
            c.slot = { ...c.slot, place: 'different-owner' };
        }
        const expected = {
            contract: 'Missing selected-pattern reconstruction',
            tag: 'Reconstruction constructor or shape changed',
            fields: 'Reconstruction field changed',
            target: 'Reconstruction restores a different owner',
            cleanup: 'Reconstruction does not restore its owner',
            permissions: 'Manual cleanup dependency protection mismatch',
        }[mutation];
        let steps = 0;
        expect(() => executeTypedProgram(p, { onStep: () => steps++ })).toThrow(expected);
        expect(steps).toBe(0);
    });

it('traps an unmatched borrowed pattern before running its body', () => {
    for (const source of [
        '{let xs = []\n {let [h, ...rest] = ~xs\n h := 3}\n xs}',
        '{let xs = []\n match ~xs {[h, ...rest] -> {h := 3}}}',
    ]) {
        const p = JSON.parse(JSON.stringify(typedProgram(source)));
        expect(() => executeTypedProgram(p)).toThrow('No case arm matched');
        expect(() => legacyReference(source)).toThrow();
    }
});

import { borrowedPatternSamples } from './backend/borrowed-pattern-samples.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { BackendDiagnostic } from '../src/backend/target.ts';
for (const sample of borrowedPatternSamples)
    it(`concrete borrowed pattern: ${sample.name}`, () => {
        const p = typedProgram(sample.source);
        expect<unknown>(executeTypedProgram(JSON.parse(JSON.stringify(p)))).toEqual(
            sample.expected,
        );
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        const concrete = compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
    });
it('keeps nominal runtime layout restrictions separate from borrowed checking', () => {
    const p = typedProgram(samples[0][1]);
    try {
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        throw Error('Expected nominal adapter restriction');
    } catch (e) {
        expect(e).toBeInstanceOf(BackendDiagnostic);
        expect((e as BackendDiagnostic).code).toBe('unsupported-layout');
        expect((e as Error).message).toBe('No storage definition for List');
    }
});

import { Checker } from '../src/check.ts';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Linear } from '../src/ast.ts';
import { verifyElaboration } from '../src/backend/verify-elaboration.ts';
it('retains and independently checks selected reconstruction elaboration', () => {
    const parsed = grammar.parse<Linear>('Linear', readLines(samples[0][1]).nodes[0]);
    if (parsed.type === 'failure') throw Error('Invalid source');
    const original = JSON.stringify(parsed.value);
    const e = JSON.parse(JSON.stringify(new Checker().check(parsed.value).elaboration));
    expect(JSON.stringify(parsed.value)).toBe(original);
    verifyElaboration(e);
    const m = e.manuals.find((m: any) => m.reconstruction);
    expect(m).toBeDefined();
    delete m.reconstruction;
    expect(() => verifyElaboration(e)).toThrow('Missing constructor reconstruction metadata');
});
it('rejects changing a concrete reconstruction contract', () => {
    const p = typedProgram(borrowedPatternSamples[0].source);
    const c = JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
    const visit = (b: any): boolean => {
        for (const i of b.instructions) {
            if (i.op === 'manual' && i.reconstruction) {
                delete i.reconstruction;
                return true;
            }
            if (i.op === 'scope' && visit(i.body)) return true;
            if (i.op === 'case' && i.cases.some((arm: any) => visit(arm.body))) return true;
        }
        return false;
    };
    expect(c.code.some((code: any) => visit(code.body))).toBe(true);
    expect(() => verifyConcreteProgram(c)).toThrow('Manual restoration contract changed');
});

for (const source of [
    'fn update(~[h, ...rest]) {h := h + 1}\n {let xs = [1, 2]\n update(~xs)\n xs}',
    'fn first(~[h, ...rest]) ~h\n {let xs = [1, 2]\n first(~xs) := 2\n xs}',
])
    it('reconstructs constructor-pattern lens parameters', () => {
        const p = JSON.parse(JSON.stringify(typedProgram(source)));
        expect<unknown>(executeTypedProgram(p)).toEqual([2, 2]);
        expect(legacyReference(source)).toEqual([2, 2]);
    });

it('preserves selected reconstruction identities inside constructor-pattern parameters', () => {
    const source =
        'fn update(~[h, ...rest]) {match ~rest {[a, ...tail] -> {a := 3\n ()}; [] -> ()}}\n {let xs = [1, 2]\n update(~xs)\n xs}';
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect<unknown>(executeTypedProgram(p)).toEqual([1, 3]);
    expect(legacyReference(source)).toEqual([1, 3]);
});

for (const source of [
    'fn raw() ~{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h}}',
    'fn raw() ~{let pair = (1, 2)\n match ~pair {(a, b) -> a}}',
])
    it('keeps raw local sublens escapes rejected', () => {
        expect(() => typedProgram(source)).toThrow('Returned lens must refer to a lens parameter');
    });

it('independently preserves raw-local escape checks through reconstruction', () => {
    const p = JSON.parse(
        JSON.stringify(
            typedProgram(
                'fn retained() ~{let pair = (1, 2)\n @({match ~pair {(a, b) -> a}}, fn () ())}',
            ),
        ),
    );
    let removed = false;
    const visit = (b: import('../src/typed-ir.ts').IRBlock): void => {
        const explicit = b.instructions.find((i) => i.op === 'manual' && !i.reconstruction);
        if (explicit?.op === 'manual') {
            b.instructions = b.instructions.filter((i) => i !== explicit);
            if (b.result === explicit.out.id) b.result = explicit.lens;
            removed = true;
        }
        for (const i of b.instructions) {
            if (i.op === 'scope') visit(i.body);
            if (i.op === 'case') i.cases.forEach((arm) => visit(arm.body));
        }
    };
    for (const u of p.units) for (const f of u.functions) visit(f.body);
    expect(removed).toBe(true);
    expect(() => verifyTypedProgram(p)).toThrow('Lens return escapes owned local storage');
});

it('independently rejects a lost permit on a selected reconstructed field', () => {
    const source = samples.find(([name]) => name === 'branch over reconstructed field true')![1];
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    let changed = false;
    const visit = (b: import('../src/typed-ir.ts').IRBlock): void => {
        for (const i of b.instructions) {
            if (i.op === 'scope') visit(i.body);
            if (i.op === 'case') {
                if (i.out.type.tag === 'flow') {
                    for (const arm of i.cases) {
                        const acquire = arm.body.instructions.find((v) => v.op === 'acquire');
                        if (acquire?.op === 'acquire' && acquire.slot.permit) {
                            delete acquire.slot.permit;
                            changed = true;
                        }
                    }
                }
                i.cases.forEach((arm) => visit(arm.body));
            }
        }
    };
    p.units.forEach((u: import('../src/typed-ir.ts').IRUnit) => visit(u.entry));
    expect(changed).toBe(true);
    let steps = 0;
    expect(() => executeTypedProgram(p, { onStep: () => steps++ })).toThrow(
        'Use while exclusively borrowed',
    );
    expect(steps).toBe(0);
});
