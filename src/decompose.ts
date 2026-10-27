/*

Here's where I turn a Term into an Expr.
Let's make this happen.



*/

import { Expr, Idd, Linear, Pat, Patd, Stmt, Swap } from './ast.ts';

type Ctx = { scope: Record<string, number>; counter: { current: number } };

const subScope = (ctx: Ctx) => ({ ...ctx, scope: { ...ctx.scope } });

export const sstmt = (stmt: Stmt): string => {
    switch (stmt.type) {
        case 'let':
            return `let ${spat(stmt.pat)}=${sexpr(stmt.value)}`;
        case 'return':
            return `return ${sexpr(stmt.value)}`;
        default:
            return sexpr(stmt);
    }
};

export const spat = (pat: Patd): string => {
    switch (pat.type) {
        case 'idd':
            return pat.text + pat.id;
        case 'drop':
            return '_';
        case 'tuple':
            return `(${pat.items.map(spat).join(',')})`;
        case 'constructor':
            return `CONSTR`;
        case 'lens':
            return '~' + spat(pat.inner);
    }
};

export const sexpr = (expr: Expr): string => {
    switch (expr.type) {
        case 'string':
            return `"${expr.head}${expr.interp.map((i) => '${' + sexpr(i.value) + '}' + i.tail).join('')}"`;
        case 'idd':
            return expr.text + expr.id;
        case 'swap':
            return `swap(${sexpr(expr.id)},${sexpr(expr.value)})`;
        case 'const':
            return expr.value + '';
        case 'iffe': {
            if (expr.cleanup.length) {
                return `iffe(${expr.block.map(sstmt).join(';')};let $res=${sexpr(expr.result)};${expr.cleanup.map(({ id, value }) => `swap(${id.text + id.id},${sexpr(value)})`).join(';')};return $res)`;
            } else {
                return `iffe(${expr.block.map(sstmt).join(';')};return ${sexpr(expr.result)})`;
            }
        }
        case 'fn':
            return `(${expr.args.map(spat)})=>${
                Array.isArray(expr.body) ? `{${expr.body.map(sstmt).join(';')}}` : sexpr(expr.body)
            }`;
        case 'apply':
            return `${sexpr(expr.fn)}(${expr.args.map(sexpr).join(',')})`;
        case 'tuple':
            return `(${expr.items.map(sexpr).join(',')})`;
    }
};

export const patToPatd = (ctx: Ctx, pat: Pat): Patd => {
    switch (pat.type) {
        case 'id': {
            const id = ctx.counter.current++;
            ctx.scope[pat.text] = id;
            return { ...pat, type: 'idd', id };
        }
        case 'drop':
            return pat;
        case 'tuple':
            return { ...pat, items: pat.items.map((p) => patToPatd(ctx, p)) };
        case 'constructor':
            return { ...pat, args: pat.args.map((p) => patToPatd(ctx, p)) };
        case 'lens':
            return { ...pat, inner: patToPatd(ctx, pat.inner) };
    }
};

export const patValue = (ctx: Ctx, pat: Pat): Expr => {
    switch (pat.type) {
        case 'id': {
            const id = ctx.scope[pat.text];
            if (id == null) throw new Error(`unbound ${pat.text}`);
            return { ...pat, type: 'idd', id };
        }
        case 'drop':
            throw new Error(`cant make expr out of _`);
        case 'tuple':
            return { ...pat, items: pat.items.map((p) => patValue(ctx, p)) };
        case 'constructor':
            throw new Error('nope');
        case 'lens':
            throw new Error(`cant make expr out of lens`);
    }
};

export const linearToExpr = (ctx: Ctx, lin: Linear): Expr => {
    switch (lin.type) {
        case 'const':
            return lin;
        case 'op':
        case 'id': {
            const id = ctx.scope[lin.text];
            if (id == null) throw new Error(`unbound ${lin.text}`);
            return { ...lin, type: 'idd', id };
        }
        case 'string':
            return {
                ...lin,
                interp: lin.interp.map((l) => ({ ...l, value: linearToExpr(ctx, l.value) })),
            };
        case 'let': {
            const sub = subScope(ctx);
            const pat = patToPatd(sub, lin.pat);
            const next = linearToExpr(sub, lin.body);
            const cleanup: Swap[] = [];
            let lest: Stmt;
            if (lin.value.type === 'lens') {
                if (lin.value.lens.type === 'id') {
                    lest = {
                        type: 'let',
                        pat,
                        loc: lin.loc,
                        value: linearToExpr(ctx, lin.value.lens),
                    };
                    const id = ctx.scope[lin.value.lens.text];
                    if (id == null) throw new Error(`unbound ${lin.value.lens.text}`);
                    cleanup.push({
                        type: 'swap',
                        id: { ...lin.value.lens, type: 'idd', id },
                        value: patValue(sub, lin.pat),
                        loc: -1,
                    });
                } else {
                    throw 1;
                }
            } else {
                lest = {
                    type: 'let',
                    pat,
                    loc: lin.loc,
                    value: linearToExpr(ctx, lin.value),
                };
            }
            return next.type === 'iffe'
                ? { ...next, block: [lest, ...next.block], cleanup: [...cleanup, ...next.cleanup] }
                : { type: 'iffe', block: [lest], cleanup, result: next, loc: -1 };
        }
        case 'fn': {
            if (lin.body.type === 'lens') throw 2;
            const sub = subScope(ctx);
            const args = lin.args.map((a) => patToPatd(sub, a.pat));
            const body = linearToExpr(sub, lin.body);
            return {
                ...lin,
                args,
                body: body.type === 'iffe' ? body.block : body,
            };
        }
        case 'apply':
            return {
                ...lin,
                fn: linearToExpr(ctx, lin.fn),
                args: lin.args.map((arg) => {
                    if (arg.type === 'lens') throw 4;
                    return linearToExpr(ctx, arg);
                }),
            };
        case 'tuple':
            return { ...lin, items: lin.items.map((lin) => linearToExpr(ctx, lin)) };
        case 'assign': {
            if (lin.lens.type === 'id') {
                const id = ctx.scope[lin.lens.text];
                if (id == null) throw new Error(`unbound ${lin.lens.text}`);
                return {
                    type: 'swap',
                    id: { ...lin.lens, type: 'idd', id },
                    value: linearToExpr(ctx, lin.value),
                    loc: -1,
                };
            }
        }
        // here we do a thing
        case 'constructor':
        case 'case':
            throw new Error('not support yet ' + lin.type);
    }
};
