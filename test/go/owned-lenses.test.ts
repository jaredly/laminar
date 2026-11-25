import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { backendAvailable, expectRun } from '../backend/backends.ts';
import { net } from '../backend/owned-lens-samples.ts';

const execute = process.env.LAMINAR_EXEC && backendAvailable('go') ? it : it.skip;

/** Tasks finish in any order, so each cleanup reports on a channel instead of printing. */
const reporting = `// laminar: dual
fn connection(n, closed) ~{
    lens fd <- n + 0
    chanSend(closed, dup(~fd))
}
fn double(mut ~conn) { conn := dup(~conn) * 2
    () }
`;

execute('a spawned task takes the connection and its cleanup', async () => {
    await expectRun(
        'go',
        `${reporting}{let closed = chanNew()
 let conn = ~connection(21, closed)
 spawn(fn () {double(~conn)})
 chanRecv(closed)}`,
        { expected: 42 },
    );
});

execute('an accept loop gives each connection to its own task', async () => {
    await expectRun(
        'go',
        `${reporting}fn serve(n, closed) {
    if n == 0 then () else {
        let conn = ~connection(n, closed)
        spawn(fn () {double(~conn)})
        serve(n - 1, closed)
    }
}
fn total(n, closed, sum) {if n == 0 then sum else total(n - 1, closed, sum + chanRecv(closed))}
{let closed = chanNew()
 spawn(fn () {serve(100, closed)})
 total(100, closed, 0)}`,
        { expected: 10100 },
    );
});

it('keeps the restore with the lens in emitted Go', () => {
    const code = compileSource(
        `${net}{let conn = ~connection(1)\n spawn(fn () {handle("a", ~conn)})\n sleep(1)}`,
        { target: goTarget('test') },
    ).code;
    expect(code).toContain('go func()');
    expect(code).toContain('.restore = func(');
});
