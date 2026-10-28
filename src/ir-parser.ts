import {
    Grammar,
    Id,
    Op,
    Node,
    option,
    b,
    lit,
    wrapper,
    many,
    list,
    manyItems,
    rest,
} from './grammar-lexer.ts';
import { Expr, Stmt, Patd, Swap, Idd } from './ast.ts';

export const grammar = new Grammar({});

grammar.add('Expr', [
    // Expr:1
    option(b('id', 'Idd'), ({ id, node }: { id: Idd; node: Node }): Expr => id),
    // Expr:2
    option(b('id', 'id'), ({ id, node }: { id: Id; node: Node }): Expr => ({
        type: 'idd',
        text: id.text,
        id: -1,
        loc: id.loc,
    })),
    // Expr:3
    option(b('id', 'op'), ({ id, node }: { id: Op; node: Node }): Expr => ({
        type: 'idd',
        text: id.text,
        id: -1,
        loc: id.loc,
    })),
    // Expr:4
    option(b('swap', 'Swap'), ({ swap, node }: { swap: Swap; node: Node }): Expr => swap),
    // Expr:5
    option(
        list(
            '',
            lit('iffe'),
            wrapper('{', list(';', many('block', 'Stmt'))),
            wrapper('{', b('result', 'Expr')),
            wrapper('{', list(';', many('cleanup', 'Swap'))),
        ),
        ({
            block,
            result,
            cleanup,
            node,
        }: {
            block: Stmt[];
            result: Expr;
            cleanup: Swap[];
            node: Node;
        }): Expr => ({ type: 'iffe', block, cleanup, result, loc: node.loc }),
    ),
    // Expr:6
    option(
        list(
            '',
            lit('iffe'),
            wrapper('{', list('\n', many('block', 'Stmt'))),
            wrapper('{', b('result', 'Expr')),
            wrapper('{', list(';', many('cleanup', 'Swap'))),
        ),
        ({
            block,
            result,
            cleanup,
            node,
        }: {
            block: Stmt[];
            result: Expr;
            cleanup: Swap[];
            node: Node;
        }): Expr => ({ type: 'iffe', block, cleanup, result, loc: node.loc }),
    ),
    // Expr:7
    option(b('num', /\d+/), ({ num, node }: { num: Id; node: Node }): Expr => ({
        type: 'const',
        value: +num.text,
        loc: num.loc,
    })),
    // Expr:8
    option(lit('true'), ({ node }: { node: Node }): Expr => ({
        type: 'const',
        value: true,
        loc: node.loc,
    })),
    // Expr:9
    option(lit('false'), ({ node }: { node: Node }): Expr => ({
        type: 'const',
        value: false,
        loc: node.loc,
    })),
    // Expr:10
    option(
        list('"', b('head', 'id'), manyItems('interp', [b('value', 'Expr'), b('tail', 'id')])),
        ({
            head,
            interp,
            node,
        }: {
            head: Id;
            interp: { value: Expr; tail: Id }[];
            node: Node;
        }): Expr => ({
            type: 'string',
            head: head.text,
            interp: interp.map(({ value, tail }) => ({ value, tail: tail.text })),
            loc: node.loc,
        }),
    ),
    // Expr:11
    option(
        list(
            '',
            wrapper('(', list(',', many('args', 'Patd'))),
            lit('=>'),
            rest('body', 'Block', false),
        ),
        ({ args, body, node }: { args: Patd[]; body: Stmt[]; node: Node }): Expr => ({
            type: 'fn',
            args,
            body: bodyIffe(body),
            loc: node.loc,
        }),
    ),
    // Expr:12
    option(
        list(
            '',
            wrapper('(', list(',', many('args', 'Patd'))),
            lit('=>'),
            rest('body', 'Expr', false),
        ),
        ({ args, body, node }: { args: Patd[]; body: Expr; node: Node }): Expr => ({
            type: 'fn',
            args,
            body,
            loc: node.loc,
        }),
    ),
    // Expr:13
    option(
        wrapper('(', list(',', many('items', 'Expr'))),
        ({ items, node }: { items: Expr[]; node: Node }): Expr => ({
            type: 'tuple',
            items,
            loc: node.loc,
        }),
    ),
    // Expr:14
    option(
        list('', b('fn', 'Expr'), wrapper('(', list(',', many('args', 'Expr')))),
        ({ fn, args, node }: { fn: Expr; args: Expr[]; node: Node }): Expr => ({
            type: 'apply',
            fn,
            args,
            loc: node.loc,
        }),
    ),
    // Expr:15
    option(list('', b('one', 'Expr')), ({ one, node }: { one: Expr; node: Node }): Expr => one),
    // Expr:16
    option(b('id', 'id'), ({ id, node }: { id: Id; node: Node }): Expr => ({
        type: 'idd',
        text: id.text,
        id: 0,
        loc: node.loc,
    })),
    // Expr:17
    option(wrapper('[', null), ({ node }: { node: Node }): Expr => ({
        type: 'constructor',
        name: 'nil',
        args: [],
        loc: node.loc,
    })),
    // Expr:18
    option(
        wrapper('[', list(',', many('items', 'Expr'))),
        ({ items, node }: { items: Expr[]; node: Node }): Expr =>
            econs(
                [...items, { type: 'constructor', name: 'nil', args: [], loc: node.loc }],
                node.loc,
            ),
    ),
    // Expr:19
    option(
        wrapper('[', list(',', many('items', 'Expr'), list('', lit('...'), b('tail', 'Expr')))),
        ({ items, tail, node }: { items: Expr[]; tail: Expr; node: Node }): Expr =>
            econs([...items, tail], node.loc),
    ),
    // Expr:20
    option(
        list(
            ' ',
            lit('match'),
            b('value', 'Expr'),
            wrapper('{', list('\n', many('cases', 'Case'))),
        ),
        ({
            value,
            cases,
            node,
        }: {
            value: Expr;
            cases: { pat: Patd; body: Expr }[];
            node: Node;
        }): Expr => ({ type: 'case', value, cases, loc: node.loc }),
    ),
    // Expr:21
    option(
        list(' ', lit('match'), b('value', 'Expr'), wrapper('{', list(';', many('cases', 'Case')))),
        ({
            value,
            cases,
            node,
        }: {
            value: Expr;
            cases: { pat: Patd; body: Expr }[];
            node: Node;
        }): Expr => ({ type: 'case', value, cases, loc: node.loc }),
    ),
    // Expr:22
    option(
        list(' ', lit('match'), b('value', 'Expr'), wrapper('{', b('kase', 'Case'))),
        ({
            value,
            kase,
            node,
        }: {
            value: Expr;
            kase: { pat: Patd; body: Expr };
            node: Node;
        }): Expr => ({ type: 'case', value, cases: [kase], loc: node.loc }),
    ),
    // Expr:23
    option(list(' ', b('one', 'Expr')), ({ one, node }: { one: Expr; node: Node }): Expr => one),
    // Expr:24
    option(list(';', b('one', 'Expr')), ({ one, node }: { one: Expr; node: Node }): Expr => one),
]);

