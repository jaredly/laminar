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
    Pat,
    Type,
    Term,
    Lens,
    Linear,
    LinearOps,
    FnArg,
    LinearCase,
    LinearInterp,
} from './ast.ts';

export const grammar = new Grammar({
    reserved: ['let', 'lens', '~', '<-', '=', ':=', 'case', '::', '=>', '_'],
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
        }),
    ),
    // FileItem:2
    option(
        b('linear', 'Linear'),
        ({ linear, node }: { linear: Linear; node: Node }): FileItem => linear,
    ),
]);

grammar.add('Pat', [
    // Pat:1
    option(lit('_'), ({ node }: { node: Node }): Pat => ({ type: 'drop' })),
    // Pat:2
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Pat => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Pat:3
    option(
        list('', lit('~'), b('inner', 'Pat')),
        ({ inner, node }: { inner: Pat; node: Node }): Pat => ({ type: 'lens', inner }),
    ),
    // Pat:4
    option(
        list('', b('name', 'id'), wrapper('(', list(',', many('args', 'Pat')))),
        ({ name, args, node }: { name: Id; args: Pat[]; node: Node }): Pat => ({
            type: 'constructor',
            name: name.text,
            args,
        }),
    ),
    // Pat:5
    option(
        wrapper('(', list(',', many('items', 'Pat'))),
        ({ items, node }: { items: Pat[]; node: Node }): Pat => ({ type: 'tuple', items }),
    ),
    // Pat:6
    option(wrapper('(', null), ({ node }: { node: Node }): Pat => ({ type: 'tuple', items: [] })),
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
        list('', b('left', 'Type'), lit('/'), b('right', 'Type')),
        ({ left, right, node }: { left: Type; right: Type; node: Node }): Type => ({
            type: 'lens',
            left,
            right,
        }),
    ),
    // Type:4
    option(
        wrapper('(', list(',', many('items', 'Type'))),
        ({ items, node }: { items: Type[]; node: Node }): Type => ({ type: 'tuple', items }),
    ),
    // Type:5
    option(wrapper('(', null), ({ node }: { node: Node }): Type => ({ type: 'tuple', items: [] })),
    // Type:6
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
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Lens => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Lens:2
    option(list('', b('one', 'Lens')), ({ one, node }: { one: Lens; node: Node }): Lens => one),
    // Lens:3
    option(
        list('', b('fn', 'Linear'), wrapper('(', list(',', many('args', 'Term')))),
        ({ fn, args, node }: { fn: Linear; args: Term[]; node: Node }): Lens => ({
            type: 'apply',
            fn,
            args,
        }),
    ),
    // Lens:4
    option(
        wrapper('(', list(',', many('items', 'Lens'))),
        ({ items, node }: { items: Lens[]; node: Node }): Lens => ({ type: 'tuple', items }),
    ),
    // Lens:5
    option(wrapper('(', null), ({ node }: { node: Node }): Lens => ({ type: 'tuple', items: [] })),
    // Lens:6
    option(wrapper('{', b('one', 'Lens')), ({ one, node }: { one: Lens; node: Node }): Lens => one),
    // Lens:7
    option(wrapper('(', null), ({ node }: { node: Node }): Lens => ({ type: 'tuple', items: [] })),
    // Lens:8
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
        }),
    ),
    // Lens:9
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
        }): Lens => ({ type: 'aslens', pat, value, body }),
    ),
    // Lens:10
    option(
        wrapper('{', list('\n', b('one', 'Lens'))),
        ({ one, node }: { one: Lens; node: Node }): Lens => one,
    ),
    // Lens:11
    option(
        wrapper('{', list('\n', b('value', 'Term'), rest('body', 'Lens', false))),
        ({ value, body, node }: { value: Term; body: Lens; node: Node }): Lens => ({
            type: 'let',
            pat: { type: 'drop' },
            value,
            body,
        }),
    ),
]);

import { partition } from './laminar-helpers.ts';

