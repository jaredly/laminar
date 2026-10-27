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
    option(b('swap', 'Swap'), ({ swap, node }: { swap: Swap; node: Node }): Expr => swap),
    // Expr:3
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
    // Expr:4
    option(b('num', /\d+/), ({ num, node }: { num: Id; node: Node }): Expr => ({
        type: 'const',
        value: +num.text,
        loc: num.loc,
    })),
    // Expr:5
    option(lit('true'), ({ node }: { node: Node }): Expr => ({
        type: 'const',
        value: true,
        loc: node.loc,
    })),
    // Expr:6
    option(lit('false'), ({ node }: { node: Node }): Expr => ({
        type: 'const',
        value: false,
        loc: node.loc,
    })),
    // Expr:7
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
    // Expr:8
    option(
        list('', wrapper('(', list(',', many('args', 'Patd'))), lit('=>'), b('body', 'Block')),
        ({ args, body, node }: { args: Patd[]; body: Stmt[]; node: Node }): Expr => ({
            type: 'fn',
            args,
            body,
            loc: node.loc,
        }),
    ),
    // Expr:9
    option(
        list('', wrapper('(', list(',', many('args', 'Patd'))), lit('=>'), b('body', 'Expr')),
        ({ args, body, node }: { args: Patd[]; body: Expr; node: Node }): Expr => ({
            type: 'fn',
            args,
            body,
            loc: node.loc,
        }),
    ),
    // Expr:10
    option(
        wrapper('(', list(',', many('items', 'Expr'))),
        ({ items, node }: { items: Expr[]; node: Node }): Expr => ({
            type: 'tuple',
            items,
            loc: node.loc,
        }),
    ),
    // Expr:11
    option(list('', b('one', 'Expr')), ({ one, node }: { one: Expr; node: Node }): Expr => one),
]);

grammar.add('Block', [
    // Block:1
    option(
        wrapper('{', list(';', many('stmts', 'Stmt'))),
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
    option(
        list(' ', lit('return'), b('value', 'Expr')),
        ({ value, node }: { value: Expr; node: Node }): Stmt => ({
            type: 'return',
            value,
            loc: node.loc,
        }),
    ),
    // Stmt:3
    option(b('expr', 'Expr'), ({ expr, node }: { expr: Expr; node: Node }): Stmt => expr),
]);

grammar.add('Patd', [
    // Patd:1
    option(b('id', 'Idd'), ({ id, node }: { id: Idd; node: Node }): Patd => id),
    // Patd:2
    option(lit('_'), ({ node }: { node: Node }): Patd => ({ type: 'drop' })),
    // Patd:3
    option(
        wrapper('(', list(',', many('items', 'Patd'))),
        ({ items, node }: { items: Patd[]; node: Node }): Patd => ({ type: 'tuple', items }),
    ),
]);

grammar.add('Swap', [
    // Swap:1
    option(
        list('', lit('swap'), wrapper('(', list(',', b('id', 'Idd'), b('value', 'Expr')))),
        ({ id, value, node }: { id: Idd; value: Expr; node: Node }): Swap => ({
            type: 'swap',
            id,
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
