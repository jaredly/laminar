import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { BackendDiagnostic } from '../backend/target.ts';

export type GoBuildOptions = {
    compiler?: string;
    gofmt?: string;
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
            { encoding: 'utf8', timeout: 60000, env, cwd },
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
export function getVersion(command: string): Promise<string> {
    let result = versions.get(command);
    if (!result) {
        result = runProcess(command, ['version']).then((r) => r.stdout.trim() || r.stderr.trim());
        versions.set(command, result);
    }
    return result;
}

/** Compilation and execution of Go programs. Temporary failure directories are retained. */
export async function buildAndRunGo(source: string, options: GoBuildOptions = {}): Promise<unknown[]> {
    const compiler = options.compiler ?? 'go';
    const gofmt = options.gofmt ?? 'gofmt';
    const directory = await mkdtemp(join(tmpdir(), 'laminar-go-'));
    const input = join(directory, 'main.go');
    const output = join(directory, 'program');

    await writeFile(input, source);

    const [compilerVersion] = await Promise.all([
        getVersion(compiler),
    ]);

    await writeFile(
        join(directory, 'build.json'),
        JSON.stringify({ options, compilerVersion }, null, 2),
    );

    const run = async (
        command: string,
        args: string[],
        stage: 'go-fmt' | 'go-build' | 'go-runtime',
    ) => {
        const env = { ...process.env, ...options.env };
        const result = await runProcess(command, args, env, directory);
        if (result.error || result.status !== 0) {
            await writeFile(
                join(directory, `${stage}.json`),
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
                `${command}: ${result.error?.message ?? result.stderr}\nArtifacts: ${directory}`,
            );
        }
        return result.stdout;
    };

    if (options.format !== false) {
        await run(gofmt, ['-w', 'main.go'], 'go-fmt');
    }

    await run(compiler, ['build', '-o', output, 'main.go'], 'go-build');
    const text = await run(output, [], 'go-runtime');

    try {
        const results = text
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line));

        if (options.expected && JSON.stringify(results) !== JSON.stringify(options.expected)) {
            throw Error(`Expected ${JSON.stringify(options.expected)}, got ${JSON.stringify(results)}`);
        }

        await rm(directory, { recursive: true });
        return results;
    } catch (e) {
        throw new BackendDiagnostic(
            'go-result',
            `Invalid result: ${text}\nArtifacts: ${directory}\n${e}`,
        );
    }
}
