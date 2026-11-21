import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { compileSource } from '../../src/compiler.ts';
import { detectTarget } from '../../src/backend/host.ts';
import { goTarget, type TargetConfig } from '../../src/backend/target.ts';
import { buildAndRun } from '../../src/c/build.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { checkSource } from '../../src/compiler.ts';
import { referenceRun } from './reference-run.ts';

/**
 * Execution backends for the shared corpus. Select them explicitly with
 * `LAMINAR_BACKENDS=reference,native,go`. Without it, the typed-IR reference always
 * runs, and `LAMINAR_EXEC=1` adds every compiled backend. Wasm is not a corpus
 * backend: it builds the same C as native through Emscripten.
 */
export type BackendName = 'reference' | 'native' | 'go';
export const backendNames: readonly BackendName[] = ['reference', 'native', 'go'];

export function selectedBackends(env = process.env): BackendName[] {
    const requested = env.LAMINAR_BACKENDS?.split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    if (!requested) return env.LAMINAR_EXEC ? [...backendNames] : ['reference'];
    for (const name of requested)
        if (!backendNames.includes(name as BackendName))
            throw Error(`Unknown backend ${name}; expected ${backendNames.join(', ')}`);
    return requested as BackendName[];
}

const available = (command: string, args: string[]) =>
    spawnSync(command, args, { encoding: 'utf8' }).status === 0;
/** Whether a backend's toolchain exists here. In CI a selected but missing toolchain is a failure. */
export function backendAvailable(name: BackendName): boolean {
    const present =
        name === 'reference' ||
        (name === 'native' ? available('clang', ['--version']) : available('go', ['version']));
    if (!present && process.env.CI) throw Error(`Required backend toolchain missing for ${name}`);
    return present;
}

/** The result protocol spells non-finite numbers and negative zero as objects. */
export const normalize = (v: unknown): unknown =>
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

const targets = new Map<BackendName, TargetConfig>();
const targetFor = (name: 'native' | 'go') => {
    let target = targets.get(name);
    if (!target) {
        target =
            name === 'native'
                ? detectTarget('native')
                : goTarget(spawnSync('go', ['version'], { encoding: 'utf8' }).stdout.trim());
        targets.set(name, target);
    }
    return target;
};

export type Expectation = { expected: unknown; stdin?: string; output?: string };

/**
 * Run one program on a backend and check its result and host output. Native builds
 * twice: at -O0 under ASan/UBSan, and at -O2.
 */
export async function expectRun(name: BackendName, source: string, e: Expectation): Promise<void> {
    const output = e.output ?? '';
    if (name === 'reference') {
        const run = referenceRun(checkSource(source), e.stdin);
        const actual = JSON.stringify(normalize(run.result));
        if (actual !== JSON.stringify(e.expected))
            throw Error(`Reference result ${actual}, expected ${JSON.stringify(e.expected)}`);
        if (run.output !== output)
            throw Error(
                `Reference output ${JSON.stringify(run.output)}, expected ${JSON.stringify(output)}`,
            );
        return;
    }
    const { code } = compileSource(source, { target: targetFor(name) });
    const options = { expected: [e.expected], stdin: e.stdin, output };
    if (name === 'go') await buildAndRunGo(code, options);
    else
        for (const build of [{ sanitize: true }, { optimize: true }])
            await buildAndRun(code, { compiler: 'clang', ...build, ...options });
}

/** Build and run a program that must trap; returns the runtime failure code. */
export async function runTrap(name: 'native' | 'go', source: string): Promise<string | undefined> {
    const { code } = compileSource(source, { target: targetFor(name) });
    try {
        if (name === 'go') await buildAndRunGo(code);
        else await buildAndRun(code, { compiler: 'clang' });
    } catch (error) {
        const failure = error as { code?: string; message: string };
        // Expected trap artifacts have been checked; unexpected failures keep theirs.
        const directory = failure.message.match(/Artifacts: (.+)/)?.[1];
        if (directory && failure.code?.endsWith('-runtime'))
            await rm(directory, { recursive: true, force: true });
        return failure.code;
    }
    return undefined;
}
