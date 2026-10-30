import {
    Grammar,
    Id,
    Op,
    Node,
    option,
    many,
    list,
    b,
    lit,
    rest,
    wrapper,
    re,
} from './grammar-lexer.ts';
import { File, FileItem, ConfigValue, RawRule, RawOption, Pat } from './grammar-lexer.ts';

export const grammar = new Grammar({});

grammar.add('File', [
    // File:1
    option(
        list('\n', many('items', 'FileItem')),
        ({ items, node }: { items: FileItem[]; node: Node }): File => items,
    ),
]);

grammar.add('FileItem', [
    // FileItem:1
    option(b('rule', 'RawRule'), ({ rule, node }: { rule: RawRule; node: Node }): FileItem => ({
        type: 'rule',
        rule,
    })),
    // FileItem:2
    option(
        list(' ', lit('function'), rest('rest', 'any', false)),
        ({ rest, node }: { rest: Node; node: Node }): FileItem => ({ type: 'function', rest }),
    ),
    // FileItem:3
    option(
        list(' ', lit('const'), rest('rest', 'any', false)),
        ({ rest, node }: { rest: Node; node: Node }): FileItem => ({ type: 'const', rest }),
    ),
    // FileItem:4
    option(
        list(' ', lit('import'), rest('rest', 'any', false)),
        ({ rest, node }: { rest: Node; node: Node }): FileItem => ({ type: 'import', rest }),
    ),
    // FileItem:5
    option(
        list(
            ' ',
            list('', lit('@'), lit('config')),
            wrapper('{', list('\n', many('config', 'ConfigItem'))),
        ),
        ({ config, node }: { config: [string, ConfigValue][]; node: Node }): FileItem => ({
            type: 'config',
            values: Object.fromEntries(config),
        }),
    ),
    // FileItem:6
    option(
        list(' ', list('', lit('@'), lit('config')), wrapper('{', null)),
        ({ node }: { node: Node }): FileItem => ({ type: 'config', values: {} }),
    ),
]);

grammar.add('ConfigItem', [
    // ConfigItem:1
    option(
        list(':', b('name', 'id'), b('value', 'ConfigValue')),
        ({
            name,
            value,
            node,
        }: {
            name: Id;
            value: ConfigValue;
            node: Node;
        }): [string, ConfigValue] => [name.text, value],
    ),
]);

grammar.add('ConfigValue', [
    // ConfigValue:1
    option(
        wrapper('[', list(' ', many('values', 'ConfigValue'))),
        ({ values, node }: { values: ConfigValue[]; node: Node }): ConfigValue => values,
    ),
    // ConfigValue:2
    option(b('id', 'id'), ({ id, node }: { id: Id; node: Node }): ConfigValue => id.text),
    // ConfigValue:3
    option(b('op', 'op'), ({ op, node }: { op: Op; node: Node }): ConfigValue => op.text),
    // ConfigValue:4
    option(
        b('num', /^[0-9]+$/),
        ({ num, node }: { num: Id; node: Node }): ConfigValue => +num.text,
    ),
    // ConfigValue:5
    option(
        list('"', b('text', 'id')),
        ({ text, node }: { text: Id; node: Node }): ConfigValue => text.text,
    ),
]);

grammar.add('RawRule', [
    // RawRule:1
    option(
        list(' ', b('name', 'RuleName'), wrapper('{', list('\n', many('options', 'RawOption')))),
        ({
            name,
            options,
            node,
        }: {
            name: { name: Id; ann?: Node };
            options: RawOption[];
            node: Node;
        }): RawRule => ({ name, options }),
    ),
    // RawRule:2
    option(
        list(' ', b('name', 'RuleName'), wrapper('{', b('option', 'RawOption'))),
        ({
            name,
            option,
            node,
        }: {
            name: { name: Id; ann?: Node };
            option: RawOption;
            node: Node;
        }): RawRule => ({ name, options: [option] }),
    ),
]);

grammar.add('RuleName', [
    // RuleName:1
    option(
        b('name', 'id'),
        ({ name, node }: { name: Id; node: Node }): { name: Id; ann?: Node } => ({ name }),
    ),
    // RuleName:2
    option(
        list(':', b('name', 'id'), b('ann', 'any')),
        ({ name, ann, node }: { name: Id; ann: Node; node: Node }): { name: Id; ann?: Node } => ({
            name,
            ann,
        }),
    ),
]);

