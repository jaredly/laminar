import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('gives capture-free bodies ordinary signatures and direct calls', () => {
    const code = emit('fn add(a, b) {a + b}\nadd(1, 2)');
    expect(code).toContain('func add(a float64, b float64) float64');
    expect(code).toContain('return add(1.0, 2.0)');
    expect(code).toContain('func entry() float64');
    expect(code).not.toContain('func add_callable');
    expect(code).not.toContain('.environment');
});
it('uses a typed ABI thunk when a capture-free function becomes a value', () => {
    const code = emit('fn inc(n) {n + 1}\nfn apply(f, x) {f(x)}\napply(inc, 2)');
    expect(code).toContain('func inc(n float64) float64');
    expect(code).toContain('func inc_callable(_ any, arg0 float64) float64');
    expect(code).toContain('return inc(arg0)');
    expect(code).toMatch(/invoke\d+: inc_callable/);
});
it('preserves opaque environments on captured closure bodies', () => {
    const code = emit('fn maker(n) {let add = fn (x) {n + x}\n add}\nmaker(2)(3)');
    expect(code).toContain('func maker(n float64)');
    expect(code).toContain('func maker_add(environment any, x float64) float64');
    expect(code).not.toContain('func maker_add_callable');
    expect(code).toContain('.environment');
});
it('keeps wrapper names distinct from source functions', () => {
    const code = emit(
        'fn inc(n) {n + 1}\nfn inc_callable(n) {n + 2}\nfn apply(f, x) {f(x)}\n(apply(inc, 2), inc_callable(2))',
    );
    expect(code).toContain('func inc_callable(n float64) float64');
    expect(code).toContain('func inc_callable_2(_ any, arg0 float64) float64');
});

for (const [name, source, expected, output] of [
    ['ordinary call', 'fn add(a, b) {a + b}\nadd(1, 2)', 3, ''],
    ['zero arguments', 'fn value() 7\nvalue()', 7, ''],
    ['generic specialization', 'fn id(x) x\n(id(1), id(true))', [1, true], ''],
    [
        'recursive ordinary calls',
        'fn down(n) {match dup(~n) {0 -> 0; _ -> down(n - 1)}}\ndown(3)',
        0,
        '',
    ],
    ['first-class function', 'fn inc(n) {n + 1}\nfn apply(f, x) {f(x)}\napply(inc, 2)', 3, ''],
    [
        'joined callable entries',
        'fn inc(n) {n + 1}\nfn twice(n) {n * 2}\nfn pick(flag) {match flag {true -> inc; false -> twice}}\n(pick(true)(3), pick(false)(3))',
        [4, 6],
        '',
    ],
    ['captured function', 'fn maker(n) {let add = fn (x) {n + x}\n add}\nmaker(2)(3)', 5, ''],
    [
        'mixed captured and ordinary entries',
        'fn inc(n) {n + 1}\nfn pick(flag, n) {match flag {true -> inc; false -> fn (x) {n + x}}}\n(pick(true, 10)(3), pick(false, 10)(3))',
        [4, 13],
        '',
    ],
    [
        'lens ABI thunk',
        'fn change(~x) {x := true}\nfn apply(f, ~x) {f(~x)}\n{let x = 1\n apply(change, ~x)\n x}',
        true,
        '',
    ],
    [
        'returned lens adapter',
        'fn pass(~x) ~x\nfn choose(flag) {match flag {true -> pass; false -> fn (~x) ~x}}\n{let x = 1\n let selected = choose(true)\n selected(~x) := 9\n x}',
        9,
        '',
    ],
    [
        'effect order',
        'fn first() {print("first")\n 1}\nfn second() {print("second")\n 2}\nfn add(a, b) {a + b}\nadd(first(), second())',
        3,
        'first\nsecond\n',
    ],
    [
        'wrapper name collision',
        'fn inc(n) {n + 1}\nfn inc_callable(n) {n + 2}\nfn apply(f, x) {f(x)}\n(apply(inc, 2), inc_callable(2))',
        [3, 4],
        '',
    ],
] as const)
    execute(
        `direct-call Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output })).toEqual([expected]);
        },
        60000,
    );
