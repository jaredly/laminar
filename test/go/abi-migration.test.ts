import { it, expect } from 'bun:test';
import { rm } from 'node:fs/promises';
import { samples } from '../backend/execution-samples.ts';
import { typedProgram } from '../backend/typed-program.ts';
import { goTarget } from '../../src/backend/target.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { emitGo } from '../../src/go/emit.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot(work: () => Promise<void>) {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
        await work();
    } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
    }
}
for (const sample of samples) {
    it.concurrent(
        `Go ABI corpus: ${sample.name}`,
        () =>
            withSlot(async () => {
                const p = typedProgram(sample.source);
                const c = compileConcreteProgram(p, goTarget('test'), [
                    { unit: p.units.at(-1)!.id, arguments: [] },
                ]);
                const source = emitGo(c);
                if (process.env.LAMINAR_EXEC)
                    expect(await buildAndRunGo(source, { expected: [sample.expected] })).toEqual([
                        sample.expected,
                    ]);
            }),
        60000,
    );
}

for (const source of ['match 1 {2 -> 3}', '{let f = ~{lens 4 <- 1\n ()}\n f := 3}']) {
    (process.env.LAMINAR_EXEC ? it.concurrent : it.skip)(
        'Go ABI corpus: expected runtime trap',
        () =>
            withSlot(async () => {
                const p = typedProgram(source);
                const c = compileConcreteProgram(p, goTarget('test'), [
                    { unit: p.units.at(-1)!.id, arguments: [] },
                ]);
                try {
                    await buildAndRunGo(emitGo(c));
                    throw Error('Expected runtime trap');
                } catch (error) {
                    expect((error as { code?: string }).code).toBe('go-runtime');
                    const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                    await rm(directory, { recursive: true });
                }
            }),
        60000,
    );
}