grammar.add('RawOption', [
    // RawOption:1
    option(
        list(' ', b('pat', 'Pat'), lit('->'), rest('res', 'any', false)),
        ({ pat, res, node }: { pat: Pat; res: Node; node: Node }): RawOption => ({ pat, res }),
    ),
    // RawOption:2
    option(list('"', b('text', 'id')), ({ text, node }: { text: Id; node: Node }): RawOption => ({
        pat: { type: 'literal', text },
    })),
    // RawOption:3
    option(
        list('', lit('re'), list('"', b('raw', 'id'))),
        ({ raw, node }: { raw: Id; node: Node }): RawOption => ({
            pat: { type: 'regexp', regexp: new RegExp(raw.text) },
        }),
    ),
]);

function parseList(kind: Id, items: Pat[]): Pat {
    if ('{[('.includes(kind.text[0])) {
        return {
            type: 'wrapper',
            kind: { ...kind, text: kind.text[0] },
            child: { type: 'list', kind: { ...kind, text: kind.text[1] }, items },
        };
    }
    return { type: 'list', kind, items };
}

grammar.add('Pat', [
    // Pat:1
    option(list('"', b('text', 'id')), ({ text, node }: { text: Id; node: Node }): Pat => ({
        type: 'literal',
        text,
    })),
    // Pat:2
    option(
        list(':', b('name', 'id'), b('rule', 'id')),
        ({ name, rule, node }: { name: Id; rule: Id; node: Node }): Pat => ({
            type: 'rule',
            name,
            rule,
        }),
    ),
    // Pat:3
    option(
        list(':', b('name', 'id'), list('', lit('re'), list('"', b('raw', 'id')))),
        ({ name, raw, node }: { name: Id; raw: Id; node: Node }): Pat => ({
            type: 'rule',
            name,
            rule: { type: 'regex', rx: new RegExp(raw.text) },
        }),
    ),
    // Pat:4
    option(
        wrapper('[', list(' ', list('"', b('kind', 'WrapperKind')), b('child', 'Pat'))),
        ({ kind, child, node }: { kind: Id; child: Pat; node: Node }): Pat => ({
            type: 'wrapper',
            kind,
            child,
        }),
    ),
    // Pat:5
    option(
        wrapper('[', list(' ', list('"', b('kind', 'ListKind')), many('items', 'Pat'))),
        ({ kind, items, node }: { kind: Id; items: Pat[]; node: Node }): Pat =>
            parseList(kind, items),
    ),
    // Pat:6
    option(
        wrapper('[', list('"', b('kind', 'WrapperKind'))),
        ({ kind, node }: { kind: Id; node: Node }): Pat => ({
            type: 'wrapper',
            kind,
            loc: node.loc,
        }),
    ),
    // Pat:7
    option(wrapper('[', list('"', lit('"'))), ({ node }: { node: Node }): Pat => ({
        type: 'list',
        kind: '"',
        items: [],
        loc: node.loc,
    })),
    // Pat:8
    option(
        list(':', list('', lit('...'), b('name', 'id')), list('', lit('*'), b('rule', 'id'))),
        ({ name, rule, node }: { name: Id; rule: Id; node: Node }): Pat => ({
            type: 'rest',
            name,
            rule,
            multi: !1,
        }),
    ),
    // Pat:9
    option(
        list(':', list('', lit('...'), b('name', 'id')), list('', lit('**'), b('rule', 'id'))),
        ({ name, rule, node }: { name: Id; rule: Id; node: Node }): Pat => ({
            type: 'rest',
            name,
            rule,
            multi: !0,
        }),
    ),
    // Pat:10
    option(
        list(':', list('', lit('...'), b('name', 'id')), b('rule', 'id')),
        ({ name, rule, node }: { name: Id; rule: Id; node: Node }): Pat => ({
            type: 'many',
            name,
            rule,
        }),
    ),
    // Pat:11
    option(
        list(
            ':',
            list('', lit('...'), b('name', 'id')),
            wrapper('(', list(' ', many('items', 'Pat'))),
        ),
        ({ name, items, node }: { name: Id; items: Pat[]; node: Node }): Pat => ({
            type: 'many-items',
            name,
            items,
        }),
    ),
    // Pat:12
    option(
        list('', lit('re'), list('"', b('raw', 'id'))),
        ({ raw, node }: { raw: Id; node: Node }): Pat => ({
            type: 'regexp',
            regexp: new RegExp(raw.text),
        }),
    ),
]);

grammar.add('WrapperKind', [
    // WrapperKind:1
    option(lit('{')),
    // WrapperKind:2
    option(lit('(')),
    // WrapperKind:3
    option(lit('[')),
]);

grammar.add('ListKind', [
    // ListKind:1
    option(re(/[{([][ ,;:\n]/)),
    // ListKind:2
    option(lit(',')),
    // ListKind:3
    option(lit(';')),
    // ListKind:4
    option(lit('')),
    // ListKind:5
    option(lit(' ')),
    // ListKind:6
    option(lit(':')),
    // ListKind:7
    option(lit('"')),
    // ListKind:8
    option(lit('\n')),
]);
