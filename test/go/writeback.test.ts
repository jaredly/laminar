import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { printGo, type Statement } from '../../src/go/syntax.ts';
import { lowerWritebacks, type PendingJoin } from '../../src/go/writeback.ts';
import { expression, type Data } from '../../src/go/storage.ts';
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const update =
    'fn update(flag, ~(a, b)) {match flag {true -> {a := 3\n b := 4\n ()}; false -> {a := 5\n b := 6\n ()}}}\n';

it('writes terminal joins in the arms without scalar phi locals', () => {
    const code = emit(update + '{let p = (1, 2)\n update(true, ~p)\n p}');
    expect(code).not.toMatch(/var v\d+ float64/);
    expect(code).toContain('= 3.0, 4.0');
    expect(code).toContain('= 5.0, 6.0');
});
it('retains ordinary joins when a later effect intervenes', () => {
    const code = emit(
        'fn update(flag, ~x) {match flag {true -> {x := 3\n ()}; false -> {x := 5\n ()}}\n print("after")}\n{let x = 1\n update(true, ~x)\n x}',
    );
    expect(code).toMatch(/var v\d+ float64/);
});
it('retains ordinary joins when their value is read after the branch', () => {
    const code = emit(
        'fn update(flag, ~x) {match flag {true -> {x := 3\n ()}; false -> {x := 5\n ()}}\n dup(~x)}\n{let x = 1\n (update(true, ~x), x)}',
    );
    expect(code).toMatch(/var v\d+ float64/);
});

// This tests the write-back mechanism below the source ownership restrictions:
// different endpoints can alias, and an unchanged endpoint must not be discarded
// from a mixed parallel assignment when another endpoint could overwrite it.
execute(
    'preserves parallel-copy semantics with aliased endpoints',
    async () => {
        const arm: Statement[] = [];
        const boundary: Statement[] = [{ head: 'if true', body: arm }];
        const at: Statement[] = [];
        const group = { boundary };
        const p: Data = { expression: 'phi0', key: 'phi0', layout: 'number' };
        const q: Data = { expression: 'phi1', key: 'phi1', layout: 'number' };
        const pending = new WeakMap<object, PendingJoin>();
        pending.set(p, {
            group,
            materialized: false,
            inputs: () => [{ body: arm, data: { expression: '2.0', layout: 'number' } }],
        });
        pending.set(q, {
            group,
            materialized: false,
            inputs: () => [
                { body: arm, data: { expression: '*q', address: 'q', layout: 'number' } },
            ],
        });
        const body: Statement[] = ['x := 1.0', 'p, q := &x, &x', boundary, at, 'fmt.Println(x)'];
        lowerWritebacks(
            body,
            [
                {
                    body: at,
                    destinations: () => [
                        { pointer: 'p', layout: 'number', data: p },
                        { pointer: 'q', layout: 'number', data: q },
                    ],
                    fallback: () => {
                        throw Error('Unexpected fallback');
                    },
                },
            ],
            pending,
            (d) => expression((d as Exclude<Data, Data[]>).expression),
            (p, v) => `${p.map((p) => '*' + p).join(', ')} = ${v.join(', ')}`,
        );
        expect(
            await buildAndRunGo(
                printGo({ imports: ['fmt'], functions: [{ signature: 'func main()', body }] }),
            ),
        ).toEqual([1]);
    },
    60000,
);

