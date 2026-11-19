import { specializeProgram } from '../src/specialize.ts';
import { expect, it } from 'bun:test';
import { aggregateJoinSamples } from './backend/aggregate-join-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of aggregateJoinSamples)
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
    const p = typedProgram(aggregateJoinSamples[0]!.source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
for (const mutation of [
    'missing',
    'ownership',
    'source',
    'destination',
    'order',
    'callable',
    'entry',
] as const)
    it(`rejects forged aggregate join ${mutation}`, () => {
        const c = concrete();
        function find(block: any): any {
            for (const i of block.instructions) {
                if (i.aggregateJoin) return i;
                if (i.op === 'scope') {
                    const found = find(i.body);
                    if (found) return found;
                }
            }
        }
        const instruction = c.code.map((code: any) => find(code.body)).find(Boolean);
        const join = instruction.aggregateJoin;
        const root = join.arms[0];
        const callable = root.items[0].items[0];
        if (mutation === 'missing') delete instruction.aggregateJoin;
        if (mutation === 'ownership') join.ownership = 'copy';
        if (mutation === 'source') root.from = 'forged-layout';
        if (mutation === 'destination') callable.to = 'forged-layout';
        if (mutation === 'order') root.items.reverse();
        if (mutation === 'callable') callable.callable = 'forged';
        if (mutation === 'entry') callable.entries[0].source = 'forged';
        expect(() => verifyConcreteProgram(c)).toThrow('Aggregate join adapter changed');
        expect(() => emitC(c)).toThrow('Aggregate join adapter changed');
    });
it('rejects forged aggregate join member provenance independently', () => {
    const c = concrete();
    const joined = c.analysis.entries[0].values.find(
        (v: any) =>
            v.representation.kind === 'aggregate' &&
            v.representation.items[0].kind === 'aggregate' &&
            v.representation.items[0].items[0].kind === 'callable-choice',
    );
    joined.representation.items[0].items[0] = joined.representation.items[0].items[0].options[0];
    expect(() => verifyConcreteProgram(c)).toThrow('Branch needs a representation adapter');
});
