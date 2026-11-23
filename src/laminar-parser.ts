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
    manyItems,
} from './grammar-lexer.ts';
import {
    File,
    FileItem,
    TypeDecl,
    TypeConstr,
    Pat,
    TypeField,
    PatField,
    RecordField,
    Type,
    Term,
    Lens,
    LensOp,
    Linear,
    LinearOps,
    FnArg,
    LinearCase,
    LensCase,
    LinearInterp,
} from './ast.ts';

export const grammar = new Grammar({
    reserved: ['let', 'lens', 'mut', 'linear', '~', '<-', '=', ':=', 'case', '::', '=>', '_', '@'],
});

grammar.add('File', [
    // File:1
    option(
        list('\n', many('items', 'FileItem')),
        ({ items, node }: { items: FileItem[]; node: Node }): File => items,
    ),
    // File:2
    option(b('item', 'FileItem'), ({ item, node }: { item: FileItem; node: Node }): File => [item]),
]);

grammar.add('FileItem', [
    // FileItem:1
    option(
        list(' ', b('name', 'id'), lit('::'), rest('ann', 'Type', false)),
        ({ name, ann, node }: { name: Id; ann: Type; node: Node }): FileItem => ({
            type: 'decl',
            name,
            ann,
            loc: node.loc,
        }),
    ),
    // FileItem:2
    option(
        b('decl', 'TypeDecl'),
        ({ decl, node }: { decl: TypeDecl; node: Node }): FileItem => decl,
    ),
    // FileItem:3
    option(
        b('linear', 'Linear'),
        ({ linear, node }: { linear: Linear; node: Node }): FileItem => linear,
    ),
]);

grammar.add('TypeDecl', [
    // TypeDecl:1
    option(
        list(' ', lit('type'), b('name', 'id'), lit('='), b('alias', 'Type')),
        ({ name, alias, node }: { name: Id; alias: Type; node: Node }): TypeDecl => ({
            type: 'type-alias',
            name,
            alias,
            loc: node.loc,
        }),
    ),
    // TypeDecl:2
    option(
        list(
            ' ',
            lit('type'),
            list('', b('name', 'id'), wrapper('(', list(',', many('args', 'id')))),
            lit('='),
            b('alias', 'Type'),
        ),
        ({
            name,
            args,
            alias,
            node,
        }: {
            name: Id;
            args: Id[];
            alias: Type;
            node: Node;
        }): TypeDecl => ({
            type: 'type-alias',
            name,
            args,
            alias,
            loc: node.loc,
        }),
    ),
    // TypeDecl:3
    option(
        list(
            ' ',
            lit('type'),
            b('name', 'id'),
            wrapper('{', list('\n', many('items', 'TypeConstr'))),
        ),
        ({ name, items, node }: { name: Id; items: TypeConstr[]; node: Node }): TypeDecl => ({
            type: 'union',
            name,
            items,
            loc: node.loc,
        }),
    ),
    // TypeDecl:4
    option(
        list(
            ' ',
            lit('type'),
            list('', b('name', 'id'), wrapper('(', list(',', many('args', 'id')))),
            wrapper('{', list('\n', many('items', 'TypeConstr'))),
        ),
        ({
            name,
            args,
            items,
            node,
        }: {
            name: Id;
            args: Id[];
            items: TypeConstr[];
            node: Node;
        }): TypeDecl => ({ type: 'union', name, args, items, loc: node.loc }),
    ),
    // TypeDecl:5
    option(
        list(' ', lit('type'), lit('linear'), b('name', 'id'), lit('='), b('alias', 'Type')),
        ({ name, alias, node }: { name: Id; alias: Type; node: Node }): TypeDecl => ({
            type: 'type-alias',
            name,
            alias,
            linear: true,
            loc: node.loc,
        }),
    ),
    // TypeDecl:6
    option(
        list(
            ' ',
            lit('type'),
            lit('linear'),
            list('', b('name', 'id'), wrapper('(', list(',', many('args', 'id')))),
            lit('='),
            b('alias', 'Type'),
        ),
        ({
            name,
            args,
            alias,
            node,
        }: {
            name: Id;
            args: Id[];
            alias: Type;
            node: Node;
        }): TypeDecl => ({
            type: 'type-alias',
            name,
            args,
            alias,
            linear: true,
            loc: node.loc,
        }),
    ),
    // TypeDecl:7
    option(
        list(
            ' ',
            lit('type'),
            lit('linear'),
            b('name', 'id'),
            wrapper('{', list('\n', many('items', 'TypeConstr'))),
        ),
        ({ name, items, node }: { name: Id; items: TypeConstr[]; node: Node }): TypeDecl => ({
            type: 'union',
            name,
            items,
            linear: true,
            loc: node.loc,
        }),
    ),
    // TypeDecl:8
    option(
        list(
            ' ',
            lit('type'),
            lit('linear'),
            list('', b('name', 'id'), wrapper('(', list(',', many('args', 'id')))),
            wrapper('{', list('\n', many('items', 'TypeConstr'))),
        ),
        ({
            name,
            args,
            items,
            node,
        }: {
            name: Id;
            args: Id[];
            items: TypeConstr[];
            node: Node;
        }): TypeDecl => ({
            type: 'union',
            name,
            args,
            items,
            linear: true,
            loc: node.loc,
        }),
    ),
]);