grammar.add('Case', [
    // Case:1
    option(
        list(' ', b('pat', 'Patd'), lit('->'), rest('body', 'Expr', false)),
        ({
            pat,
            body,
            node,
        }: {
            pat: Patd;
            body: Expr;
            node: Node;
        }): { pat: Patd; body: Expr } => ({ pat, body }),
    ),
]);

function econs(items: Expr[], loc: number) {
    let last = items[items.length - 1];
    for (let i = items.length - 2; i >= 0; i--) {
        last = { type: 'constructor', name: 'cons', args: [items[i], last], loc };
    }
    return last;
}

function pcons(items: Patd[], loc: number) {
    let last = items[items.length - 1];
    for (let i = items.length - 2; i >= 0; i--) {
        last = { type: 'constructor', name: 'cons', args: [items[i], last], loc };
    }
    return last;
}

function bodyIffe(body: Stmt[]): Expr {
    let last = body[body.length - 1];
    if (!body.length || last.type === 'let')
        return {
            type: 'iffe',
            block: body,
            result: { type: 'tuple', items: [], loc: -1 },
            cleanup: [],
            loc: -1,
        };
    return { type: 'iffe', block: body.slice(0, -1), result: last, cleanup: [], loc: -1 };
}

grammar.add('Block', [
    // Block:1
    option(
        wrapper('{', list(';', many('stmts', 'Stmt'))),
        ({ stmts, node }: { stmts: Stmt[]; node: Node }): Stmt[] => stmts,
    ),
    // Block:2
    option(
        wrapper('{', list('\n', many('stmts', 'Stmt'))),
        ({ stmts, node }: { stmts: Stmt[]; node: Node }): Stmt[] => stmts,
    ),
]);

