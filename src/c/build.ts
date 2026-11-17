import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BackendDiagnostic } from '../backend/target.ts';
export type BuildOptions = {
    compiler: string;
    wasm?: boolean;
    node?: string;
    optimize?: boolean;
    sanitize?: boolean;
    expected?: unknown[];
};
/** Compilation and execution are separate from emission. Failure directories are retained. */
export async function buildAndRun(source: string, options: BuildOptions): Promise<unknown[]> {
    const directory = await mkdtemp(join(tmpdir(), 'laminar-c-'));
    const input = join(directory, 'program.c'),
        output = join(directory, options.wasm ? 'program.js' : 'program');
    const args = [
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-pedantic',
        options.optimize ? '-O2' : '-O0',
        input,
        '-o',
        output,
        '-lm',
    ];
    if (options.sanitize)
        args.push(
            '-fsanitize=address,undefined',
            '-fno-omit-frame-pointer',
            '-fno-sanitize-recover=all',
        );
    if (options.wasm) args.push('-sENVIRONMENT=node', '-sEXIT_RUNTIME=1', '-sASSERTIONS=1');
    await writeFile(input, source);
    const compilerVersion = spawnSync(options.compiler, ['--version'], { encoding: 'utf8' }).stdout;
    const runtimeVersion = options.wasm
        ? spawnSync(options.node ?? 'node', ['--version'], { encoding: 'utf8' }).stdout
        : undefined;
    await writeFile(
        join(directory, 'build.json'),
        JSON.stringify({ options, args, compilerVersion, runtimeVersion }, null, 2),
    );
    const run = (command: string, args: string[], stage: 'c-build' | 'c-runtime') => {
        const env = { ...process.env };
        if (options.sanitize)
            env.ASAN_OPTIONS = [env.ASAN_OPTIONS, 'detect_stack_use_after_return=1']
                .filter(Boolean)
                .join(':');
        // Host SDK include injection breaks Emscripten and bypasses native system-header treatment.
        delete env.CPATH;
        delete env.C_INCLUDE_PATH;
        delete env.CPLUS_INCLUDE_PATH;
        if (options.wasm) delete env.SDKROOT;
        const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, env });
        if (result.error || result.status !== 0) {
            writeFileSync(
                join(directory, stage + '.json'),
                JSON.stringify(
                    {
                        command,
                        args,
                        status: result.status,
                        signal: result.signal,
                        stdout: result.stdout,
                        stderr: result.stderr,
                    },
                    null,
                    2,
                ),
            );
            throw new BackendDiagnostic(
                stage,
                `${command}: ${result.error ?? result.stderr}\nArtifacts: ${directory}`,
            );
        }
        return result.stdout;
    };
    run(options.compiler, args, 'c-build');
    const text = options.wasm
        ? run(options.node ?? 'node', [output], 'c-runtime')
        : run(output, [], 'c-runtime');
    try {
        const results = text
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        if (options.expected && JSON.stringify(results) !== JSON.stringify(options.expected))
            throw Error(`Expected ${JSON.stringify(options.expected)}`);
        await rm(directory, { recursive: true });
        return results;
    } catch (e) {
        throw new BackendDiagnostic(
            'c-result',
            `Invalid result: ${text}\nArtifacts: ${directory}\n${e}`,
        );
    }
}
