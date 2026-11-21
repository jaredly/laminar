import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { BackendDiagnostic } from '../backend/target.ts';
import { parseRun } from '../backend/protocol.ts';
export type BuildOptions = {
    compiler: string;
    wasm?: boolean;
    node?: string;
    optimize?: boolean;
    sanitize?: boolean;
    expected?: unknown[];
    /** Text supplied on the program's stdin. */
    stdin?: string;
    /** Exact host output expected besides the result lines. */
    output?: string;
};
// Keep subprocesses asynchronous so independent builds can overlap.
function runProcess(command: string, args: string[], env = process.env, input = '') {
    return new Promise<{
        stdout: string;
        stderr: string;
        status: number | null;
        signal: NodeJS.Signals | null;
        error?: Error;
    }>((resolve) => {
        const child = execFile(
            command,
            args,
            { encoding: 'utf8', timeout: 60000, env },
            (error, stdout, stderr) => {
                resolve({
                    stdout,
                    stderr,
                    status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
                    signal: error?.signal ?? null,
                    error: error && typeof error.code !== 'number' ? error : undefined,
                });
            },
        );
        child.stdin?.end(input);
    });
}
const versions = new Map<string, Promise<string>>();
function version(command: string): Promise<string> {
    let result = versions.get(command);
    if (!result) {
        result = runProcess(command, ['--version']).then((result) => result.stdout);
        versions.set(command, result);
    }
    return result;
}
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
    const [compilerVersion, runtimeVersion] = await Promise.all([
        version(options.compiler),
        options.wasm ? version(options.node ?? 'node') : undefined,
    ]);
    await writeFile(
        join(directory, 'build.json'),
        JSON.stringify({ options, args, compilerVersion, runtimeVersion }, null, 2),
    );
    const run = async (
        command: string,
        args: string[],
        stage: 'c-build' | 'c-runtime',
        input = '',
    ) => {
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
        const result = await runProcess(command, args, env, input);
        if (result.error || result.status !== 0) {
            await writeFile(
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
    await run(options.compiler, args, 'c-build');
    const text = options.wasm
        ? await run(options.node ?? 'node', [output], 'c-runtime', options.stdin)
        : await run(output, [], 'c-runtime', options.stdin);
    try {
        const { results, output } = parseRun(text);
        if (options.expected && JSON.stringify(results) !== JSON.stringify(options.expected))
            throw Error(`Expected ${JSON.stringify(options.expected)}`);
        if (options.output !== undefined && output !== options.output)
            throw Error(`Expected output ${JSON.stringify(options.output)}`);
        await rm(directory, { recursive: true });
        return results;
    } catch (e) {
        throw new BackendDiagnostic(
            'c-result',
            `Invalid result: ${text}\nArtifacts: ${directory}\n${e}`,
        );
    }
}
