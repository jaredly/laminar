import { expect, it } from 'bun:test';
import { checkSource } from '../src/compiler.ts';
import { backendAvailable, expectRun, selectedBackends } from './backend/backends.ts';
import { ownedLensProgram } from './backend/owned-lens-programs.ts';
import { referenceRun } from './backend/reference-run.ts';

/**
 * Random owned-lens programs, with the reference evaluator as the oracle. The reference runs
 * every seed in the default range; each compiled backend builds the first few, since each
 * program is a whole build. `LAMINAR_LENS_SEEDS=1000-1400` runs another range on both, and a
 * failure names its seed, so `LAMINAR_LENS_SEEDS=29-30` reproduces seed 29 alone.
 */
function range(first: number, end: number): number[] {
    const requested = process.env.LAMINAR_LENS_SEEDS;
    if (requested) {
        const match = /^(\d+)-(\d+)$/.exec(requested);
        if (!match || Number(match[1]) >= Number(match[2]))
            throw Error(`LAMINAR_LENS_SEEDS must be <first>-<end>, not ${requested}`);
        [first, end] = [Number(match[1]), Number(match[2])];
    }
    return Array.from({ length: end - first }, (_, i) => first + i);
}

const run = (source: string) => referenceRun(checkSource(source));

/** The program travels with the failure, so it can be read without rerunning the generator. */
const explain = (seed: number, source: string, error: unknown) =>
    new Error(`Seed ${seed} failed: ${(error as Error).message}\n\n${source}`);

it('type checks and runs every generated program on the reference', () => {
    let ended = 0;
    for (const seed of range(0, 300)) {
        const source = ownedLensProgram(seed);
        try {
            ended += run(source).output.match(/^close /gm)?.length ?? 0;
        } catch (error) {
            throw explain(seed, source, error);
        }
    }
    // Guards against a generator that quietly stops making lenses.
    if (!process.env.LAMINAR_LENS_SEEDS) expect(ended).toBeGreaterThan(1000);
});

// Seeds 29 and 30 are the ones that found C reading a moved lens's freed storage.
for (const backend of selectedBackends().filter((b) => b !== 'reference'))
    for (const seed of range(0, 40))
        (backendAvailable(backend) ? it : it.skip)(
            `${backend} agrees with the reference on seed ${seed}`,
            async () => {
                const source = ownedLensProgram(seed);
                try {
                    const { output } = run(source);
                    await expectRun(backend, source, { expected: null, output });
                } catch (error) {
                    throw explain(seed, source, error);
                }
            },
            30_000,
        );
