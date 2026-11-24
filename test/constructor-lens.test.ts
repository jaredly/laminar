import { describe, expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import { TypeDiagnostic, printType } from '../src/types.ts';

// Step 3 of docs/scattered-constructor-lenses.md: constructor lenses are typed, and a
// constructor of lenses over a multi-constructor type is not replaceable as a whole.
// These tests check types and diagnostics only; lowering and execution are step 4.

const typeOf = (source: string): string => {
    const checker = new Checker();
    let last = '',
        declaration: Decl | undefined;
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        const item = parsed.value;
        if (item.type === 'decl') declaration = item;
        else if (item.type === 'type-alias' || item.type === 'union') checker.addType(item);
        else {
            const checked = checker.check(item, declaration);
            declaration = undefined;
            last = printType(checked.type);
            if (item.type === 'fn' && item.name) checker.publish(checked);
        }
    }
    return last;
};
const code = (source: string): string => {
    try {
        typeOf(source);
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    throw new Error('Expected a diagnostic');
};

const find = `fn find(needle, ~lst) ~{
    match ~lst {
        [x, ...rest] -> {
            match (dup(~x) == dup(~needle)) {
                true -> {
                    Some(x)
                }
                false -> {
                    find(needle, ~rest)
                }
            }
        }
        [] -> {
            None
        }
    }
}
`;
const using = (body: string) => `${find}{
    let x = [1, 2, 3]
${body}
    x
}`;

describe('constructor lens types', () => {
    it('types a constructor of lenses as a non-replaceable lens', () => {
        expect(typeOf('fn pick(~a) ~{Some(a)}')).toBe('(a/b) => Option<a>/=Option<b>');
    });
    it('types a nullary constructor with independent endpoints', () => {
        expect(typeOf('fn pick(~a) ~{None}')).toBe('(a/a) => Option<b>/=Option<c>');
    });
    it('infers the recursive search through branches and a self-call', () => {
        expect(typeOf(find)).toBe(
            '(a, List<a>/List<a>) => Option<a>/=Option<a>', // `==` compares any type
        );
    });
    it('leaves a single-constructor type replaceable', () => {
        const box = 'type Box(a) {\n    Box(a)\n}\nfn bx(~a) ~{Box(a)}\n';
        expect(typeOf(box)).toBe('(a/b) => Box<a>/Box<b>');
        expect(typeOf(`${box}{\n    let x = 1\n    bx(~x) := Box(5)\n    x\n}`)).toBe('Number');
    });
    it('leaves ordinary lens functions unchanged', () => {
        expect(typeOf('fn id(~x) ~x')).toBe('(a/b) => a/b');
    });
});

describe('matching a constructor lens', () => {
    it('accepts the motivating example and restores the list type', () => {
        expect(
            typeOf(
                using(`    match ~find(2, ~x) {
        Some(y) -> {
            y := 20
            ()
        }
        None -> ()
    }`),
            ),
        ).toBe('List<Number>');
    });
    it('rejects writing a different type through the field lens', () => {
        expect(
            code(
                using(`    match ~find(2, ~x) {
        Some(y) -> {
            y := "s"
            ()
        }
        None -> ()
    }`),
            ),
        ).toBe('type-mismatch');
    });
    it('keeps the owner borrowed while the field lens is live', () => {
        expect(
            code(
                using(`    match ~find(2, ~x) {
        Some(y) -> {
            x := []
            y := 1
            ()
        }
        None -> ()
    }`),
            ),
        ).toBe('use-while-borrowed');
    });
});

describe('what a constructor lens cannot do', () => {
    it('cannot be replaced as a whole', () => {
        expect(code(using('    find(1, ~x) := None'))).toBe('not-replaceable');
        expect(code(using('    find(1, ~x) := Some(3)'))).toBe('not-replaceable');
    });
    it('cannot be replaced as a whole through a tuple-pattern parameter', () => {
        expect(code('fn pair(~(a, b)) ~{Some(a)}\n{ let p = (1, 2)\n pair(~p) := None\n p }')).toBe(
            'not-replaceable',
        );
    });
    it('can be bound by name, but the binding keeps the restriction', () => {
        const scoped = (inner: string) =>
            using(`    {
        let r = ~find(2, ~x)
${inner}
    }`);
        expect(typeOf(scoped('        ()'))).toBe('List<Number>');
        expect(code(scoped('        r := None'))).toBe('not-replaceable');
        expect(code(scoped('        let y = r\n        ()'))).toBe('not-replaceable');
        expect(code(scoped('        dup(~r)'))).toBe('replaceable-mismatch');
        // An alias of the binding is restricted too.
        expect(code(scoped('        let q = ~r\n        q := None'))).toBe('not-replaceable');
    });
    it('can be matched through a binding', () => {
        expect(
            typeOf(
                using(`    {
        let r = ~find(2, ~x)
        match ~r {
            Some(y) -> {
                y := 20
                ()
            }
            None -> ()
        }
    }`),
            ),
        ).toBe('List<Number>');
    });
    it('keeps the owner borrowed while the binding is live', () => {
        expect(code(using('    let r = ~find(2, ~x)'))).toBe('use-while-borrowed');
    });
    it('cannot be passed where a stored lens is expected', () => {
        expect(code('fn pick(~a) ~{Some(a)}\n{\n    let x = 1\n    dup(~pick(~x))\n}')).toBe(
            'replaceable-mismatch',
        );
        expect(
            code('fn pick(~a) ~{Some(a)}\nfn id2(~b) ~b\n{\n    let x = 1\n    id2(~pick(~x))\n    x\n}'),
        ).toBe('replaceable-mismatch');
    });
    it('cannot be a tuple item or a constructor field', () => {
        expect(code('fn f(~a) ~{Some(Some(a))}')).toBe('not-replaceable');
        expect(code('fn f(~a) ~(Some(a), None)')).toBe('not-replaceable');
    });
    it('cannot join with a stored lens in a branch', () => {
        expect(
            code(`fn mix(c, ~o) ~{
    match c {
        true -> {
            None
        }
        false -> {
            o
        }
    }
}`),
        ).toBe('replaceable-mismatch');
    });
    it('joins two constructor lenses', () => {
        expect(
            typeOf(`fn mix(c, ~a) ~{
    match c {
        true -> {
            Some(a)
        }
        false -> {
            None
        }
    }
}`),
        ).toBe('(Bool, a/a) => Option<a>/=Option<a>');
    });
});

describe('non-replaceable lens annotations', () => {
    it('rejects a result annotated as non-replaceable when the body is a stored lens', () => {
        expect(code('r :: (Number/Number) => Number/=Number\nfn r(~x) ~x')).toBe(
            'replaceable-mismatch',
        );
    });
    it('rejects a result annotated as replaceable when the body is a constructor lens', () => {
        expect(code('r :: (a/b) => c/d\nfn r(~x) ~{Some(x)}')).toBe('type-mismatch');
    });
});
