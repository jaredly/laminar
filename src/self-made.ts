import { Grammar, Id, Node, option, many, list, b, lit, rest } from './grammar.ts';
import { File, FileItem, RawRule, RawOption, Pat, ListKind } from './grammar.ts';

export const grammar = new Grammar();

grammar.add('File', [
    option(
        list('\n', many('items', 'FileItem')),
        ({ items }: { items: FileItem[] }): File => items,
    ),
]);

grammar.add('FileItem', [
    option(b('rule', 'RawRule'), ({ rule }: { rule: RawRule }): FileItem => ({
        type: 'rule',
        rule,
    })),
    option(
        list(' ', lit('function'), rest('rest', 'any')),
        ({ rest }: { rest: Node }): FileItem => ({ type: 'function', rest }),
    ),
    option(list(' ', lit('const'), rest('rest', 'any')), ({ rest }: { rest: Node }): FileItem => ({
        type: 'const',
        rest,
    })),
]);

grammar.add('RawRule', [
    option(
        list(' ', b('name', 'id'), list('{', many('options', 'RawOption'))),
        ({ name, options }: { name: Id; options: RawOption[] }): RawRule => ({ name, options }),
    ),
]);

grammar.add('RawOption', [
    option(
        list(' ', b('pat', 'Pat'), lit('->'), rest('res', 'any')),
        ({ pat, res }: { pat: Pat; res: Node }): RawOption => ({ pat, res }),
    ),
    option(list('"', b('text', 'id')), ({ text }: { text: Id }): RawOption => ({
        pat: { type: 'literal', text },
    })),
]);

grammar.add('Pat', [
    option(list('"', b('text', 'id')), ({ text }: { text: Id }): Pat => ({
        type: 'literal',
        text,
    })),
    option(
        list(': ', b('name', 'id'), b('rule', 'id')),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({ type: 'rule', name, rule }),
    ),
    option(
        list('[', list(' ', list('"', b('kind', 'ListKind')), many('items', 'Pat'))),
        ({ kind, items }: { kind: ListKind; items: Pat[] }): Pat => ({ type: 'list', kind, items }),
    ),
    option(
        list(': ', list('', lit('...'), b('name', 'id')), list('', lit('*'), b('rule', 'id'))),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({
            type: 'rest',
            name,
            rule,
            multi: false,
        }),
    ),
    option(
        list(': ', list('', lit('...'), b('name', 'id')), list('', lit('**'), b('rule', 'id'))),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({
            type: 'rest',
            name,
            rule,
            multi: true,
        }),
    ),
    option(
        list(': ', list('', lit('...'), b('name', 'id')), b('rule', 'id')),
        ({ name, rule }: { name: Id; rule: Id }): Pat => ({ type: 'many', name, rule }),
    ),
    option(
        list(
            ': ',
            list('', lit('...'), b('name', 'id')),
            list('(', list(' ', many('items', 'Pat'))),
        ),
        ({ name, items }: { name: Id; items: Pat[] }): Pat => ({ type: 'many-items', name, items }),
    ),
]);

grammar.add('ListKind', [
    option(lit('')),
    option(lit('{')),
    option(lit('[')),
    option(lit('(')),
    option(lit(' ')),
    option(lit(': ')),
    option(lit('"')),
    option(lit('\n')),
]);
