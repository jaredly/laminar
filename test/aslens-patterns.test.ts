import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { specializeProgram } from '../src/specialize.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';

import { aslensNominalSamples as samples } from './backend/nominal-pattern-samples.ts';
for (const [name, source, expected] of samples)
    it(`aslens pattern: ${name}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(source)));
        verifyTypedProgram(p);
        expect<unknown>(executeTypedProgram(p)).toEqual(expected);
        expect(legacyReference(source)).toEqual(expected);
        const specialized = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        const detached = JSON.parse(JSON.stringify(specialized.program));
        verifyTypedProgram(detached);
        expect<unknown>(executeTypedProgram(detached)).toEqual(expected);
    });

for (const source of [
    '{let f = ~{lens 4 <- 1\n ()}\n f := 3}',
    '{let f = ~{lens [h, ...t] <- 1\n h}\n f := []}',
    '{let f = ~{lens [1, v] <- 1\n v}\n f := [2, 3]}',
])
    it(`traps an unmatched final cleanup pattern: ${source}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(source)));
        expect(() => executeTypedProgram(p)).toThrow('No case arm matched');
        expect(() => legacyReference(source)).toThrow();
    });

import { Checker } from '../src/check.ts';
import { verifyElaboration } from '../src/backend/verify-elaboration.ts';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Linear } from '../src/ast.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { TypeDiagnostic } from '../src/types.ts';

it('retains final constructor pattern elaboration without changing caller syntax', () => {
    const parsed = grammar.parse<Linear>('Linear', readLines(samples[0][1]).nodes[0]);
    if (parsed.type === 'failure') throw Error('Invalid source');
    const original = JSON.stringify(parsed.value);
    const checked = new Checker().check(parsed.value);
    expect(JSON.stringify(parsed.value)).toBe(original);
    verifyElaboration(JSON.parse(JSON.stringify(checked.elaboration)));
    const p = typedProgram(samples[0][1]);
    // Phase 7 derives list storage from the constructor imports; the reconstruction
    // still lowers through ordinary verified concrete IR.
    const concrete = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(concrete.layouts.some((l) => l.kind === 'union')).toBe(true);
    expect(() => verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)))).not.toThrow();
});

it('restores borrowed lexical storage from owned constructor fields', () => {
    const source =
        'fn tail(~xs) ~{lens [h, ...t] <- xs\n xs := t}\n {let xs = [1]\n tail(~xs) := [2, 3]\n xs}';
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect<unknown>(executeTypedProgram(p)).toEqual([3]);
    expect(legacyReference(source)).toEqual([3]);
});

for (const [source, code, message] of [
    [
        '{let f = ~{lens [h, ...t] <- 1\n (h, h)}\n f := [2]}',
        'use-after-move',
        'Value has already been consumed',
    ],
    [
        '{let f = ~{lens [h, h] <- 1\n h}\n f := [2, 3]}',
        'duplicate-pattern',
        'Duplicate pattern name h',
    ],
    ['{let f = ~{lens true <- 1\n ()}\n f := 3}', 'type-mismatch', 'Cannot unify Number with Bool'],
    [
        'fn bad(~xs) ~{lens [h, ...t] <- xs\n h}',
        'unrestored-lens',
        'Lens must contain a value at the end of its lifetime',
    ],
] as const)
    it(`rejects invalid cleanup ownership or type: ${code}`, () => {
        try {
            typedProgram(source);
            throw Error('Expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
            expect((e as Error).message).toBe(message);
        }
    });

it('traps before cleanup effects when a final literal does not match', () => {
    const p = typedProgram(
        '{let seen = 0\n {let f = ~{lens 4 <- 1\n seen := true}\n f := 3}\n seen}',
    );
    let swaps = 0;
    expect(() =>
        executeTypedProgram(JSON.parse(JSON.stringify(p)), {
            onStep: (_, op) => {
                if (op === 'swap') swaps++;
            },
        }),
    ).toThrow('No case arm matched');
    expect(swaps).toBe(1);
});

it('independently requires disposal of constructor cleanup locals', () => {
    const p = JSON.parse(
        JSON.stringify(typedProgram('{let f = ~{lens [h, ...t] <- 1\n ()}\n f := [2]}')),
    );
    let changed = false;
    const visit = (b: import('../src/typed-ir.ts').IRBlock): void => {
        for (const i of b.instructions) {
            if (i.op === 'scope') visit(i.body);
            if (i.op === 'manual') {
                const match = i.cleanup.instructions.find((i) => i.op === 'case');
                if (match?.op === 'case') {
                    match.cases[0]!.body.cleanup = [];
                    changed = true;
                }
            }
        }
    };
    p.units.forEach((u: import('../src/typed-ir.ts').IRUnit) => visit(u.entry));
    expect(changed).toBe(true);
    let steps = 0;
    expect(() => executeTypedProgram(p, { onStep: () => steps++ })).toThrow(
        'Case pattern value has no disposal',
    );
    expect(steps).toBe(0);
});
