import { specializeProgram } from '../src/specialize.ts';
import { expect, it } from 'bun:test';
import { deferredStorageSamples } from './backend/deferred-storage-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of deferredStorageSamples)
    it(sample.name, () => {
        const p = typedProgram(sample.source);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
        const specialized = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        expect(executeTypedProgram(specialized.program)).toEqual(sample.expected);
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
function concrete(source = deferredStorageSamples[0]!.source) {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
function selectedCase(c: any): any {
    function find(block: any): any {
        for (const i of block.instructions) {
            if (i.storageJoins?.some((j: any) => j.restoration)) return i;
            if (i.op === 'scope') {
                const nested = find(i.body);
                if (nested) return nested;
            }
        }
    }
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
it('retains original invocation slots when the common callable has none', () => {
    const c = concrete();
    const j = selectedCase(c).storageJoins[0];
    expect(c.callables.find((v: any) => v.layout === j.arms[0].to).entries).toHaveLength(0);
    expect(
        c.callables.find((v: any) => v.layout === j.restoration.retained[0]).entries,
    ).toHaveLength(1);
});
for (const mutation of ['missing', 'ownership', 'order', 'layout', 'arms'] as const)
    it(`rejects forged deferred storage retention ${mutation}`, () => {
        const c = concrete();
        const j = selectedCase(c).storageJoins[0];
        const r = j.restoration;
        if (mutation === 'missing') delete j.restoration;
        if (mutation === 'ownership') r.ownership = 'copy';
        if (mutation === 'order') r.order.reverse();
        if (mutation === 'layout') r.retained[0] = j.arms[0].to;
        if (mutation === 'arms') r.retained.reverse();
        expect(() => verifyConcreteProgram(c)).toThrow('Branch storage adapter changed');
        expect(() => emitC(c)).toThrow('Branch storage adapter changed');
    });
for (const mutation of ['missing', 'mode'] as const)
    it(`independently rejects forged deferred storage annotation ${mutation}`, () => {
        const c = concrete();
        const j = c.analysis.entries[0].values.find((v: any) => v.storageJoins).storageJoins[0];
        if (mutation === 'missing') delete j.restoration;
        else j.restoration = 'replace';
        expect(() => verifyConcreteProgram(c)).toThrow(
            'Selected storage restoration contract changed',
        );
    });
it('keeps deferred replacement of divergent storage explicit', () => {
    const source = `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match true {true -> {let old = f := fn () y
 @(x, {let old = f := fn () 9
 old()
 fn () ()})}; false -> x}}
 focus := 2}
 x}`;
    const p = typedProgram(source);
    expect(legacyReference(source)).toEqual(2);
    expect(executeTypedProgram(p)).toEqual(2);
    expect(() =>
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    ).toThrow('Deferred callable storage replacement requires a restoration adapter');
});
