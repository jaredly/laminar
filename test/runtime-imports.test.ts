import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { goTarget, wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
import { emitGo } from '../src/go/emit.ts';
import { builtinTypes } from '../src/builtins.ts';
import {
    checkConventions,
    requireImport,
    runtimeImports,
    type RuntimeImport,
} from '../src/runtime-imports.ts';
import { referenceRun } from './backend/reference-run.ts';
import { Solver, fn, plain, con } from '../src/types.ts';

const compile = (source: string, target = wasm32Emscripten('test')) => {
    const p = typedProgram(source);
    return compileConcreteProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
};

/** One call per registered import, so every backend claim is exercised. */
const probes: Record<string, string> = {
    '+': '1 + 2',
    '-': '1 - 2',
    '*': '1 * 2',
    '/': '1 / 2',
    '==': '1 == 2',
    '>=': '1 >= 2',
    '<=': '1 <= 2',
    round: 'round(1.5)',
    heapsize: 'heapsize()',
    fst: '{let x = (1, 2)\n fst(~x) := true\n x}',
    dup: '{let x = 1\n dup(~x)}',
    array: 'array(2, 0)',
    charList: 'charList("ab")',
    getInput: 'getInput("> ")',
    print: 'print("x")',
};

it('derives source signatures from the registry, in registry order', () => {
    expect([...builtinTypes().keys()]).toEqual(runtimeImports.map((i) => i.name));
    expect(Object.keys(probes).sort()).toEqual(runtimeImports.map((i) => i.name).sort());
});

it('rejects conventions that disagree with the signature', () => {
    const lying: RuntimeImport = { ...runtimeImports[0]!, arguments: ['lens', 'owned'] };
    expect(() => checkConventions(lying, lying.signature(new Solver()))).toThrow(
        'conventions disagree',
    );
    expect(() =>
        checkConventions(
            { ...runtimeImports[0]!, result: 'lens' },
            fn([plain(con('Number')), plain(con('Number'))], plain(con('Number'))),
        ),
    ).toThrow('conventions disagree');
});

for (const entry of runtimeImports)
    it(`implements ${entry.name} on every claimed backend`, () => {
        const source = probes[entry.name]!;
        if (entry.backends.includes('reference'))
            expect(() => referenceRun(typedProgram(source), 'line\n')).not.toThrow();
        if (entry.backends.includes('c')) expect(() => emitC(compile(source))).not.toThrow();
        if (entry.backends.includes('go'))
            expect(() => emitGo(compile(source, goTarget('test')))).not.toThrow();
    });

it('diagnoses unknown imports and missing capabilities', () => {
    expect(() => requireImport('native/launch', 'c')).toThrow(
        'No runtime import registered for launch',
    );
    const browser = wasm32Emscripten('test', 'emscripten-browser');
    expect(() => emitC(compile('getInput("> ")', browser))).toThrow(
        'Runtime import getInput needs stdin, which the emscripten-browser runtime does not provide',
    );
    expect(() => emitC(compile('print("x")', browser))).not.toThrow();
});

it('marks result lines only for programs that use host I/O', () => {
    expect(emitC(compile('print("x")'))).toContain('putchar(30);');
    expect(emitC(compile('"x"'))).not.toContain('putchar(30);');
    expect(emitGo(compile('print("x")', goTarget('test')))).toContain('fmt.Print("\\x1e")');
    const go = emitGo(compile('getInput("> ")', goTarget('test')));
    expect(go).toContain('"bufio"');
    expect(emitGo(compile('"x"', goTarget('test')))).not.toContain('bufio');
});

it('captures reference host output and input', () => {
    expect(referenceRun(typedProgram('{print("a")\n getInput("? ")}'), 'b\n')).toEqual({
        result: 'b',
        output: 'a\n? ',
    });
});
