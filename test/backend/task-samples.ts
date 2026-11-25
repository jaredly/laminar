/**
 * Programs with tasks. Each one's result does not depend on the order tasks run in, so the
 * reference, which tries one order, and Go, which does not fix one, must agree.
 */
const dual = (source: string) => `// laminar: dual\n${source}`;

/** Tasks finish in any order, so each cleanup reports on a channel instead of printing. */
const reporting = `fn connection(n, closed) ~{
    lens fd <- n + 0
    chanSend(closed, dup(~fd))
}
fn double(mut ~conn) { conn := dup(~conn) * 2
    () }
`;

export type TaskSample = { name: string; source: string; expected: unknown; output?: string };

const cases: [string, string, unknown, string?][] = [
    [
        'a task answers over a channel',
        '{let ch = chanNew()\n spawn(fn () {chanSend(ch, 42)})\n chanRecv(ch)}',
        42,
        '',
    ],
    [
        'many tasks, one reply each',
        'fn ask(ch, n) {if n == 0 then () else {spawn(fn () {chanSend(ch, n)})\n ask(ch, n - 1)}}\nfn total(ch, n, acc) {if n == 0 then acc else total(ch, n - 1, acc + chanRecv(ch))}\n{let ch = chanNew()\n ask(ch, 50)\n total(ch, 50, 0)}',
        1275,
        '',
    ],
    [
        'a task that owns its state',
        // the counter task owns `count`; requests and replies are the only way in
        'fn counter(requests, count) {let reply = chanRecv(requests)\n chanSend(reply, count + 1)\n counter(requests, count + 1)}\nfn next(requests) {let reply = chanNew()\n chanSend(requests, reply)\n chanRecv(reply)}\n{let requests = chanNew()\n spawn(fn () {counter(requests, 0)})\n (next(requests), next(requests), next(requests))}',
        [1, 2, 3],
        '',
    ],
    [
        'sleep lets other tasks run',
        '{let ch = chanNew()\n spawn(fn () {sleep(30)\n chanSend(ch, 2)})\n spawn(fn () {chanSend(ch, 1)})\n (chanRecv(ch), chanRecv(ch))}',
        [1, 2],
        '',
    ],
    [
        'a spawned task takes a connection and its cleanup',
        `${reporting}{let closed = chanNew()
 let conn = ~connection(21, closed)
 spawn(fn () {double(~conn)})
 chanRecv(closed)}`,
        42,
    ],
    [
        'an accept loop gives each connection to its own task',
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
        10100,
    ],
    [
        'the program ends while a task still waits',
        '{let ch = chanNew()\n spawn(fn () {let _ = chanRecv(ch)\n print("never")})\n sleep(5)\n 7}',
        7,
    ],
    [
        'tasks wake in the order of their sleeps',
        'fn later(ms, ch) {sleep(dup(ms))\n chanSend(ch, ms)}\n{let ch = chanNew()\n spawn(fn () {later(60, ch)})\n spawn(fn () {later(20, ch)})\n spawn(fn () {later(40, ch)})\n (chanRecv(ch), chanRecv(ch), chanRecv(ch))}',
        [20, 40, 60],
    ],
    [
        'a sender waits until someone receives',
        '{let ch = chanNew()\n let done = chanNew()\n spawn(fn () {chanSend(ch, 1)\n print("sent")\n chanSend(done, 2)})\n sleep(20)\n print("receiving")\n let a = chanRecv(ch)\n (a, chanRecv(done))}',
        [1, 2],
        'receiving\nsent\n',
    ],
];

export const taskSamples: TaskSample[] = cases.map(([name, source, expected, output]) => ({
    name,
    source: dual(source),
    expected,
    output: output ?? '',
}));
