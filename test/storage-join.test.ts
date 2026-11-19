import { specializeProgram } from '../src/specialize.ts';
import { expect, it } from 'bun:test';
import { storageJoinSamples } from './backend/storage-join-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of storageJoinSamples)
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

function concrete(source = storageJoinSamples[0]!.source) {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
function storageCase(c: any): any {
    function find(block: any): any {
        for (const i of block.instructions) {
            if (i.storageJoins) return i;
            if (i.op === 'scope') {
                const nested = find(i.body);
                if (nested) return nested;
            }
        }
    }
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
for (const mutation of [
    'missing',
    'place',
    'ownership',
    'source-layout',
    'target-layout',
    'entry',
    'arms',
] as const)
    it(`rejects forged branch storage adapter ${mutation}`, () => {
        const c = concrete();
        const instruction = storageCase(c);
        const j = instruction.storageJoins[0];
        const a = j.arms[0];
        if (mutation === 'missing') delete instruction.storageJoins;
        if (mutation === 'place') j.place = 'forged';
        if (mutation === 'ownership') j.ownership = 'copy';
        if (mutation === 'source-layout') a.from = 'forged-layout';
        if (mutation === 'target-layout') a.to = 'forged-layout';
        if (mutation === 'entry') a.entries[0].source = 'forged';
        if (mutation === 'arms') j.arms.reverse();
        expect(() => verifyConcreteProgram(c)).toThrow('Branch storage adapter changed');
        expect(() => emitC(c)).toThrow('Branch storage adapter changed');
    });
for (const mutation of ['missing', 'place', 'arms', 'result', 'continuation'] as const)
    it(`independently rejects forged branch storage provenance ${mutation}`, () => {
        const c = concrete();
        const values = c.analysis.entries[0].values;
        const annotation = values.find((v: any) => v.storageJoins);
        const j = annotation.storageJoins[0];
        if (mutation === 'missing') delete annotation.storageJoins;
        if (mutation === 'place') j.place = 'forged';
        if (mutation === 'arms') j.arms.reverse();
        if (mutation === 'result') j.result = j.result.options[0];
        if (mutation === 'continuation') {
            const moved = values
                .filter((v: any) => v.representation.kind === 'callable-choice')
                .at(-1);
            moved.representation = moved.representation.options[0];
        }
        expect(() => verifyConcreteProgram(c)).toThrow();
        expect(() => emitC(c)).toThrow();
    });
