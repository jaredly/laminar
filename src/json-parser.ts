import { Grammar, Id, Node, option, wrapper, many, list, b, re } from './grammar-lexer.ts';
import { JSONValue, JSONPair } from './json.ts';

export const grammar = new Grammar();

grammar.add('JSONValue', [
    option(
        wrapper('[', list(',', many('value', 'JSONValue'))),
        ({ value }: { value: JSONValue[] }): JSONValue => value,
    ),
    option(wrapper('[', b('value', 'JSONValue')), ({ value }: { value: JSONValue }): JSONValue => [
        value,
    ]),
    option(
        wrapper('{', list(',', many('pair', 'JSONPair'))),
        ({ pair }: { pair: JSONPair[] }): JSONValue => Object.fromEntries(pair),
    ),
    option(wrapper('{', b('pair', 'JSONPair')), ({ pair }: { pair: JSONPair }): JSONValue =>
        Object.fromEntries([pair]),
    ),
    option(list('"', b('text', 'id')), ({ text }: { text: Id }): JSONValue => text.text),
    option(re(/[0-9]+/), ({ node }: { node: Node }): JSONValue => +(node as Id).text),
]);

grammar.add('JSONPair', [
    option(
        list(':', list('"', b('key', 'id')), b('value', 'JSONValue')),
        ({ key, value }: { key: Id; value: JSONValue }): JSONPair => [key.text, value],
    ),
]);
