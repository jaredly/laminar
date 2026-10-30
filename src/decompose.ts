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
Left(lin)
Right(lin)
case lin
    Left(pat) -> lin
    Right(pat) -> lin
case ~lens
    Left(pat) -> lin
    Right(pat) -> lin

-> easy
lin & lin // SPLIT
fst(lin)
snd(lin)

-> hard
unlens lens in lin
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
case ~lens
    Left(pat) -> lens
    Right(pat) -> lens
case lin
    Left(pat) -> lens
    Right(pat) -> lens

-> easier
() : ()/A'

-> harder???
let pat = lin in lens
let pat = ~lens in lens
false(term)


So that's the language level syntax.
BUT
we can replace all of the lenses with, like, lambda functions. right?



*/

import { subscribe } from 'diagnostics_channel';
import { Expr, Idd, Lens, Linear, Pat, Patd, patdBinds, Stmt, Swap } from './ast.ts';
import { Node } from './lexer.ts';

type Ctx = { scope: Record<string, number>; counter: { current: number } };

const subScope = (ctx: Ctx) => ({ ...ctx, scope: { ...ctx.scope } });

export const sstmt = (stmt: Stmt): string => {
    switch (stmt.type) {
        case 'let':
            return `let ${spat(stmt.pat)} = ${sexpr(stmt.value)}`;
        // case 'return':
        //     return `return ${sexpr(stmt.value)}`;
        default:
            return sexpr(stmt);
    }
};

export const lstmt = (stmt: Stmt): Node => {
    switch (stmt.type) {
        case 'let':
            return l.l(' ', [`let`, lpat(stmt.pat), '=', lexpr(stmt.value)]);
        // case 'return':
        //     return `return ${sexpr(stmt.value)}`;
        default:
            return lexpr(stmt);
    }
};

