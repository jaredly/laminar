import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';

const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('does not materialize unused pure values or their dependencies', () => {
    const code = emit('{let dead = (12345, 6 / 0)\n 7}');
    expect(code).not.toContain('12345');
    expect(code).not.toContain(' / ');
    expect(code).not.toMatch(/(?:\bvar v\d+\b|\bv\d+ :=)/);
    expect(code).not.toMatch(/^\s*_ = /m);
});

it('does not demand a discarded match scrutinee or constructor payload', () => {
    const code = emit('match [12345, 67890] {_ -> 7}');
    expect(code).not.toContain('12345');
    expect(code).not.toContain('67890');
    expect(code).not.toContain(' = new(');
    expect(code).not.toMatch(/^\s*_ = /m);
});

it('keeps unused calls as statements without result locals, including unit entries', () => {
    const code = emit(
        'fn effect() {print("before")\n 8}\n{let unused = effect()\n print("after")}',
    );
    expect(code).not.toMatch(/^\s*_ = /m);
    expect(code).not.toMatch(/\bunused(?:_\d+)? (?:=|:=) effect\(/);
    expect(code).not.toMatch(/\bvar result\d+\b/);
    expect(code).toContain('"before"');
    expect(code).toContain('"after"');
});

const forwarding =
    'fn inc(~x) {x := dup(~x) + 1}\nfn twice(~x) {inc(~x)\n inc(~x)}\n{let x = 1\n twice(~x)\n x}';
it('reborrows compatible incoming storage without private backing or copy-back cells', () => {
    const code = emit(forwarding);
    // Only the owned entry value needs call backing. Both calls inside twice
    // reborrow the incoming address, rather than staging another private copy.
    expect(code.match(/^type Backing\d+ struct/gm)).toHaveLength(1);
    expect(code).not.toMatch(/^\s*_ = /m);
});

for (const [name, source, expected, output] of [
    ['discarded division', '{let dead = 1 / 0\n 7}', 7, ''],
    [
        'effect order',
        'fn effect() {print("before")\n 8}\n{let unused = effect()\n print("after")\n 7}',
        7,
        'before\nafter\n',
    ],
    ['unit entry', 'print("unit")', null, 'unit\n'],
    ['tuple of units', '((), ())', [null, null], ''],
    [
        'load before mutation',
        'fn change(~x) {x := 2}\n{let x = 1\n let saved = dup(~x)\n change(~x)\n (saved, x)}',
        [1, 2],
        '',
    ],
    [
        'load before branch writes',
        'fn choose(b, ~x) {match b {true -> x := 2; false -> x := 3}}\n{let x = 1\n let old = choose(true, ~x)\n (old, x)}',
        [1, 2],
        '',
    ],
    ['forwarded writes', forwarding, 3, ''],
    ['type-changing backing', 'fn change(~x) {x := true}\n{let x = 1\n change(~x)\n x}', true, ''],
    [
        'runtime floating arithmetic',
        '(1 / 0, 0 / 0, 0 / (0 - 1))',
        [{ number: 'Infinity' }, { number: 'NaN' }, { number: '-0' }],
        '',
    ],
    ['boxed constructor sequencing', '[1, 2, 3]', [1, 2, 3], ''],
] as const) {
    execute(
        `demand-driven Go: ${name}`,
        async () => {
            const code = emit(source);
            expect(code).not.toMatch(/^\s*_ = /m);
            expect(await buildAndRunGo(code, { output })).toEqual([expected]);
        },
        60000,
    );
}

execute(
    'preserves a trap in a call whose result is discarded',
    async () => {
        const source = 'fn fail(x) {match x {2 -> 3}}\n{let unused = fail(1)\n 7}';
        await expect(buildAndRunGo(emit(source))).rejects.toMatchObject({ code: 'go-runtime' });
    },
    60000,
);
