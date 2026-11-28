import { expect, it } from 'bun:test';
import { checkSource } from '../src/compiler.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { backendAvailable, expectRun, selectedBackends } from './backend/backends.ts';
import { taskSamples } from './backend/task-samples.ts';

// C has no tasks.
for (const backend of selectedBackends().filter((b) => b !== 'native'))
    for (const sample of taskSamples)
        (backendAvailable(backend) ? it : it.skip)(
            `${backend} runs: ${sample.name}`,
            async () => {
                await expectRun(backend, sample.source, sample);
            },
            60_000,
        );

const run = (source: string, maxSteps?: number) =>
    executeTypedProgram(checkSource(`// laminar: dual\n${source}`), {
        maxSteps,
        stdout: () => {},
    });

it('reports a deadlock when every task waits', () => {
    expect(() => run('{let ch = chanNew()\n chanRecv(ch)}')).toThrow('Every task is blocked');
    expect(() => run('{let ch = chanNew()\n chanSend(ch, 1)}')).toThrow('Every task is blocked');
    // two tasks, each waiting for the other to go first
    expect(() =>
        run(
            '{let a = chanNew()\n let b = chanNew()\n spawn(fn () {let x = chanRecv(a)\n chanSend(b, x)})\n let y = chanRecv(b)\n chanSend(a, y)}',
        ),
    ).toThrow('Every task is blocked');
});

it('does not wait in real time to sleep', () => {
    const start = performance.now();
    expect(run('{sleep(60000)\n 1}')).toBe(1);
    expect(performance.now() - start).toBeLessThan(5000);
});

it('rejects what the Go backend rejects', () => {
    expect(() => run('spawn(fn () {1})')).toThrow('A spawned task must return ()');
    expect(() => run('fn start(mut task) {spawn(task)}\n{start(fn () {1})\n sleep(1)}')).toThrow(
        'A spawned task must return ()',
    );
});

it('limits the steps of all tasks together', () => {
    const forever = 'fn spin() {spin()}\n{spawn(fn () {spin()})\n sleep(1)}';
    expect(() => run(forever, 1000)).toThrow('step limit');
});

it('recurses further than the JavaScript stack would allow, in any task', () => {
    const count = 'fn count(n) {if n == 0 then 0 else {1 + count(n - 1)}}\n';
    expect(run(`${count}count(50000)`)).toBe(50000);
    expect(
        run(
            `${count}{let ch = chanNew()\n spawn(fn () {chanSend(ch, count(50000))})\n chanRecv(ch)}`,
        ),
    ).toBe(50000);
});
