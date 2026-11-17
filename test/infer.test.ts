import { describe, expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { FileItem, Linear } from '../src/ast.ts';
import { Checker, checkFile } from '../src/check.ts';
import { Solver, TypeDiagnostic, con, tuple, fn, plain, printType } from '../src/types.ts';
import { runSnapshot } from './fixtures.ts';

function parse(source: string): FileItem[] {
    return readLines(source).nodes.map((node) => {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        return parsed.value;
    });
}
function expression(source: string): Linear {
    const [n] = parse(source);
    if (n.type === 'decl') throw new Error('Expected expression');
    return n;
}
function type(source: string, checker = new Checker()): string {
    return printType(checker.check(expression(source)).type);
}
function rejects(source: string, code: string, checker = new Checker()) {
    try {
        checker.check(expression(source));
        throw new Error('Expected inference error');
    } catch (e) {
        expect(e).toBeInstanceOf(TypeDiagnostic);
        expect((e as TypeDiagnostic).code).toBe(code);
    }
}

describe('unification', () => {
    it('composes substitutions, handles self-unification, and rejects infinite types', () => {
        const s = new Solver(),
            a = s.fresh(),
            b = s.fresh();
        s.unify(a, a, 0);
        s.unify(a, tuple(b), 0);
        s.unify(b, con('Bool'), 0);
        expect(printType(s.resolve(a))).toBe('(Bool)');
        const c = s.fresh();
        expect(() => s.unify(c, fn([plain(c)], plain(c)), 9)).toThrow(TypeDiagnostic);
    });
    it('freshens only quantified variables', () => {
        const s = new Solver(),
            a = s.fresh(),
            b = s.fresh();
        const scheme = s.generalize(tuple(a, b), [{ quantified: [], body: b }]);
        expect(scheme.quantified).toHaveLength(1);
        const one = s.instantiate(scheme),
            two = s.instantiate(scheme);
        s.unify(one, tuple(con('Number'), con('Bool')), 0);
        s.unify(two, tuple(con('String'), con('Bool')), 0);
        expect(printType(s.resolve(b))).toBe('Bool');
    });
});

describe('AST inference', () => {
    it('infers literals, tuples, strings, operators and homogeneous lists', () => {
        expect(type('(1, true, "yes")')).toBe('(Number, Bool, String)');
        expect(type('[1, 2 + 3]')).toBe('List<Number>');
        expect(type('[]')).toBe('List<a>');
        rejects('[1, true]', 'type-mismatch');
        rejects('1 + true', 'type-mismatch');
        rejects('Missing(1)', 'unknown-constructor');
        rejects('round(1, 2)', 'arity-mismatch');
    });
    it('generalizes closed local functions with independent occurrence types', () => {
        expect(
            type(`{
            let id = fn (x) x
            (id(1), id(true))
        }`),
        ).toBe('(Number, Bool)');
        rejects('fn (f) (f(1), f(true))', 'type-mismatch');
    });
    it('does not generalize applications or mutable captured state', () => {
        rejects(
            `{
            let make = fn (unused) {fn (x) x}
            let id = make(())
            (id(1), id(true))
        }`,
            'type-mismatch',
        );
        rejects(
            `{
            let x = 1
            let f = fn (()) x
            f(())
        }`,
            'unsupported-capture',
        );
    });
    it('forbids overwriting reusable polymorphic definitions', () => {
        rejects(
            `{
            let id = fn (x) x
            id := fn (x) {x + 1}
            id(true)
        }`,
            'immutable-definition',
        );
    });
    it('rejects invalid patterns and infinite types', () => {
        rejects('fn (x, x) x', 'duplicate-pattern');
        rejects('fn (x) x(x)', 'infinite-type');
        rejects(
            `{
            let (x, y) = 1
            x
        }`,
            'type-mismatch',
        );
    });
    it('tracks swap results and subsequent storage types', () => {
        expect(
            type(`{
            let x = 1
            let old = x := true
            (old, x)
        }`),
        ).toBe('(Number, Bool)');
        expect(
            type(`{
            let x = 1
            x := x := true
        }`),
        ).toBe('Bool');
    });
    it('propagates alias writes through the owner, including tuple components', () => {
        expect(
            type(`{
            let x = (1, 2)
            let (a, b) = ~x
            a := true
            (x, b)
        }`),
        ).toBe('((Bool, Number), Number)');
        expect(
            type(`{
            let x = 1
            let y = ~x
            y := true
            x
        }`),
        ).toBe('Bool');
    });
    it('rejects overlapping tuple lenses', () => {
        rejects(
            `{
            let x = 1
            (x, x) := (true, false)
        }`,
            'alias-conflict',
        );
    });
    it('resolves shadowed aliases without changing the outer owner', () => {
        expect(
            type(`{
            let x = 1
            {
                let x = true
                x := "new"
            }
            x
        }`),
        ).toBe('Number');
    });
    it('infers flow endpoints for swaps and returned tuple lenses', () => {
        expect(type('fn (~x) {x := ()}')).toBe('(a/()) => a');
        expect(type('fn (~(x, y)) ~x')).toBe('((a, b)/(c, b)) => a/c');
        expect(type('fn (f, ~x) {x := f(x)}')).toBe('((a) => b, a/b) => a');
        rejects('fn (~x, y) y', 'lens-position');
        rejects('round(~x)', 'unbound-name');
    });
    it('instantiates higher-order flow functions and updates their arguments', () => {
        const checker = new Checker();
        checker.define(expression('fn take(~x) {x := ()}') as Linear & { type: 'fn' });
        expect(
            type(
                `{
            let x = 1
            (take(~x), x)
        }`,
                checker,
            ),
        ).toBe('(Number, ())');
        expect(
            type(`{
            let x = (1, 2)
            fst(~x) := true
            x
        }`),
        ).toBe('(Bool, Number)');
        rejects('take(1)', 'mode-mismatch', checker);
        rejects('fn (x) ~x', 'escaping-lens');
    });
    it('unifies branch results and outer states, preserving aliases', () => {
        expect(
            type(`{
            let x = 1
            match true { true -> x := true; false -> x := false }
            x
        }`),
        ).toBe('Bool');
        rejects('match true { true -> 1; false -> false }', 'type-mismatch');
        rejects(
            `{
            let x = 1
            match true { true -> {x := true\n ()}; false -> () }
            x
        }`,
            'branch-state',
        );
    });
    it('diagnoses unsupported lens restoration forms instead of inventing types', () => {
        rejects('fn (~x) ~{ @(x, round) }', 'unsupported-lens');
    });
});

describe('checked compilation', () => {
    it('exports the declared contract when it is narrower than the implementation', () => {
        const checker = new Checker();
        const [decl, ast] = parse('id :: (Number) => Number\nfn id(x) x');
        checker.define(ast as Linear & { type: 'fn' }, decl as import('../src/ast.ts').Decl);
        expect(type('id(1)', checker)).toBe('Number');
        rejects('id(true)', 'type-mismatch', checker);
    });
    it('keeps final lens setup ahead of ordinary argument evaluation', () => {
        const checker = new Checker();
        checker.define(expression('fn update(n, ~x) {x := n}') as Linear & { type: 'fn' });
        expect(
            type(
                `{
            let x = 1
            update(x := true, ~x)
        }`,
                checker,
            ),
        ).toBe('Bool');
        rejects(
            `{
            let x = (1, 2)
            fst(~x) := { x := true\n 1 }
        }`,
            'alias-conflict',
        );
    });
    it('rejects value/lens result mismatches and invalidated tuple aliases', () => {
        rejects('fn (~x) fst(~x)', 'mode-mismatch');
        rejects(
            `{
            let x = (1, 2)
            let (a, b) = ~x
            x := true
            a
        }`,
            'alias-shape',
        );
    });
    it('does not permit replacing globally resolved definitions', () => {
        const checker = new Checker();
        checker.define(expression('fn id(x) x') as Linear & { type: 'fn' });
        rejects('fn id(x) true', 'duplicate-definition', checker);
    });
    it('checks generic signatures rigidly and accepts valid flow signatures', () => {
        const good = parse('id :: (a) => a\nfn id(x) x');
        expect(checkFile(good).ir).toHaveLength(1);
        expect(() => checkFile(parse('bad :: (a) => a\nfn bad(x) {x + 1}'))).toThrow(
            TypeDiagnostic,
        );
        expect(checkFile(parse('take :: (a/()) => a\nfn take(~x) {x := ()}')).ir).toHaveLength(1);
        expect(() => checkFile(parse('inc :: (~Int) => ()\nfn inc(~x) {x := x + 1}'))).toThrow(
            TypeDiagnostic,
        );
    });
    it('diagnoses mismatched and orphan declarations without publishing failures', () => {
        expect(() => checkFile(parse('other :: (a) => a\nfn id(x) x'))).toThrow(TypeDiagnostic);
        expect(() => checkFile(parse('other :: Number'))).toThrow(TypeDiagnostic);
        const checker = new Checker();
        expect(() =>
            checker.define(expression('fn bad(x) x(x)') as Linear & { type: 'fn' }),
        ).toThrow(TypeDiagnostic);
        expect(checker.definitions.has('bad')).toBe(false);
    });
    it('accepts monomorphic recursion but rejects polymorphic recursion', () => {
        const checker = new Checker();
        expect(() =>
            checker.define(expression('fn loop(x) loop(x)') as Linear & { type: 'fn' }),
        ).not.toThrow();
        rejects('fn loop(x) loop([x])', 'infinite-type');
    });
    it('keeps lowering tied to a successful check and its source snapshot', () => {
        const checker = new Checker(),
            ast = expression('1');
        const checked = checker.check(ast);
        if (ast.type === 'number') ast.value = 99;
        expect(checker.lower(checked)).toMatchObject({ type: 'const', value: 1 });
        expect(() => new Checker().lower(checked)).toThrow();
    });
    it('checks and executes snapshot bodies with unchanged IR', () => {
        const source = `fn take(~x) {x := ()}
{
    let x = 1
    (take(~x), x)
}
(1, ())`;
        const unchecked = runSnapshot(source, 'in-memory');
        const checked = runSnapshot(source, 'in-memory', false, { checked: true });
        expect(checked.testResults.every((r) => !r.failure)).toBe(true);
        expect(checked.text).toBe(unchecked.text);
    });
    it('executes checked type-changing tuple aliases and computed lenses', () => {
        const source = `{
    let x = (1, 2)
    let (a, b) = ~x
    a := true
    x
}
(true, 2)
{
    let x = (1, 2)
    fst(~x) := true
    x
}
(true, 2)`;
        const checked = runSnapshot(source, 'in-memory', false, { checked: true });
        expect(checked.testResults).toHaveLength(2);
        expect(checked.testResults.every((r) => !r.failure)).toBe(true);
        expect(checked.text).toBe(runSnapshot(source, 'in-memory').text);
    });
    it('rejects a bad expected result before executing either side', () => {
        const result = runSnapshot('{let x = 1\n x}\ntrue', 'in-memory', false, { checked: true });
        expect(result.testResults[0].failure).toBeInstanceOf(TypeDiagnostic);
        expect(result.text).not.toContain('ir->');
    });
});
