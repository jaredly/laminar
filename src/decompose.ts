/*

Here's where I turn a Term into an Expr.
Let's make this happen.

# PAT
vbl
(pat, pat)
()

# LIN
-> finished
vbl
(lin, lin)
let pat = lin in lin
fn(pat) => lin
lin(lin)
()
lens := lin
let pat = ~lens in lin

fn(pat) => ~lens

-> easy
Left(lin)
Right(lin)
case lin
    Left(pat) -> lin
    Right(pat) -> lin
lin & lin // SPLIT
fst(lin)
snd(lin)

-> hard
unlens lens in lin
case ~lens
    Left(pat) -> lin
    Right(pat) -> lin
false(term) ???
true(lin)
promote??discard??copy??derelict??


There's this funny thing where, a plain variable `id`
can be either a lens or a linear, just based on whether it's
used as one or the other. By contrast, a function invocation
can only be one or the other, based on that function's type signature.


# LENS
-> finished
vbl : A/A'
(lens, lens) : (A,B)/(A',B')
lin(lin) : A/A'
lin(~lens) : A/A'
aslens vbl <- lin in lin : A/A'

Some(lens) : Option(A)/Option(A')
None : Option(A)/Option(A')

-> easier
() : ()/A'

-> harder???
let pat = lin in lens
let pat = ~lens in lens
case lin
    Left(pat) -> lens
    Right(pat) -> lens
case ~lens
    Left(pat) -> lens
    Right(pat) -> lens
false(term)


So that's the language level syntax.
BUT
we can replace all of the lenses with, like, lambda functions. right?



*/

import { subscribe } from 'diagnostics_channel';
import { Expr, Idd, Lens, Linear, Pat, Patd, Stmt, Swap } from './ast.ts';

type Ctx = { scope: Record<string, number>; counter: { current: number } };

const subScope = (ctx: Ctx) => ({ ...ctx, scope: { ...ctx.scope } });

export const sstmt = (stmt: Stmt): string => {
    switch (stmt.type) {
        case 'let':
            return `let ${spat(stmt.pat)}=${sexpr(stmt.value)}`;
        // case 'return':
        //     return `return ${sexpr(stmt.value)}`;
        default:
            return sexpr(stmt);
    }
};

export const spat = (pat: Patd): string => {
    switch (pat.type) {
        case 'idd':
            return pat.text + pat.id;
        case 'drop':
            return '_' + (pat.id ?? '');
        case 'tuple':
            return `(${pat.items.map(spat).join(',')})`;
        case 'constructor':
            const list = unwrapp(pat);
            if (list) {
                return `[${list.items
                    .map(spat)
                    .concat(list.tail ? ['...' + spat(list.tail)] : [])
                    .join(',')}]`;
            }
            return `CONSTR`;
        // case 'lens':
        //     return '~' + spat(pat.inner);
    }
};

export const unwrapp = (expr: Patd): null | { items: Patd[]; tail: null | Patd } => {
    if (expr.type !== 'constructor') return null;
    if (expr.name === 'nil') return { items: [], tail: null };
    if (expr.name === 'cons') {
        const items: Patd[] = [];
        while (expr.type === 'constructor' && expr.name === 'cons') {
            const args: Patd[] = expr.args;
            if (args.length !== 2) throw new Error(`cons needs 2 args, found ${args.length}`);
            items.push(args[0]);
            expr = args[1];
            // console.log('args', args);
        }
        // console.log('UNWRAP', items, expr);
        if (expr.type !== 'constructor' || expr.name !== 'nil') {
            return { items, tail: expr };
        } else {
            return { items, tail: null };
        }
    }
    return null;
};

