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
it('rejects forged recursive callable contracts', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable recursive exchange')!.source,
    );
    const variant = c.analysis.variants.find((v: any) =>
        v.calls.some((call: any) => call.target === v.id),
    );
    variant.arguments[2].replacement = structuredClone(variant.arguments[2].read);
    expect(() => verifyConcreteProgram(c)).toThrow('Noncanonical variant key or name');
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
        'recursive branch-selected lens result',
        'fn walk(k, ~x) ~{match k {0 -> x\n j -> walk(j - 1, ~x)}}\n{let f = fn () 3\n let old = walk(2, ~f) := fn () 7\n (old(), f())}',
        'Recursive callable lens results require a demand-dependent fixed point',
    ],
    [
        'branch-selected scattered differing contracts',
        'fn ex1(new, ~(x, y)) {x := new}\nfn ex2(new, ~(x, y)) {let o = x := fn () 9\n new}\n{let f = fn () 3\n let n = 4\n let e = match true {true -> ex1\n false -> ex2}\n let old = e(fn () 7, ~(f, n))\n (old(), f(), n)}',
        'Branch-selected scattered focus callees require a common parameter contract',
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
function dispatchAdapter(c: any) {
    return c.wrappers.find(
        (w: any) =>
            w.kind === 'adapt-focus-arguments' &&
            w.arguments.some((a: any) => a && a.replacement.kind === 'callable'),
    );
}
it('converts differing dispatch entry tables through a focus argument adapter', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable dispatch converts entry tables')!
            .source,
    );
    const w = dispatchAdapter(c);
    expect(w).toBeDefined();
    const staged = w.arguments.find(Boolean);
    expect(staged.replacement.from).not.toBe(staged.replacement.to);
});
for (const mutation of ['source', 'ownership', 'exact', 'replacement'] as const)
    it(`rejects forged focus argument adapter ${mutation}`, () => {
        const c = concrete(
            demandSamples.find((s) => s.name === 'demand callable dispatch converts entry tables')!
                .source,
        );
        const w = dispatchAdapter(c);
        const n = w.arguments.findIndex(Boolean);
        if (mutation === 'source') w.source = w.id;
        if (mutation === 'ownership') w.ownership = 'copy-replacements';
        if (mutation === 'exact') w.arguments[n] = null;
        if (mutation === 'replacement') w.arguments[n].replacement.to = 'forged-layout';
        const message =
            mutation === 'source' || mutation === 'ownership'
                ? 'Invalid focus argument adapter'
                : 'Focus argument adapter changed';
        expect(() => verifyConcreteProgram(c)).toThrow(message);
        expect(() => emitC(c)).toThrow(message);
    });
it('rejects dispatch replacements that are not the join of their alternatives', () => {
    const c = concrete(
        demandSamples.find((s) => s.name === 'demand callable dispatch joined contract')!.source,
    );
    const call = c.analysis.entries[0].calls.find(
        (call: any) => call.targets && call.arguments.some((a: any) => a.kind === 'local-focus'),
    );
    const focus = call.arguments.find((a: any) => a.kind === 'local-focus');
    focus.replacement = focus.replacement.options[0];
    expect(() => verifyConcreteProgram(c)).toThrow('Call argument representations changed');
});
