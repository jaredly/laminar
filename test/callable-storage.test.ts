import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { emitC } from '../src/c/emit.ts';
import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { verifyRepresentations } from '../src/verify-representations.ts';
import { lowerConcreteProgram } from '../src/lower-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';

import { callableStorageSamples } from './backend/callable-storage-samples.ts';
for (const sample of callableStorageSamples) {
    it(`retains callable aggregate provenance: ${sample.name}`, () => {
        const p = typedProgram(sample.source);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
        const source = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        expect(executeTypedProgram(source.program)).toEqual(sample.expected);
        const analysis = JSON.parse(JSON.stringify(inferRepresentations(source)));
        verifyRepresentations(source, analysis);
        expect(JSON.stringify(analysis)).toContain('"kind":"aggregate"');
        const concrete = JSON.parse(JSON.stringify(lowerConcreteProgram(source, analysis)));
        verifyConcreteProgram(concrete);
        expect(() => emitC(concrete)).not.toThrow();
    });
}
it('independently rejects changed callable tuple members', () => {
    const p = typedProgram(
        '{let x = 3\n let y = 5\n let pair = (fn () x, fn () y)\n let (f, g) = pair\n f() + g()}',
    );
    const source = specializeProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    const analysis = JSON.parse(JSON.stringify(inferRepresentations(source)));
    const aggregate = analysis.entries[0].values.find(
        (v: any) => v.representation.kind === 'aggregate',
    ).representation;
    aggregate.items.reverse();
    expect(() => verifyRepresentations(source, analysis)).toThrow(
        'Tuple member provenance changed',
    );
});
it('keeps callable focus storage explicit', () => {
    const p = typedProgram('{let x = 3\n let f = fn () x\n let g = f := fn () 5\n g()}');
    const source = specializeProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(() => inferRepresentations(source)).toThrow(
        'Callable storage requires an explicit closure representation',
    );
});

for (const mutation of ['field-layout', 'field-kind', 'field-order'] as const)
    it(`rejects corrupted physical callable aggregate ${mutation}`, () => {
        const p = typedProgram(callableStorageSamples[0]!.source);
        const source = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        const concrete = JSON.parse(JSON.stringify(lowerConcreteProgram(source)));
        const aggregate = concrete.layouts.find(
            (l: { key: string }) => JSON.parse(l.key)[2] === 'aggregate',
        );
        if (mutation === 'field-layout') aggregate.fields[0].layout = aggregate.fields[1].layout;
        if (mutation === 'field-kind') aggregate.fields[0].kind = 'pointer';
        if (mutation === 'field-order') aggregate.fields.reverse();
        expect(() => verifyConcreteProgram(concrete)).toThrow('Incorrect concrete storage fields');
        expect(() => emitC(concrete)).toThrow('Incorrect concrete storage fields');
    });
