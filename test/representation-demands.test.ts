import { expect, it } from 'bun:test';
import { demandSamples } from './backend/demand-samples.ts';
import { callableFocusSamples } from './backend/callable-focus-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { emitC } from '../src/c/emit.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
function concrete(source: string) {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
for (const s of demandSamples)
    it(s.name, () => {
        expect(executeTypedProgram(typedProgram(s.source))).toEqual(s.expected);
        expect(legacyReference(s.source)).toEqual(s.expected);
        expect(() => emitC(concrete(s.source))).not.toThrow();
    });
it('uses ordinary lens contracts without replacement demands', () => {
    for (const sample of demandSamples) {
        const c = concrete(sample.source);
        for (const record of [...c.analysis.entries, ...c.analysis.variants]) {
            expect(record.resultDemand).toBeUndefined();
            for (const call of record.calls) expect(call.demand).toBeUndefined();
            for (const value of record.values)
                expect(['data', 'aggregate', 'callable', 'lens']).toContain(
                    value.representation.kind,
                );
        }
    }
});
it('rejects obsolete replacement demand annotations', () => {
    const c = concrete(demandSamples[1]!.source);
    c.analysis.entries[0].calls[0].demand = { value: 'forged-source' };
    expect(() => verifyConcreteProgram(c)).toThrow('Unexpected call annotation');
});
it('represents recursive callable parameters with ordinary lens shapes', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable recursive exchange')!.source,
    );
    const variant = c.analysis.variants.find((v: any) =>
        v.calls.some((call: any) => call.target === v.id),
    );
    expect(variant).toBeDefined();
    expect(variant.arguments[2].kind).toBe('lens');
    const shape = c.analysis.shapes.find((s: any) => s.id === variant.arguments[2].shape);
    expect(c.analysis.layouts.find((l: any) => l.id === shape.replacement).storage).toBe(
        'callable',
    );
});
it('returns a callee-private lens through the ordinary residual context', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable private redirect')!.source,
    );
    expect(c.analysis.variants.some((v: any) => v.result.kind === 'lens')).toBe(true);
    expect(() => emitC(c)).not.toThrow();
});
it('checks recursive lens result contracts without a replacement demand', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'recursive callable lens result')!.source,
    );
    const variant = c.analysis.variants.find(
        (v: any) => v.result.kind === 'lens' && v.calls.some((call: any) => call.target === v.id),
    );
    expect(variant).toBeDefined();
    expect(variant.resultDemand).toBeUndefined();
    expect(variant.arguments[1].kind).toBe('lens');
});
