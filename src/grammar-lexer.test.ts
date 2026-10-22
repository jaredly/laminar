import { b, Grammar, Id, list, lit, many, option, re, wrapper } from './grammar-lexer.ts';
import { it, expect } from 'bun:test';
import { compact, read } from './lexer.ts';

type JSONValue = { [key: string]: JSONValue } | string | JSONValue[] | number | null;

const grammar = new Grammar();

grammar.add('JSONValue', [
    option(
        wrapper('[', list(',', many('value', 'JSONValue'))),
        ({ value }: { value: JSONValue[] }) => value,
    ),
    option(wrapper('[', b('value', 'JSONValue')), ({ value }: { value: JSONValue }) => [value]),
    option(
        wrapper('{', list(',', many('pairs', 'JSONPair'))),
        ({ pairs }: { pairs: [string, JSONValue][] }) => Object.fromEntries(pairs),
    ),
    option(wrapper('{', b('pair', 'JSONPair')), ({ pair }: { pair: [string, JSONValue] }) =>
        Object.fromEntries([pair]),
    ),
    option(list('"', b('text', 'id')), ({ text }: { text: Id }) => text.text),
    option(re(/[0-9]+/), ({ node }: { node: Id }) => +node.text),
]);

grammar.add('JSONPair', [
    option(
        list(':', list('"', b('key', 'id')), b('value', 'JSONValue')),
        ({ key, value }: { key: Id; value: JSONValue }) => [key.text, value],
    ),
]);

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