export const spat = (pat: Patd): string => {
    switch (pat.type) {
        case 'idd':
            return pat.id === -1 ? pat.text : pat.text + pat.id;
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
            return `${pat.name}(${pat.args.map(spat).join(',')})`;
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

import { dsl as l } from './lexer.ts';

export const lpat = (pat: Patd): Node => {
    switch (pat.type) {
        case 'idd':
            return l.i(pat.id === -1 ? pat.text : pat.text + pat.id);
        case 'drop':
            return l.i('_' + (pat.id ?? ''));
        case 'tuple':
            return l.l(`(,`, pat.items.map(lpat));
        case 'constructor':
            const list = unwrapp(pat);
            if (list) {
                return l.l(
                    `[,`,
                    list.items
                        .map(lpat)
                        .concat(list.tail ? l.l('', [l.o('...'), lpat(list.tail)]) : []),
                );
            }
            return l.l('', [pat.name, l.l('(,', pat.args.map(lpat))]);
    }
};

export const lexpr = (expr: Expr): Node => {
    switch (expr.type) {
        case 'constructor': {
            const list = unwrap(expr);
            if (list)
                return l.l(
                    '[,',
                    list.items
                        .map((i) => lexpr(i))
                        .concat(list.tail ? [l.l('', ['...', lexpr(list.tail)])] : []),
                );
            return l.l('', [expr.name, l.l('(,', expr.args.map(lexpr))]);
        }
        case 'string':
            return l.l('"', [expr.head, ...expr.interp.flatMap((i) => [lexpr(i.value), i.tail])]);
        case 'idd':
            return l.i(expr.id === -1 ? expr.text : expr.text + expr.id);
        case 'swap':
            return l.l('', ['swap', l.l('(,', [lpat(expr.pat), lexpr(expr.value)])]);
        case 'const':
            return l.i(expr.value + '');
        case 'iffe': {
            return l.l('', [
                `iffe`,
                l.l('{;', expr.block.map(lstmt)),
                l.w('{', lexpr(expr.result)),
                l.l('{;', expr.cleanup.map(lexpr)),
            ]);
        }
        case 'fn':
            return l.l('', [
                l.l(`(,`, expr.args.map(lpat)),
                '=>',
                Array.isArray(expr.body) ? l.l(`{;`, expr.body.map(lstmt)) : lexpr(expr.body),
            ]);
        case 'apply': {
            const res = l.l('', [lexpr(expr.fn), l.l('(,', expr.args.map(lexpr))]);
            if (expr.fn.type === 'idd' && expr.fn.text === '*') {
                return l.w('(', res);
            }
            return res;
        }
        case 'case':
            return l.l(`(`, [
                l.l(' ', [
                    'match',
                    lexpr(expr.value),
                    l.l(
                        '{',
                        expr.cases.map((c) => l.l(' ', [lpat(c.pat), '->', lexpr(c.body)])),
                    ),
                ]),
            ]);
        case 'tuple':
            if (expr.items.length === 1) return lexpr(expr.items[0]);
            return l.l(`(,`, expr.items.map(lexpr));
    }
    throw new Error('oks' + JSON.stringify(expr));
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
            if (pat.id == null) throw new Error(`drop not initialized with an id`);
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
            const pat =
                lin.pat.type === 'drop' && lin.value.type === 'fn' && lin.value.name
                    ? patToPatd(
                          sub,
                          { type: 'id', text: lin.value.name, loc: lin.value.loc },
                          false,
                      )
                    : patToPatd(sub, lin.pat, false);
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
                    const body =
                        lin.body.lens.type === 'manual'
                            ? {
                                  type: 'tuple' as const,
                                  items: [
                                      linearToExpr(sub, lin.body.lens.frontend),
                                      linearToExpr(sub, lin.body.lens.backend),
                                  ],
                                  loc: lin.body.lens.loc,
                              }
                            : lensToExpr(sub, lin.body.lens, (pat): Expr => {
                                  const id = ctx.counter.current++;
                                  const iid: Idd = { type: 'idd', id, text: 'back', loc: -1 };
                                  block.push({ type: 'swap', pat, value: iid, loc: -1 });
                                  return {
                                      type: 'tuple',
                                      items: [
                                          patdToExpr(pat),
                                          {
                                              type: 'fn',
                                              args: [iid],
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

                const args = lin.args.map((a) => patToPatd(sub, a.pat, false));
                const block: Stmt[] = [];
                const body =
                    lin.body.lens.type === 'manual'
                        ? {
                              type: 'tuple' as const,
                              items: [
                                  linearToExpr(sub, lin.body.lens.frontend),
                                  linearToExpr(sub, lin.body.lens.backend),
                              ],
                              loc: lin.body.lens.loc,
                          }
                        : lensToExpr(sub, lin.body.lens, (pat): Expr => {
                              const id = ctx.counter.current++;
                              const iid: Idd = { type: 'idd', id, text: 'back', loc: -1 };
                              block.push({ type: 'swap', pat, value: iid, loc: -1 });
                              return {
                                  type: 'tuple',
                                  items: [
                                      patdToExpr(pat),
                                      {
                                          type: 'fn',
                                          args: [iid],
                                          body: {
                                              type: 'iffe',
                                              block,
                                              result: { type: 'tuple', items: [], loc: -1 },
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
    }
    throw new Error('not support yet ' + (lin as any).type);
};

export const lensToExpr = (ctx: Ctx, lens: Lens, inner: (name: Patd) => Expr): Expr => {
    switch (lens.type) {
        case 'manual': {
            throw new Error(`manual lenses only allowed in certain contexts`);
        }
        case 'id': {
            const id = ctx.scope[lens.text];
            if (id == null) throw new Error(`unbound ${lens.text}`);
            return inner({ ...lens, type: 'idd', id });
        }
        // case 'constructor': {
        //     let next = (i: number, args: Patd[]): Expr => {
        //         if (i === lens.args.length) {
        //             return inner({ type: 'constructor', name: lens.name, args, loc: lens.loc });
        //         }
        //         return lensToExpr(ctx, lens.args[i], (name) => next(i + 1, [...args, name]));
        //     };
        //     return next(0, []);
        // }
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
            const finish = (tmp?: Patd) =>
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
                                value: tmp
                                    ? patdToExpr(tmp)
                                    : linearToExpr(ctx, lens.value as Linear),
                                cases: lens.cases.map(({ pat, body }) => {
                                    const sub = subScope(ctx);
                                    const cpat = patToPatd(sub, pat, true);
                                    return {
                                        pat: cpat,
                                        body:
                                            body.type === 'manual'
                                                ? {
                                                      type: 'tuple',
                                                      items: [
                                                          linearToExpr(sub, body.frontend),
                                                          linearToExpr(sub, body.backend),
                                                      ],
                                                      loc: lens.loc,
                                                  }
                                                : lensToExpr(sub, body, (bpat): Expr => {
                                                      const hasBindings = patdBinds(bpat);
                                                      const id = ctx.counter.current++;
                                                      return {
                                                          type: 'tuple',
                                                          items: [
                                                              patdToExpr(bpat),
                                                              {
                                                                  type: 'fn',
                                                                  args: [
                                                                      {
                                                                          type: 'idd',
                                                                          id,
                                                                          loc: -1,
                                                                          text: 'back',
                                                                      },
                                                                  ],
                                                                  body: collapseIffe({
                                                                      type: 'iffe',
                                                                      result: patdToExpr(cpat),
                                                                      loc: -1,
                                                                      block: [
                                                                          {
                                                                              type: 'swap',
                                                                              value: {
                                                                                  type: 'idd',
                                                                                  id,
                                                                                  loc: -1,
                                                                                  text: 'back',
                                                                              },
                                                                              pat: bpat,
                                                                              loc: -1,
                                                                          },
                                                                      ],
                                                                      cleanup: [],
                                                                  }),
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
                            pat: tmp ?? { type: 'drop', loc: -1, id: null }, // { type: 'tuple', items: [], loc: -1 },
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
            if (lens.value.type !== 'lens') return finish();
            return lensToExpr(ctx, lens.value.lens, finish);
        }
        case 'let':
            throw new Error('not yet');
    }
    throw new Error('not support yet ' + (lens as any).type);
};
