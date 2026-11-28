import { describe, expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, File, FileItem } from '../src/ast.ts';
import { Checker, checkFile, checkTypedFile } from '../src/check.ts';
import { TypeDiagnostic, printType } from '../src/types.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';

const parseFile = (source: string): File =>
    readLines(source).nodes.map((node) => {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        return parsed.value;
    });
const typeOf = (source: string) => {
    const checker = new Checker();
    let last = '',
        declaration: Decl | undefined;
    for (const item of parseFile(source)) {
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
const run = (source: string) => executeTypedProgram(checkTypedFile(parseFile(source)).program);
const code = (source: string) => {
    try {
        typeOf(source);
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    throw new Error('Expected a diagnostic');
};

describe('records: parsing', () => {
    it('parses literals, patterns and types', () => {
        const [lit] = parseFile('{x: 1, y: 2}');
        expect(lit).toMatchObject({ type: 'record', fields: [{ name: 'x' }, { name: 'y' }] });
        const [single] = parseFile('{x: 1}');
        expect(single).toMatchObject({ type: 'record', fields: [{ name: 'x' }] });
        const [fn] = parseFile('fn f({x, y: b}) { x }');
        expect(fn).toMatchObject({
            args: [
                {
                    pat: {
                        type: 'record',
                        fields: [{ name: 'x', pat: { type: 'id' } }, { name: 'y' }],
                    },
                },
            ],
        });
        const [alias] = parseFile('type P = {x: Number, y: Bool}');
        expect(alias).toMatchObject({ alias: { type: 'record' } });
    });
});

describe('records: types', () => {
    it('infers structural, field-order independent types', () => {
        expect(typeOf('{y: true, x: 1}')).toBe('{x: Number, y: Bool}');
        expect(typeOf('{x: {y: 1}}')).toBe('{x: {y: Number}}');
        expect(typeOf('{x: 1}')).toBe('{x: Number}');
    });
    it('destructures, in any field order', () => {
        expect(typeOf('{\n let {y, x} = {x: 1, y: true}\n (y, x)\n}')).toBe('(Bool, Number)');
        expect(typeOf('{\n let {x: a, y: _} = {x: 1, y: true}\n a\n}')).toBe('Number');
    });
    it('checks annotations and aliases', () => {
        const src =
            'type P = {x: Number, y: Bool}\nf :: (P) => Number\nfn f({x, y: _}) { x }\nf({y: false, x: 3})';
        expect(typeOf(src)).toBe('Number');
        expect(
            code('type P = {x: Number}\nf :: (P) => Number\nfn f({x}) { x }\nf({x: true})'),
        ).toBe('type-mismatch');
    });
    it('rejects mismatches', () => {
        expect(code('{\n let {x, z} = {x: 1, y: 2}\n x\n}')).toBe('type-mismatch');
        // A pattern may name only some of the fields.
        expect(typeOf('{\n let {x} = {x: 1, y: 2}\n x\n}')).toBe('Number');
        expect(code('{x: 1, x: 2}')).toBe('duplicate-field');
        expect(code('{\n let {x, x} = {x: 1}\n x\n}')).toBe('duplicate-field');
    });
    it('keeps affine use per record', () => {
        expect(code('{\n let r = {x: 1}\n (r, r)\n}')).toBe('use-after-move');
    });
    it('supports lens patterns that update one field in place', () => {
        const src = `fn inc(~c) { c := c + 1 }
fn bumpx(~{x, y}) {
    inc(~x)
    2
}
{
    let r = {y: true, x: 1}
    (bumpx(~r), r)
}`;
        expect(typeOf(src)).toBe('(Number, {x: Number, y: Bool})');
    });
});

describe('records: reference evaluation', () => {
    it('builds, destructures and updates', () => {
        // Evaluated as name-sorted tuples.
        expect(run('{y: 2, x: 1}')).toEqual([1, 2]);
        expect(run('{\n let {y, x} = {x: 1, y: 2}\n (y, x)\n}')).toEqual([2, 1]);
        expect(
            run(`fn inc(~c) { c := c + 1 }
fn bumpx(~{x, y}) {
    inc(~x)
    2
}
{
    let r = {y: 10, x: 1}
    (bumpx(~r), r)
}`),
        ).toEqual([2, [2, 10]]);
    });
    it('matches nested record patterns in case', () => {
        expect(
            run(`{
    match {a: Some(1), b: 5} {
        {a: Some(n), b} -> n + b
        {a: None, b} -> b
    }
}`),
        ).toEqual(6);
    });
    it('goes through the legacy decomposition too', () => {
        const file = parseFile('{\n let {y, x} = {x: 1, y: 2}\n (y, x)\n}');
        expect(() => checkFile(file)).not.toThrow();
    });
});

describe('records: attribute access', () => {
    it('moves one field out of a record, leaving the rest usable', () => {
        expect(typeOf('{\n let r = {x: 1, y: true}\n (r.y, r.x)\n}')).toBe('(Bool, Number)');
        expect(typeOf('{\n let r = {a: {b: 1}, c: 2}\n r.a.b\n}')).toBe('Number');
        expect(run('{\n let r = {y: 10, x: 1}\n (r.y, r.x)\n}')).toEqual([10, 1]);
        expect(run('{\n let r = {a: {b: 7}, c: 2}\n r.a.b + r.c\n}')).toEqual(9);
    });
    it('is affine per field', () => {
        expect(code('{\n let r = {x: 1}\n (r.x, r.x)\n}')).toBe('use-after-move');
        expect(code('{\n let r = {x: 1, y: 2}\n let a = r.x\n r\n}')).toBe('use-after-move');
    });
    it('rejects unknown fields and unknown record types', () => {
        expect(code('{\n let r = {x: 1}\n r.z\n}')).toBe('unknown-field');
        // A value of unknown type becomes a record with at least that field.
        expect(typeOf('fn f(r) { r.x }')).toBe('({x: a, ...b}) => a');
        expect(code('{\n let r = 1\n r.x\n}')).toBe('unknown-record');
        expect(code('f(1).x')).toBe('field-target');
    });
    it('focuses a field as a lens', () => {
        const src = `fn inc(~c) { c := c + 1 }
{
    let r = {y: 10, x: 1}
    inc(~r.x)
    r.x := r.x + 5
    r
}`;
        expect(typeOf(src)).toBe('{x: Number, y: Number}');
        expect(run(src)).toEqual([7, 10]);
        expect(
            run(`fn inc(~c) { c := c + 1 }
{
    let r = {a: {b: 1}, c: 0}
    inc(~r.a.b)
    r
}`),
        ).toEqual([[2], 0]);
    });
    it('supports persistent field aliases', () => {
        const src = `fn inc(~c) { c := c + 1 }
{
    let r = {y: 10, x: 1}
    {
        let a = ~r.x
        inc(~a)
    }
    r
}`;
        expect(run(src)).toEqual([2, 10]);
    });
    it('is not available to the legacy decomposition', () => {
        const file = parseFile('{\n let r = {x: 1}\n r.x\n}');
        expect(checkFile(file).expressions).toHaveLength(1);
        expect(() => checkFile(file).ir).toThrow('legacy');
    });
});
