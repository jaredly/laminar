import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { unionTagNames } from '../../src/backend/type-names.ts';
import { CNames } from '../../src/c/names.ts';
import { expectRun } from '../backend/backends.ts';

const compile = (source: string) => compileSource(source, { target: wasm32Emscripten('test') });
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

const scalar =
    'fn nextGuess(lastGuess) {let next = lastGuess + 1\n (dup(~next), next)}\nnextGuess(3)';
const generic = 'fn id(value) value\n(id(3), id(true))';
const library =
    'fn sin(x) {x + 1}\nfn double(x) {x * 2}\nfn free(x) {x - 1}\nfn main(x) {sin(double(free(x)))}\nmain(3)';
const runtime =
    'fn allocate_context(n) {n + 1}\nfn environment(n) {match dup(~n) {0 -> 0; _ -> environment(n - 1)}}\n(allocate_context(1), environment(3))';
// The discarded list parameter needs the generated drop_List_Number helper.
const helper = 'fn drop_List_Number(l) {3}\ndrop_List_Number([4, 5, 6])';

it('preserves source function, parameter and layout names', () => {
    const { code } = compile(scalar);
    expect(code).toMatch(/^\S+ nextGuess\(void \*environment, double lastGuess\)/m);
    expect(code).not.toMatch(/\barg\d+\b/);
    expect(code).not.toMatch(/\bfn\d+\(/);
    expect(code).not.toMatch(/\bL\d+\b/);
    expect(code).toContain('struct Tuple_Number_Number { double item0; double item1; };');
});

it('names semantic specializations', () => {
    const { code } = compile(generic);
    expect(code).toContain(' id_number(');
    expect(code).toContain(' id_bool(');
});

it('escapes C keywords, library, runtime and generated helper names', () => {
    const names = new CNames();
    const chosen = [
        'double',
        'sin',
        'main',
        'free',
        'index',
        'fn0',
        'L3',
        'drop_List_Number',
        'String',
    ].map((n) => names.source(n));
    expect(chosen).toEqual([
        'double_2',
        'sin_2',
        'main_2',
        'free_2',
        'index_2',
        'fn0_source',
        'L3_source',
        'drop_List_Number_source',
        'String_2',
    ]);
    expect(compile(library).code).toMatch(/ sin_2\(void \*environment/);
    const helped = compile(helper).code;
    expect(helped).toMatch(/ drop_List_Number_source\(void \*environment/);
    expect(helped).toMatch(/ drop_List_Number\(List_Number value\)/);
});

it('emits the same names on repeated lowering', () => {
    expect(compile(runtime).code).toBe(compile(runtime).code);
});

for (const [name, source, expected] of [
    ['source names', scalar, [4, 4]],
    ['generic variants', generic, [3, true]],
    ['library collisions', library, 5],
    ['runtime collisions', runtime, [2, 0]],
    ['helper collisions', helper, 3],
] as const)
    execute(
        `named C: ${name}`,
        () => expectRun('native', source, { expected: structuredClone(expected) as unknown }),
        60000,
    );

it('names union tags in constructors, matches and runtime helpers', () => {
    const { code } = compile(
        'fn len(l) {match l {[] -> 0; [x, ...rest] -> 1 + len(rest)}}\nlen([1, 2])',
    );
    expect(code).toContain('enum { List_Number_nil = 0, List_Number_cons = 1 };');
    expect(code).toContain('.tag=List_Number_cons');
    // A complete match on every constructor is a switch over the named constants.
    expect(code).toContain('case List_Number_cons:');
    expect(code).not.toMatch(/\.tag\s*(?:=|==)\s*\d/);
    expect(code).not.toMatch(/case \d/);
});

it('keeps constructor constants distinct across specializations', () => {
    const { code } = compile('([1], [true])');
    expect(code).toContain('List_Number_cons = 1');
    expect(code).toContain('List_Bool_cons = 1');
    expect(code).toContain('value.tag == List_Number_cons');
    expect(code).toContain('value.tag == List_Bool_cons');
});

execute(
    'named C: union tags',
    () => expectRun('native', '([1], [true])', { expected: [[1], [true]] }),
    60000,
);

it('allocates constructor constants in the reserved package namespace', () => {
    const { concrete } = compile('[1]');
    const union = concrete.layouts.find((l) => l.kind === 'union')!;
    const allocator = new CNames(['List_Number_cons']);
    const tags = unionTagNames(concrete, new Map([[union.id, 'List_Number']]), allocator);
    expect(tags.get(union.id)).toEqual(['List_Number_nil', 'List_Number_cons_2']);
    expect(allocator.source('List_Number_cons_2')).toBe('List_Number_cons_2_2');
});
