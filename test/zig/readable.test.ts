import { describe, it, expect } from 'bun:test';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { emitZig } from '../../src/zig/emit.ts';
import { zigTarget } from '../../src/zig/target.ts';
import { tidy, printStmt, name, type Stmt, type Expr } from '../../src/zig/ast.ts';

// Golden output for the readability pass. These need no Zig toolchain; execute.test.ts
// proves the same output compiles and runs.
const functionsOf = (source: string) => {
    const p = typedProgram(source);
    const zig = emitZig(
        compileConcreteProgram(p, zigTarget('golden'), [{ unit: p.units.at(-1)!.id, arguments: [] }]),
    );
    return zig
        .split('\n\n')
        .filter((s) => /^(fn|const [A-Z])/.test(s) && !s.startsWith('fn printNumber'))
        .join('\n\n');
};

describe('Zig readable output', () => {
    it('keeps source names and plain signatures', () => {
        expect(functionsOf('fn swap(p) {let (a, b) = p\n (b, a)}\nswap((1, true))')).toBe(
            [
                'const Tuple_bool_f64 = struct {\n    item0: bool,\n    item1: f64,\n};',
                'const Tuple_f64_bool = struct {\n    item0: f64,\n    item1: bool,\n};',
                'fn swap(p: Tuple_f64_bool) Tuple_bool_f64 {\n    const a = p.item0;\n    const b = p.item1;\n    return .{ .item0 = b, .item1 = a };\n}',
                'fn entry() Tuple_bool_f64 {\n    return swap(.{ .item0 = 1, .item1 = true });\n}',
            ].join('\n\n'),
        );
    });

    it('names specializations and shadowed bindings', () => {
        const generic = functionsOf('fn id(x) x\n(id(1), id(true))');
        expect(generic).toContain('fn id_f64(x: f64) f64');
        expect(generic).toContain('fn id_bool(x: bool) bool');
        expect(functionsOf('fn id(x) x\nid(id(2))')).toContain('fn id(x: f64) f64');
        expect(functionsOf('{let x = 1\n {let x = x + 1\n x * 10}}')).toBe(
            'fn entry() f64 {\n    const x: f64 = 1;\n    const x_1 = x + 1;\n    return x_1 * 10;\n}',
        );
    });

    it('inlines nested calls and destructured literals', () => {
        expect(functionsOf('fn add(a, b) {a + b}\nfn plus3(x) add(x, 3)\nplus3(add(1, 2))')).toContain(
            'fn entry() f64 {\n    return plus3(add(1, 2));\n}',
        );
        expect(functionsOf('{let (a, b) = (1, 2)\n a - b}')).toBe(
            'fn entry() f64 {\n    const a: f64 = 1;\n    const b: f64 = 2;\n    return a - b;\n}',
        );
    });

    it('types literal-only arithmetic so it is not comptime_int division', () => {
        expect(functionsOf('1 / 0')).toContain('return @as(f64, 1) / 0;');
    });
});

describe('Zig tidy pass preserves evaluation order', () => {
    const call = (f: string, ...args: Expr[]): Expr => ({ k: 'call', callee: name(f), args });
    const let_ = (n: string, value: Expr): Stmt => ({ k: 'let', name: n, type: 'f64', value, named: false });
    const show = (body: Stmt[]) => tidy(body).map(printStmt);

    it('does not move a call past a sibling call', () => {
        expect(
            show([
                let_('t0', call('f')),
                { k: 'return', value: { k: 'binary', op: '+', left: name('t0'), right: call('g') } },
            ]),
        ).toEqual(['const t0 = f();', 'return t0 + g();']);
    });

    it('does not move a call past an earlier effect', () => {
        expect(
            show([let_('t0', call('f')), let_('t1', call('g')), { k: 'return', value: { k: 'binary', op: '+', left: name('t1'), right: name('t0') } }]),
        ).toEqual(['const t0 = f();', 'return g() + t0;']);
    });

    it('keeps unused call results as discards', () => {
        expect(show([let_('t0', call('f')), { k: 'return', value: { k: 'lit', text: '1' } }])).toEqual([
            '_ = f();',
            'return 1;',
        ]);
    });
});
