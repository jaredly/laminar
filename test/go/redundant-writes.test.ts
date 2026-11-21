import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { GoLocals } from '../../src/go/locals.ts';
import { printGoStatements, type Statement } from '../../src/go/syntax.ts';
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const print = (l: GoLocals, body: Statement[]) => printGoStatements(l.place(body)).join('\n');

it('uses implicit zero initialization for fresh cells', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    expect(
        print(l, [
            l.declaration(x, 'float64', '0.0', { zeroInitial: true }),
            l.template`use(${x})`,
        ]),
    ).toBe('var x float64\nuse(x)');
});
it('retains zero resets when a cell is shared across closure invocations', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const code = print(l, [
        {
            head: 'reset := func()',
            body: [l.declaration(x, 'float64', '0.0', { zeroInitial: true }), l.assign(x, '9.0')],
        },
        l.template`use(${x})`,
    ]);
    expect(code).toStartWith('var x float64\nreset := func() {\n\tx = 0.0');
    expect(code).toContain('x = 9.0');
});
it('does not treat signed negative zero as default initialization', () => {
    const code = emit('fn keep(~x) {()}\n{let x = 0 / (0 - 1)\n keep(~x)\n x}');
    expect(code).toContain('math.Copysign(0, -1)');
});
it('omits unchanged incoming lens restoration', () => {
    const code = emit(
        'fn observe(~(a, b)) {dup(~a) + dup(~b)}\n{let p = (1, 2)\n (observe(~p), p)}',
    );
    expect(code).not.toMatch(/^\s*(\*[^\n]+) = \1$/m);
});
it('retains writes to changed owners', () => {
    const code = emit('fn change(~x) {x := 9}\n{let x = 1\n change(~x)\n x}');
    expect(code).toMatch(/\.read = /);
});
it('uses freshly zeroed backing fields without separate zero writes', () => {
    const code = emit('fn change(~x) {x := true}\n{let x = 0\n change(~x)\n x}');
    expect(code).not.toMatch(/\.write\d+ = false/);
    expect(code).not.toMatch(/\.read\d+ = 0\.0/);
});

for (const [name, source, expected, output] of [
    [
        'unchanged thin',
        'fn observe(~(a, b)) {dup(~a) + dup(~b)}\n{let p = (1, 2)\n (observe(~p), p)}',
        [3, [1, 2]],
        '',
    ],
    [
        'unchanged scattered',
        'fn observe(~(a, b)) {dup(~a) + dup(~b)}\n{let a = 1\n let b = 2\n (observe(~(a, b)), (a, b))}',
        [3, [1, 2]],
        '',
    ],
    ['changed owner', 'fn change(~x) {x := 9}\n{let x = 1\n change(~x)\n x}', 9, ''],
    [
        'type changing replacement',
        'fn change(~x) {x := true}\n{let x = 1\n change(~x)\n x}',
        true,
        '',
    ],
    [
        'untouched field after call',
        'fn change(~x) {x := 9}\nfn observe(~(a, b)) {change(~a)\n dup(~b)}\n{let p = (1, 2)\n (observe(~p), p)}',
        [2, [9, 2]],
        '',
    ],
    [
        'snapshot restored after change',
        'fn change(~x) {let old = dup(~x)\n x := 9\n x := old}\n{let x = 1\n change(~x)\n x}',
        1,
        '',
    ],
    [
        'manual cleanup',
        '{let x = 1\n let old = dup(~{@(x, fn () {print("cleanup")})})\n (old, x)}',
        [1, 1],
        'cleanup\n',
    ],
    [
        'repeated type changing calls',
        'fn change(~x) {x := true}\n{let x = 1\n change(~x)\n let y = 2\n change(~y)\n (x, y)}',
        [true, true],
        '',
    ],
] as const)
    execute(
        `redundant-write Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output })).toEqual([expected]);
        },
        60000,
    );
