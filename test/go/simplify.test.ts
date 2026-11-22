import { expect, it } from 'bun:test';
import { GoLocals } from '../../src/go/locals.ts';
import { printGoStatements, type Statement } from '../../src/go/syntax.ts';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
const print = (l: GoLocals, body: Statement[]) => printGoStatements(l.place(body)).join('\n');
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('collapses immutable copies while leaving the original load before effects', () => {
    const l = new GoLocals();
    const x = l.reference('snapshot'),
        a = l.reference('a'),
        b = l.reference('b');
    const body: Statement[] = [
        l.declaration(x, 'float64', 'read()'),
        l.declaration(a, 'float64', x),
        l.declaration(b, 'float64', a),
        'effect()',
        l.template`use(${b})`,
    ];
    expect(print(l, body)).toBe('snapshot := read()\neffect()\nuse(snapshot)');
});
it('retains snapshots of reassigned variables', () => {
    const l = new GoLocals();
    const x = l.reference('x'),
        old = l.reference('old');
    const body: Statement[] = [
        l.declaration(x, 'float64', 'read()'),
        l.declaration(old, 'float64', x),
        l.assign(x, 'next()'),
        l.template`use(${old})`,
    ];
    expect(print(l, body)).toContain('old := x\nx = next()\nuse(old)');
});
it('retains separate addressable cells and copies of mutable records', () => {
    const l = new GoLocals();
    const source = l.reference('source'),
        copy = l.reference('copy');
    l.mutable(source);
    const body: Statement[] = [
        l.declaration(source, 'T', 'makeRecord()'),
        l.declaration(copy, 'T', source),
        l.template`use(${l.address(copy)})`,
    ];
    expect(print(l, body)).toContain('copy := source\nuse(&copy)');
});
it('inlines pure expressions over stable values without moving their loads', () => {
    const l = new GoLocals();
    const x = l.reference('snapshot'),
        sum = l.reference('sum');
    const plus = l.binary('+', x, l.scalar('1.0', 1));
    const body: Statement[] = [
        l.declaration(x, 'float64', 'read()'),
        l.declaration(sum, 'float64', plus, { pure: true, inline: true }),
        'effect()',
        l.template`use(${sum})`,
    ];
    expect(print(l, body)).toBe('snapshot := read()\neffect()\nuse(snapshot + 1.0)');
});
it('does not move pure computations across changes to their inputs', () => {
    const l = new GoLocals();
    const x = l.reference('x'),
        sum = l.reference('sum');
    const plus = l.binary('+', x, l.scalar('1.0', 1));
    const body: Statement[] = [
        l.declaration(x, 'float64', 'read()'),
        l.declaration(sum, 'float64', plus, { pure: true, inline: true }),
        l.assign(x, 'next()'),
        l.template`use(${sum})`,
    ];
    expect(print(l, body)).toContain('sum := x + 1.0\nx = next()\nuse(sum)');
});
it('forwards an immediately consumed call result without crossing effects', () => {
    const l = new GoLocals();
    const x = l.reference('x'),
        result = l.reference('result');
    const body: Statement[] = [
        l.declaration(result, 'float64', '0.0'),
        l.declaration(x, 'float64', 'effect()'),
        l.assign(result, x),
        l.returnValue(result),
    ];
    expect(print(l, body)).toBe('result := 0.0\nresult = effect()\nreturn result');
});
it('keeps calls before intervening cleanup rather than moving them into return', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        l.declaration(x, 'float64', 'effect()'),
        'cleanup()',
        l.returnValue(x),
    ];
    expect(print(l, body)).toBe('x := effect()\ncleanup()\nreturn x');
});
it('emits direct parameter references and mixed runtime arithmetic', () => {
    const code = emit('fn inc(x) {let y = x + 1\n y}\ninc(3)');
    expect(code).toContain('return x + 1.0');
    expect(code).not.toContain('y :=');
    expect(code).not.toContain('x_2 :=');
    expect(code).not.toMatch(/v\d+ := 1\.0/);
});
it('folds literal arithmetic with double precision and omits dead operand locals', () => {
    const code = emit('9007199254740992 + 1 - 9007199254740992');
    expect(code).toContain('return 0.0');
    expect(code).not.toMatch(/v\d+ :=/);
});

for (const [name, source, expected, output] of [
    ['double rounding', '9007199254740992 + 1 - 9007199254740992', 0, ''],
    [
        'IEEE special values',
        '(1 / 0, 0 / 0, 0 / (0 - 1), (0 / 0) == (0 / 0))',
        [{ number: 'Infinity' }, { number: 'NaN' }, { number: '-0' }, false],
        '',
    ],
    [
        'constant native operands',
        '(1 / heapsize(), 0 / heapsize())',
        [{ number: 'Infinity' }, { number: 'NaN' }],
        '',
    ],
    ['overflow', `${'1' + '0'.repeat(308)} * ${'1' + '0'.repeat(308)}`, { number: 'Infinity' }, ''],
    [
        'call order',
        'fn effect(n) {print("${dup(~n)}")\n n}\n{let a = effect(1)\n let b = effect(2)\n a + b}',
        3,
        '1\n2\n',
    ],
    [
        'load before call',
        'fn change(~x) {x := 2}\nfn observe(~x) {let old = dup(~x)\n change(~x)\n old}\n{let x = 7\n let old = observe(~x)\n (old, x)}',
        [7, 2],
        '',
    ],
] as const)
    execute(
        `simplified Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output })).toEqual([expected]);
        },
        60000,
    );

it('forwards a terminal load suffix into nested aggregate returns', () => {
    const l = new GoLocals();
    const a = l.reference('a'),
        b = l.reference('b'),
        backing = l.reference('backing'),
        steps = l.reference('steps');
    const inner = l.aggregate(l.template`Pair{${b}, ${steps}}`, [b, steps]);
    const outer = l.aggregate(l.template`Pair{${a}, ${inner}}`, [a, inner]);
    expect(
        print(l, [
            l.declaration(a, 'float64', l.template`${backing}.first`, { load: true }),
            l.declaration(b, 'float64', l.template`${backing}.second`, { load: true }),
            l.returnValue(outer),
        ]),
    ).toBe('return Pair{backing.first, Pair{backing.second, steps}}');
});
it('keeps snapshot loads before cleanup and opaque return computations', () => {
    for (const cleanup of [true, false]) {
        const l = new GoLocals();
        const a = l.reference('a');
        const result = cleanup
            ? l.aggregate(l.template`Pair{${a}}`, [a])
            : l.template`effect(${a})`;
        const code = print(l, [
            l.declaration(a, 'float64', 'backing.first', { load: true }),
            ...(cleanup ? ['cleanup()'] : []),
            l.returnValue(result),
        ]);
        expect(code).toContain('a := backing.first');
    }
});
it('preserves the order of snapshot loads when return fields are reordered', () => {
    const l = new GoLocals();
    const a = l.reference('a'),
        b = l.reference('b');
    const value = l.aggregate(l.template`Pair{${b}, ${a}}`, [b, a]);
    const code = print(l, [
        l.declaration(a, 'float64', 'backing.first', { load: true }),
        l.declaration(b, 'float64', 'backing.second', { load: true }),
        l.returnValue(value),
    ]);
    expect(code).toContain('a := backing.first\nb := backing.second');
});
