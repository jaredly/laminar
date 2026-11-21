import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const bump = 'fn bump(~x) {x := dup(~x) + 1}\n';
const bumpPair = 'fn bumpPair(~(a, b)) {a := dup(~a) + 1\n b := dup(~b) + 2}\n';

it('forwards an unchanged aggregate lens rather than reconstructing its fields', () => {
    const code = emit(
        'fn sum(~(a, b)) {dup(~a) + dup(~b)}\nfn forward(~(a, b)) {sum(~(a, b))}\n{let a = 1\n let b = 2\n forward(~(a, b))}',
    );
    expect(code).toMatch(/sum\([A-Za-z_]\w*\)/);
});
it('reuses backing across sequential homogeneous calls', () => {
    const code = emit(bump + '{let x = 0\n bump(~x)\n bump(~x)\n x}');
    expect(code.match(/type Backing_[A-Za-z_0-9]+ struct/g)).toHaveLength(1);
    expect(code.match(/bump\(.*&back0\.read0/g)).toHaveLength(2);
    expect(code).toContain('return back0.read0');
});
it('keeps a whole tuple in its existing backing after a call', () => {
    const code = emit(bumpPair + '{let p = (1, 2)\n bumpPair(~p)\n bumpPair(~p)\n p}');
    expect(code.match(/type Backing_[A-Za-z_0-9]+ struct/g)).toHaveLength(1);
    expect(code).toMatch(/return back\d+\.read0/);
});
it('retains separate typed backing for type-changing calls', () => {
    const code = emit('fn change(~x) {x := true}\n{let x = 1\n change(~x)\n x}');
    expect(code).toContain('replacement: &');
    expect(code).toMatch(/write\d+ bool/);
});
it('retains allocated staging for escaping lens results', () => {
    const code = emit('fn pass(~x) ~x\n{let x = 1\n pass(~x) := 9\n x}');
    expect(code).toMatch(/new\(Backing_[A-Za-z_0-9]+\)/);
});

for (const [name, source, expected, output] of [
    [
        'reordered lens endpoints',
        'fn digits(~(a, b)) {10 * dup(~a) + dup(~b)}\nfn forward(~(a, b)) {digits(~(b, a))}\n{let a = 1\n let b = 2\n forward(~(a, b))}',
        21,
        '',
    ],
    ['sequential scalar calls', bump + '{let x = 0\n bump(~x)\n bump(~x)\n x}', 2, ''],
    [
        'whole tuple backing',
        bumpPair + '{let p = (1, 2)\n bumpPair(~p)\n bumpPair(~p)\n p}',
        [3, 6],
        '',
    ],
    [
        'scattered tuple backing',
        bumpPair + '{let a = 1\n let b = 2\n bumpPair(~(a, b))\n bumpPair(~(a, b))\n (a, b)}',
        [3, 6],
        '',
    ],
    [
        'scalar snapshot before reuse',
        bump + '{let x = 0\n bump(~x)\n let old = dup(~x)\n bump(~x)\n (old, x)}',
        [1, 2],
        '',
    ],
    [
        'tuple snapshot before reuse',
        bumpPair + '{let p = (1, 2)\n bumpPair(~p)\n let old = dup(~p)\n bumpPair(~p)\n (old, p)}',
        [
            [2, 4],
            [3, 6],
        ],
        '',
    ],
    [
        'moved owner before reuse',
        bump + '{let x = 0\n bump(~x)\n let old = x\n x := 10\n bump(~x)\n (old, x)}',
        [1, 11],
        '',
    ],
    [
        'mixed live and detached fields',
        bumpPair +
            'fn work(~(a, b)) {a := 10\n bumpPair(~(a, b))\n bumpPair(~(a, b))}\n{let p = (1, 2)\n work(~p)\n p}',
        [12, 6],
        '',
    ],
    [
        'branch join true',
        bump + '{let x = 0\n match true {true -> bump(~x); false -> 0}\n bump(~x)\n x}',
        2,
        '',
    ],
    [
        'branch join false',
        bump + '{let x = 0\n match false {true -> bump(~x); false -> 0}\n bump(~x)\n x}',
        1,
        '',
    ],
    [
        'partial projection after reuse',
        bump + '{let p = (1, 2)\n {let (a, b) = ~p\n bump(~a)\n bump(~b)\n bump(~a)}\n p}',
        [3, 3],
        '',
    ],
    [
        'type change before homogeneous reuse',
        bump + 'fn change(~x) {x := 5}\n{let x = false\n change(~x)\n bump(~x)\n bump(~x)\n x}',
        7,
        '',
    ],
    [
        'returned lens restoration',
        bump + 'fn pass(~x) ~x\n{let x = 0\n bump(~x)\n pass(~x) := 9\n bump(~x)\n x}',
        10,
        '',
    ],
    [
        'manual restoration order',
        bump + '{let x = 0\n bump(~{@(x, fn () {print("cleanup")})})\n bump(~x)\n x}',
        2,
        'cleanup\n',
    ],
    [
        'indirect callable',
        bump + 'fn apply(f, ~x) {f(~x)}\n{let x = 0\n apply(bump, ~x)\n apply(bump, ~x)\n x}',
        2,
        '',
    ],
] as const)
    execute(
        `lens staging Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output })).toEqual([expected]);
        },
        60000,
    );
