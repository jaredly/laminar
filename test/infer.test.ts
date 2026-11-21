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
    if (n.type === 'type-alias' || n.type === 'union') {
        throw new Error('not supported yet');
    }
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
    it('keeps first-class functions affine while top-level schemes remain reusable', () => {
        rejects(
            `{
            let id = fn (x) x
            (id(1), id(true))
        }`,
            'use-after-move',
        );
        rejects('fn (f) (f(1), f(true))', 'use-after-move');
        const checker = new Checker();
        checker.define(expression('fn id(x) x') as Linear & { type: 'fn' });
        expect(type('(id(1), id(true))', checker)).toBe('(Number, Bool)');
        rejects(
            `{
            let id = id
            (id(1), id(true))
        }`,
            'use-after-move',
            checker,
        );
    });
    it('moves closure captures at definition time and allows unused local values', () => {
        expect(
            type(`{
            let x = 1
            let unused = true
            let f = fn (()) x
            f(())
        }`),
        ).toBe('Number');
        rejects(
            `{
            let x = 1
            let f = fn (()) x
            x
        }`,
            'use-after-move',
        );
        rejects(
            `{
            let x = 1
            let f = fn (()) {x := 2}
            f(())
        }`,
            'borrowed-capture',
        );
        rejects(
            `{
            let x = (1, 2)
            let f = fn (()) {fst(~x) := true}
            f(())
        }`,
            'borrowed-capture',
        );
        rejects(
            `{
            let x = 1
            let f = fn (()) dup(~x)
            f(())
        }`,
            'borrowed-capture',
        );
    });
    it('allows replacing a local function but keeps its use affine', () => {
        expect(
            type(`{
            let id = fn (x) x
            id := fn (x) {x + 1}
            id(2)
        }`),
        ).toBe('Number');
    });
    it('requires moved lens contents to be restored before scope exit', () => {
        rejects(
            `{
            let x = 1
            let y = ~x
            let f = fn (()) y
            f
        }`,
            'unrestored-lens',
        );
        expect(
            type(`{
            let x = 1
            let y = ~x
            let f = fn (()) y
            y := 2
            f(())
        }`),
        ).toBe('Number');
        rejects('fn (~x) x', 'unrestored-lens');
        expect(type('fn (~x) {let old = x\n x := true\n old}')).toBe('(a/Bool) => a');
    });
    it('tracks independent tuple components and nested exclusive borrows', () => {
        expect(
            type(`{
            let x = (1, 2)
            {
                let (a, b) = ~x
                let old = a
                b := true
                a := old
            }
            x
        }`),
        ).toBe('(Number, Bool)');
        rejects(
            `{
            let x = 1
            let y = ~x
            let z = ~y
            y := 2
        }`,
            'use-while-borrowed',
        );
        expect(
            type(`{
            let x = 1
            {
                let y = ~x
                {
                    let z = ~y
                    z := true
                }
                y := "restored"
            }
            x
        }`),
        ).toBe('String');
        rejects(
            `{
            let x = (1, 2)
            let (a, b) = ~x
            a
        }`,
            'unrestored-lens',
        );
    });
    it('joins affine availability conservatively across branches', () => {
        rejects(
            `{
            let x = 1
            match true {true -> {x\n ()}; false -> ()}
            x
        }`,
            'use-after-move',
        );
        expect(
            type(`{
            let x = 1
            match true {true -> x; false -> x}
        }`),
        ).toBe('Number');
        rejects(
            `{
            let x = 1
            let y = ~x
            match true {true -> {y\n ()}; false -> ()}
        }`,
            'unrestored-lens',
        );
        expect(
            type(`{
            let x = 1
            {
                let y = ~x
                match true {true -> {y\n ()}; false -> ()}
                y := true
            }
            x
        }`),
        ).toBe('Bool');
    });
    it('rejects invalid patterns and infinite types', () => {
        rejects('fn (x, x) x', 'duplicate-pattern');
        rejects('fn (x) x(x)', 'use-after-move');
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
    it('prevents owner access until all persistent aliases leave scope', () => {
        rejects(
            `{
            let x = (1, 2)
            let (a, b) = ~x
            a := true
            (x, b)
        }`,
            'use-while-borrowed',
        );
        rejects(
            `{
            let x = 1
            let y = ~x
            y := true
            x
        }`,
            'use-while-borrowed',
        );
        expect(
            type(`{
            let x = (1, 2)
            {
                let (a, b) = ~x
                a := true
            }
            x
        }`),
        ).toBe('(Bool, Number)');
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
        expect(type('fn (f, ~x) {x := f(x)}')).toBe('((a) => b, a/b) => ()');
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
            'use-while-borrowed',
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
        expect(checkFile(parse('inc :: (~Int) => ()\nfn inc(~x) {x := x + 1}')).ir).toHaveLength(1);
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
    {
        let (a, b) = ~x
        a := true
    }
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
    it('moves closure captures by value, retaining the alias storage for restoration', () => {
        const source = `{
    let x = 1
    let f = {
        let y = ~x
        let f = fn (()) y
        y := 2
        f
    }
    (f(()), x)
}
(1, 2)
{
    let x = 1
    let f = fn (()) x
    f(())
}
1`;
        const checked = runSnapshot(source, 'in-memory', false, { checked: true });
        expect(checked.testResults).toHaveLength(2);
        expect(checked.testResults.map((r) => r.failure)).toEqual([undefined, undefined]);
    });
    it('captures first-class callees used inside lens expressions by value', () => {
        const source = `{
    let g = {
        let f = fn (~x) ~x
        fn (~y) ~f(~y)
    }
    let x = 1
    g(~x) := true
    x
}
true`;
        const result = runSnapshot(source, 'in-memory', false, { checked: true });
        expect(result.testResults.map((r) => r.failure)).toEqual([undefined]);
    });
});

describe('type declarations', () => {
    const definition = (source: string, name: string) =>
        printType(checkFile(parse(source)).definitions.get(name)!.body);
    const rejectsFile = (source: string, code: string) => {
        try {
            checkFile(parse(source));
            throw new Error('Expected type error');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
        }
    };
    const direction = `type direction {
    Higher
    Lower
}`;
    it('introduces nominal unions whose constructors build and match the union', () => {
        expect(
            definition(
                `${direction}
fn flip(d) {
    match d {
        Higher -> Lower
        Lower -> Higher
    }
}`,
                'flip',
            ),
        ).toBe('(direction) => direction');
    });
    it('resolves declared union names in annotations, ahead of type variables', () => {
        expect(
            definition(
                `${direction}
pick :: (direction) => Number
fn pick(d) 1`,
                'pick',
            ),
        ).toBe('(direction) => Number');
        rejectsFile(
            `${direction}
pick :: (direction) => Number
fn pick(d) 1
pick(2)`,
            'type-mismatch',
        );
    });
    it('supports parameterized and recursive unions', () => {
        const tree = `type tree(a) {
    Leaf
    Node(tree(a), a, tree(a))
}`;
        expect(definition(`${tree}\nfn single(x) Node(Leaf, x, Leaf)`, 'single')).toBe(
            '(a) => tree<a>',
        );
        rejectsFile(`${tree}\nNode(Leaf, 1, Node(Leaf, "a", Leaf))`, 'type-mismatch');
    });
    it('expands aliases structurally, including parameters and lens types', () => {
        expect(
            definition(
                `type pair(a, b) = (a, b)
swap :: (pair(a, b)) => pair(b, a)
fn swap((a, b)) (b, a)`,
                'swap',
            ),
        ).toBe('((a, b)) => (b, a)');
        expect(
            definition(
                `type counter = ~Int
inc :: (counter) => ()
fn inc(~x) {x := x + 1}`,
                'inc',
            ),
        ).toBe('(Number/Number) => ()');
    });
    it('rejects malformed declarations and uses', () => {
        rejectsFile('type t = (a, Number)', 'unknown-type');
        rejectsFile('type t = List(t)', 'unknown-type');
        rejectsFile('type t {\n    A(b)\n}', 'unknown-type');
        rejectsFile('type t(a, a) = a', 'duplicate-type-parameter');
        rejectsFile('type Number = Bool', 'duplicate-type');
        rejectsFile(`${direction}\ntype other {\n    Higher\n}`, 'duplicate-constructor');
        rejectsFile(
            'type pair(a, b) = (a, b)\nf :: (pair(Number)) => Number\nfn f(x) 1',
            'type-arity',
        );
        rejectsFile('f :: (Missing) => Number\nfn f(x) 1', 'unknown-type');
    });
});

describe('vectors', () => {
    it('infers homogeneous vector literals', () => {
        expect(type('[:1, 2 + 3:]')).toBe('Vector<Number>');
        expect(type('[::]')).toBe('Vector<a>');
        expect(type('[:[:true:]:]')).toBe('Vector<Vector<Bool>>');
        rejects('[:1, true:]', 'type-mismatch');
    });
    it('focuses elements through index lenses', () => {
        expect(type('fn (~v) dup(~v[0])')).toBe('(Vector<a>/Vector<a>) => a');
        expect(type('fn (i, ~v) {v[i] := true}')).toBe(
            '(Number, Vector<Bool>/Vector<Bool>) => Bool',
        );
        expect(type('fn (~v) dup(~v[0][1])')).toBe('(Vector<Vector<a>>/Vector<Vector<a>>) => a');
        expect(
            type(`fn (~v) {
            let x = ~v[1]
            x := 3
        }`),
        ).toBe('(Vector<Number>/Vector<Number>) => Number');
        rejects('{let v = [:1:]\nlet x = ~v[0]\nv}', 'use-while-borrowed');
        expect(type('array(3, "x")')).toBe('Vector<String>');
    });
    it('keeps elements full and of the element type', () => {
        rejects('fn (v) v[0]', 'index-value');
        rejects('fn (~v) {v[0] := 1\nv[1] := true}', 'type-mismatch');
        rejects('fn (~v) {let x = ~v[0]\nlet y = x\n()}', 'unrestored-lens');
        rejects('fn (~v) {v[~v] := 1}', 'index-lens');
        rejects('fn (~v) {v[true] := 1}', 'type-mismatch');
        rejects('fn (~v) {v[dup(~v[0])] := 1}', 'alias-conflict');
        rejects('{let v = [:1:]\nlet w = v\nv[0] := 2}', 'use-after-move');
    });
    it('checks the snake range example', () => {
        const checker = new Checker();
        const [fill, range, call] = parse(`fn fillRange(n, end, ~arr) {
    match (dup(~n) >= dup(~end)) {
        true -> ()
        false -> {
            arr[dup(~n)] := dup(~n)
            fillRange(n + 1, end, ~arr)
        }
    }
}
fn range(n) {
    let arr = array(dup(~n), 0)
    fillRange(0, n, ~arr)
    arr
}
range(10)`) as Linear[];
        const types = [fill, range].map((f) => {
            const checked = checker.check(f);
            checker.publish(checked);
            return printType(checked.type);
        });
        expect(types).toEqual([
            '(Number, Number, Vector<Number>/Vector<Number>) => ()',
            '(Number) => Vector<Number>',
        ]);
        expect(printType(checker.check(call).type)).toBe('Vector<Number>');
    });
});
