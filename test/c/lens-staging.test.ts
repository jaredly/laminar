/**
 * C lens staging: a call over storage that needs no restoration points at the
 * storage it already has, forwards a matching incoming lens as-is, and leaves its
 * results in the backing it used. Type-changing and escaping lenses keep explicit
 * staging. Execution cases run natively (under ASan/UBSan at -O0, and at -O2).
 */
import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { expectRun } from '../backend/backends.ts';

const compile = (source: string, specializeLenses?: readonly string[]) =>
    compileSource(source, { target: wasm32Emscripten('test'), specializeLenses }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const body = (code: string, name: string) => {
    const start = code.search(new RegExp(`^\\S+ ${name}\\(void \\*environment[^;]*\\{$`, 'm'));
    return code.slice(start, code.indexOf('\n}\n', start));
};
const bump = 'fn bump(~x) {x := dup(~x) + 1}\n';
const bumpPair = 'fn bumpPair(~(a, b)) {a := dup(~a) + 1\n b := dup(~b) + 2}\n';

it('forwards an unchanged aggregate lens rather than rebuilding it', () => {
    const code = compile(
        'fn sum(~(a, b)) {dup(~a) + dup(~b)}\nfn forward(~(a, b)) {sum(~(a, b))}\n{let a = 1\n let b = 2\n forward(~(a, b))}',
    );
    const forward = body(code, 'forward');
    expect(forward).toMatch(/return sum\(NULL, a_b\);/);
    expect(forward).not.toMatch(/Backing|\.read=/);
});

it('reuses one backing across sequential homogeneous calls', () => {
    const code = compile(bump + '{let x = 0\n bump(~x)\n bump(~x)\n x}');
    const entry = body(code, 'entry');
    expect(entry.match(/Backing_\w+ back\d+/g)).toHaveLength(1);
    expect(entry.match(/bump\(NULL, \w+\)/g)).toHaveLength(2);
    expect(entry.match(/\.read=&back0\.read0/g)).toHaveLength(2);
    // Results are read where the calls left them, not copied out and rebuilt.
    expect(entry).toContain('return back0.read0;');
    expect(entry).not.toMatch(/\.read=\(\w+\)|Tuple_/);
});

it('keeps a whole tuple in its existing backing after a call', () => {
    const code = compile(bumpPair + '{let p = (1, 2)\n bumpPair(~p)\n bumpPair(~p)\n p}', [
        'bumpPair',
    ]);
    expect(body(code, 'entry').match(/Backing_\w+ back\d+/g)).toHaveLength(1);
});

it('keeps separate typed backing for a type-changing call', () => {
    const entry = body(compile('fn change(~x) {x := true}\n{let x = 1\n change(~x)\n x}'), 'entry');
    expect(entry).toContain('.replacement=&back0.write0');
    expect(entry).toContain('return *v5.replacement;');
});

it('keeps heap staging for a lens that escapes', () => {
    const entry = body(compile('fn pass(~x) ~x\n{let x = 1\n pass(~x) := 9\n x}'), 'entry');
    expect(entry).toMatch(/Backing_\w+ \* ?back\d+ = allocate_context\(sizeof \*back\d+\);/);
    expect(entry).toMatch(/release_context\(back\d+\);/);
    // Heap memory is not zeroed, so every field is written.
    expect(entry).toMatch(/back\d+->read0 = 1;/);
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
        'temporary restoration order',
        bump +
            '{let x = 0\n bump(~{{lens finalFocus <- x\nx := finalFocus\n{print("cleanup")}}})\n bump(~x)\n x}',
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
        `lens staging C: ${name}`,
        () => expectRun('native', source, { expected, output }),
        60000,
    );
