import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'bun:test';
import { it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { typedProgram } from '../backend/typed-program.ts';
import { lensBranchSamples } from '../backend/lens-branch-samples.ts';
import { computedAliases } from '../backend/computed-alias-samples.ts';
import { phase5Samples } from './phase5-samples.ts';
import { backendCorpus } from '../backend/corpus.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { targetConfig, wasm32Emscripten } from '../../src/backend/target.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { emitC } from '../../src/c/emit.ts';
import { buildAndRun } from '../../src/c/build.ts';
const version = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8' });
const clang = version('clang'),
    emcc = version('emcc'),
    node = version('node');
if (emcc.status === 0 && !process.env.EM_CACHE) {
    const cache = await mkdtemp(join(tmpdir(), 'laminar-emcache-'));
    const original = spawnSync('em-config', ['CACHE'], { encoding: 'utf8' }).stdout.trim();
    await cp(original, cache, { recursive: true });
    await rm(join(cache, 'build'), { recursive: true, force: true });
    process.env.EM_CACHE = cache;
    // Homebrew 6.0.5 batch builds use invalid relative source paths in a relocated cache.
    const oldBatch = process.env.EMCC_BATCH_BUILD;
    process.env.EMCC_BATCH_BUILD = '0';
    afterAll(async () => {
        delete process.env.EM_CACHE;
        if (oldBatch === undefined) delete process.env.EMCC_BATCH_BUILD;
        else process.env.EMCC_BATCH_BUILD = oldBatch;
        await rm(cache, { recursive: true });
    });
}
const macros =
    spawnSync('clang', ['-dM', '-E', '-x', 'c', '/dev/null'], { encoding: 'utf8' }).stdout ?? '';
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
const samples = [
    ...backendCorpus.filter((s) => s.phase <= 5),
    ...phase5Samples,
    ...computedAliases,
    ...lensBranchSamples,
    { name: 'lexical-alias', source: '{let x = 1\n {let y = ~x\n y := y + 1}\n x}', expected: 2 },
    { name: 'empty-swap', source: '{let x = 1\n x := x + 1}', expected: null },
    { name: 'full-swap-order', source: '{let x = 1\n (x := 2, x := 3, x)}', expected: [1, 2, 3] },
    { name: 'nested-swap-order', source: '{let x = 1\n (x := (x := 2), x)}', expected: [2, 1] },
    { name: 'double-division', source: '3 / 2', expected: 1.5 },
    { name: 'nan', source: '0 / 0', expected: { number: 'NaN' } },
    { name: 'infinity', source: '1 / 0', expected: { number: 'Infinity' } },
    { name: 'negative-zero', source: '0 / (0 - 1)', expected: { number: '-0' } },
];
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
for (const wasm of [false, true]) {
    const available = wasm ? emcc.status === 0 && node.status === 0 : clang.status === 0;
    if (!available && process.env.CI)
        throw Error(`Required backend toolchain missing: ${wasm ? 'emcc/Node' : 'clang'}`);
    if (!available)
        console.warn(`Skipping local backend execution: missing ${wasm ? 'emcc/Node' : 'clang'}`);
    for (const sample of samples)
        (available ? it : it.skip)(
            `${wasm ? 'Wasm' : 'native'}: ${sample.name}`,
            async () => {
                const p = typedProgram(sample.source);
                const c = compileConcreteProgram(
                    p,
                    wasm ? wasm32Emscripten(emcc.stdout.trim()) : native!,
                    [{ unit: p.units.at(-1)!.id, arguments: [] }],
                );
                const source = emitC(c);
                expect<unknown>(normalize(executeTypedProgram(p))).toEqual(sample.expected);
                if (!wasm)
                    expect(
                        await buildAndRun(source, {
                            compiler: 'clang',
                            sanitize: true,
                            expected: [sample.expected],
                        }),
                    ).toEqual([sample.expected]);
                for (const optimize of [false, true])
                    expect(
                        await buildAndRun(source, {
                            compiler: wasm ? 'emcc' : 'clang',
                            wasm,
                            optimize,
                            expected: [sample.expected],
                        }),
                    ).toEqual([sample.expected]);
            },
            60000,
        );
    (available ? it : it.skip)(
        `${wasm ? 'Wasm' : 'native'}: unmatched case traps`,
        async () => {
            const p = typedProgram('match 1 {2 -> 3}');
            const c = compileConcreteProgram(
                p,
                wasm ? wasm32Emscripten(emcc.stdout.trim()) : native!,
                [{ unit: p.units.at(-1)!.id, arguments: [] }],
            );
            try {
                await buildAndRun(emitC(c), { compiler: wasm ? 'emcc' : 'clang', wasm });
                throw Error('Expected runtime trap');
            } catch (error) {
                expect((error as { code?: string }).code).toBe('c-runtime');
                const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                // Expected trap artifacts have been checked; real regressions remain retained.
                await rm(directory, { recursive: true });
            }
        },
        60000,
    );
}
