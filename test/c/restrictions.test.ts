import { it, expect } from 'bun:test';
import { typedProgram } from '../backend/typed-program.ts';
import { backendCorpus } from '../backend/corpus.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { emitC } from '../../src/c/emit.ts';
for (const sample of backendCorpus.filter((s) => s.phase > 4 && s.phase < 7))
    it(`diagnoses later-phase ${sample.name}`, () => {
        const p = typedProgram(sample.source);
        const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        expect(() => emitC(c)).toThrow(/phase 5|phase 6|later backend phase|Native import/);
    });
it('rejects corrupted concrete IR before emission', () => {
    const p = typedProgram('1');
    const c = structuredClone(
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    );
    c.code[0]!.body.layout = 'forged';
    expect(() => emitC(c)).toThrow();
});
