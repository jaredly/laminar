/**
 * Here we are using the dsl
 */

import {
    b,
    colon,
    curly,
    Grammar,
    lit,
    many,
    option,
    Pat,
    RawOption,
    RawRule,
    rest,
    round,
    spaced,
    square,
    squish,
    string,
} from './grammar.ts';
import { Id, Node } from './nnodes.ts';

const self = new Grammar();

// NOTE: we should generate return type annotations for rule fns
self.add('Rule', [
    option(
        spaced(b('name', 'id'), curly(many('options', 'RawOption'))),
        ({ name, options }: { name: Id; options: RawOption[] }): RawRule => ({
            name,
            options,
        }),
    ),
]);

self.add('RawOption', [
    option(
        spaced(b('pat', 'Pat'), lit('->'), rest('res', 'any')),
        ({ pat, res }: { pat: Pat; res: Node }): RawOption => ({ pat, res }),
    ),
    option(string(b('text', 'id')), ({ text }: { text: Id }): RawOption => {
        return {
            pat: { type: 'literal', text },
        };
    }),
]);

self.add('Pat', [
    option(string(b('text', 'id')), ({ text }: { text: Id }): Pat => {
        return {
            type: 'literal',
            text,
        };
    }),
    option(
        colon(b('name', 'id'), b('rule', 'id')),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({
            type: 'rule',
            name,
            rule,
        }),
    ),
    option(
        square(spaced(string(b('kind', 'ListKind')), many('items', 'Pat'))),
        ({ kind, items }: { kind: Id; items: Pat[] }): Pat => ({
            type: 'list',
            kind,
            items,
        }),
    ),
    option(
        colon(squish(lit('...'), b('name', 'id')), squish(lit('*'), b('rule', 'id'))),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({
            type: 'rest',
            name,
            rule,
            multi: false,
        }),
    ),
    option(
        colon(squish(lit('...'), b('name', 'id')), squish(lit('**'), b('rule', 'id'))),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({
            type: 'rest',
            name,
            rule,
            multi: true,
        }),
    ),
    option(
        colon(squish(lit('...'), b('name', 'id')), b('rule', 'id')),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({
            type: 'many',
            name,
            rule,
        }),
    ),
    option(
        colon(squish(lit('...'), b('name', 'id')), round(spaced(many('items', 'Pat')))),
        ({ name, items }: { name: Id; items: Pat[] }): Pat => ({
            type: 'many-items',
            name,
            items,
        }),
    ),
    // ...etc.
]);

self.add('ListKind', [
    { pat: lit('') },
    { pat: lit('{') },
    { pat: lit('[') },
    { pat: lit('(') },
    { pat: lit(' ') },
    { pat: lit(': ') },
    { pat: lit('"') },
]);

export { self };
