import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { verifyRepresentations } from '../src/verify-representations.ts';
import { lowerConcreteProgram } from '../src/lower-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';

const samples = [
    {
        name: 'projection',
        source: '{let x = 3\n let pair = (fn () x, 4)\n let (f, y) = pair\n f() + y}',
        expected: 7,
    },
    {
        name: 'nested capture',
        source: '{let x = 3\n let pair = ((fn () x, 4), 5)\n let g = fn () {let ((f, y), z) = pair\n f() + y + z}\n g()}',
        expected: 12,
    },
    {
        name: 'parameter',
        source: 'fn run(pair) {let (f, x) = pair\n f() + x}\n{let y = 3\n run((fn () y, 4))}',
        expected: 7,
    },
    {
        name: 'result',
        source: 'fn make(x) (fn () x, 4)\n{let (f, y) = make(3)\n f() + y}',
        expected: 7,
    },
    {
        name: 'unused affine member',
        source: '{let x = 3\n let pair = (fn () x, 4)\n let (_, y) = pair\n y}',
        expected: 4,
    },
    {
        name: 'joined member',
        source: '{let x = 3\n let y = 5\n let f = match false {true -> fn () x; false -> fn () y}\n let (g, z) = (f, 4)\n g() + z}',
        expected: 9,
    },
];
for (const sample of samples) {
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
        expect(() => lowerConcreteProgram(source, analysis)).toThrow(
            'Callable aggregate storage requires an explicit physical adapter',
        );
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
