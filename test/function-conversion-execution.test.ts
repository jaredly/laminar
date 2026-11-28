import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { buildCompiled, compileSource } from '../src/compiler.ts';
import { detectTarget } from '../src/backend/host.ts';
import { backendAvailable, expectRun, selectedBackends } from './backend/backends.ts';
import { conversionSamples } from './backend/conversion-samples.ts';

describe('converted functions run', () => {
    for (const backend of selectedBackends().filter(backendAvailable))
        it.each(conversionSamples)(
            `${backend}: $name`,
            async ({ source, expected }) => {
                await expectRun(backend, source, { expected });
            },
            120_000,
        );
});

/** Two tasks each receive the same reusable function, copy it, and call the copies. */
const sharedAcrossTasks = `// laminar: dual
fn counted(n) { fn () { dup(n) + 1 } }
deliver :: (Chan(() => mut Number), () => mut Number) => ()
fn deliver(jobs, job) {
    chanSend(jobs, dup(job))
    chanSend(jobs, job)
}
work :: (Chan(() => mut Number), Chan(Number)) => ()
fn work(jobs, done) {
    let mut job = chanRecv(jobs)
    let mut again = dup(~job)
    chanSend(done, job() + again())
}
fn go() {
    let jobs = chanNew()
    let done = chanNew()
    let job = counted(1)
    spawn(fn () { work(jobs, done) })
    spawn(fn () { work(jobs, done) })
    deliver(jobs, job)
    chanRecv(done) + chanRecv(done)
}
go()`;

describe('reusable functions sent between tasks', () => {
    it.skipIf(!process.env.LAMINAR_EXEC)(
        'do not race, by the Go race detector',
        () => {
            const config = detectTarget('go');
            const built = buildCompiled(compileSource(sharedAcrossTasks, { target: config }), config);
            const run = spawnSync('go', ['run', '-race', 'main.go'], {
                cwd: built.directory,
                encoding: 'utf8',
            });
            expect([run.status, run.stderr]).toEqual([0, '']);
            expect(run.stdout).toContain('8');
            rmSync(built.directory, { recursive: true, force: true });
        },
        120_000,
    );
});