for (const [name, source, expected, output] of [
    ['thin true', update + '{let p = (1, 2)\n update(true, ~p)\n p}', [3, 4], ''],
    ['thin false', update + '{let p = (1, 2)\n update(false, ~p)\n p}', [5, 6], ''],
    [
        'scattered true',
        update + '{let a = 1\n let b = 2\n update(true, ~(a, b))\n (a, b)}',
        [3, 4],
        '',
    ],
    [
        'scattered false',
        update + '{let a = 1\n let b = 2\n update(false, ~(a, b))\n (a, b)}',
        [5, 6],
        '',
    ],
    [
        'swap',
        'fn swap(flag, ~(a, b)) {match flag {true -> {let old = dup(~a)\n a := dup(~b)\n b := old\n ()}; false -> ()}}\n{let p = (1, 2)\n swap(true, ~p)\n p}',
        [2, 1],
        '',
    ],
    [
        'unchanged arm',
        'fn update(flag, ~x) {match flag {true -> {x := 3\n ()}; false -> ()}}\n{let x = 1\n update(false, ~x)\n x}',
        1,
        '',
    ],
    [
        'read after join',
        'fn update(flag, ~x) {match flag {true -> {x := 3\n ()}; false -> {x := 5\n ()}}\n dup(~x)}\n{let x = 1\n (update(true, ~x), x)}',
        [3, 3],
        '',
    ],
    [
        'effect barrier',
        'fn update(flag, ~x) {match flag {true -> {x := 3\n ()}; false -> {x := 5\n ()}}\n print("after")}\n{let x = 1\n update(true, ~x)\n x}',
        3,
        'after\n',
    ],
    [
        'nested branches',
        'fn update(a, b, ~x) {match a {true -> match b {true -> {x := 3\n ()}; false -> {x := 4\n ()}}; false -> {x := 5\n ()}}}\n{let x = 1\n update(true, false, ~x)\n x}',
        4,
        '',
    ],
    [
        'type change',
        'fn update(flag, ~x) {match flag {true -> {x := true\n ()}; false -> {x := false\n ()}}}\n{let x = 1\n update(true, ~x)\n x}',
        true,
        '',
    ],
    [
        'cleanup reads joined owner',
        'fn update(flag, ~x) {let cleanup = ~{@(x, fn () {print("${dup(~x)}")})}\n match flag {true -> {cleanup := 3\n ()}; false -> {cleanup := 5\n ()}}}\n{let x = 1\n update(true, ~x)\n x}',
        3,
        '3\n',
    ],
] as const)
    execute(
        `write-back Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output })).toEqual([expected]);
        },
        60000,
    );

execute(
    'materializes later fallback reads before promoting earlier stores',
    async () => {
        const arm: Statement[] = [],
            declarations: Statement[] = [];
        const boundary: Statement[] = [{ head: 'if true', body: arm }];
        const early: Statement[] = [],
            late: Statement[] = [];
        const group = { boundary };
        const pending = new WeakMap<object, PendingJoin>();
        const changed: Data = {
            key: 'changed',
            layout: 'number',
            expression: () => {
                pending.get(changed)!.materialized = true;
                declarations.push('var changed float64');
                arm.push('changed = 2.0');
                return 'changed';
            },
        };
        const old: Data = {
            key: 'old',
            layout: 'number',
            expression: () => {
                pending.get(old)!.materialized = true;
                declarations.push('var old float64');
                arm.push('old = *p');
                return 'old';
            },
        };
        pending.set(changed, {
            group,
            materialized: false,
            inputs: () => [{ body: arm, data: { expression: '2.0', layout: 'number' } }],
        });
        pending.set(old, {
            group,
            materialized: false,
            inputs: () => [
                { body: arm, data: { expression: '*p', address: 'p', layout: 'number' } },
            ],
        });
        const read = (d: Data) => expression((d as Exclude<Data, Data[]>).expression);
        const body: Statement[] = [
            'x, z := 1.0, 0.0',
            'p := &x',
            declarations,
            boundary,
            early,
            'barrier()',
            late,
            'fmt.Printf("[%g,%g]\\n", x, z)',
        ];
        lowerWritebacks(
            body,
            [
                {
                    body: early,
                    destinations: () => [{ pointer: 'p', layout: 'number', data: changed }],
                    fallback: () => early.push(`*p = ${read(changed)}`),
                },
                {
                    body: late,
                    destinations: () => [{ pointer: '&z', layout: 'number', data: old }],
                    fallback: () => late.push(`z = ${read(old)}`),
                },
            ],
            pending,
            read,
            (p, v) => `${p.map((p) => '*' + p).join(', ')} = ${v.join(', ')}`,
        );
        expect(
            await buildAndRunGo(
                printGo({
                    imports: ['fmt'],
                    functions: [
                        { signature: 'func barrier()', body: [] },
                        { signature: 'func main()', body },
                    ],
                }),
            ),
        ).toEqual([[2, 1]]);
    },
    60000,
);

it('requires every retained cleanup occurrence to have a terminal join', () => {
    const arm: Statement[] = [],
        at: Statement[] = [];
    const boundary: Statement[] = [{ head: 'if selected', body: arm }];
    const group = { boundary };
    const data: Data = { expression: 'phi', key: 'phi', layout: 'number' };
    const pending = new WeakMap<object, PendingJoin>();
    pending.set(data, {
        group,
        materialized: false,
        inputs: () => [{ body: arm, data: { expression: '2.0', layout: 'number' } }],
    });
    const body: Statement[] = [
        { head: 'if outer', body: [boundary, 'effect()', at] },
        { head: 'else', body: [boundary, at] },
    ];
    lowerWritebacks(
        body,
        [
            {
                body: at,
                destinations: () => [{ pointer: 'p', layout: 'number', data }],
                fallback: () => at.push('fallback()'),
            },
        ],
        pending,
        (d) => expression((d as Exclude<Data, Data[]>).expression),
        () => 'promoted()',
    );
    expect(arm).toEqual([]);
    expect(at).toEqual(['fallback()']);
});
