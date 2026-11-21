import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
const emit = (source: string) => compileSource(source, { target: goTarget('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const effect = 'fn effect(n) {print("${dup(~n)}")\n n}\n';
const pure = [
    ['tuple binding', '{let (a, _) = (1, charList("discarded"))\n a}'],
    [
        'nested tuple binding',
        '{let ((a, _), _) = ((1, charList("discarded")), charList("discarded"))\n a}',
    ],
    ['whole tuple move', '{let p = (1, charList("discarded"))\n let (a, _) = p\n a}'],
    ['tuple duplication', '{let p = (1, charList("discarded"))\n let (a, _) = dup(~p)\n a}'],
    ['tuple pattern', 'match (1, charList("discarded")) {(a, _) -> a}'],
    ['tuple literal guard', 'match (1, charList("discarded")) {(1, _) -> 1; _ -> 0}'],
    [
        'constructor payload',
        'match Some((1, charList("discarded"))) {Some((a, _)) -> a; None -> 0}',
    ],
    [
        'constructor move',
        '{let box = Some((1, charList("discarded")))\n match box {Some((a, _)) -> a; None -> 0}}',
    ],
    [
        'tuple join',
        '{let (a, _) = match true {true -> (1, charList("discarded")); false -> (2, charList("discarded"))}\n a}',
    ],
    [
        'unused replacement field',
        '{let p = (0, [])\n p := (1, charList("discarded"))\n let (a, _) = p\n a}',
    ],
] as const;
for (const [name, source] of pure)
    it(`does not build discarded data: ${name}`, () => {
        const code = emit(source);
        expect(code).not.toContain('discarded');
        expect(code).not.toContain('char_list_');
        expect(code).not.toMatch(/^\s*_ = /m);
    });

for (const [name, source, expected, output] of [
    ...pure.map(([name, source]) => [name, source, 1, ''] as const),
    ['tuple call order', effect + '{let (a, _) = (effect(1), effect(2))\n a}', 1, '1\n2\n'],
    [
        'constructor call order',
        effect + 'match Some((effect(1), effect(2))) {Some((a, _)) -> a; None -> 0}',
        1,
        '1\n2\n',
    ],
    [
        'selected effects',
        effect +
            '{let (a, _) = match true {true -> (effect(1), effect(2)); false -> (effect(3), effect(4))}\n a}',
        1,
        '1\n2\n',
    ],
    ['unit effects', '{let (a, _) = (1, print("unit"))\n a}', 1, 'unit\n'],
    ['unused input result', '{let (a, _) = (1, getInput("prompt"))\n a}', 1, 'prompt'],
    [
        'unused closure capture',
        'fn capture() {print("capture")\n "owned"}\n{let s = capture()\n let (a, _) = (1, fn () s)\n a}',
        1,
        'capture\n',
    ],
    [
        'restoration of discarded dup',
        '{let x = 1\n let (a, _) = (1, dup(~{{lens finalFocus <- x\nx := finalFocus\n{print("cleanup")}}}))\n a}',
        1,
        'cleanup\n',
    ],
    [
        'thin snapshot before write',
        'fn change(~(a, b)) {a := 9\n b := 8}\nfn observe(~p) {let old = dup(~p)\n change(~p)\n let (a, _) = old\n a}\n{let p = (1, 2)\n let old = observe(~p)\n (old, p)}',
        [1, [9, 8]],
        '',
    ],
    [
        'scattered snapshot before write',
        'fn change(~(a, b)) {a := 9\n b := 8}\nfn observe(~p) {let old = dup(~p)\n change(~p)\n let (a, _) = old\n a}\n{let a = 1\n let b = 2\n let old = observe(~(a, b))\n (old, (a, b))}',
        [1, [9, 8]],
        '',
    ],
] as const)
    execute(
        `dead-value Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(emit(source), { output, stdin: 'ignored\n' })).toEqual([
                expected,
            ]);
        },
        60000,
    );

for (const [name, source] of [
    ['discarded call result', 'fn fail(x) {match x {2 -> 3}}\n{let (a, _) = (1, fail(0))\n a}'],
    ['unmatched constructor', 'match Some((1, charList("discarded"))) {None -> 0}'],
    ['unmatched payload literal', 'match Some((2, charList("discarded"))) {Some((1, _)) -> 0}'],
] as const)
    execute(
        `preserves trap: ${name}`,
        async () => {
            await expect(buildAndRunGo(emit(source))).rejects.toMatchObject({ code: 'go-runtime' });
        },
        60000,
    );
