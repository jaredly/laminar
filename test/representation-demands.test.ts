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
it('rejects missing callable replacement demands', () => {
    const c = concrete(demandSamples[1]!.source);
    delete c.analysis.entries[0].calls.find((call: any) => call.demand).demand;
    expect(() => verifyConcreteProgram(c)).toThrow('Missing callable result replacement demand');
    expect(() => emitC(c)).toThrow('Missing callable result replacement demand');
});
it('rejects forged replacement demand source', () => {
    const c = concrete(demandSamples[1]!.source);
    c.analysis.entries[0].calls.find((call: any) => call.demand).demand.value = 'forged-source';
    expect(() => verifyConcreteProgram(c)).toThrow('Callable replacement demand source changed');
});
function demandOf(name: string) {
    const c = concrete(demandSamples.find((s) => s.name === name)!.source);
    const call = c.analysis.entries[0].calls.find((call: any) => call.demand);
    return { c, call };
}
it('rejects forged alias demand sources', () => {
    const { c, call } = demandOf('demand callable persistent result alias');
    expect(call.demand.loan).toBeString();
    call.demand.loan = 'forged-loan';
    expect(() => verifyConcreteProgram(c)).toThrow('Callable replacement demand source changed');
});
it('rejects forged consuming-call demand sources', () => {
    const { c, call } = demandOf('demand callable result consumed by focus call');
    expect(call.demand.consumer).toBeString();
    call.demand.consumer = 'forged-call';
    expect(() => verifyConcreteProgram(c)).toThrow('Callable replacement demand source changed');
});
it('solves recursive callable contracts as a least fixed point', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable recursive exchange')!.source,
    );
    const [variant] = c.analysis.variants.filter((v: any) =>
        v.calls.some((call: any) => call.target === v.id),
    );
    // The seed excludes the recursive arm, so the contract is only the installed closure.
    expect(variant.arguments[2].replacement.kind).toBe('callable');
    expect(variant.arguments[2].replacement).toEqual(variant.arguments[1]);
});
it('routes callee-private result backing through the residual context', () => {
    const { c, call } = demandOf('demand callable private redirect');
    const variant = c.analysis.variants.find((v: any) => v.id === call.target);
    expect(variant.resultDemand).toEqual(call.demand.replacement);
    const retained = c.analysis.variants
        .flatMap((v: any) => v.values)
        .find((v: any) => v.retainedStorage);
    expect(retained).toBeDefined();
    delete retained.retainedStorage;
    expect(() => verifyConcreteProgram(c)).toThrow('Retained scope storage provenance changed');
});
it('solves recursive lens result contracts on their demand', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'recursive callable lens result')!.source,
    );
    const variant = c.analysis.variants.find(
        (v: any) => v.resultDemand && v.calls.some((call: any) => call.target === v.id),
    );
    expect(variant).toBeDefined();
    // Seeded with the recursive arm divergent: the contract is exactly the demand.
    expect(variant.arguments[1].replacement).toEqual(variant.resultDemand);
});