grammar.add('TypeConstr', [
    // TypeConstr:1
    option(b('name', /^[A-Z]/), ({ name, node }: { name: Id; node: Node }): TypeConstr => ({
        name,
        loc: node.loc,
    })),
    // TypeConstr:2
    option(
        list('', b('name', /^[A-Z]/), wrapper('(', list(',', many('args', 'Type')))),
        ({ name, args, node }: { name: Id; args: Type[]; node: Node }): TypeConstr => ({
            name,
            args,
            loc: node.loc,
        }),
    ),
]);

function pcons(items: Pat[], loc: number) {
    let last = items[items.length - 1];
    for (let i = items.length - 2; i >= 0; i--) {
        last = {
            type: 'constructor',
            name: 'cons',
            args: [items[i], last],
            loc,
        };
    }
    return last;
}

function econs(items: Linear[], loc: number) {
    let last = items[items.length - 1];
    for (let i = items.length - 2; i >= 0; i--) {
        last = {
            type: 'constructor',
            name: 'cons',
            args: [items[i], last],
            loc,
        };
    }
    return last;
}

grammar.add('Pat', [
    // Pat:1
    option(lit('_'), ({ node }: { node: Node }): Pat => ({ type: 'drop', loc: node.loc })),
    // Pat:2
    option(b('bool', /true|false/), ({ bool, node }: { bool: Id; node: Node }): Pat => ({
        type: 'bool',
        loc: node.loc,
        value: bool.text === 'true',
    })),
    // Pat:3
    option(
        list('', b('one', /^[0-9]+$/), lit('.'), b('two', /^[0-9]+$/)),
        ({ one, two, node }: { one: Id; two: Id; node: Node }): Pat => ({
            type: 'number',
            value: +(one.text + '.' + two.text),
            loc: node.loc,
        }),
    ),
    // Pat:4
    option(re(/^[0-9]+$/), ({ node }: { node: Node }): Pat => ({
        type: 'number',
        value: +(node as Id).text,
        loc: node.loc,
    })),
    // Pat:5
    option(b('name', /^[A-Z]/), ({ name, node }: { name: Id; node: Node }): Pat => ({
        type: 'constructor',
        name: name.text,
        args: [],
        loc: node.loc,
    })),
    // Pat:6
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Pat => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Pat:7
    option(
        list('', lit('~'), b('inner', 'Pat')),
        ({ inner, node }: { inner: Pat; node: Node }): Pat => ({
            type: 'lens',
            inner,
            loc: node.loc,
        }),
    ),
    // Pat:8
    option(
        list('', b('name', 'id'), wrapper('(', list(',', many('args', 'Pat')))),
        ({ name, args, node }: { name: Id; args: Pat[]; node: Node }): Pat => ({
            type: 'constructor',
            name: name.text,
            args,
            loc: node.loc,
        }),
    ),
    // Pat:9
    option(
        wrapper('{', list(',', many('fields', 'PatField'))),
        ({ fields, node }: { fields: PatField[]; node: Node }): Pat => ({
            type: 'record',
            fields,
            loc: node.loc,
        }),
    ),
    // Pat:10
    option(
        wrapper('{', b('one', 'PatField')),
        ({ one, node }: { one: PatField; node: Node }): Pat => ({
            type: 'record',
            fields: [one],
            loc: node.loc,
        }),
    ),
    // Pat:11
    option(
        wrapper('(', list(',', many('items', 'Pat'))),
        ({ items, node }: { items: Pat[]; node: Node }): Pat =>
            items.length === 1 ? items[0] : { type: 'tuple', items, loc: node.loc },
    ),
    // Pat:12
    option(wrapper('(', null), ({ node }: { node: Node }): Pat => ({
        type: 'tuple',
        items: [],
        loc: node.loc,
    })),
    // Pat:13
    option(wrapper('[', null), ({ node }: { node: Node }): Pat => ({
        type: 'constructor',
        name: 'nil',
        args: [],
        loc: node.loc,
    })),
    // Pat:14
    option(
        wrapper('[', list(',', many('items', 'Pat'))),
        ({ items, node }: { items: Pat[]; node: Node }): Pat =>
            pcons(
                [
                    ...items,
                    {
                        type: 'constructor',
                        name: 'nil',
                        args: [],
                        loc: node.loc,
                    },
                ],
                node.loc,
            ),
    ),
    // Pat:15
    option(
        wrapper(
            '[',
            list(',', many('items', 'Pat'), list('', lit('...'), rest('tail', 'Pat', false))),
        ),
        ({ items, tail, node }: { items: Pat[]; tail: Pat; node: Node }): Pat =>
            pcons([...items, tail], node.loc),
    ),
    // Pat:16
    option(list('"', b('text', 'id')), ({ text, node }: { text: Id; node: Node }): Pat => ({
        type: 'string',
        text: text.text,
        loc: node.loc,
    })),
    // Pat:17
    option(list('"'), ({ node }: { node: Node }): Pat => ({
        type: 'string',
        text: '',
        loc: node.loc,
    })),
    // Pat:18
    option(list('', b('one', 'Pat')), ({ one, node }: { one: Pat; node: Node }): Pat => one),
]);

