import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { GoLocals } from '../../src/go/locals.ts';
import { printGoStatements } from '../../src/go/syntax.ts';
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

for (const flag of ['a', 'b'])
    execute(
        `string switch restores selected lens: ${flag}`,
        async () => {
            const source = `{let x = 1
 let count = 0
 {let focus = ~{match "${flag}" {"a" -> {lens finalFocus <- x\nx := finalFocus\n{count := count + 1}}; _ -> {lens finalFocus <- x\nx := finalFocus\n{count := count + 10}}}}
 focus := true}
 (x, count)}`;
            const code = emit(source);
            expect(code).toContain('switch ');
            expect(await buildAndRunGo(code)).toEqual([[true, flag === 'a' ? 1 : 10]]);
        },
        60000,
    );

it('uses if/else for exhaustive Booleans in either order', () => {
    for (const arms of ['true -> 1; false -> 2', 'false -> 2; true -> 1']) {
        const code = emit(`fn choose(flag) {match flag {${arms}}}\n choose(true)`);
        expect(code).not.toContain('== true');
        expect(code).not.toContain('== false');
        expect(code).not.toContain('unmatched case');
        expect(code).toContain('} else {');
    }
});
it('uses string switches with a default wildcard', () => {
    const code = emit('fn choose(s) {match s {"a" -> 1; "b" -> 2; _ -> 3}}\n choose("b")');
    expect(code).toContain('switch s');
    expect(code).toContain('case "a":');
    expect(code).toContain('default:');
    expect(code).not.toContain('else if true');
    expect(code).not.toContain('unmatched case');
});
it('switches on dynamic union tags with irrefutable payloads', () => {
    const code = emit('fn choose(x) {match x {Some(n) -> n; None -> 0}}\n choose(Some(2))');
    expect(code).toMatch(/switch .*\.tag/);
    expect(code).not.toContain('unmatched case');
});
it('keeps guarded payload matches ordered', () => {
    const code = emit(
        'fn choose(x) {match x {Some(1) -> 10; Some(n) -> n; None -> 0}}\n choose(Some(2))',
    );
    expect(code).not.toContain('switch ');
    expect(code).toContain('else if');
});
it('keeps duplicate string patterns ordered', () => {
    const code = emit('fn choose(s) {match s {"a" -> 1; "a" -> 2; _ -> 3}}\n choose("a")');
    expect(code).not.toContain('switch ');
    expect(code).not.toContain('else if true');
});
it('hoists shared switch cells before the selector', () => {
    const l = new GoLocals();
    const x = l.reference('x');
    const code = printGoStatements(
        l.place([
            {
                kind: 'switch',
                subject: 'flag',
                cases: [
                    { label: 'true', body: [l.declaration(x, 'float64', 'read()')] },
                    { body: [l.template`use(${x})`] },
                ],
            },
            l.template`use(${x})`,
        ]),
    ).join('\n');
    expect(code).toStartWith('var x float64\nswitch flag');
    expect(code).toContain('x = read()');
});

for (const [name, source, expected, output] of [
    [
        'boolean false first',
        'fn choose(x) {match x {false -> 2; true -> 1}}\n (choose(true), choose(false))',
        [1, 2],
        '',
    ],
    [
        'strings',
        'fn choose(s) {match s {"a" -> 1; "b" -> 2; _ -> 3}}\n (choose("a"), choose("b"), choose("c"))',
        [1, 2, 3],
        '',
    ],
    [
        'union payload',
        'fn choose(x) {match x {Some(n) -> n; None -> 0}}\n (choose(Some(2)), choose(None))',
        [2, 0],
        '',
    ],
    [
        'payload guards',
        'fn choose(x) {match x {Some(1) -> 10; Some(n) -> n; None -> 0}}\n (choose(Some(1)), choose(Some(2)), choose(None))',
        [10, 2, 0],
        '',
    ],
    [
        'duplicate strings',
        'fn choose(s) {match s {"a" -> 1; "a" -> 2; _ -> 3}}\n choose("a")',
        1,
        '',
    ],
    [
        'ordered effects',
        'fn choose(s) {match s {"a" -> {print("a")\n 1}; _ -> {print("fallback")\n 2}}}\n choose("a")',
        1,
        'a\n',
    ],
    [
        'cleanup after match',
        '{let x = true\n let r = match dup(~{{lens finalFocus <- x\nx := finalFocus\n{print("cleanup")}}}) {true -> 1; false -> 2}\n r}',
        1,
        'cleanup\n',
    ],
] as const)
    execute(
        `control-flow Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output })).toEqual([expected]);
        },
        60000,
    );
for (const source of [
    'fn choose(s) {match s {"a" -> 1}}\n choose("b")',
    'fn choose(b) {match b {true -> 1}}\n choose(false)',
    'fn choose(x) {match x {Some(n) -> n}}\n choose(None)',
])
    execute(
        'retains partial-match traps',
        async () => {
            await expect(buildAndRunGo(emit(source))).rejects.toMatchObject({ code: 'go-runtime' });
        },
        60000,
    );
