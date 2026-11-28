import { expect, it } from 'bun:test';
import { CompileError, checkSource } from '../src/compiler.ts';

/**
 * What typed channels accept. A channel's type says what kind of function it carries. Where
 * only the receiver's code says, it carries must-call functions if that code allows it, so
 * most of these try to lose, copy or reuse one.
 */
const check = (source: string) => {
    try {
        checkSource(source);
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
    return 'ok';
};

const P = `// laminar: dual
fn connection(n) ~{
    lens fd <- n + 0
    print("close \${dup(~fd)}")
}
fn handle(mut ~conn) { () }
type linear Conn {
    Conn(Number)
}
fn finish(mut c) { match c { mut Conn(fd) -> closeHandle(fd) } }
type Box(a) {
    Box(a)
}
`;
/** A body that has queued one connection-owning job on `jobs`. */
const queued = (rest: string) => `{
    let jobs = chanNew()
    let conn = ~connection(1)
    spawn(fn () { chanSend(jobs, fn () { handle(~conn) }) })
    ${rest}
}`;
const cases: [name: string, expected: string, body: string][] = [
    // a receiver in the same body
    ['receive and call', 'ok', queued('let mut job = chanRecv(jobs)\n job()')],
    ['receive and discard with _', 'linear-unconsumed', queued('let _ = chanRecv(jobs)\n 0')],
    ['receive as a bare statement', 'linear-unconsumed', queued('chanRecv(jobs)\n 0')],
    ['receive and never call', 'linear-unconsumed', queued('let mut job = chanRecv(jobs)\n 0')],
    ['receive into a plain binding', 'linear-plain', queued('let job = chanRecv(jobs)\n job()')],
    ['call twice', 'use-after-move', queued('let mut job = chanRecv(jobs)\n job()\n job()')],
    [
        'call in one branch only',
        'linear-unconsumed',
        queued('let mut job = chanRecv(jobs)\n if true then job() else ()'),
    ],
    [
        'wrap in a closure that is dropped',
        'linear-unconsumed',
        queued('let mut job = chanRecv(jobs)\n let mut later = fn () { job() }\n 0'),
    ],
    [
        'hold without calling, in a dropped closure',
        'linear-unconsumed',
        queued('let mut job = chanRecv(jobs)\n let mut later = fn () { job }\n 0'),
    ],
    // a worker defined on its own, before anything is known about the jobs
    [
        'worker that calls each job',
        'ok',
        `fn work(jobs) { let mut job = chanRecv(jobs)\n job()\n work(jobs) }\n${queued('work(jobs)')}`,
    ],
    [
        'worker that drops one',
        'linear-unconsumed',
        `fn work(jobs) { let mut job = chanRecv(jobs)\n work(jobs) }\n${queued('work(jobs)')}`,
    ],
    [
        'worker that discards with _',
        'linear-unconsumed',
        `fn work(jobs) { let _ = chanRecv(jobs)\n work(jobs) }\n${queued('work(jobs)')}`,
    ],
    [
        'worker that copies a job',
        'linear-unconsumed',
        `fn work(jobs) { let job = chanRecv(jobs)\n (job, job) }\n${queued('work(jobs)')}`,
    ],
    [
        // It may drop a job, so its channel carries no job that must be called.
        'worker that calls it only sometimes',
        'linear-closure-mismatch',
        `fn work(jobs, run) { let mut job = chanRecv(jobs)\n if run then job() else () }\n${queued('work(jobs, false)')}`,
    ],
    [
        'generic forwarder',
        'ok',
        `fn forward(from, to) { chanSend(to, chanRecv(from)) }\n${queued('let other = chanNew()\n spawn(fn () { forward(jobs, other) })\n let mut job = chanRecv(other)\n job()')}`,
    ],
    [
        'forwarded, then discarded',
        'linear-unconsumed',
        `fn forward(from, to) { chanSend(to, chanRecv(from)) }\n${queued('let other = chanNew()\n spawn(fn () { forward(jobs, other) })\n let _ = chanRecv(other)\n 0')}`,
    ],
    // sending
    [
        'use a closure after sending it',
        'use-after-move',
        '{let jobs = chanNew()\n let mut f = fn () { () }\n chanSend(jobs, f)\n f()}',
    ],
    [
        'send an ordinary closure after a linear one',
        'ok',
        queued(
            'spawn(fn () { chanSend(jobs, fn () { () }) })\n let mut a = chanRecv(jobs)\n a()\n let mut b = chanRecv(jobs)\n b()',
        ),
    ],
    [
        'enqueue through a function',
        'ok',
        'fn enqueue(jobs, mut task) { chanSend(jobs, task) }\n{let jobs = chanNew()\n let conn = ~connection(1)\n spawn(fn () { enqueue(jobs, fn () { handle(~conn) }) })\n let mut job = chanRecv(jobs)\n job()}',
    ],
    [
        'an ordinary closure through the same function',
        'ok',
        'fn enqueue(jobs, mut task) { chanSend(jobs, task) }\n{let jobs = chanNew()\n spawn(fn () { enqueue(jobs, fn () { () }) })\n let mut job = chanRecv(jobs)\n job()}',
    ],
    [
        'capture a borrowed lens in a job',
        'borrowed-capture',
        '{let jobs = chanNew()\n let mut n = 1\n chanSend(jobs, fn () { print("${dup(~n)}") })}',
    ],
    // a function only later known to be one-use, passed first to something that may drop it
    [
        'maybe-dropped, then sent: an ordinary closure is fine',
        'ok',
        'fn maybe(mut t) { if false then t() else () }\nfn g(c, jobs, mut task) { if c then maybe(task) else chanSend(jobs, task) }\n0',
    ],
    [
        '...but it refuses a job that must run',
        'linear-unconsumed',
        'fn maybe(mut t) { if false then t() else () }\nfn g(c, jobs, mut task) { if c then maybe(task) else chanSend(jobs, task) }\n{let jobs = chanNew()\n let conn = ~connection(1)\n g(true, jobs, fn () { handle(~conn) })}',
    ],
    [
        '...and one received from a channel',
        'linear-closure-mismatch',
        'fn maybe(mut t) { if false then t() else () }\nfn g(c, jobs, mut task) { if c then maybe(task) else chanSend(jobs, task) }\n' +
            queued('let mut job = chanRecv(jobs)\n g(true, jobs, job)'),
    ],
    [
        'sent, then maybe-dropped',
        'ok',
        'fn maybe(mut t) { if false then t() else () }\nfn g(c, jobs, mut task) { if c then chanSend(jobs, task) else maybe(task) }\n0',
    ],
    [
        'maybe-dropped, parameter received later',
        'ok',
        'fn maybe(mut t) { if false then t() else () }\nfn g(jobs, c) { let mut job = chanRecv(jobs)\n maybe(job)\n if c then chanSend(jobs, fn () { () }) else () }\n0',
    ],
    [
        'received, then handed to a known function that drops it',
        'linear-closure-mismatch',
        'fn maybe(mut t) { if false then t() else () }\n' +
            queued('let mut job = chanRecv(jobs)\n maybe(job)'),
    ],
    [
        'two generic steps, the second one drops',
        'linear-unconsumed',
        'fn lose(mut x) { 0 }\nfn pass(ch) { let mut x = chanRecv(ch)\n lose(x) }\n' +
            queued('pass(jobs)'),
    ],
    [
        'generic that loses what it receives',
        'linear-unconsumed',
        'fn pass(ch) { let _ = chanRecv(ch)\n 0 }\n' + queued('pass(jobs)'),
    ],
    [
        'generic checked first, instantiated at a linear value',
        'linear-unconsumed',
        'fn pass(ch) { let _ = chanRecv(ch)\n 0 }\n{let ch = chanNew()\n spawn(fn () { chanSend(ch, Conn(1)) })\n pass(ch)}',
    ],
    [
        'dropped by a local function',
        'linear-unconsumed',
        queued(
            'let mut maybe = fn (mut t) { if false then t() else () }\n let mut job = chanRecv(jobs)\n maybe(job)',
        ),
    ],
    // inside data
    [
        'boxed job discarded',
        'linear-unconsumed',
        '{let jobs = chanNew()\n spawn(fn () { chanSend(jobs, Box(fn () { () })) })\n let _ = chanRecv(jobs)\n 0}',
    ],
    [
        'job in a pair, discarded',
        'linear-unconsumed',
        '{let jobs = chanNew()\n spawn(fn () { chanSend(jobs, (fn () { () }, 1)) })\n let mut (_, n) = chanRecv(jobs)\n n}',
    ],
    [
        'job in a pair, called',
        'ok',
        '{let jobs = chanNew()\n spawn(fn () { chanSend(jobs, (fn () { () }, 1)) })\n let mut (job, n) = chanRecv(jobs)\n job()\n n}',
    ],
    // linear data, not functions
    [
        'send a linear value and finish it',
        'ok',
        '{let ch = chanNew()\n spawn(fn () { chanSend(ch, Conn(1)) })\n let mut c = chanRecv(ch)\n finish(c)}',
    ],
    [
        'send a linear value and lose it',
        'linear-unconsumed',
        '{let ch = chanNew()\n spawn(fn () { chanSend(ch, Conn(1)) })\n let _ = chanRecv(ch)\n 0}',
    ],
    [
        'a channel of linear values is itself shared',
        'ok',
        'fn put(ch) { chanSend(ch, Conn(1)) }\n{let ch = chanNew()\n spawn(fn () { put(ch) })\n spawn(fn () { put(ch) })\n let mut a = chanRecv(ch)\n finish(a)\n let mut b = chanRecv(ch)\n finish(b)}',
    ],
    // plain bindings and types
    [
        'send a plain linear binding',
        'linear-plain',
        '{let ch = chanNew()\n let c = Conn(1)\n chanSend(ch, c)}',
    ],
    [
        'generic sender of a plain value, used at a linear type',
        'dup-linear',
        'fn put(ch, v) { chanSend(ch, v) }\n{let ch = chanNew()\n let mut c = Conn(1)\n put(ch, c)}',
    ],
    [
        'send plain scalars',
        'ok',
        'fn f(ch, n, s) { chanSend(ch, (n + 0, "x"))\n chanSend(s, n)\n chanSend(ch, (n, "y")) }\n0',
    ],
    [
        'send a plain vector, and keep it',
        'ok',
        '{let ch = chanNew()\n let v = [:1:]\n spawn(fn () { chanSend(ch, v) })\n let mut got = chanRecv(ch)\n got[0] := 2\n (dup(~got[0]), v)}',
    ],
    ['send a plain value of unknown type', 'ok', 'fn f(ch, v) { chanSend(ch, v) }\n0'],
    [
        'one channel, two types',
        'type-mismatch',
        '{let ch = chanNew()\n chanSend(ch, 1)\n chanSend(ch, "x")}',
    ],
    ['a number is not a channel', 'type-mismatch', '{chanRecv(1)}'],
    [
        'declared channel type',
        'ok',
        'f :: (mut Chan(Number)) => ()\nfn f(mut ch) { chanSend(ch, 1) }\n0',
    ],
    [
        'chanSend taken as a value',
        'ok',
        '{let ch = chanNew()\n let mut put = chanSend\n spawn(fn () { put(ch, 1) })\n chanRecv(ch)}',
    ],
    [
        'channel of jobs named in a data type',
        'ok',
        'type Pool {\n    Pool(Chan(() => ()))\n}\n{let mut p = Pool(chanNew())\n match p {Pool(jobs) -> {spawn(fn () { chanSend(jobs, fn () { () }) })\n let mut job = chanRecv(jobs)\n job()}}}',
    ],
    [
        '...and a job from it dropped',
        'linear-unconsumed',
        'type Pool {\n    Pool(Chan(linear () => ()))\n}\nfn lose(mut p) {match p {Pool(jobs) -> {let mut job = chanRecv(jobs)\n ()}}}\n0',
    ],
    [
        'channel of jobs in a signature',
        'ok',
        'work :: (mut Chan(() => ())) => ()\nfn work(mut jobs) { let mut job = chanRecv(jobs)\n job() }\n0',
    ],
    // names that bind a value and then leave it
    [
        'a match arm that ignores a job',
        'linear-unconsumed',
        queued('match chanRecv(jobs) { mut job -> 0 }'),
    ],
    [
        'a match arm that ignores a linear value',
        'linear-unconsumed',
        '{let mut c = Conn(1)\n match c { mut x -> 0 }}',
    ],
    [
        'a generic local left behind',
        'linear-unconsumed',
        'fn lose(mut x) { let mut y = x\n 0 }\n{let mut c = Conn(1)\n lose(c)}',
    ],
    [
        'a generic match name left behind',
        'linear-unconsumed',
        'fn lose(mut x) { match x { mut y -> 0 } }\n{let mut c = Conn(1)\n lose(c)}',
    ],
];
for (const [name, expected, body] of cases)
    it(`${expected}: ${name}`, () => {
        expect(check(P + body)).toBe(expected);
    });
