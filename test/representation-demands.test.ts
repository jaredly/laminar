import { expect, it } from 'bun:test';
import { RepresentationDemands } from '../src/representation-demands.ts';
import { demandSamples } from './backend/demand-samples.ts';
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
it('detects cyclic representation demands', () => {
    const graph = new RepresentationDemands<number>();
    graph.define('a', () => graph.get('b'));
    graph.define('b', () => graph.get('a'));
    expect(() => graph.get('a')).toThrow('Cyclic replacement demand');
});
it('bounds representation demand expansion', () => {
    const graph = new RepresentationDemands<number>(1);
    graph.define('a', () => 1);
    expect(() => graph.define('b', () => 2)).toThrow('Representation demand budget exceeded');
});
it('keeps distinct restoration demands in variant identities', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable distinct replacement variants')!
            .source,
    );
    const variants = c.analysis.variants.filter((v: any) => v.resultDemand);
    expect(variants).toHaveLength(2);
    expect(new Set(variants.map((v: any) => v.key)).size).toBe(2);
    expect(variants[0].arguments).toEqual(variants[1].arguments);
    expect(variants[0].resultDemand).not.toEqual(variants[1].resultDemand);
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
it('rejects forged demanded cache identities', () => {
    const c = concrete(demandSamples[1]!.source);
    const v = c.analysis.variants.find((v: any) => v.resultDemand);
    v.resultDemand = structuredClone(v.result.read);
    expect(() => verifyConcreteProgram(c)).toThrow('Noncanonical variant key or name');
});