export const unwrap = (expr: Expr): null | { items: Expr[]; tail: null | Expr } => {
    if (expr.type !== 'constructor') return null;
    if (expr.name === 'nil') return { items: [], tail: null };
    if (expr.name === 'cons') {
        const items: Expr[] = [];
        while (expr.type === 'constructor' && expr.name === 'cons') {
            const args: Expr[] = expr.args;
            if (args.length !== 2) throw new Error(`cons needs 2 args, found ${args.length}`);
            items.push(args[0]);
            expr = args[1];
            // console.log('args', args);
        }
        // console.log('UNWRAP', items, expr);
        if (expr.type !== 'constructor' || expr.name !== 'nil') {
            return { items, tail: expr };
        } else {
            return { items, tail: null };
        }
    }
    return null;
};

export const sexpr = (expr: Expr): string => {
    switch (expr.type) {
        case 'constructor': {
            const list = unwrap(expr);
            if (list)
                return `[${list.items
                    .map((i) => sexpr(i))
                    .concat(list.tail ? ['...' + sexpr(list.tail)] : [])
                    .join(', ')}]`;
            return `${expr.name}(${expr.args.map(sexpr).join(',')})`;
        }
        case 'string':
            return `"${expr.head}${expr.interp.map((i) => '${' + sexpr(i.value) + '}' + i.tail).join('')}"`;
        case 'idd':
            return expr.id === -1 ? expr.text : expr.text + expr.id;
        case 'swap':
            return `swap(${spat(expr.pat)},${sexpr(expr.value)})`;
        case 'const':
            return expr.value + '';
        case 'iffe': {
            return `iffe{${expr.block.map(sstmt).join(';\n')}}{${sexpr(expr.result)}}{${expr.cleanup.map(sexpr).join(';\n')}}`;
        }
        case 'fn':
            return `(${expr.args.map(spat)})=>${
                Array.isArray(expr.body) ? `{${expr.body.map(sstmt).join(';')}}` : sexpr(expr.body)
            }`;
        case 'apply':
            return `${sexpr(expr.fn)}(${expr.args.map(sexpr).join(',')})`;
        case 'case':
            return `(match ${sexpr(expr.value)} {${expr.cases.map((c) => `${spat(c.pat)} -> ${sexpr(c.body)}`).join('\n')}})`;
        case 'tuple':
            if (expr.items.length === 1) return sexpr(expr.items[0]);
            return `(${expr.items.map(sexpr).join(',')})`;
    }
};

