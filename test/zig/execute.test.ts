import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { emitZig } from '../../src/zig/emit.ts';
import { buildAndRunZig } from '../../src/zig/build.ts';
import { zigTarget } from '../../src/zig/target.ts';
import { backendCorpus } from '../backend/corpus.ts';

// Cap concurrent compiler jobs, as the C and Go suites do.
let active = 0;
const waiting: (() => void)[] = [];
async function withBuildSlot<T>(work: () => Promise<T>): Promise<T> {
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

const zigVersion = spawnSync('zig', ['version'], { encoding: 'utf8' });
const zigAvailable = zigVersion.status === 0;
const target = zigAvailable ? zigTarget(zigVersion.stdout.trim()) : undefined;

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

const emit = (source: string) => {
    const p = typedProgram(source);
    const c = compileConcreteProgram(p, target!, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
    return { p, zig: emitZig(c) };
};

// Phase 1: scalars, records, direct calls, and arithmetic.
const phase1Samples = [
    ...backendCorpus.filter((s) =>
        ['scalar', 'tuple', 'generic-calls', 'annotated-generic', 'narrow-contract'].includes(
            s.name,
        ),
    ),
    { name: 'double-division', source: '3 / 2', expected: 1.5 },
    { name: 'nan', source: '0 / 0', expected: { number: 'NaN' } },
    { name: 'infinity', source: '1 / 0', expected: { number: 'Infinity' } },
    { name: 'negative-infinity', source: '(0 - 1) / 0', expected: { number: '-Infinity' } },
    { name: 'negative-zero', source: '0 / (0 - 1)', expected: { number: '-0' } },
    { name: 'fraction', source: '0.1 + 0.2', expected: 0.30000000000000004 },
    { name: 'nested-tuple', source: '((1, 2), (true, ()))', expected: [[1, 2], [true, null]] },
    { name: 'arithmetic-precedence', source: '1 + 2 * 3', expected: 7 },
    { name: 'comparisons', source: '(1 == 1, 1 >= 2, 2 <= 2)', expected: [true, false, true] },
    { name: 'boolean-literals', source: '(true, false)', expected: [true, false] },
    { name: 'unit', source: '()', expected: null },
    { name: 'two-argument-call', source: 'fn add(a, b) {a + b}\nadd(1, 2)', expected: 3 },
    {
        name: 'nested-calls',
        source: 'fn add(a, b) {a + b}\nfn plus3(x) add(x, 3)\nplus3(add(1, 2))',
        expected: 6,
    },
    {
        name: 'tuple-let-destructure',
        source: '{let (a, b) = (1, 2)\n a - b}',
        expected: -1,
    },
    {
        name: 'tuple-result-call',
        source: 'fn swap(p) {let (a, b) = p\n (b, a)}\nswap((1, true))',
        expected: [true, 1],
    },
    { name: 'shadowed-let', source: '{let x = 1\n {let x = x + 1\n x * 10}}', expected: 20 },
];

describe('Zig Backend Phase 1: Scalars, Records, and Direct Calls', () => {
    for (const sample of phase1Samples) {
        (zigAvailable ? it.concurrent : it.skip)(
            `Zig: ${sample.name}`,
            () =>
                withBuildSlot(async () => {
                    const { p, zig } = emit(sample.source);
                    expect(normalize(executeTypedProgram(p))).toEqual(sample.expected);
                    expect(await buildAndRunZig(zig, { expected: [sample.expected] })).toEqual([
                        sample.expected,
                    ]);
                }),
            120000,
        );
    }
});

describe('Zig Backend: later-phase features are rejected, not miscompiled', () => {
    const later = [
        { name: 'lens update', source: '{let x = 1\n x := x + 1\n x}' },
        { name: 'branch', source: 'match true {true -> 1; false -> 2}' },
    ];
    for (const sample of later) {
        (zigAvailable ? it : it.skip)(sample.name, () => {
            let error: unknown;
            try {
                emit(sample.source);
            } catch (e) {
                error = e;
            }
            expect((error as { code?: string })?.code).toBe('unsupported-zig');
        });
    }
});
