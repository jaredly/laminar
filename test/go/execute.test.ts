import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { goTarget } from '../../src/backend/target.ts';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { emitGo } from '../../src/go/emit.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { printGo } from '../../src/go/syntax.ts';
import { backendCorpus } from '../backend/corpus.ts';

// Bun schedules concurrent tests in groups; cap expensive compiler jobs at four.
let active = 0;
const waiting: (() => void)[] = [];
export async function withBuildSlot<T>(work: () => Promise<T>): Promise<T> {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
        return await work();
    } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
    }
}

const goVersionResult = spawnSync('go', ['version'], { encoding: 'utf8' });
const goAvailable = goVersionResult.status === 0;

export const goNativeTarget = goAvailable
    ? goTarget(goVersionResult.stdout.trim())
    : undefined;

const normalize = (v: unknown): unknown =>
    typeof v === 'number'
        ? Number.isNaN(v)
            ? { number: 'NaN' }
            : !Number.isFinite(v)
              ? { number: v < 0 ? '-Infinity' : 'Infinity' }
              : Object.is(v, -0)
                ? { number: '-0' }
                : v
        : Array.isArray(v)
          ? v.map(normalize)
          : v;

// Phase 1 samples: scalars, records, tuples, direct calls, and arithmetic
const phase1Corpus = backendCorpus.filter((s) =>
    ['scalar', 'tuple', 'generic-calls', 'annotated-generic', 'narrow-contract'].includes(s.name),
);

const phase1ArithmeticSamples = [
    { name: 'double-division', source: '3 / 2', expected: 1.5 },
    { name: 'nan', source: '0 / 0', expected: { number: 'NaN' } },
    { name: 'infinity', source: '1 / 0', expected: { number: 'Infinity' } },
    { name: 'negative-zero', source: '0 / (0 - 1)', expected: { number: '-0' } },
    { name: 'nested-tuple', source: '((1, 2), (true, ()))', expected: [[1, 2], [true, null]] },
    { name: 'arithmetic-precedence', source: '1 + 2 * 3', expected: 7 },
    { name: 'comparisons', source: '(1 == 1, 1 >= 2, 2 <= 2)', expected: [true, false, true] },
    { name: 'boolean-literals', source: '(true, false)', expected: [true, false] },
];

const phase1Samples = [...phase1Corpus, ...phase1ArithmeticSamples];

describe('Go Backend Execution Harness', () => {
    (goAvailable ? it : it.skip)('executes a smoke test with build slot concurrency', async () => {
        await withBuildSlot(async () => {
            const source = printGo({
                packageName: 'main',
                imports: ['fmt'],
                declarations: [],
                functions: [
                    {
                        signature: 'func main()',
                        body: ['fmt.Println("100")'],
                    },
                ],
            });

            const results = await buildAndRunGo(source, { expected: [100] });
            expect(results).toEqual([100]);
        });
    });

    (goAvailable ? it : it.skip)('detects expected runtime trap', async () => {
        await withBuildSlot(async () => {
            const source = printGo({
                packageName: 'main',
                declarations: [],
                functions: [
                    {
                        signature: 'func main()',
                        body: ['panic("unmatched case")'],
                    },
                ],
            });

            try {
                await buildAndRunGo(source);
                expect().fail('Expected runtime trap');
            } catch (error) {
                expect((error as { code?: string }).code).toBe('go-runtime');
                const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                await rm(directory, { recursive: true, force: true });
            }
        });
    });
});

describe('Go Backend Phase 1: Scalars, Records, and Direct Calls', () => {
    for (const sample of phase1Samples) {
        (goAvailable ? it.concurrent : it.skip)(
            `Go: ${sample.name}`,
            () =>
                withBuildSlot(async () => {
                    const p = typedProgram(sample.source);
                    const c = compileConcreteProgram(p, goNativeTarget!, [
                        { unit: p.units.at(-1)!.id, arguments: [] },
                    ]);
                    const source = emitGo(c);
                    expect(normalize(executeTypedProgram(p))).toEqual(sample.expected);
                    const results = await buildAndRunGo(source, {
                        expected: [sample.expected],
                    });
                    expect(results).toEqual([sample.expected]);
                }),
            30000,
        );
    }
});
