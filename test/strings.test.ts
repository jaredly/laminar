import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { goTarget, wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
import { emitGo } from '../src/go/emit.ts';
import { cBytes } from '../src/c/strings.ts';
import { goBytes } from '../src/go/strings.ts';

const compile = (source: string, target = wasm32Emscripten('test')) => {
    const p = typedProgram(source);
    return compileConcreteProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
};

it('gives String a primitive physical layout', () => {
    const concrete = compile('"a"');
    expect(concrete.layouts.map((l) => l.kind)).toContain('string');
    const c = emitC(concrete);
    expect(c).toMatch(/typedef laminar_string \*L\d+;/);
    expect(c).toContain('string_new("a", 1)');
    expect(c).toContain('print_string(result0);');
    expect(c).toContain('string_drop(result0);');
    expect(emitGo(compile('"a"', goTarget('test')))).toContain('func entry(environment any) string');
});

it('emits the string runtime only for programs that reach a string layout', () => {
    const c = emitC(compile('(1, true)'));
    expect(c).not.toContain('#include <string.h>');
    expect(c).not.toContain('laminar_string');
    expect(emitGo(compile('(1, true)', goTarget('test')))).not.toContain('formatNumber');
});

it('encodes literal bytes exactly', () => {
    // `?` is escaped so no trigraph forms; octal escapes never absorb a following digit.
    expect(cBytes('a"\\?\n\u00001é')).toEqual({
        literal: '"a\\042\\134\\077\\012\\0001\\303\\251"',
        length: 9,
    });
    expect(goBytes('a"\\\n\u0000é')).toBe('"a\\x22\\x5c\\x0a\\x00\\xc3\\xa9"');
    expect(() => cBytes('\ud800')).toThrow('unpaired surrogate');
});

it('builds interpolation in source order and consumes string parts', () => {
    const c = emitC(compile('{let s = "x"\n "a${1}b${true}c${s}"}'));
    const order = ['builder_bytes', 'builder_number', 'builder_bool', 'builder_string'].map(
        (call) => c.indexOf(`${call}(&`),
    );
    expect(order.every((n, i) => n > 0 && (!i || n > order[i - 1]!))).toBe(true);
    expect(emitGo(compile('{let s = "x"\n "a${1}b${true}c${s}"}', goTarget('test')))).toMatch(
        /"a" \+ formatNumber\(1\.0\) \+ "b" \+ strconv\.FormatBool\(true\) \+ "c" \+ s(?:_\d+)?/,
    );
});

it('restricts interpolation to String, Number and Bool parts', () => {
    for (const source of ['"${(1, 2)}"', '"${[1]}"'])
        expect(() => emitC(compile(source))).toThrow(
            'String interpolation supports String, Number and Bool parts',
        );
    expect(() => emitGo(compile('"${(1, 2)}"', goTarget('test')))).toThrow(
        'String interpolation supports String, Number and Bool parts',
    );
});

it('compares string literal patterns by content and drops the matched string', () => {
    const c = emitC(compile('match "ab" {"a" -> 1; _ -> 2}'));
    expect(c).toMatch(/string_equals\(v\d+, "a", 1\)/);
    expect(c).toMatch(/string_drop\(v\d+\);/);
});
