import { grammar } from './json-parser.ts';
import { compact, read } from './lexer.ts';
import { it, expect } from 'bun:test';

const j = (v: string) => {
    const res = grammar.parse('JSONValue', read(v));
    if (res.type === 'failure') {
        expect(res).toMatchObject({ type: 'success' });
        return null;
    }
    return res.value;
};

it('should parse a string', () => {
    expect(grammar.parse('JSONValue', read('"Hello"'))).toMatchObject({ value: 'Hello' });
});

it('should parse an array', () => {
    const node = read('["a", "b", "cde"]');
    expect(compact(node)).toEqual(['[,', ['"', 'a'], ['"', 'b'], ['"', 'cde']]);
    expect(grammar.parse('JSONValue', node)).toMatchObject({
        value: ['a', 'b', 'cde'],
    });
});

it('should parse a zero', () => {
    expect(j('0')).toEqual(0);
});

it('should parse a single element', () => {
    expect(j('[0]')).toEqual([0]);
});

it('should ignore newlines', () => {
    expect(
        j(`[0
        ]`),
    ).toEqual([0]);
});

it('should parse a complex thing', () => {
    expect(j('{"one": [0,1], "two": [[0]]}')).toEqual({
        one: [0, 1],
        two: [[0]],
    });
});