grammar.add('TypeField', [
    // TypeField:1
    option(
        list(':', b('name', 'id'), b('type', 'Type')),
        ({ name, type, node }: { name: Id; type: Type; node: Node }): TypeField => ({
            name: name.text,
            type,
            loc: node.loc,
        }),
    ),
]);

grammar.add('PatField', [
    // PatField:1
    option(
        list(':', b('name', 'id'), b('pat', 'Pat')),
        ({ name, pat, node }: { name: Id; pat: Pat; node: Node }): PatField => ({
            name: name.text,
            pat,
            loc: node.loc,
        }),
    ),
    // PatField:2
    option(b('name', 'id'), ({ name, node }: { name: Id; node: Node }): PatField => ({
        name: name.text,
        pat: { type: 'id', text: name.text, loc: node.loc } as Pat,
        loc: node.loc,
    })),
]);

grammar.add('RecordField', [
    // RecordField:1
    option(
        list(':', b('name', 'id'), b('value', 'Linear')),
        ({ name, value, node }: { name: Id; value: Linear; node: Node }): RecordField => ({
            name: name.text,
            value,
            loc: node.loc,
        }),
    ),
]);

grammar.add('Type', [
    // Type:1
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Type => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Type:2
    option(
        list('', lit('~'), b('left', 'Type')),
        ({ left, node }: { left: Type; node: Node }): Type => ({ type: 'lens', left }),
    ),
    // Type:3
    option(
        list('', lit('='), b('left', 'Type')),
        ({ left, node }: { left: Type; node: Node }): Type => ({
            type: 'lens',
            left,
            replaceable: false,
        }),
    ),
    // Type:4
    option(
        list('', b('left', 'Type'), lit('/'), b('right', 'Type')),
        ({ left, right, node }: { left: Type; right: Type; node: Node }): Type => ({
            type: 'lens',
            left,
            right,
        }),
    ),
    // Type:5
    option(
        list('', b('left', 'Type'), lit('/='), b('right', 'Type')),
        ({ left, right, node }: { left: Type; right: Type; node: Node }): Type => ({
            type: 'lens',
            left,
            right,
            replaceable: false,
        }),
    ),
    // Type:6
    option(
        list('', b('name', 'id'), wrapper('(', list(',', many('args', 'Type')))),
        ({ name, args, node }: { name: Id; args: Type[]; node: Node }): Type => ({
            type: 'constr',
            name,
            args,
            loc: node.loc,
        }),
    ),
    // Type:7
    option(
        wrapper('(', list(',', many('items', 'Type'))),
        ({ items, node }: { items: Type[]; node: Node }): Type => ({ type: 'tuple', items }),
    ),
    // Type:8
    option(
        wrapper('{', list(',', many('fields', 'TypeField'))),
        ({ fields, node }: { fields: TypeField[]; node: Node }): Type => ({
            type: 'record',
            fields,
            loc: node.loc,
        }),
    ),
    // Type:9
    option(
        wrapper('{', b('one', 'TypeField')),
        ({ one, node }: { one: TypeField; node: Node }): Type => ({
            type: 'record',
            fields: [one],
            loc: node.loc,
        }),
    ),
    // Type:10
    option(wrapper('(', null), ({ node }: { node: Node }): Type => ({ type: 'tuple', items: [] })),
    // Type:11
    option(
        list(' ', wrapper('(', list(',', many('args', 'Type'))), lit('=>'), b('body', 'Type')),
        ({ args, body, node }: { args: Type[]; body: Type; node: Node }): Type => ({
            type: 'fn',
            args,
            body,
        }),
    ),
]);