grammar.add('Stmt', [
    // Stmt:1
    option(
        list(' ', lit('let'), list('', b('pat', 'Patd'), lit('='), rest('value', 'Expr', false))),
        ({ pat, value, node }: { pat: Patd; value: Expr; node: Node }): Stmt => ({
            type: 'let',
            pat,
            value,
            loc: node.loc,
        }),
    ),
    // Stmt:2
    option(b('expr', 'Expr'), ({ expr, node }: { expr: Expr; node: Node }): Stmt => expr),
]);

grammar.add('Patd', [
    // Patd:1
    option(b('id', /^_\d+$/), ({ id, node }: { id: Id; node: Node }): Patd => ({
        type: 'drop',
        loc: node.loc,
        id: +id.text.slice(1),
    })),
    // Patd:2
    option(b('id', 'Idd'), ({ id, node }: { id: Idd; node: Node }): Patd => id),
    // Patd:3
    option(lit('_'), ({ node }: { node: Node }): Patd => ({
        type: 'drop',
        loc: node.loc,
        id: null,
    })),
    // Patd:4
    option(
        wrapper('(', list(',', many('items', 'Patd'))),
        ({ items, node }: { items: Patd[]; node: Node }): Patd => ({
            type: 'tuple',
            items,
            loc: node.loc,
        }),
    ),
    // Patd:5
    option(wrapper('[', null), ({ node }: { node: Node }): Patd => ({
        type: 'constructor',
        name: 'nil',
        args: [],
        loc: node.loc,
    })),
    // Patd:6
    option(
        wrapper('[', list(',', many('items', 'Patd'))),
        ({ items, node }: { items: Patd[]; node: Node }): Patd =>
            pcons(
                [...items, { type: 'constructor', name: 'nil', args: [], loc: node.loc }],
                node.loc,
            ),
    ),
    // Patd:7
    option(
        wrapper('[', list(',', many('items', 'Patd'), list('', lit('...'), b('tail', 'Patd')))),
        ({ items, tail, node }: { items: Patd[]; tail: Patd; node: Node }): Patd =>
            pcons([...items, tail], node.loc),
    ),
]);

grammar.add('Swap', [
    // Swap:1
    option(
        list('', lit('swap'), wrapper('(', list(',', b('pat', 'Patd'), b('value', 'Expr')))),
        ({ pat, value, node }: { pat: Patd; value: Expr; node: Node }): Swap => ({
            type: 'swap',
            pat,
            value,
            loc: node.loc,
        }),
    ),
]);

grammar.add('Idd', [
    // Idd:1
    option(b('id', /^[a-zA-Z_]+\d+$/), ({ id, node }: { id: Id; node: Node }): Idd => {
        let num = id.text.match(new RegExp('\\d+$'))!;
        return { type: 'idd', id: +num[0], text: id.text.slice(0, -num[0].length), loc: id.loc };
    }),
]);
