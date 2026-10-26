/*

Here's where I turn a Term into an Expr.
Let's make this happen.



*/

import { Expr, Linear, Stmt } from './ast.ts';

export const linearToExpr = (lin: Linear): Expr => {
    switch (lin.type) {
        case 'const':
        case 'op':
        case 'id':
            return lin;
        case 'string':
            return {
                ...lin,
                interp: lin.interp.map((l) => ({ ...l, value: linearToExpr(l.value) })),
            };
        case 'let':
            if (lin.value.type === 'lens') {
                throw 1;
            }
            const next = linearToExpr(lin.body);
            return {
                type: 'iffe',
                block: [
                    { type: 'let', pat: lin.pat, loc: lin.loc, value: linearToExpr(lin.value) },
                    ...(next.type === 'iffe'
                        ? next.block
                        : [{ type: 'return' as const, value: next }]),
                ],
            };
        case 'fn':
            if (lin.body.type === 'lens') throw 2;
            const body = linearToExpr(lin.body);
            return { ...lin, body: body.type === 'iffe' ? body.block : body };
        case 'apply':
            return {
                ...lin,
                fn: linearToExpr(lin.fn),
                args: lin.args.map((arg) => {
                    if (arg.type === 'lens') throw 4;
                    return linearToExpr(arg);
                }),
            };
        case 'tuple':
            return { ...lin, items: lin.items.map((lin) => linearToExpr(lin)) };
        case 'assign':
        // here we do a thing
        case 'constructor':
        case 'case':
            throw new Error('not support yet ' + lin.type);
    }
};
