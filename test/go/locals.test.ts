import { expect, it } from 'bun:test';
import { GoLocals } from '../../src/go/locals.ts';
import { printGoStatements, type Statement } from '../../src/go/syntax.ts';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';

const print = (locals: GoLocals, body: Statement[]) =>
    printGoStatements(locals.place(body)).join('\n');
it('declares ordinary values at their original sequence points', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        'before()',
        [l.declaration(x, 'float64', 'read()')],
        l.template`use(${x})`,
    ];
    expect(print(l, body)).toBe('before()\nx := read()\nuse(x)');
});
it('keeps branch-local values inside their branch', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        { head: 'if flag', body: [l.declaration(x, 'float64', 'read()'), l.template`use(${x})`] },
        'after()',
    ];
    expect(print(l, body)).toBe('if flag {\n\tx := read()\n\tuse(x)\n}\nafter()');
});
it('shares a setup cell with later restoration without moving its initializer', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        { head: 'if selected', body: [l.declaration(x, 'float64', 'read()')] },
        { head: 'restore = func()', body: [l.template`use(${x})`] },
    ];
    expect(print(l, body)).toBe(
        'var x float64\nif selected {\n\tx = read()\n}\nrestore = func() {\n\tuse(x)\n}',
    );
});
it('uses the nearest common scope rather than the whole function', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        {
            head: 'if outer',
            body: [
                { head: 'if inner', body: [l.declaration(x, 'float64', 'read()')] },
                l.template`use(${x})`,
            ],
        },
    ];
    expect(print(l, body)).toBe(
        'if outer {\n\tvar x float64\n\tif inner {\n\t\tx = read()\n\t}\n\tuse(x)\n}',
    );
});
it('lifts declarations before the entire if/else chain', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        {
            kind: 'if',
            arms: [
                { condition: 'flag', body: ['first()'] },
                { condition: 'other', body: [l.declaration(x, 'float64', 'read()')] },
                { body: ['last()'] },
            ],
        },
        l.template`use(${x})`,
    ];
    const code = print(l, body);
    expect(code).toStartWith('var x float64\nif flag');
    expect(code).toContain('} else if other {\n\tx = read()');
});
it('tracks writes and references carried through joined expressions', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        { head: 'if flag', body: [l.declaration(x, 'float64', '1.0')] },
        l.assign(x, '2.0'),
        l.template`use(${l.join([x], ', ')})`,
    ];
    expect(print(l, body)).toContain('var x float64\nif flag {\n\tx = 1.0');
});
it('puts declarations before earlier closure captures, but keeps evaluation ordered', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        { head: 'restore = func()', body: [l.template`use(${x})`] },
        'effect()',
        l.declaration(x, 'float64', 'read()'),
    ];
    expect(print(l, body)).toBe(
        'var x float64\nrestore = func() {\n\tuse(x)\n}\neffect()\nx = read()',
    );
});
it('does not infer references from text inside string literals', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        { head: 'if flag', body: [l.declaration(x, 'float64', '1.0'), l.template`use(${x})`] },
        l.template`print("x")`,
    ];
    expect(print(l, body)).toStartWith('if flag {\n\tx := 1.0');
});

it('does not treat field labels as variable references', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const body: Statement[] = [
        { head: 'if flag', body: [l.declaration(x, 'float64', '1.0'), l.template`use(${x})`] },
        l.template`use(T{${l.literal('x')}: 1.0})`,
    ];
    expect(print(l, body)).toStartWith('if flag {\n\tx := 1.0');
});

it('keeps references supplied by external expression formatters', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const formatted = l.derive(`formatNumber(${x})`, x);
    const body: Statement[] = [
        { head: 'if flag', body: [l.declaration(x, 'float64', '1.0')] },
        l.template`print(${formatted})`,
    ];
    expect(print(l, body)).toStartWith('var x float64\nif flag');
});

it('does not lose a local reference when a generated field has the same spelling', () => {
    const l = new GoLocals();
    const read0 = l.reference('read0');
    const declaration = l.declaration(read0, 'float64', 'read()');
    const field = l.template`read${0}`;
    const body: Statement[] = [
        { head: 'if flag', body: [declaration] },
        l.template`use(T{${l.literal(String(field))}: 1.0})`,
        l.template`use(${read0})`,
    ];
    expect(print(l, body)).toStartWith('var read0 float64\nif flag');
});

const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const cases = [
    ...(['true', 'false'] as const).map(
        (condition) =>
            [
                `returned type-changing lens ${condition}`,
                `fn pass(~x) ~x
fn choose(b, ~x) ~{match b {true -> pass(~x); false -> pass(~x)}}
{let x = 1
 choose(${condition}, ~x) := true
 x}`,
                true,
            ] as const,
    ),
    [
        'branch result',
        'fn pick(b) {match b {true -> {let x = 2\n x + 1}; false -> 4}}\n(pick(true), pick(false))',
        [3, 4],
    ],
    [
        'captured branch values',
        'fn make(b) {match b {true -> {let n = 2\n fn (x) {n + x}}; false -> {let n = 4\n fn (x) {n + x}}}}\n(make(true)(3), make(false)(3))',
        [5, 7],
    ],
    [
        'load before mutation',
        'fn change(~x) {x := 2}\n{let x = 1\n let saved = dup(~x)\n change(~x)\n (saved, x)}',
        [1, 2],
    ],
] as const;
for (const [name, source, expected] of cases)
    execute(
        `scoped Go: ${name}`,
        async () => {
            const { code } = compileSource(source, { target: goTarget('test') });
            expect(await buildAndRunGo(code)).toEqual([expected]);
        },
        60000,
    );

it('rewrites references inside compound expressions without rewriting literal syntax', () => {
    const l = new GoLocals();
    const read = l.reference('read');
    const value = l.template`use(${l.binary('+', read, l.scalar('1.0', 1))}, ${l.literal('value.read')}, "read")`;
    const rewritten = l.rewriteReferences(
        value,
        new Map([[read, l.access('ctx', '.', l.literal('read'))]]),
    );
    expect(String(rewritten)).toBe('use(ctx.read + 1.0, value.read, "read")');
});

it('rejects rewriting a captured reference hidden in opaque code', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const opaque = l.derive(`consume(${x})`, x);
    expect(() => l.rewriteReferences(opaque, new Map([[x, l.literal('ctx.x')]]))).toThrow(
        'Cannot rewrite references in opaque code',
    );
});