grammar.add('Term', [
    // Term:1
    option(list(' ', b('one', 'Term')), ({ one, node }: { one: Term; node: Node }): Term => one),
    // Term:2
    option(
        list('', lit('~'), rest('lens', 'Lens', false)),
        ({ lens, node }: { lens: Lens; node: Node }): Term => ({ type: 'lens', lens }),
    ),
    // Term:3
    option(
        wrapper('{', list('', lit('~'), rest('lens', 'Lens', false))),
        ({ lens, node }: { lens: Lens; node: Node }): Term => ({ type: 'lens', lens }),
    ),
    // Term:4
    option(
        b('linear', 'Linear'),
        ({ linear, node }: { linear: Linear; node: Node }): Term => linear,
    ),
]);

grammar.add('Lens', [
    // Lens:1
    option(b('text', /^[A-Z]/), ({ text, node }: { text: Id; node: Node }): Lens => ({
        type: 'constructor',
        name: text.text,
        args: [],
        loc: text.loc,
    })),
    // Lens:2
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Lens => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Lens:3
    option(list('', b('one', 'Lens')), ({ one, node }: { one: Lens; node: Node }): Lens => one),
    // Lens:4
    option(list(' ', b('one', 'Lens')), ({ one, node }: { one: Lens; node: Node }): Lens => one),
    // Lens:5
    option(
        list('', b('fn', /^[A-Z]/), wrapper('(', list(',', many('args', 'Lens')))),
        ({ fn, args, node }: { fn: Id; args: Lens[]; node: Node }): Lens => ({
            type: 'constructor',
            name: fn.text,
            args,
            loc: fn.loc,
        }),
    ),
    // Lens:6
    option(
        list('', b('fn', 'Linear'), wrapper('(', list(',', many('args', 'Term')))),
        ({ fn, args, node }: { fn: Linear; args: Term[]; node: Node }): Lens => ({
            type: 'apply',
            fn,
            args,
            loc: node.loc,
        }),
    ),
    // Lens:7
    option(
        list('', b('target', 'Lens'), rest('ops', 'LensOp', true)),
        ({ target, ops, node }: { target: Lens; ops: LensOp[]; node: Node }): Lens =>
            handleLensOps(target, ops, node.loc),
    ),
    // Lens:8
    option(
        wrapper('(', list(',', many('items', 'Lens'))),
        ({ items, node }: { items: Lens[]; node: Node }): Lens =>
            items.length === 1 ? items[0] : { type: 'tuple', items, loc: node.loc },
    ),
    // Lens:9
    option(wrapper('(', null), ({ node }: { node: Node }): Lens => ({
        type: 'tuple',
        items: [],
        loc: node.loc,
    })),
    // Lens:10
    option(wrapper('{', b('one', 'Lens')), ({ one, node }: { one: Lens; node: Node }): Lens => one),
    // Lens:11
    option(wrapper('(', null), ({ node }: { node: Node }): Lens => ({
        type: 'tuple',
        items: [],
        loc: node.loc,
    })),
    // Lens:12
    option(
        wrapper(
            '{',
            list(
                '\n',
                list(' ', lit('let'), b('pat', 'Pat'), lit('='), rest('value', 'Term', false)),
                rest('body', 'Lens', false),
            ),
        ),
        ({ pat, value, body, node }: { pat: Pat; value: Term; body: Lens; node: Node }): Lens => ({
            type: 'let',
            pat,
            value,
            body,
            loc: node.loc,
        }),
    ),
    // Lens:13
    option(
        wrapper(
            '{',
            list(
                '\n',
                list(
                    ' ',
                    lit('let'),
                    lit('mut'),
                    b('pat', 'Pat'),
                    lit('='),
                    rest('value', 'Term', false),
                ),
                rest('body', 'Lens', false),
            ),
        ),
        ({ pat, value, body, node }: { pat: Pat; value: Term; body: Lens; node: Node }): Lens => ({
            type: 'let',
            pat,
            value,
            body,
            mut: true,
            loc: node.loc,
        }),
    ),
    // Lens:14
    option(
        wrapper(
            '{',
            list(
                '\n',
                list(' ', lit('lens'), b('pat', 'Pat'), lit('<-'), rest('value', 'Linear', false)),
                rest('body', 'Linear', false),
            ),
        ),
        ({
            pat,
            value,
            body,
            node,
        }: {
            pat: Pat;
            value: Linear;
            body: Linear;
            node: Node;
        }): Lens => ({ type: 'aslens', pat, value, body, loc: node.loc }),
    ),
    // Lens:15
    option(
        wrapper('{', list('\n', b('one', 'Lens'))),
        ({ one, node }: { one: Lens; node: Node }): Lens => one,
    ),
    // Lens:16
    option(list('\n', b('one', 'Lens')), ({ one, node }: { one: Lens; node: Node }): Lens => one),
    // Lens:17
    option(
        wrapper('{', list('\n', b('value', 'Term'), rest('body', 'Lens', false))),
        ({ value, body, node }: { value: Term; body: Lens; node: Node }): Lens => ({
            type: 'let',
            pat: { type: 'drop', loc: node.loc },
            value,
            body,
            loc: node.loc,
        }),
    ),
    // Lens:18
    option(
        list(
            ' ',
            lit('match'),
            b('value', 'Term'),
            wrapper('{', list('\n', many('cases', 'LensCase'))),
        ),
        ({ value, cases, node }: { value: Term; cases: LensCase[]; node: Node }): Lens => ({
            type: 'case',
            value,
            cases,
            loc: node.loc,
        }),
    ),
    // Lens:19
    option(
        list(
            ' ',
            lit('match'),
            b('value', 'Term'),
            wrapper('{', list(';', many('cases', 'LensCase'))),
        ),
        ({ value, cases, node }: { value: Term; cases: LensCase[]; node: Node }): Lens => ({
            type: 'case',
            value,
            cases,
            loc: node.loc,
        }),
    ),
]);

