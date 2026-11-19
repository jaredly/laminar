import { expect, it } from 'bun:test';
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
it('rejects demands that disagree with the installed replacement', () => {
    const { c, call } = demandOf('demand callable persistent result alias');
    call.demand.replacement = structuredClone(call.result.read);
    expect(() => verifyConcreteProgram(c)).toThrow('Callable result demand changed');
    expect(() => emitC(c)).toThrow('Callable result demand changed');
});
it('specializes alias demands joined across branches', () => {
    const { call } = demandOf('demand callable joined alias replacement');
    expect(call.demand.replacement.kind).toBe('callable-choice');
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
for (const [name, source, message] of [
    [
        'recursive',
        'fn ex(k, new, ~x) {match k {0 -> x := new\n j -> ex(j - 1, new, ~x)}}\n{let f = fn () 3\n let old = ex(2, fn () 7, ~f)\n (old(), f())}',
        'Recursive callable endpoint demands require a fixed-point constraint',
    ],
    [
        'branch-selected',
        'fn ex1(new, ~x) {x := new}\nfn ex2(new, ~x) {x := new}\n{let f = fn () 3\n let e = match true {true -> ex1\n false -> ex2}\n let old = e(fn () 7, ~f)\n (old(), f())}',
        'Callable focus calls require verified native fst provenance',
    ],
])
    it(`keeps ${name} callable focus callees explicit`, () => {
        const p = typedProgram(source!);
        expect(() =>
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ).toThrow(message!);
    });