grammar.add('Linear', [
    // Linear:1
    option(re(/^[0-9]+$/), ({ node }: { node: Node }): Linear => ({
        type: 'const',
        value: +(node as Id).text,
        loc: node.loc,
    })),
    // Linear:2
    option(re(/true|false/), ({ node }: { node: Node }): Linear => ({
        type: 'const',
        value: (node as Id).text === 'true',
        loc: node.loc,
    })),
    // Linear:3
    option(b('text', 'id'), ({ text, node }: { text: Id; node: Node }): Linear => ({
        type: 'id',
        text: text.text,
        loc: node.loc,
    })),
    // Linear:4
    option(list('"', b('text', 'id')), ({ text, node }: { text: Id; node: Node }): Linear => ({
        type: 'string',
        head: text.text,
        interp: [],
        loc: node.loc,
    })),
    // Linear:5
    option(
        list('', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:6
    option(
        list('', b('fn', /^[+-]$/), rest('arg', 'Linear', false)),
        ({ fn, arg, node }: { fn: Id; arg: Linear; node: Node }): Linear => ({
            type: 'apply',
            fn,
            args: [arg],
            loc: node.loc,
        }),
    ),
    // Linear:7
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
    // Linear:8
    option(
        wrapper('(', list(',', many('items', 'Linear'))),
        ({ items, node }: { items: Linear[]; node: Node }): Linear => ({
            type: 'tuple',
            items,
            loc: node.loc,
        }),
    ),
    // Linear:9
    option(wrapper('(', null), ({ node }: { node: Node }): Linear => ({
        type: 'tuple',
        items: [],
        loc: node.loc,
    })),
    // Linear:10
    option(
        list('"', b('head', 'id'), rest('interp', 'LinearInterp', true)),
        ({ head, interp, node }: { head: Id; interp: LinearInterp[]; node: Node }): Linear => ({
            type: 'string',
            head: head.text,
            interp,
            loc: node.loc,
        }),
    ),
    // Linear:11
    option(
        list(' ', lit('match'), b('value', 'Linear'), wrapper('{', many('cases', 'LinearCase'))),
        ({ value, cases, node }: { value: Linear; cases: LinearCase[]; node: Node }): Linear => ({
            type: 'case',
            value,
            cases,
            loc: node.loc,
        }),
    ),
    // Linear:12
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
        }): Linear => ({ type: 'fn', name: name.text, args, ann, body, loc: node.loc }),
    ),
    // Linear:13
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
        }): Linear => ({ type: 'fn', name: name.text, args, body, loc: node.loc }),
    ),
    // Linear:14
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
    // Linear:15
    option(
        list(' ', lit('fn'), wrapper('(', list(',', many('args', 'FnArg'))), b('body', 'Term')),
        ({ args, body, node }: { args: FnArg[]; body: Term; node: Node }): Linear => ({
            type: 'fn',
            args,
            body,
            loc: node.loc,
        }),
    ),
    // Linear:16
    option(
        list(' ', b('lens', 'Lens'), lit(':='), rest('value', 'Linear', false)),
        ({ lens, value, node }: { lens: Lens; value: Linear; node: Node }): Linear => ({
            type: 'assign',
            lens,
            value,
            loc: node.loc,
        }),
    ),
    // Linear:17
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
    // Linear:18
    option(
        list(' ', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:19
    option(
        list('\n', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:20
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
    // Linear:21
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
    // Linear:22
    option(
        wrapper('{', b('one', 'Linear')),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:23
    option(
        wrapper('{', list('\n', b('one', 'Linear'))),
        ({ one, node }: { one: Linear; node: Node }): Linear => one,
    ),
    // Linear:24
    option(
        wrapper('{', list('\n', b('value', 'Linear'), rest('body', 'Linear', false))),
        ({ value, body, node }: { value: Linear; body: Linear; node: Node }): Linear => ({
            type: 'let',
            pat: { type: 'drop' },
            value,
            body,
            loc: node.loc,
        }),
    ),
    // Linear:25
    option(
        list('\n', b('value', 'Linear'), rest('body', 'Linear', false)),
        ({ value, body, node }: { value: Linear; body: Linear; node: Node }): Linear => ({
            type: 'let',
            pat: { type: 'drop' },
            value,
            body,
            loc: node.loc,
        }),
    ),
]);

grammar.add('LinearOps', [
    // LinearOps:1
    option(
        list('', wrapper('(', list(',', many('args', 'Term')))),
        ({ args, node }: { args: Term[]; node: Node }): LinearOps => ({ type: 'apply', args }),
    ),
]);

function handleSuffixes(head: Linear, suffixes: LinearOps[]): Linear {
    return suffixes.reduce((head, suffix): Linear => {
        switch (suffix.type) {
            case 'apply':
                return { type: 'apply', fn: head, args: suffix.args, loc: head.loc };
        }
        throw new Error('bad suffix' + JSON.stringify(suffix));
    }, head);
}

grammar.add('FnArg', [
    // FnArg:1
    option(b('pat', 'Pat'), ({ pat, node }: { pat: Pat; node: Node }): FnArg => ({ pat })),
    // FnArg:2
    option(
        list(':', b('pat', 'Pat'), b('typ', 'Type')),
        ({ pat, typ, node }: { pat: Pat; typ: Type; node: Node }): FnArg => ({ pat, typ }),
    ),
]);

grammar.add('LinearCase', [
    // LinearCase:1
    option(
        list(' ', b('pat', 'Pat'), rest('body', 'Linear', false)),
        ({ pat, body, node }: { pat: Pat; body: Linear; node: Node }): LinearCase => ({
            pat,
            body,
        }),
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
