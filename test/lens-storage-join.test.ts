import { specializeProgram } from '../src/specialize.ts';
import { expect, it } from 'bun:test';
import { lensStorageJoinSamples } from './backend/lens-storage-join-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of lensStorageJoinSamples)
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
    const p = typedProgram(lensStorageJoinSamples[0]!.source);
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
            if (i.storageJoins && i.lensJoin) return i;
            if (i.op === 'scope') {
                const nested = find(i.body);
                if (nested) return nested;
            }
        }
    }
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
for (const mutation of ['storage', 'lens', 'ownership', 'layout', 'arms', 'entry'] as const)
    it(`rejects forged selected lens storage ${mutation}`, () => {
        const c = concrete();
        const i = selectedCase(c);
        const join = i.storageJoins[0];
        if (mutation === 'storage') delete i.storageJoins;
        if (mutation === 'lens') delete i.lensJoin;
        if (mutation === 'ownership') join.ownership = 'copy';
        if (mutation === 'layout') join.arms[0].to = join.arms[0].from;
        if (mutation === 'arms') join.arms.reverse();
        if (mutation === 'entry') join.arms[0].entries[0].source = 'forged';
        expect(() => verifyConcreteProgram(c)).toThrow(
            mutation === 'lens'
                ? 'Selected-branch restoration adapter changed'
                : 'Branch storage adapter changed',
        );
        expect(() => emitC(c)).toThrow();
    });
it('independently rejects forged selected-lens owner provenance', () => {
    const c = concrete();
    const values = c.analysis.entries[0].values;
    const j = values.find((v: any) => v.storageJoins).storageJoins[0];
    j.result = j.result.options[0];
    expect(() => verifyConcreteProgram(c)).toThrow('Branch needs a representation adapter');
});