grammar.add('LensOp', [
    // LensOp:1
    option(
        list('', wrapper('[', b('index', 'Term'))),
        ({ index, node }: { index: Term; node: Node }): LensOp => ({ type: 'index', index }),
    ),
    // LensOp:2
    option(list('', lit('.')), ({ node }: { node: Node }): LensOp => ({ type: 'dot' })),
    // LensOp:3
    option(list('', b('name', 'id')), ({ name, node }: { name: Id; node: Node }): LensOp => ({
        type: 'name',
        text: name.text,
    })),
]);

function handleLensOps(target: Lens, ops: LensOp[], loc: number): Lens {
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.type === 'index') target = { type: 'index', target, index: op.index, loc };
        else if (op.type === 'dot' && ops[i + 1]?.type === 'name') {
            target = {
                type: 'field',
                target,
                name: (ops[++i] as { text: string }).text,
                loc,
            };
        } else throw new Error('bad lens suffix ' + JSON.stringify(op));
    }
    return target;
}

import { partition } from './laminar-helpers.ts';

grammar.add('Linear', [
    // Linear:1
    option(
        list('', b('one', /^[0-9]+$/), lit('.'), b('two', /^[0-9]+$/)),
        ({ one, two, node }: { one: Id; two: Id; node: Node }): Linear => ({
            type: 'number',
            value: +(one.text + '.' + two.text),
            loc: node.loc,
        }),
    ),
    // Linear:2
    option(re(/^[0-9]+$/), ({ node }: { node: Node }): Linear => ({
        type: 'number',
        value: +(node as Id).text,
        loc: node.loc,
    })),
    // Linear:3
    option(re(/true|false/), ({ node }: { node: Node }): Linear => ({
        type: 'bool',
        value: (node as Id).text === 'true',
        loc: node.loc,
    })),
    // Linear:4
    option(b('text', /^[A-Z]/), ({ text, node }: { text: Id; node: Node }): Linear => ({
        type: 'constructor',
        name: text.text,
        args: [],
        loc: text.loc,
    })),
    // Linear:5
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Linear => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Linear:6
    option(
        list('', lit('!'), b('value', 'id')),
        ({ value, node }: { value: Id; node: Node }): Linear => ({
            type: 'apply',
            fn: { type: 'id', text: 'dup', loc: node.loc },
            args: [{ type: 'lens', lens: value }],
            loc: node.loc,
        }),
    ),
    // Linear:7
    option(list('"', b('text', 'id')), ({ text, node }: { text: Id; node: Node }): Linear => ({
        type: 'string',
        head: text.text,
        interp: [],
        loc: node.loc,
    })),
    // Linear:8
    option(
        list('', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:9
    option(
        list('', b('fn', /^[A-Z]/), wrapper('(', list(',', many('args', 'Linear')))),
        ({ fn, args, node }: { fn: Id; args: Linear[]; node: Node }): Linear => ({
            type: 'constructor',
            name: fn.text,
            args,
            loc: fn.loc,
        }),
    ),
    // Linear:10
    option(
        list('', b('fn', /^[+-]$/), rest('arg', 'Linear', false)),
        ({ fn, arg, node }: { fn: Id; arg: Linear; node: Node }): Linear => ({
            type: 'apply',
            fn,
            args: [arg],
            loc: node.loc,
        }),
    ),
    // Linear:11
    option(
        list('', b('target', 'Linear'), rest('suffixes', 'LinearOps', true)),
        ({
            target,
            suffixes,
            node,
        }: {
            target: Linear;
            suffixes: LinearOps[];
            node: Node;
        }): Linear => handleSuffixes(target, suffixes),
    ),
    // Linear:12
    option(
        wrapper('{', list(',', many('fields', 'RecordField'))),
        ({ fields, node }: { fields: RecordField[]; node: Node }): Linear => ({
            type: 'record',
            fields,
            loc: node.loc,
        }),
    ),
    // Linear:13
    option(
        wrapper('{', b('one', 'RecordField')),
        ({ one, node }: { one: RecordField; node: Node }): Linear => ({
            type: 'record',
            fields: [one],
            loc: node.loc,
        }),
    ),
    // Linear:14
    option(
        wrapper('(', list(',', many('items', 'Linear'))),
        ({ items, node }: { items: Linear[]; node: Node }): Linear => ({
            type: 'tuple',
            items,
            loc: node.loc,
        }),
    ),
    // Linear:15
    option(wrapper('(', null), ({ node }: { node: Node }): Linear => ({
        type: 'tuple',
        items: [],
        loc: node.loc,
    })),
    // Linear:16
    option(
        list('"', b('head', 'id'), rest('interp', 'LinearInterp', true)),
        ({ head, interp, node }: { head: Id; interp: LinearInterp[]; node: Node }): Linear => ({
            type: 'string',
            head: head.text,
            interp,
            loc: node.loc,
        }),
    ),
    // Linear:17
    option(
        list(
            ' ',
            lit('match'),
            b('value', 'Term'),
            wrapper('{', list('\n', many('cases', 'LinearCase'))),
        ),
        ({ value, cases, node }: { value: Term; cases: LinearCase[]; node: Node }): Linear => ({
            type: 'case',
            value,
            cases,
            loc: node.loc,
        }),
    ),
    // Linear:18
    option(
        list(
            ' ',
            lit('match'),
            b('value', 'Term'),
            wrapper('{', list(';', many('cases', 'LinearCase'))),
        ),
        ({ value, cases, node }: { value: Term; cases: LinearCase[]; node: Node }): Linear => ({
            type: 'case',
            value,
            cases,
            loc: node.loc,
        }),
    ),
    // Linear:19
    option(wrapper('[', null), ({ node }: { node: Node }): Linear => ({
        type: 'constructor',
        name: 'nil',
        args: [],
        loc: node.loc,
    })),
    // Linear:20
    option(
        wrapper('[', list(',', many('items', 'Linear'))),
        ({ items, node }: { items: Linear[]; node: Node }): Linear =>
            econs(
                [
                    ...items,
                    {
                        type: 'constructor',
                        name: 'nil',
                        args: [],
                        loc: node.loc,
                    },
                ],
                node.loc,
            ),
    ),
    // Linear:21
    option(
        wrapper(
            '[',
            list(',', many('items', 'Linear'), list('', lit('...'), rest('tail', 'Linear', false))),
        ),
        ({ items, tail, node }: { items: Linear[]; tail: Linear; node: Node }): Linear =>
            econs([...items, tail], node.loc),
    ),
    // Linear:22
    option(
        wrapper('[:', list(',', many('items', 'Linear'))),
        ({ items, node }: { items: Linear[]; node: Node }): Linear => ({
            type: 'vector',
            items,
            loc: node.loc,
        }),
    ),
    // Linear:23
    option(
        list(
            ' ',
            lit('fn'),
            list(
                ':',
                list('', b('name', 'id'), wrapper('(', list(',', many('args', 'FnArg')))),
                b('ann', 'Type'),
            ),
            b('body', 'Term'),
        ),
        ({
            name,
            args,
            ann,
            body,
            node,
        }: {
            name: Id;
            args: FnArg[];
            ann: Type;
            body: Term;
            node: Node;
        }): Linear => ({
            type: 'fn',
            name: name.text,
            args,
            ann,
            body,
            loc: node.loc,
        }),
    ),
    // Linear:24
    option(
        list(
            ' ',
            lit('fn'),
            list('', b('name', 'id'), wrapper('(', list(',', many('args', 'FnArg')))),
            b('body', 'Term'),
        ),
        ({
            name,
            args,
            body,
            node,
        }: {
            name: Id;
            args: FnArg[];
            body: Term;
            node: Node;
        }): Linear => ({
            type: 'fn',
            name: name.text,
            args,
            body,
            loc: node.loc,
        }),
    ),
    // Linear:25
    option(
        list(
            ' ',
            lit('fn'),
            list(':', wrapper('(', list(',', many('args', 'FnArg'))), b('ann', 'Type')),
            b('body', 'Term'),
        ),
        ({
            args,
            ann,
            body,
            node,
        }: {
            args: FnArg[];
            ann: Type;
            body: Term;
            node: Node;
        }): Linear => ({ type: 'fn', args, ann, body, loc: node.loc }),
    ),
    // Linear:26
    option(
        list(' ', lit('fn'), wrapper('(', list(',', many('args', 'FnArg'))), b('body', 'Term')),
        ({ args, body, node }: { args: FnArg[]; body: Term; node: Node }): Linear => ({
            type: 'fn',
            args,
            body,
            loc: node.loc,
        }),
    ),
    // Linear:27
    option(
        list(' ', b('lens', 'Lens'), lit(':='), rest('value', 'Linear', false)),
        ({ lens, value, node }: { lens: Lens; value: Linear; node: Node }): Linear => ({
            type: 'assign',
            lens,
            value,
            loc: node.loc,
        }),
    ),
    // Linear:28
    option(
        list(' ', b('left', 'Linear'), manyItems('right', [b('op', 'op'), b('right', 'Linear')])),
        ({
            left,
            right,
            node,
        }: {
            left: Linear;
            right: { op: Op; right: Linear }[];
            node: Node;
        }): Linear => partition(left, right),
    ),
    // Linear:29
    option(
        list(' ', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:30
    option(
        list('\n', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:31
    option(
        wrapper(
            '{',
            list(
                '\n',
                list(' ', lit('let'), b('pat', 'Pat'), lit('='), rest('value', 'Term', false)),
                rest('body', 'Linear', false),
            ),
        ),
        ({
            pat,
            value,
            body,
            node,
        }: {
            pat: Pat;
            value: Term;
            body: Linear;
            node: Node;
        }): Linear => ({ type: 'let', pat, value, body, loc: node.loc }),
    ),
    // Linear:32
    option(
        list(
            '\n',
            list(' ', lit('let'), b('pat', 'Pat'), lit('='), rest('value', 'Term', false)),
            rest('body', 'Linear', false),
        ),
        ({
            pat,
            value,
            body,
            node,
        }: {
            pat: Pat;
            value: Term;
            body: Linear;
            node: Node;
        }): Linear => ({ type: 'let', pat, value, body, loc: node.loc }),
    ),
    // Linear:33
    option(
        wrapper(
            '{',
            list(
                '\n',
                list(
                    ' ',
                    lit('let'),
                    lit('mut'),
                    b('pat', 'Pat'),
                    lit('='),
                    rest('value', 'Term', false),
                ),
                rest('body', 'Linear', false),
            ),
        ),
        ({
            pat,
            value,
            body,
            node,
        }: {
            pat: Pat;
            value: Term;
            body: Linear;
            node: Node;
        }): Linear => ({
            type: 'let',
            pat,
            value,
            body,
            mut: true,
            loc: node.loc,
        }),
    ),
    // Linear:34
    option(
        list(
            '\n',
            list(
                ' ',
                lit('let'),
                lit('mut'),
                b('pat', 'Pat'),
                lit('='),
                rest('value', 'Term', false),
            ),
            rest('body', 'Linear', false),
        ),
        ({
            pat,
            value,
            body,
            node,
        }: {
            pat: Pat;
            value: Term;
            body: Linear;
            node: Node;
        }): Linear => ({
            type: 'let',
            pat,
            value,
            body,
            mut: true,
            loc: node.loc,
        }),
    ),
    // Linear:35
    option(
        wrapper('{', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:36
    option(
        wrapper('{', list('\n', b('one', 'Linear'))),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:37
    option(
        wrapper('{', list('\n', b('value', 'Linear'), rest('body', 'Linear', false))),
        ({ value, body, node }: { value: Linear; body: Linear; node: Node }): Linear => ({
            type: 'let',
            pat: { type: 'drop', loc: node.loc },
            value,
            body,
            loc: node.loc,
        }),
    ),
    // Linear:38
    option(
        list('\n', b('value', 'Linear'), rest('body', 'Linear', false)),
        ({ value, body, node }: { value: Linear; body: Linear; node: Node }): Linear => ({
            type: 'let',
            pat: { type: 'drop', loc: node.loc },
            value,
            body,
            loc: node.loc,
        }),
    ),
]);

grammar.add('LinearOps', [
    // LinearOps:1
    option(
        list('', wrapper('[', b('index', 'Linear'))),
        ({ index, node }: { index: Linear; node: Node }): LinearOps => ({ type: 'index', index }),
    ),
    // LinearOps:2
    option(
        list('', wrapper('(', list(',', many('args', 'Term')))),
        ({ args, node }: { args: Term[]; node: Node }): LinearOps => ({ type: 'apply', args }),
    ),
    // LinearOps:3
    option(list('', wrapper('(', null)), ({ node }: { node: Node }): LinearOps => ({
        type: 'apply',
        args: [],
    })),
    // LinearOps:4
    option(list('', lit('.')), ({ node }: { node: Node }): LinearOps => ({ type: 'dot' })),
    // LinearOps:5
    option(list('', b('name', 'id')), ({ name, node }: { name: Id; node: Node }): LinearOps => ({
        type: 'name',
        text: name.text,
    })),
]);

function handleSuffixes(head: Linear, suffixes: LinearOps[]): Linear {
    for (let i = 0; i < suffixes.length; i++) {
        const suffix = suffixes[i];
        switch (suffix.type) {
            case 'index':
                head = {
                    type: 'index',
                    index: suffix.index,
                    target: head,
                    loc: head.loc,
                };
                continue;
            case 'apply':
                head = {
                    type: 'apply',
                    fn: head,
                    args: suffix.args,
                    loc: head.loc,
                };
                continue;
            case 'dot': {
                const name = suffixes[i + 1];
                if (name?.type !== 'name') break;
                head = {
                    type: 'field',
                    target: head,
                    name: name.text,
                    loc: head.loc,
                };
                i++;
                continue;
            }
        }
        throw new Error('bad suffix' + JSON.stringify(suffix));
    }
    return head;
}

grammar.add('FnArg', [
    // FnArg:1
    option(b('pat', 'Pat'), ({ pat, node }: { pat: Pat; node: Node }): FnArg => ({ pat })),
    // FnArg:2
    option(
        list(':', b('pat', 'Pat'), b('typ', 'Type')),
        ({ pat, typ, node }: { pat: Pat; typ: Type; node: Node }): FnArg => ({ pat, typ }),
    ),
    // FnArg:3
    option(
        list(' ', lit('mut'), b('pat', 'Pat')),
        ({ pat, node }: { pat: Pat; node: Node }): FnArg => ({ pat, mut: true }),
    ),
    // FnArg:4
    option(
        list(':', list(' ', lit('mut'), b('pat', 'Pat')), b('typ', 'Type')),
        ({ pat, typ, node }: { pat: Pat; typ: Type; node: Node }): FnArg => ({
            pat,
            typ,
            mut: true,
        }),
    ),
]);

grammar.add('LinearCase', [
    // LinearCase:1
    option(
        list(' ', b('pat', 'Pat'), lit('->'), rest('body', 'Linear', false)),
        ({ pat, body, node }: { pat: Pat; body: Linear; node: Node }): LinearCase => ({
            pat,
            body,
        }),
    ),
]);

grammar.add('LensCase', [
    // LensCase:1
    option(
        list(' ', b('pat', 'Pat'), lit('->'), rest('body', 'Lens', false)),
        ({ pat, body, node }: { pat: Pat; body: Lens; node: Node }): LensCase => ({ pat, body }),
    ),
]);

grammar.add('LinearInterp', [
    // LinearInterp:1
    option(
        list('"', b('value', 'Linear'), b('tail', 'id')),
        ({ value, tail, node }: { value: Linear; tail: Id; node: Node }): LinearInterp => ({
            value,
            tail: tail.text,
        }),
    ),
]);
