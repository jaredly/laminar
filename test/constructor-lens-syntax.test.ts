import { describe, expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { FileItem, Lens, Linear, Type } from '../src/ast.ts';

// Step 1 of docs/done/scattered-constructor-lenses.md: grammar and AST only. Type checking is
// covered by constructor-lens.test.ts.

const parse = (source: string): FileItem[] =>
    readLines(source).nodes.map((node) => {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse failed: ${source}`);
        return parsed.value;
    });
const strip = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v, (k, x) => (k === 'loc' ? undefined : x)));
const lensBody = (source: string): Lens => {
    const [item] = parse(source);
    const body = (item as Linear & { type: 'fn' }).body;
    if (body.type !== 'lens') throw new Error('Expected a lens body');
    return body.lens;
};
const annotation = (source: string): Type => {
    const [item] = parse(source);
    return (item as Linear & { type: 'fn' }).ann!;
};

describe('constructor lens syntax', () => {
    it('parses a constructor of lenses in lens position', () => {
        expect(strip(lensBody('fn pick(~a) ~{Some(a)}'))).toEqual({
            type: 'constructor',
            name: 'Some',
            args: [{ type: 'id', text: 'a' }],
        });
    });
    it('parses a nullary constructor in lens position', () => {
        expect(strip(lensBody('fn pick(~a) ~{None}'))).toEqual({
            type: 'constructor',
            name: 'None',
            args: [],
        });
    });
    it('parses multiple and nested constructor arguments', () => {
        expect(strip(lensBody('fn pick(~(a, b)) ~{Pair(a, b)}'))).toMatchObject({
            type: 'constructor',
            name: 'Pair',
            args: [{ text: 'a' }, { text: 'b' }],
        });
        expect(strip(lensBody('fn pick(~a) ~{Some(Some(a))}'))).toMatchObject({
            type: 'constructor',
            args: [{ type: 'constructor', name: 'Some', args: [{ text: 'a' }] }],
        });
    });
    it('parses constructor lenses as match arm bodies', () => {
        const [item] = parse(`fn find(needle, ~lst) ~{
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
}`);
        const text = JSON.stringify(strip(item));
        expect(text).toContain('"type":"constructor","name":"Some"');
        expect(text).toContain('"type":"constructor","name":"None"');
    });
    it('does not change lowercase applications in lens position', () => {
        expect(strip(lensBody('fn f(~a) ~{g(a)}'))).toMatchObject({ type: 'apply' });
    });
});

describe('non-replaceable lens type syntax', () => {
    it('keeps ~A and A/B replaceable', () => {
        expect(strip(annotation('fn f(x): ~Number x'))).toEqual({
            type: 'lens',
            left: { type: 'id', text: 'Number' },
        });
        expect(strip(annotation('fn f(x): Number/String x'))).toEqual({
            type: 'lens',
            left: { type: 'id', text: 'Number' },
            right: { type: 'id', text: 'String' },
        });
    });
    it('parses =A as a non-replaceable lens', () => {
        expect(strip(annotation('fn f(x): =Number x'))).toEqual({
            type: 'lens',
            left: { type: 'id', text: 'Number' },
            replaceable: false,
        });
    });
    it('parses A/=B as a non-replaceable lens with distinct endpoints', () => {
        expect(strip(annotation('fn f(x): Number/=String x'))).toEqual({
            type: 'lens',
            left: { type: 'id', text: 'Number' },
            right: { type: 'id', text: 'String' },
            replaceable: false,
        });
    });
});
