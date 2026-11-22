import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { BackendDiagnostic } from '../backend/target.ts';

export type ZigBuildOptions = {
    compiler?: string;
    mode?: 'Debug' | 'ReleaseSafe' | 'ReleaseFast';
    format?: boolean;
    expected?: unknown[];
    env?: NodeJS.ProcessEnv;
};

// Keep subprocesses asynchronous so independent builds can overlap.
function runProcess(command: string, args: string[], env = process.env, cwd?: string) {
    return new Promise<{
        stdout: string;
        stderr: string;
        status: number | null;
        signal: NodeJS.Signals | null;
        error?: Error;
    }>((resolve) => {
        execFile(
            command,
            args,
            { encoding: 'utf8', timeout: 120000, env, cwd },
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
    });
}

const versions = new Map<string, Promise<string>>();
export function getZigVersion(command = 'zig'): Promise<string> {
    let result = versions.get(command);
    if (!result) {
        result = runProcess(command, ['version']).then((r) => r.stdout.trim() || r.stderr.trim());
        versions.set(command, result);
    }
    return result;
}

/** Format, compile, and run one Zig program. Failure directories are retained. */
export async function buildAndRunZig(
    source: string,
    options: ZigBuildOptions = {},
): Promise<unknown[]> {
    const compiler = options.compiler ?? 'zig';
    const mode = options.mode ?? 'Debug';
    const directory = await mkdtemp(join(tmpdir(), 'laminar-zig-'));
    await writeFile(join(directory, 'main.zig'), source);
    await writeFile(
        join(directory, 'build.json'),
        JSON.stringify({ options, compilerVersion: await getZigVersion(compiler) }, null, 2),
    );

    const run = async (
        command: string,
        args: string[],
        stage: 'zig-fmt' | 'zig-build' | 'zig-runtime',
    ) => {
        const result = await runProcess(
            command,
            args,
            { ...process.env, ...options.env },
            directory,
        );
        if (result.error || result.status !== 0) {
            await writeFile(
                join(directory, `${stage}.json`),
                JSON.stringify({ command, args, ...result, error: result.error?.message }, null, 2),
            );
            throw new BackendDiagnostic(
                stage,
                `${command}: ${result.error?.message ?? result.stderr}\nArtifacts: ${directory}`,
            );
        }
        return result.stdout;
    };

    if (options.format !== false) await run(compiler, ['fmt', 'main.zig'], 'zig-fmt');
    await run(
        compiler,
        ['build-exe', '-lc', '-O', mode, '-femit-bin=program', 'main.zig'],
        'zig-build',
    );
    const text = await run(join(directory, 'program'), [], 'zig-runtime');

    let results: unknown[];
    try {
        results = text
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line));
    } catch (e) {
        throw new BackendDiagnostic(
            'zig-result',
            `Invalid result: ${text}\nArtifacts: ${directory}\n${e}`,
        );
    }
    if (options.expected && JSON.stringify(results) !== JSON.stringify(options.expected))
        throw new BackendDiagnostic(
            'zig-result',
            `Expected ${JSON.stringify(options.expected)}, got ${JSON.stringify(results)}\nArtifacts: ${directory}`,
        );
    await rm(directory, { recursive: true });
    return results;
}
