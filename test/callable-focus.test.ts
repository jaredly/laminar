import { expect, it } from 'bun:test';
import { callableFocusSamples } from './backend/callable-focus-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of callableFocusSamples)
    it(sample.name, () => {
        const p = typedProgram(sample.source);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
        const c = JSON.parse(
            JSON.stringify(
                compileConcreteProgram(p, wasm32Emscripten('test'), [
                    { unit: p.units.at(-1)!.id, arguments: [] },
                ]),
            ),
        );
        verifyConcreteProgram(c);
        expect(() => emitC(c)).not.toThrow();
    });

function concrete(source = callableFocusSamples[0]!.source) {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
for (const endpoint of ['read', 'replacement'] as const)
    it(`rejects forged local focus ${endpoint} provenance`, () => {
        const c = concrete();
        const focus = c.analysis.entries[0].values.find(
            (v: any) => v.representation.kind === 'local-focus',
        ).representation;
        focus[endpoint] = focus[endpoint === 'read' ? 'replacement' : 'read'];
        expect(() => verifyConcreteProgram(c)).toThrow(
            endpoint === 'read'
                ? 'Callable focus read provenance changed'
                : 'Callable swap replacement provenance changed',
        );
    });
it('rejects a forged local focus physical pointer', () => {
    const c = concrete();
    const l = c.layouts.find((l: any) => JSON.parse(l.key)[2] === 'local-focus');
    l.fields[0].layout = l.fields[1].layout;
    expect(() => verifyConcreteProgram(c)).toThrow('Incorrect concrete storage fields');
    expect(() => emitC(c)).toThrow('Incorrect concrete storage fields');
});
it('keeps borrowed callable focuses explicit', () => {
    expect(() =>
        concrete('{let x = 3\n let f = fn () x\n let a = ~f\n let old = a := fn () 5\n old()}'),
    ).toThrow('Callable focuses require a direct whole-owned-local swap');
});
it('keeps branch callable storage versions explicit', () => {
    expect(() =>
        concrete(
            '{let x = 3\n let f = fn () x\n match true {true -> {let old = f := fn () 5\n old()}; false -> 2}\n f()}',
        ),
    ).toThrow('Branch callable storage versions require an adapter');
});
