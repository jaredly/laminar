import { samples } from '../backend/execution-samples.ts';
import { rm } from 'node:fs/promises';
import { it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { targetConfig } from '../../src/backend/target.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { emitC } from '../../src/c/emit.ts';
import { buildAndRun } from '../../src/c/build.ts';
// Bun schedules concurrent tests in groups; cap expensive toolchain jobs at four.
let active = 0;
const waiting: (() => void)[] = [];
async function withBuildSlot(work: () => Promise<void>) {
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
// Native builds are slow; opt in with LAMINAR_EXEC=1. Wasm would compile the same C
// through Emscripten, testing the toolchain rather than the backend, so it is not run.
const executionEnabled = !!process.env.LAMINAR_EXEC;
const skipped = { status: 1, stdout: '' } as const;
const version = (cmd: string) =>
    executionEnabled ? spawnSync(cmd, ['--version'], { encoding: 'utf8' }) : skipped;
const clang = version('clang');
const macros = executionEnabled
    ? (spawnSync('clang', ['-dM', '-E', '-x', 'c', '/dev/null'], { encoding: 'utf8' }).stdout ?? '')
    : '';
const native =
    clang.status === 0
        ? targetConfig({
              schemaVersion: 1,
              triple: spawnSync('clang', ['-dumpmachine'], { encoding: 'utf8' }).stdout.trim(),
              pointerBits:
                  Number(macros.match(/#define __SIZEOF_POINTER__ (\d+)/)?.[1]) === 4 ? 32 : 64,
              byteOrder: /#define __BYTE_ORDER__ __ORDER_BIG_ENDIAN__/.test(macros)
                  ? 'big'
                  : 'little',
              abi: 'c11',
              toolchain: { compiler: 'clang', version: clang.stdout.trim() },
              runtime: 'native',
              features: [],
          })
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
const available = clang.status === 0;
if (executionEnabled && !available && process.env.CI)
    throw Error('Required backend toolchain missing: clang');
if (executionEnabled && !available) console.warn('Skipping local backend execution: missing clang');
const compile = (source: string) => {
    const p = typedProgram(source);
    return { p, c: compileConcreteProgram(p, native!, [{ unit: p.units.at(-1)!.id, arguments: [] }]) };
};
for (const sample of samples)
    (available ? it.concurrent : it.skip)(
        `native: ${sample.name}`,
        () =>
            withBuildSlot(async () => {
                const { p, c } = compile(sample.source);
                const source = emitC(c);
                expect<unknown>(normalize(executeTypedProgram(p))).toEqual(sample.expected);
                // Sanitized -O0 checks memory and UB; plain -O2 checks optimized semantics.
                for (const options of [{ sanitize: true }, { optimize: true }])
                    expect(
                        await buildAndRun(source, {
                            compiler: 'clang',
                            ...options,
                            expected: [sample.expected],
                        }),
                    ).toEqual([sample.expected]);
            }),
        60000,
    );
for (const [name, source] of [
    ['unmatched case', 'match 1 {2 -> 3}'],
    ['unmatched temporary cleanup', '{let f = ~{lens 4 <- 1\n ()}\n f := 3}'],
])
    (available ? it.concurrent : it.skip)(
        `native: ${name} traps`,
        () =>
            withBuildSlot(async () => {
                try {
                    await buildAndRun(emitC(compile(source!).c), { compiler: 'clang' });
                    throw Error('Expected runtime trap');
                } catch (error) {
                    expect((error as { code?: string }).code).toBe('c-runtime');
                    const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                    // Expected trap artifacts have been checked; real regressions remain retained.
                    await rm(directory, { recursive: true });
                }
            }),
        60000,
    );
