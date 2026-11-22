import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { expectRun } from '../backend/backends.ts';
const compile = (source: string) =>
    compileSource(source, { target: wasm32Emscripten('test') }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('omits unused layout definitions, forwards and direct-call ABI typedefs', () => {
    const code = compile('true');
    expect(code).not.toContain('typedef');
    expect(code).not.toContain('struct ');
    expect(code).toContain('bool entry(void *environment)');
});

it('retains recursive union payloads and types used only by callable signatures', () => {
    const list = compile('[1, 2, 3]');
    expect(list).toContain('typedef struct List_Number List_Number;');
    expect(list).toContain('struct Tuple_Number_List_Number { double item0; List_Number item1; };');
    expect(list).toContain('Unit v0; Tuple_Number_List_Number *v1;');
    const callable = compile('fn maker(n) {fn (x) {n + x}}\nmaker(2)(3)');
    expect(callable).toMatch(/typedef double \(\*Func_double_to_double_\w+\)\(void \*, double\);/);
    expect(callable).not.toContain('struct Environment_Empty');
});

execute(
    'C type reachability preserves returned captured callables',
    () => expectRun('native', 'fn maker(n) {fn (x) {n + x}}\nmaker(2)(3)', { expected: 5 }),
    60000,
);
