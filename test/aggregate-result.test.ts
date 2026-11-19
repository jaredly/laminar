import { specializeProgram } from '../src/specialize.ts';
import { expect, it } from 'bun:test';
import { aggregateResultSamples } from './backend/aggregate-result-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of aggregateResultSamples)
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

function concrete() {
    const p = typedProgram(aggregateResultSamples[0]!.source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
for (const mutation of [
    'source',
    'ownership',
    'read-layout',
    'result-layout',
    'member-order',
    'callable',
    'entry',
] as const)
    it(`rejects forged aggregate result ${mutation}`, () => {
        const c = concrete();
        const w = c.wrappers.find((w: any) => w.kind === 'adapt-aggregate-result');
        const callable = w.adapter.items[0].items[0];
        if (mutation === 'source') w.source = w.id;
        if (mutation === 'ownership') w.ownership = 'copy-result';
        if (mutation === 'read-layout') w.adapter.from = 'forged-layout';
        if (mutation === 'result-layout') callable.to = 'forged-layout';
        if (mutation === 'member-order') w.adapter.items.reverse();
        if (mutation === 'callable') callable.callable = 'forged';
        if (mutation === 'entry') callable.entries[0].source = 'forged';
        expect(() => verifyConcreteProgram(c)).toThrow(
            mutation === 'source' || mutation === 'ownership'
                ? 'Invalid aggregate result transfer adapter'
                : 'Aggregate result adapter changed',
        );
        expect(() => emitC(c)).toThrow();
    });
it('independently rejects forged dynamic aggregate member alternatives', () => {
    const c = concrete();
    const call = c.analysis.entries[0].calls.find((call: any) => call.result.kind === 'aggregate');
    const annotation = c.analysis.entries[0].values.find((v: any) => v.value === call.value);
    const result = structuredClone(call.result);
    result.items[0].items[0] = result.items[0].items[0].options[0];
    annotation.representation = result;
    call.result = result;
    expect(() => verifyConcreteProgram(c)).toThrow('Branch needs a representation adapter');
});
