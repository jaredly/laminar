import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import type { GoFunction } from '../../src/go/syntax.ts';
import { loopSelfTailCalls } from '../../src/go/tail-calls.ts';
import { expectRun } from '../backend/backends.ts';
const dual = (source: string) => `// laminar: dual\n${source}`;
const emit = (source: string) =>
    compileSource(dual(source), { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('turns a self call in tail position into a loop', () => {
    const code = emit('fn sum(n, acc) {if n == 0 then acc else sum(n - 1, acc + n)}\nsum(10, 0)');
    const body = code.slice(code.indexOf('func sum('), code.indexOf('func entry'));
    expect(body).toContain('for {');
    expect(body).toContain('n, acc = n - 1.0, acc + n');
    expect(body).toContain('continue');
    expect(body).not.toMatch(/= sum\(/);
});
it('assigns every parameter at once', () => {
    const code = emit(
        'fn fib(a, b, n) {if n == 0 then a else fib(b, a + b, n - 1)}\nfib(0, 1, 10)',
    );
    expect(code).toContain('a, b, n = b, a + b, n - 1.0');
});
it('loops a statement call in a function that returns unit', () => {
    const code = emit('fn count(n) {if n >= 3 then () else {print("x")\n count(n + 1)}}\ncount(0)');
    expect(code).toContain('for {');
    expect(code).toContain('n = n + 1.0');
});
it('leaves a call whose result is used', () => {
    const code = emit('fn sum(n) {if n == 0 then 0 else n + sum(n - 1)}\nsum(10)');
    expect(code).not.toContain('for {');
    expect(code).toContain('sum(n - 1.0)');
});
it('leaves a function whose parameter a closure or pointer could observe', () => {
    const f = (extra: string[]): GoFunction => ({
        signature: 'func f(n float64) float64',
        body: [
            'var v float64',
            {
                kind: 'if',
                arms: [
                    {
                        condition: 'n > 0',
                        body: [...extra, { kind: 'set', name: 'v', value: 'f(n - 1.0)' }],
                    },
                    { body: [{ kind: 'set', name: 'v', value: 'n' }] },
                ],
            },
            'return v',
        ],
    });
    // the control case is rewritten, so the others are skipped for their own reason
    expect(loopSelfTailCalls(f([])).body).not.toEqual(f([]).body);
    // a closure over a local only is fine: every pass declares its own
    expect(loopSelfTailCalls(f(['go func() { print(local) }()'])).body).not.toEqual(
        f(['go func() { print(local) }()']).body,
    );
    for (const extra of ['g := func() float64 { return n }', 'p := &n'])
        expect(loopSelfTailCalls(f([extra])).body).toEqual(f([extra]).body);
});
it('ignores signatures it cannot read', () => {
    const fn = { signature: 'func main()', body: ['return Unit{}'] };
    expect(loopSelfTailCalls(fn)).toBe(fn);
});

for (const [name, source, expected] of [
    ['accumulator', 'fn sum(n, acc) {if n == 0 then acc else sum(n - 1, acc + n)}\nsum(1000, 0)', 500500],
    ['swapped arguments', 'fn fib(a, b, n) {if n == 0 then a else fib(b, a + b, n - 1)}\nfib(0, 1, 20)', 6765],
    ['non-tail recursion', 'fn sum(n) {if n == 0 then 0 else n + sum(n - 1)}\nsum(100)', 5050],
] as const)
    execute(`go runs ${name}`, () => expectRun('go', dual(source), { expected }), 60000);
