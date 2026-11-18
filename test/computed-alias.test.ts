import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { BackendDiagnostic } from '../src/backend/target.ts';
import { TypeDiagnostic } from '../src/types.ts';

import { computedAliases } from './backend/computed-alias-samples.ts';
const first = 'fn first(~(x, y)) ~x\n';
for (const sample of computedAliases)
    it(`computed alias: ${sample.name}`, () => {
        const artifact = JSON.parse(JSON.stringify(typedProgram(sample.source)));
        verifyTypedProgram(artifact);
        expect(executeTypedProgram(artifact)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
    });
for (const [body, code] of [
    ['pair', 'use-while-borrowed'],
    ['focus', 'unrestored-lens'],
    ['{let inner = ~focus\n focus := true}', 'use-while-borrowed'],
])
    it(`computed alias rejects ${code}: ${body}`, () => {
        try {
            typedProgram(
                first + `{let pair = (1, 2)\n {let focus = ~first(~pair)\n ${body}}\n ()}`,
            );
            throw new Error('Expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
        }
    });

it('rejects removed or forged computed owner protection before execution', () => {
    for (const damage of [
        (p: ReturnType<typeof typedProgram>) => {
            p.units.at(-1)!.loans[0].owners = [];
        },
        (p: ReturnType<typeof typedProgram>) => {
            p.units.at(-1)!.loans[0].owners = undefined;
        },
        (p: ReturnType<typeof typedProgram>) => {
            p.units.at(-1)!.loans[0].owners![0].path = [1];
        },
    ]) {
        const p = JSON.parse(JSON.stringify(typedProgram(computedAliases[0].source)));
        damage(p);
        expect(() => verifyTypedProgram(p)).toThrow(BackendDiagnostic);
    }
});

it('preserves empty slots when a tuple lens becomes a persistent alias', () => {
    expect(() =>
        typedProgram('{let a = 1\n let b = 2\n let old = a\n {let f = ~(a, b)\n ()}\n ()}'),
    ).toThrow(TypeDiagnostic);
    const source =
        '{let a = 1\n let b = 2\n let old = a\n {let (x, y) = ~(a, b)\n x := true}\n (a, b)}';
    expect(executeTypedProgram(JSON.parse(JSON.stringify(typedProgram(source))))).toEqual([
        true,
        2,
    ]);
    expect(legacyReference(source)).toEqual([true, 2]);
});

it('requires computed alias restoration and rejects premature release', () => {
    for (const premature of [false, true]) {
        const p = JSON.parse(JSON.stringify(typedProgram(computedAliases[0].source)));
        const visit = (b: import('../src/typed-ir.ts').IRBlock): boolean => {
            const borrow = b.instructions.find((i) => i.op === 'borrow');
            if (borrow?.op === 'borrow') {
                b.cleanup = b.cleanup.filter((c) => c.kind !== 'release' || c.loan !== borrow.loan);
                if (premature)
                    b.instructions.splice(1, 0, {
                        op: 'scope',
                        origin: borrow.origin,
                        out: {
                            id: 'premature-release',
                            type: { tag: 'plain', value: { tag: 'tuple', items: [] } },
                        },
                        body: {
                            origin: borrow.origin,
                            instructions: [
                                {
                                    op: 'constant',
                                    origin: borrow.origin,
                                    out: {
                                        id: 'release-unit',
                                        type: { tag: 'plain', value: { tag: 'tuple', items: [] } },
                                    },
                                    value: null,
                                },
                            ],
                            result: 'release-unit',
                            cleanup: [{ kind: 'release', loan: borrow.loan }],
                        },
                    });
                return true;
            }
            return b.instructions.some((i) => i.op === 'scope' && visit(i.body));
        };
        expect(visit(p.units.at(-1)!.entry)).toBe(true);
        expect(() => verifyTypedProgram(p)).toThrow(BackendDiagnostic);
    }
});

it('retains one active loan identity for multiple projections of the same owner', () => {
    const source =
        '{let pair = (1, 2)\n {let (a, b) = ~pair\n {let f = ~(a, b)\n match true {true -> {f := (true, false)\n ()}; false -> {f := (false, true)\n ()}}}}\n pair}';
    expect(executeTypedProgram(JSON.parse(JSON.stringify(typedProgram(source))))).toEqual([
        true,
        false,
    ]);
    expect(legacyReference(source)).toEqual([true, false]);
});

it('rejects an overlapping move and refill even when the final owner type is unchanged', () => {
    const p = JSON.parse(
        JSON.stringify(typedProgram(first + '{let pair = (1, 2)\n first(~pair) := 4\n pair}')),
    );
    const visit = (b: import('../src/typed-ir.ts').IRBlock): boolean => {
        const callIndex = b.instructions.findIndex(
            (i) => i.op === 'call' && i.out.type.tag === 'flow',
        );
        if (callIndex >= 0) {
            const call = b.instructions[callIndex];
            if (call.op !== 'call') throw Error('Missing call');
            const source = b.instructions.find(
                (i) => i.op === 'acquire' && i.out.id === call.args[0],
            );
            if (!source || source.op !== 'acquire' || source.out.type.tag !== 'flow')
                throw Error('Missing computed owner');
            const unit: import('../src/elaborated.ts').SemanticType = { tag: 'tuple', items: [] };
            const owned = source.out.type.read;
            const origin = call.origin;
            b.instructions.splice(
                callIndex + 1,
                0,
                {
                    op: 'move',
                    origin,
                    slot: source.slot,
                    out: { id: 'overlapping-move', type: { tag: 'plain', value: owned } },
                },
                {
                    op: 'acquire',
                    origin,
                    slot: source.slot,
                    out: {
                        id: 'overlapping-lens',
                        type: { tag: 'flow', read: unit, write: owned },
                    },
                },
                {
                    op: 'swap',
                    origin,
                    lens: 'overlapping-lens',
                    value: 'overlapping-move',
                    out: { id: 'overlapping-refill', type: { tag: 'plain', value: unit } },
                },
                {
                    op: 'bind',
                    origin,
                    value: 'overlapping-refill',
                    pattern: { kind: 'drop', type: unit },
                },
            );
            return true;
        }
        return b.instructions.some((i) => i.op === 'scope' && visit(i.body));
    };
    expect(visit(p.units.at(-1)!.entry)).toBe(true);
    expect(() => verifyTypedProgram(p)).toThrow('Computed lens owner changed before restoration');
});

for (const [name, source, message] of [
    [
        'RHS overlap',
        first + '{let pair = (1, 2)\n first(~pair) := {pair := (3, 4)\n 5}\n pair}',
        'Assignment RHS changes the owner of an active computed lens',
    ],
    [
        'argument overlap',
        first +
            'fn replace(v, ~x) {x := v}\n{let pair = (1, 2)\n replace({pair := (3, 4)\n 5}, ~first(~pair))\n pair}',
        'Arguments change the owner of an active computed lens',
    ],
    [
        'branch overlap',
        first +
            '{let pair = (1, 2)\n first(~pair) := {match true {true -> {pair := (3, 4)\n ()}; false -> ()}\n 5}\n pair}',
        'Assignment RHS changes the owner of an active computed lens',
    ],
])
    it(`rejects computed-owner ${name} even at unchanged final type`, () => {
        try {
            typedProgram(source);
            throw Error('Expected overlapping owner rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe('alias-conflict');
            expect((e as Error).message).toBe(message);
        }
    });
