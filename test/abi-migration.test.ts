import { expect, it } from 'bun:test';
import { abiMigrationSamples, enabledMilestones } from './backend/abi-migration-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of abiMigrationSamples) {
    const enabled = enabledMilestones.includes(sample.milestone);
    (enabled ? it : it.skip)(`${sample.milestone}: ${sample.name}`, () => {
        const p = typedProgram(sample.source);
        expect<unknown>(legacyReference(sample.source)).toEqual(sample.expected);
        expect<unknown>(executeTypedProgram(p)).toEqual(sample.expected);
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
}
