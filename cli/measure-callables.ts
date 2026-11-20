/** Compare generated code across compiler checkouts using one frozen corpus. */
import { samples } from '../test/backend/execution-samples.ts';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
const run = promisify(execFile);
const root = resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? '.');
const objects = process.argv.includes('--objects');
const load = (file: string) => import(pathToFileURL(join(root, file)).href);
const { typedProgram } = await load('test/backend/typed-program.ts');
const { compileConcreteProgram } = await load('src/lower-concrete.ts');
const { emitC } = await load('src/c/emit.ts');
const { wasm32Emscripten } = await load('src/backend/target.ts');
const corpusHash = createHash('sha256').update(JSON.stringify(samples)).digest('hex');
const clangVersion = objects
    ? (await run('clang', ['--version'])).stdout.split('\n')[0]
    : undefined;
const directory = await mkdtemp(join(tmpdir(), 'laminar-code-size-'));
const rows: any[] = [];
try {
    // Bounded compiler jobs keep object measurements reproducible without saturation.
    let next = 0;
    await Promise.all(
        Array.from({ length: objects ? 4 : 1 }, async () => {
            while (next < samples.length) {
                const index = next++,
                    sample = samples[index]!;
                try {
                    const p = typedProgram(sample.source);
                    const c = compileConcreteProgram(p, wasm32Emscripten('measurement'), [
                        { unit: p.units.at(-1)!.id, arguments: [] },
                    ]);
                    const source = emitC(c);
                    const row: any = {
                        index,
                        name: sample.name,
                        cBytes: Buffer.byteLength(source),
                        codeBodies: c.code.length,
                        wrappers: c.wrappers.length,
                        callableEntries: c.callables.reduce(
                            (n: number, r: any) => n + r.entries.length,
                            0,
                        ),
                    };
                    if (objects) {
                        const input = join(directory, `${index}.c`),
                            output = join(directory, `${index}.o`);
                        await writeFile(input, source);
                        await run('clang', ['-std=c11', '-O2', '-c', input, '-o', output]);
                        row.objectBytes = (await stat(output)).size;
                    }
                    rows.push(row);
                } catch (error) {
                    rows.push({ index, name: sample.name, error: String(error) });
                }
            }
        }),
    );
    rows.sort((a, b) => a.index - b.index);
    process.stdout.write(
        JSON.stringify(
            {
                schemaVersion: 1,
                compiler: root,
                corpusHash,
                clangVersion,
                objects,
                target: 'wasm32 C; host clang -O2 objects',
                samples: rows,
            },
            null,
            2,
        ) + '\n',
    );
} finally {
    await rm(directory, { recursive: true });
}