export const patToPatd = (ctx: Ctx, pat: Pat, allTags: boolean): Patd => {
    switch (pat.type) {
        case 'id': {
            const id = ctx.counter.current++;
            ctx.scope[pat.text] = id;
            return { ...pat, type: 'idd', id };
        }
        case 'drop':
            return { ...pat, id: allTags ? ctx.counter.current++ : null };
        case 'tuple':
            return { ...pat, items: pat.items.map((p) => patToPatd(ctx, p, allTags)) };
        case 'constructor':
            return { ...pat, args: pat.args.map((p) => patToPatd(ctx, p, allTags)) };
        case 'lens':
            throw new Error(`pat lens cant be deified`);
        // return { ...pat, inner: patToPatd(ctx, pat.inner) };
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

export const patdToExpr = (pat: Patd): Expr => {
    switch (pat.type) {
        case 'idd':
            return pat;
        case 'drop':
            return { type: 'idd', text: '_', id: pat.id, loc: pat.loc };
        case 'tuple':
            return { ...pat, items: pat.items.map(patdToExpr) };
        case 'constructor':
            return {
                type: 'constructor',
                name: pat.name,
                args: pat.args.map(patdToExpr),
                loc: pat.loc,
            };
    }
};

export const collapseIffe = (expr: Expr): Expr => {
    if (expr.type === 'iffe' && expr.result.type === 'iffe') {
        const result = collapseIffe(expr.result) as Expr & { type: 'iffe' };
        return {
            ...expr,
            block: [...expr.block, ...result.block],
            result: result.result,
            cleanup: [...result.cleanup, ...expr.cleanup],
        };
    }
    return expr;
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
            const pat = patToPatd(sub, lin.pat, false);
            const next = linearToExpr(sub, lin.body);
            const cleanup: Swap[] = [];
            let lest: Stmt;
            if (lin.value.type === 'lens') {
                return collapseIffe(
                    lensToExpr(sub, lin.value.lens, (lpat) => {
                        return {
                            type: 'iffe',
                            block: [
                                {
                                    type: 'let',
                                    pat,
                                    loc: lin.loc,
                                    value: patdToExpr(lpat),
                                },
                            ],
                            result: next,
                            cleanup: [
                                {
                                    type: 'swap',
                                    pat: lpat,
                                    value: patdToExpr(pat),
                                    loc: -1,
                                },
                            ],
                            loc: lin.loc,
                        };
                    }),
                );
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
            const last = lin.args[lin.args.length - 1];
            const sub = subScope(ctx);
            if (lin.body.type === 'lens') {
                if (last?.pat.type === 'lens') {
                    const inner = last.pat.inner;
                    const args = lin.args.map((a, i) =>
                        i === lin.args.length - 1
                            ? patToPatd(sub, inner, false)
                            : patToPatd(sub, a.pat, false),
                    );
                    const block: Stmt[] = [];
                    const body = lensToExpr(sub, lin.body.lens, (pat): Expr => {
                        return {
                            type: 'tuple',
                            items: [
                                patdToExpr(pat),
                                {
                                    type: 'fn',
                                    args: [pat],
                                    body: {
                                        type: 'iffe',
                                        block,
                                        result: patdToExpr(args[args.length - 1]),
                                        cleanup: [],
                                        loc: lin.loc,
                                    },
                                    loc: lin.loc,
                                },
                            ],
                            loc: lin.loc,
                        };
                    });
                    const pushCleanupInside = (expr: Expr) => {
                        if (expr.type === 'iffe') {
                            block.push(...expr.cleanup);
                            expr.cleanup = [];
                            pushCleanupInside(expr.result);
                        }
                    };
                    pushCleanupInside(body);
                    return {
                        ...lin,
                        args,
                        body,
                    };
                }
                throw 6;
            }
            if (last?.pat.type === 'lens') {
                const inner = last.pat.inner;
                const args = lin.args.map((a, i) =>
                    i === lin.args.length - 1
                        ? patToPatd(sub, inner, false)
                        : patToPatd(sub, a.pat, false),
                );
                const body = linearToExpr(sub, lin.body);
                return {
                    ...lin,
                    args,
                    body: {
                        type: 'tuple',
                        items: [body, patdToExpr(args[args.length - 1])],
                        loc: lin.loc,
                    },
                };
            }
            const args = lin.args.map((a) => patToPatd(sub, a.pat, false));
            const body = linearToExpr(sub, lin.body);
            return {
                ...lin,
                args,
                body,
            };
        }
        case 'apply':
            const last = lin.args[lin.args.length - 1];
            if (last?.type === 'lens') {
                return lensToExpr(ctx, last.lens, (tmp: Patd): Expr => {
                    const rid = ctx.counter.current++;
                    const lid = ctx.counter.current++;
                    return {
                        type: 'iffe',
                        block: [
                            {
                                type: 'let',
                                pat: {
                                    type: 'tuple',
                                    items: [
                                        { type: 'idd', text: 'r', id: rid, loc: -1 },
                                        { type: 'idd', text: 'l', id: lid, loc: -1 },
                                    ],
                                    loc: -1,
                                },
                                loc: -1,
                                value: {
                                    ...lin,
                                    fn: linearToExpr(ctx, lin.fn),
                                    args: lin.args.map((arg, i) => {
                                        if (i === lin.args.length - 1) return patdToExpr(tmp);
                                        if (arg.type === 'lens') throw 5;
                                        return linearToExpr(ctx, arg);
                                    }),
                                },
                            },
                        ],
                        result: { type: 'idd', text: 'r', id: rid, loc: -1 },
                        cleanup: [
                            {
                                type: 'swap',
                                pat: tmp,
                                value: { type: 'idd', text: 'l', id: lid, loc: -1 },
                                loc: -1,
                            },
                        ],
                        loc: -1,
                    };
                });
            }

            return {
                ...lin,
                fn: linearToExpr(ctx, lin.fn),
                args: lin.args.map((arg) => {
                    if (arg.type === 'lens') throw new Error('only last can be lens');
                    return linearToExpr(ctx, arg);
                }),
            };
        case 'tuple':
            return { ...lin, items: lin.items.map((lin) => linearToExpr(ctx, lin)) };
        case 'assign': {
            return lensToExpr(ctx, lin.lens, (pat) => {
                return { type: 'swap', pat, value: linearToExpr(ctx, lin.value), loc: lin.loc };
            });
        }
        // here we do a thing
        case 'constructor': {
            return {
                ...lin,
                args: lin.args.map((l) => linearToExpr(ctx, l)),
            };
        }
        case 'case': {
            if (lin.value.type !== 'lens') {
                return {
                    ...lin,
                    cases: lin.cases.map((l) => {
                        const sub = subScope(ctx);
                        return {
                            ...l,
                            pat: patToPatd(sub, l.pat, true),
                            body: linearToExpr(sub, l.body),
                        };
                    }),

                    value: linearToExpr(ctx, lin.value),
                };
            }
            return lensToExpr(ctx, lin.value.lens, (pat): Expr => {
                return {
                    ...lin,
                    cases: lin.cases.map((l) => {
                        // OK SO, if the value was a lens, then
                        // ALL THE PATS must be lenses
                        // and we'll need to reconstruct the original value dealio
                        // at the end.
                        const pd = patToPatd(ctx, l.pat, true);
                        return {
                            ...l,
                            pat: pd,
                            body: collapseIffe({
                                type: 'iffe',
                                block: [],
                                result: linearToExpr(ctx, l.body),
                                cleanup: [
                                    { type: 'swap', pat, value: patdToExpr(pd), loc: lin.loc },
                                ],
                                loc: lin.loc,
                            }),
                        };
                    }),
                    value: patdToExpr(pat),
                };
            });
        }
        // throw new Error('not support yet ' + lin.type);
    }
};

export const lensToExpr = (ctx: Ctx, lens: Lens, inner: (name: Patd) => Expr): Expr => {
    switch (lens.type) {
        case 'id': {
            const id = ctx.scope[lens.text];
            if (id == null) throw new Error(`unbound ${lens.text}`);
            return inner({ ...lens, type: 'idd', id });
        }
        case 'tuple': {
            let next = (i: number, items: Patd[]): Expr => {
                if (i === lens.items.length) {
                    return inner({ type: 'tuple', items, loc: lens.loc });
                }
                return lensToExpr(ctx, lens.items[i], (name) => next(i + 1, [...items, name]));
            };
            return next(0, []);
        }
        case 'apply': {
            const finish = (tmp?: Patd): Expr => {
                const tid = ctx.counter.current++;
                const cid = ctx.counter.current++;
                return collapseIffe({
                    type: 'iffe',
                    block: [
                        {
                            type: 'let',
                            pat: {
                                type: 'tuple',
                                items: [
                                    { type: 'idd', text: 't', id: tid, loc: -1 },
                                    { type: 'idd', text: 'c', id: cid, loc: -1 },
                                ],
                                loc: -1,
                            },
                            value: {
                                type: 'apply',
                                fn: linearToExpr(ctx, lens.fn),
                                args: lens.args.map((arg, i) => {
                                    if (tmp && i === lens.args.length - 1) return patdToExpr(tmp);
                                    if (arg.type === 'lens')
                                        throw new Error('only last can be lens');
                                    return linearToExpr(ctx, arg);
                                }),
                                loc: -1,
                            },
                            loc: -1,
                        },
                    ],
                    result: inner({ type: 'idd', id: tid, text: 't', loc: -1 }),
                    cleanup: [
                        {
                            type: 'swap',
                            pat: tmp ?? { type: 'tuple', items: [], loc: -1 },
                            value: {
                                type: 'apply',
                                fn: { type: 'idd', id: cid, text: 'c', loc: -1 },
                                args: [{ type: 'idd', id: tid, text: 't', loc: -1 }],
                                loc: -1,
                            },
                            loc: -1,
                        },
                    ],
                    loc: -1,
                });
            };
            const last = lens.args[lens.args.length - 1];
            if (last?.type !== 'lens') return finish();
            return lensToExpr(ctx, last.lens, finish);
        }
        case 'aslens': {
            const tid = ctx.counter.current++;
            const cid = ctx.counter.current++;
            const subFinish = subScope(ctx);
            return {
                type: 'iffe',
                block: [
                    {
                        type: 'let',
                        pat: { type: 'idd', text: 't', id: tid, loc: -1 },
                        value: linearToExpr(ctx, lens.value),
                        loc: lens.loc,
                    },
                    {
                        type: 'let',
                        pat: { type: 'idd', text: 'c', id: cid, loc: -1 },
                        value: {
                            type: 'fn',
                            args: [patToPatd(subFinish, lens.pat, false)],
                            body: linearToExpr(subFinish, lens.body),
                            loc: lens.loc,
                        },
                        loc: lens.loc,
                    },
                ],
                result: inner({ type: 'idd', text: 't', id: tid, loc: -1 }),
                loc: lens.loc,
                cleanup: [
                    {
                        type: 'swap',
                        pat: { type: 'tuple', items: [], loc: lens.loc },
                        value: {
                            type: 'apply',
                            fn: { type: 'idd', id: cid, text: 'c', loc: -1 },
                            args: [{ type: 'idd', id: tid, text: 't', loc: -1 }],
                            loc: -1,
                        },
                        loc: -1,
                    },
                ],
            };
        }
        case 'case': {
            const tid = ctx.counter.current++;
            const cid = ctx.counter.current++;
            if (lens.value.type !== 'lens') throw 9;
            return lensToExpr(ctx, lens.value.lens, (mpat) =>
                collapseIffe({
                    type: 'iffe',
                    block: [
                        {
                            type: 'let',
                            pat: {
                                type: 'tuple',
                                items: [
                                    { type: 'idd', text: 't', id: tid, loc: -1 },
                                    { type: 'idd', text: 'c', id: cid, loc: -1 },
                                ],
                                loc: -1,
                            },
                            value: {
                                type: 'case',
                                value: patdToExpr(mpat),
                                cases: lens.cases.map(({ pat, body }) => {
                                    const sub = subScope(ctx);
                                    const cpat = patToPatd(sub, pat, true);
                                    return {
                                        pat: cpat,
                                        body: lensToExpr(sub, body, (bpat): Expr => {
                                            return {
                                                type: 'tuple',
                                                items: [
                                                    patdToExpr(bpat),
                                                    {
                                                        type: 'fn',
                                                        args: [bpat],
                                                        body: patdToExpr(cpat),
                                                        loc: lens.loc,
                                                    },
                                                ],
                                                loc: lens.loc,
                                            };
                                        }),
                                    };
                                }),
                                // args: lens.args.map((arg, i) => {
                                //     if (tmp && i === lens.args.length - 1) return patdToExpr(tmp);
                                //     if (arg.type === 'lens')
                                //         throw new Error('only last can be lens');
                                //     return linearToExpr(ctx, arg);
                                // }),
                                loc: -1,
                            },
                            loc: -1,
                        },
                    ],
                    result: inner({ type: 'idd', id: tid, text: 't', loc: -1 }),
                    cleanup: [
                        {
                            type: 'swap',
                            pat: mpat,
                            value: {
                                type: 'apply',
                                fn: { type: 'idd', id: cid, text: 'c', loc: -1 },
                                args: [{ type: 'idd', id: tid, text: 't', loc: -1 }],
                                loc: -1,
                            },
                            loc: -1,
                        },
                    ],
                    loc: -1,
                }),
            );
        }
        case 'let':
            throw new Error('not yet');
    }
};
