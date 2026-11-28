/**
 * The accepted corpus on every selected backend: the shared execution samples and
 * the test cases of the `.test.lm` snapshot files. Select backends with
 * `LAMINAR_BACKENDS=reference,native,go`; by default only the typed-IR reference
 * runs, and `LAMINAR_EXEC=1` selects all of them.
 */
import { describe, expect, it } from 'bun:test';
import { samples } from './backend/execution-samples.ts';
import { vectorTraps } from './backend/vector-samples.ts';
import { corpusCases, corpusFiles, rejection } from './backend/lm-corpus.ts';
import {
    backendAvailable,
    expectRun,
    runTrap,
    selectedBackends,
    type Expectation,
} from './backend/backends.ts';
import { checkSource, compileSource, CompileError } from '../src/compiler.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { goTarget, wasm32Emscripten } from '../src/backend/target.ts';

// Compiled backends are slow; bound concurrent toolchain jobs.
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

const snapshots = corpusFiles.map((file) => ({ file, ...corpusCases(file) }));
/** Snapshot cases the checker accepts, with their expected value. */
const accepted = snapshots.flatMap(({ cases }) =>
    cases
        .filter((c) => !rejection(c.source))
        .map((c) => ({
            name: `snapshot: ${c.name}`,
            source: c.source,
            expected: c.expected
                ? c.expected.value
                : executeTypedProgram(checkSource(c.expectedSource)),
        })),
);
const corpus: ({ name: string; source: string } & Expectation)[] = [...samples, ...accepted];

for (const backend of selectedBackends()) {
    const enabled = backendAvailable(backend);
    if (!enabled) console.warn(`Skipping ${backend} corpus: toolchain missing`);
    const test = enabled ? (backend === 'reference' ? it : it.concurrent) : it.skip;
    describe(`${backend} corpus`, () => {
        for (const c of corpus)
            test(
                `${backend}: ${c.name}`,
                () => withSlot(() => expectRun(backend, c.source, c)),
                60000,
            );
        if (backend !== 'reference')
            for (const [name, source] of [
                ['unmatched case', 'match 1 {2 -> 3}'],
                ['unmatched temporary cleanup', '{let f = ~{lens 4 <- 1\n ()}\n f := 3}'],
                ...vectorTraps,
            ] as const)
                test(
                    `${backend}: ${name} traps`,
                    () =>
                        withSlot(async () =>
                            expect(await runTrap(backend, source)).toBe(
                                backend === 'go' ? 'go-runtime' : 'c-runtime',
                            ),
                        ),
                    60000,
                );
    });
}

// Without a toolchain run, still check that every case emits C and Go.
const selected = selectedBackends();
describe('emission', () => {
    for (const c of corpus)
        it(`emits C and Go: ${c.name}`, () => {
            if (!selected.includes('native'))
                compileSource(c.source, { target: wasm32Emscripten('test') });
            if (!selected.includes('go')) compileSource(c.source, { target: goTarget('test') });
        });
});

describe('negative checker results', () => {
    // Programs the checker rejects are not backend restrictions; they are kept here,
    // apart from programs it accepts but a backend cannot yet compile.
    it('classifies the snapshot corpus', () => {
        expect(
            snapshots.map(({ file, cases, rejectedDefinitions }) => ({
                file,
                accepted: cases.filter((c) => !rejection(c.source)).length,
                rejectedCases: cases.flatMap((c) => {
                    const code = rejection(c.source);
                    return code ? [`${c.name} ${code}`] : [];
                }),
                rejectedDefinitions: rejectedDefinitions.map((d) => `${d.name} ${d.code}`),
            })),
        ).toMatchSnapshot();
    });
});

/**
 * Checked programs that a backend rejects: each must pass the checker and the
 * reference, so it is a backend restriction, not a negative checker test.
 */
const backendRestrictions = [
    {
        name: 'callable entry result',
        source: 'fn (x) {x + 1}',
        c: 'unsupported-representation',
        go: 'unsupported-representation',
    },
    {
        name: 'callable inside an entry result',
        source: '(1, fn (x) {x + 1})',
        c: 'unsupported-c',
        go: 'unsupported-go',
    },
];
describe('backend restrictions', () => {
    for (const r of backendRestrictions)
        it(r.name, () => {
            expect(() => executeTypedProgram(checkSource(r.source))).not.toThrow();
            const code = (target: Parameters<typeof compileSource>[1]['target']) => {
                try {
                    compileSource(r.source, { target });
                } catch (error) {
                    return (error as CompileError).code;
                }
                return 'compiled';
            };
            expect([code(wasm32Emscripten('test')), code(goTarget('test'))]).toEqual([r.c, r.go]);
        });
    it('rejects missing host capabilities per target', () => {
        expect(() =>
            compileSource('getInput("> ")', {
                target: wasm32Emscripten('test', 'emscripten-browser'),
            }),
        ).toThrow('needs stdin');
    });
});
