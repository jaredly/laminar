import { it, expect } from 'bun:test';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { emitC } from '../../src/c/emit.ts';
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
