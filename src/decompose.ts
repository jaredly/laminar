import { captureUses } from './captures.ts';
import { free, Lens, Linear, names, Pat } from './ast.ts';
import { Expr, Idd, Patd, Ref, Stmt } from './expr.ts';
import { string } from '../parser-generator/grammar-lexer.ts';

export type Scope = Record<
    string,
    { type: 'builtin' } | { type: 'stack'; id: number } | { type: 'ref'; id: number }
>;
type Ctx = { scope: Scope; counter: { current: number } };

export const subScope = (ctx: Ctx) => ({ ...ctx, scope: { ...ctx.scope } });
// One thing we should do:
// - first, extract all nested lens calls

const collectStackIds = (pat: Patd, found: (id: Idd) => void) => {
    switch (pat.type) {
        case 'idd':
            found(pat);
            return;
        case 'string':
        case 'number':
        case 'bool':
            return;
        case 'ref':
            return;
        case 'deref':
            collectStackIds(pat.inner, found);
            return;
        case 'tuple':
            pat.items.forEach((pat) => collectStackIds(pat, found));
            return;
        case 'constructor':
            pat.args.forEach((pat) => collectStackIds(pat, found));
            return;
    }
};

// export const addClosures = (expr: Expr, stack: string[][], capture: Idd[]): Expr => {
//     switch (expr.type) {
//         case 'block': {
//             const sub: Idd[] = [];
//             // let letIds: Idd[] = [];
//             const mine: string[] = [];
//             const subStack = [...stack, mine];
//             const block = expr.block.map((stmt) => {
//                 if (stmt.type === 'let') {
//                     let got: string[] = [];
//                     collectStackIds(stmt.pat, (id) => {
//                         // letIds.push(id);
//                         got.push(id.text + id.id);
//                     });
//                     const res: Stmt = { ...stmt, value: addClosures(stmt.value, subStack, sub) };
//                     mine.push(...got);
//                     return res;
//                 } else {
//                     return addClosures(stmt, subStack, sub);
//                 }
//             });
//
//             const res = {
//                 ...expr,
//                 block,
//                 result: addClosures(expr.result, subStack, sub),
//                 cleanup: expr.cleanup.map((e) => addClosures(e, subStack, sub)),
//             };
//
//             if (sub.length) {
//                 return {
//                     type: 'closure',
//                     names: sub,
//                     fn: res,
//                     loc: expr.loc,
//                 };
//             }
//
//             return res;
//         }
//         case 'idd':
//             for (let i = 0; i < stack.length - 1; i++) {
//                 if (stack[i].includes(expr.text + expr.id)) {
//                     capture.push(expr);
//                     break;
//                 }
//             }
//             return expr;
//         case 'ref':
//             return expr; // ignoring refs
//         case 'deref':
//             return { ...expr, inner: addClosures(expr.inner, stack, capture) };
//         case 'string':
//             return {
//                 ...expr,
//                 interp: expr.interp.map((i) => ({
//                     ...i,
//                     value: addClosures(i.value, stack, capture),
//                 })),
//             };
//         case 'swap': {
//             // collectPatdNames(expr.pat, (id) => {
//             //     for (let i = 0; i < stack.length - 1; i++) {
//             //         if (stack[i].includes(id.text + id.id)) {
//             //             capture.push(id);
//             //             break;
//             //         }
//             //     }
//             // });
//             return { ...expr, value: addClosures(expr.value, stack, capture) };
//         }
//         case 'const':
//             return expr;
//         case 'tuple':
//             return { ...expr, items: expr.items.map((e) => addClosures(e, stack, capture)) };
//         case 'apply':
//             return {
//                 ...expr,
//                 fn: addClosures(expr.fn, stack, capture),
//                 args: expr.args.map((a) => addClosures(a, stack, capture)),
//             };
//         case 'constructor':
//             return { ...expr, args: expr.args.map((a) => addClosures(a, stack, capture)) };
//         case 'closure':
//             return expr; // assume we've already handled things??
//         case 'fn':
//             return expr; // TODO
//         case 'case':
//             return {
//                 ...expr,
//                 value: addClosures(expr.value, stack, capture),
//                 cases: expr.cases.map(({ pat, body }) => {
//                     const self = [...stack];
//                     self[self.length - 1] = self[self.length - 1].slice();
//                     collectStackIds(pat, (id) => {
//                         self[self.length - 1].push(id.text + id.id);
//                     });
//                     // TODO: should I add a closure here?
//                     return { pat, body: addClosures(body, self, capture) };
//                 }),
//             };
//     }
// };

export const collectPatdNames = (pat: Patd, found: (id: Idd) => void) => {
    switch (pat.type) {
        case 'idd':
            found(pat);
            return;
        case 'number':
        case 'bool':
        case 'string':
            return;
        // case 'list':
        //     return pat.items.flatMap(names).concat(pat.tail ? names(pat.tail) : []);
        case 'tuple':
            return pat.items.forEach((p) => collectPatdNames(p, found));
        case 'constructor':
            return pat.args.forEach((p) => collectPatdNames(p, found));
        case 'deref':
        case 'ref':
            collectPatdNames(pat.inner, found);
            return;
    }
};

export const linearToExpr = (ctx: Ctx, lin: Linear): Expr => {
    switch (lin.type) {
        case 'bool':
        case 'number':
            return { type: 'const', value: lin.value, loc: lin.loc };
        case 'id':
        case 'op': {
            const id = ctx.scope[lin.text];
            if (id == null) throw new Error(`unbound ${lin.text}`);
            if (id.type === 'builtin') {
                return { ...lin, type: 'idd', id: -1 };
            }
            return { type: 'deref', loc: lin.loc, inner: { ...lin, type: 'idd', id: id.id } };
        }
        case 'string':
            return {
                ...lin,
                interp: lin.interp.map((l) => ({ ...l, value: linearToExpr(ctx, l.value) })),
            };
        case 'tuple':
            return { ...lin, items: lin.items.map((lin) => linearToExpr(ctx, lin)) };
        case 'constructor': {
            return {
                ...lin,
                args: lin.args.map((l) => linearToExpr(ctx, l)),
            };
        }
        case 'apply': {
            const last = lin.args[lin.args.length - 1];
            if (last && last.type === 'lens') {
                return lensToRvalue(ctx, last.lens, (value, cleanup) =>
                    withCleanup(
                        {
                            ...lin,
                            fn: linearToExpr(ctx, lin.fn),
                            args: lin.args.map((arg, i) => {
                                if (i === lin.args.length - 1) return eref(value);
                                if (arg.type === 'lens')
                                    throw new Error(`lens only allowed in final position`);
                                return linearToExpr(ctx, arg);
                            }),
                        },
                        cleanup,
                    ),
                );
            }
            return {
                ...lin,
                fn: linearToExpr(ctx, lin.fn),
                args: lin.args.map((arg) => {
                    if (arg.type === 'lens') throw new Error(`lens only allowed in final position`);
                    return linearToExpr(ctx, arg);
                }),
            };
        }
        case 'assign': {
            return lensToRvalue(ctx, lin.lens, (ref, cleanup) =>
                withCleanup(
                    {
                        type: 'swap',
                        pat: pref(ref),
                        loc: lin.loc,
                        value: linearToExpr(ctx, lin.value),
                    },
                    cleanup,
                ),
            );
        }
        case 'let':
            return letToExpr(ctx, lin);
        case 'fn': {
            let last: Patd | null = null;
            const args: Patd[] = [];
            lin.args.forEach((arg, i) => {
                if (arg.pat.type === 'lens') {
                    if (i !== lin.args.length - 1) {
                        throw new Error(`lens arg must be last`);
                    }
                    last = patToPatd(ctx, arg.pat.inner, true);
                } else {
                    args.push({
                        type: 'deref',
                        inner: patToPatd(ctx, arg.pat, false),
                        loc: arg.pat.loc,
                    });
                }
            });
            const argnames = lin.args.flatMap((v) => names(v.pat));
            const { values: ref } = captureUses(lin.body, new Set(argnames));
            const self = [...ref]
                .map((name): Idd | null => {
                    const id = ctx.scope[name];
                    if (id == null) throw new Error(`unbound ${name}`);
                    if (id.type === 'builtin') return null;
                    return { type: 'idd', id: id.id, text: name, loc: lin.loc };
                })
                .filter(notEmpty);
            const result: Expr =
                lin.body.type === 'lens'
                    ? {
                          type: 'fn',
                          args: last ? args.concat([pref(last)]) : args,
                          body: lensToRvalue(ctx, lin.body.lens, (inner, cleanup): Expr => {
                              return {
                                  type: 'tuple',
                                  loc: lin.loc,
                                  items: [eref(inner), cleanupFn(cleanup, inner.loc)],
                              };
                          }),
                          loc: lin.loc,
                      }
                    : last
                      ? {
                            type: 'fn',
                            args: args.concat([pref(last)]),
                            body: linearToExpr(ctx, lin.body),
                            loc: lin.loc,
                        }
                      : {
                            type: 'fn',
                            args: args,
                            body: linearToExpr(ctx, lin.body),
                            loc: lin.loc,
                        };
            if (self.length) {
                return {
                    type: 'closure',
                    names: self,
                    fn: result,
                    loc: lin.loc,
                };
            } else {
                return result;
            }
        }
        case 'case': {
            if (lin.value.type === 'lens') {
                return lensToRvalue(ctx, lin.value.lens, (inner, cleanup) =>
                    withCleanup(
                        makeCase(ctx, { type: 'ref', inner, loc: lin.loc }, lin, true),
                        cleanup,
                    ),
                );
            }
            return makeCase(ctx, linearToExpr(ctx, lin.value), lin, false);
        }
    }
    throw new Error('bat lintoexp');
};

const cleanupFn = (cleanup: Expr[], loc: Loc): Expr => {
    if (!cleanup.length) {
        return {
            type: 'fn',
            retained: true,
            args: [],
            body: { type: 'const', loc, value: null },
            loc,
        };
    }
    if (cleanup.length === 1 && cleanup[0].type === 'apply' && cleanup[0].args.length === 0)
        return cleanup[0].fn;
    return {
        type: 'fn',
        retained: true,
        args: [],
        body: {
            type: 'block',
            block: [],
            result: { type: 'const', loc, value: null },
            loc,
            cleanup,
        },
        loc,
    };
};

const lensCaseResult = (inner: Expr, cleanup: Expr[]): Expr => ({
    type: 'tuple',
    loc: inner.loc,
    items: [{ type: 'ref', inner, loc: inner.loc }, cleanupFn(cleanup, inner.loc)],
});

const makeLensCase = (
    ctx: Ctx,
    value: Expr,
    lin: Lens & { type: 'case' },
    ref: boolean,
    inner: (inner: Expr, cleanup: Expr[]) => Expr,
): Expr => {
    // Pattern storage outlives branch selection when the result is a lens.
    if (!ref) {
        const tid = ctx.counter.current++,
            rid = ctx.counter.current++;
        const focus: Idd = { type: 'idd', id: tid, text: 'case-focus', loc: lin.loc };
        const finish: Idd = { type: 'idd', id: rid, text: 'case-finish', loc: lin.loc };
        return {
            type: 'block',
            loc: lin.loc,
            block: [
                {
                    type: 'let',
                    loc: lin.loc,
                    pat: { type: 'tuple', loc: lin.loc, items: [pref(focus), finish] },
                    value: {
                        type: 'apply',
                        loc: lin.loc,
                        fn: { type: 'idd', id: -1, text: 'heap', loc: lin.loc },
                        args: [value],
                    },
                },
            ],
            result: makeLensCase(ctx, eref(focus), lin, true, (focus, cleanup) =>
                inner(focus, [...cleanup, { type: 'apply', loc: lin.loc, fn: finish, args: [] }]),
            ),
            cleanup: [],
        };
    }
    return {
        type: 'case',
        value,
        loc: lin.loc,
        cases: lin.cases.map((kase) => {
            const sub = subScope(ctx);
            return {
                pat: {
                    type: ref ? 'ref' : 'deref',
                    loc: lin.loc,
                    inner: patToPatd(sub, kase.pat, ref),
                },
                body: lensToRvalue(sub, kase.body, inner),
            };
        }),
    };
};

const makeCase = (ctx: Ctx, value: Expr, lin: Linear & { type: 'case' }, ref: boolean): Expr => {
    return {
        type: 'case',
        value,
        loc: lin.loc,
        cases: lin.cases.map((kase) => {
            const sub = subScope(ctx);
            return {
                pat: {
                    type: ref ? 'ref' : 'deref',
                    loc: lin.loc,
                    inner: patToPatd(sub, kase.pat, ref),
                },
                body: linearToExpr(sub, kase.body),
            };
        }),
    };
};

export const lensAsRef = (ctx: Ctx, lens: Lens): Ref => {
    switch (lens.type) {
        case 'tuple':
            return { ...lens, items: lens.items.map((item) => lensAsRef(ctx, item)) };
        case 'id': {
            const id = ctx.scope[lens.text];
            if (id == null) throw new Error(`unbound ${lens.text}`);
            return {
                type: 'ref',
                loc: lens.loc,
                inner: { ...lens, type: 'idd', id: id.type === 'builtin' ? -1 : id.id },
            };
        }
        case 'aslens':
        case 'let':
        case 'apply':
        case 'index':
        case 'case':
            throw new Error(`complex lens`);
    }
};

const withCleanup = (expr: Expr, cleanup: Expr[]): Expr =>
    cleanup.length ? { type: 'block', cleanup, result: expr, block: [], loc: expr.loc } : expr;

export const lensToRvalue = (
    ctx: Ctx,
    lin: Lens,
    inner: (v: Ref, cleanup: Expr[]) => Expr,
): Expr => {
    switch (lin.type) {
        case 'id': {
            const id = ctx.scope[lin.text];
            if (id == null) throw new Error(`unbound ${lin.text}`);
            return inner({ ...lin, type: 'idd', id: id.type === 'builtin' ? -1 : id.id }, []);
        }
        case 'apply': {
            const tid = ctx.counter.current++;
            const rid = ctx.counter.current++;
            const apply = (args: () => Expr[], cleanup: Expr[]): Expr =>
                collapseIffe({
                    type: 'block',
                    block: [
                        {
                            type: 'let',
                            pat: {
                                type: 'tuple',
                                items: [
                                    {
                                        type: 'ref',
                                        inner: { type: 'idd', id: tid, text: 't', loc: lin.loc },
                                        loc: lin.loc,
                                    },
                                    { type: 'idd', id: rid, text: 'r', loc: lin.loc },
                                ],
                                loc: lin.loc,
                            },
                            loc: lin.loc,
                            value: {
                                type: 'apply',
                                loc: lin.loc,
                                fn: linearToExpr(ctx, lin.fn),
                                args: args(),
                            },
                        },
                    ],
                    loc: lin.loc,
                    result: inner({ type: 'idd', id: tid, text: 't', loc: lin.loc }, [
                        {
                            type: 'apply',
                            fn: { type: 'idd', id: rid, loc: lin.loc, text: 'r' },
                            loc: lin.loc,
                            args: [],
                        },
                        ...cleanup,
                    ]),
                    cleanup: [],
                });
            const last = lin.args.at(-1);
            // The returned lens must complete before its argument backing is
            // restored or released. Ordinary expression calls complete immediately.
            if (last?.type === 'lens')
                return lensToRvalue(ctx, last.lens, (value, cleanup) =>
                    apply(
                        () =>
                            lin.args.map((arg, i) => {
                                if (i === lin.args.length - 1) return eref(value);
                                if (arg.type === 'lens')
                                    throw new Error('lens only allowed in final position');
                                return linearToExpr(ctx, arg);
                            }),
                        cleanup,
                    ),
                );
            return apply(
                () =>
                    lin.args.map((arg) => {
                        if (arg.type === 'lens')
                            throw new Error('lens only allowed in final position');
                        return linearToExpr(ctx, arg);
                    }),
                [],
            );
        }
        case 'tuple': {
            let next = (i: number, items: Ref[], cleanup: Expr[]): Expr => {
                if (i >= lin.items.length) {
                    return inner({ type: 'tuple', items, loc: lin.loc }, cleanup);
                } else {
                    return lensToRvalue(ctx, lin.items[i], (value, more) =>
                        next(i + 1, [...items, value], [...cleanup, ...more]),
                    );
                }
            };
            return next(0, [], []);
        }
        case 'aslens': {
            const tid = ctx.counter.current++;
            const rid = ctx.counter.current++;
            const sub = subScope(ctx);
            const refutable = (p: Pat): boolean =>
                p.type === 'constructor' ||
                p.type === 'number' ||
                p.type === 'bool' ||
                p.type === 'string' ||
                (p.type === 'tuple' && p.items.some(refutable));
            const matched = refutable(lin.pat) ? patToPatd(sub, lin.pat, false) : undefined;
            // START HERE: the VALUE of the LET needs to be
            // wrapped in a `heap()`, otherwise all will be lost
            return {
                type: 'block',
                block: [
                    {
                        type: 'let',
                        pat: {
                            type: 'tuple',
                            items: [
                                {
                                    type: 'ref',
                                    inner: { type: 'idd', id: tid, text: 't', loc: lin.loc },
                                    loc: lin.loc,
                                },
                                {
                                    type: 'idd',
                                    id: rid,
                                    text: 'r',
                                    loc: lin.loc,
                                },
                            ],
                            loc: lin.loc,
                        },
                        loc: lin.loc,
                        value: {
                            type: 'apply',
                            fn: { type: 'idd', text: 'heap', id: -1, loc: lin.loc },
                            args: [linearToExpr(ctx, lin.value)],
                            loc: lin.loc,
                        },
                    },
                ],
                loc: lin.loc,
                result: inner({ type: 'idd', id: tid, text: 't', loc: lin.loc }, [
                    {
                        type: 'block',
                        block: matched
                            ? []
                            : [
                                  {
                                      type: 'let',
                                      pat: {
                                          type: 'ref',
                                          inner: patToPatd(sub, lin.pat, true),
                                          loc: lin.loc,
                                      },
                                      loc: lin.loc,
                                      value: {
                                          type: 'ref',
                                          inner: { type: 'idd', id: tid, text: 't', loc: lin.loc },
                                          loc: lin.loc,
                                      },
                                  },
                              ],
                        result: matched
                            ? {
                                  type: 'case',
                                  loc: lin.loc,
                                  value: {
                                      type: 'deref',
                                      loc: lin.loc,
                                      inner: { type: 'idd', id: tid, text: 't', loc: lin.loc },
                                  },
                                  cases: [
                                      {
                                          pat: { type: 'deref', loc: lin.loc, inner: matched },
                                          body: linearToExpr(sub, lin.body),
                                      },
                                  ],
                              }
                            : linearToExpr(sub, lin.body),
                        cleanup: [
                            {
                                type: 'apply',
                                args: [],
                                loc: lin.loc,
                                fn: { type: 'idd', text: 'r', id: rid, loc: lin.loc },
                            },
                        ],
                        loc: lin.loc,
                    },
                ]),
                cleanup: [],
            };
        }
        case 'case': {
            const tid = ctx.counter.current++;
            const rid = ctx.counter.current++;

            return collapseIffe({
                type: 'block',
                block: [
                    {
                        type: 'let',
                        pat: {
                            type: 'tuple',
                            items: [
                                {
                                    type: 'ref',
                                    inner: { type: 'idd', id: tid, text: 't', loc: lin.loc },
                                    loc: lin.loc,
                                },
                                { type: 'idd', id: rid, text: 'r', loc: lin.loc },
                            ],
                            loc: lin.loc,
                        },
                        loc: lin.loc,
                        value:
                            lin.value.type === 'lens'
                                ? lensToRvalue(ctx, lin.value.lens, (inner, cleanup) =>
                                      withCleanup(
                                          makeLensCase(
                                              ctx,
                                              { type: 'ref', inner, loc: lin.loc },
                                              lin,
                                              true,
                                              lensCaseResult,
                                          ),
                                          cleanup,
                                      ),
                                  )
                                : makeLensCase(
                                      ctx,
                                      linearToExpr(ctx, lin.value),
                                      lin,
                                      false,
                                      lensCaseResult,
                                  ),
                        // linearToExpr(ctx, lin.value),
                    },
                ],
                loc: lin.loc,
                result: inner({ type: 'idd', id: tid, text: 't', loc: lin.loc }, [
                    {
                        type: 'apply',
                        fn: { type: 'idd', id: rid, loc: lin.loc, text: 'r' },
                        loc: lin.loc,
                        args: [],
                    },
                ]),
                cleanup: [],
            });
        }
        case 'let': {
            const sub = subScope(ctx);
            const rpat: Pat =
                lin.pat.type === 'drop' && lin.value.type === 'fn' && lin.value.name
                    ? { type: 'id', text: lin.value.name, loc: lin.value.loc }
                    : lin.pat;
            const pat = patToPatd(sub, rpat, lin.value.type === 'lens' || rpat.type !== 'drop');
            if (lin.value.type === 'lens') {
                return lensToRvalue(ctx, lin.value.lens, (value, cleanup) =>
                    collapseIffe({
                        type: 'block',
                        block: [
                            {
                                type: 'let',
                                pat: pref(pat),
                                loc: lin.loc,
                                value: eref(value),
                            },
                        ],
                        loc: lin.loc,
                        result: lensToRvalue(sub, lin.body, (inner2, cleanup2) =>
                            inner(inner2, [...cleanup2, ...cleanup]),
                        ),
                        cleanup: [],
                    }),
                );
            } else if (rpat.type !== 'drop') {
                const finish: Idd = {
                    type: 'idd',
                    id: ctx.counter.current++,
                    text: 'scope-finish',
                    loc: lin.loc,
                };
                const owned = pat;
                return collapseIffe({
                    type: 'block',
                    loc: lin.loc,
                    block: [
                        {
                            type: 'let',
                            loc: lin.loc,
                            pat: { type: 'tuple', loc: lin.loc, items: [pref(owned), finish] },
                            value: {
                                type: 'apply',
                                loc: lin.loc,
                                fn: { type: 'idd', id: -1, text: 'heap', loc: lin.loc },
                                args: [linearToExpr(ctx, lin.value)],
                            },
                        },
                    ],
                    result: lensToRvalue(sub, lin.body, (value, cleanup) =>
                        inner(value, [
                            ...cleanup,
                            { type: 'apply', loc: lin.loc, fn: finish, args: [] },
                        ]),
                    ),
                    cleanup: [],
                });
            } else {
                return collapseIffe({
                    type: 'block',
                    block: [
                        {
                            type: 'let',
                            pat: pderef(pat),
                            loc: lin.loc,
                            value: linearToExpr(ctx, lin.value),
                        },
                    ],
                    loc: lin.loc,
                    result: lensToRvalue(sub, lin.body, inner),
                    cleanup: [],
                });
            }
        }
    }
    throw new Error('nope' + JSON.stringify(lin));
};

export const letToExpr = (ctx: Ctx, lin: Linear & { type: 'let' }): Expr => {
    const sub = subScope(ctx);
    const rpat: Pat =
        lin.pat.type === 'drop' && lin.value.type === 'fn' && lin.value.name
            ? { type: 'id', text: lin.value.name, loc: lin.value.loc }
            : lin.pat;
    let pat = patToPatd(sub, rpat, lin.value.type === 'lens');
    if (lin.value.type === 'lens') {
        return lensToRvalue(ctx, lin.value.lens, (value, cleanup) =>
            collapseIffe({
                type: 'block',
                block: [
                    {
                        type: 'let',
                        pat: pref(pat),
                        loc: lin.loc,
                        value: eref(value),
                    },
                ],
                loc: lin.loc,
                result: linearToExpr(sub, lin.body),
                cleanup,
            }),
        );
    } else {
        return collapseIffe({
            type: 'block',
            block: [
                {
                    type: 'let',
                    pat: pderef(pat),
                    loc: lin.loc,
                    value: linearToExpr(ctx, lin.value),
                },
            ],
            loc: lin.loc,
            result: linearToExpr(sub, lin.body),
            cleanup: [],
        });
    }
};

const pref = (pat: Patd): Patd => ({ type: 'ref', inner: pat, loc: pat.loc });
const pderef = (pat: Patd): Patd => ({ type: 'deref', inner: pat, loc: pat.loc });
const eref = (pat: Expr): Expr => ({ type: 'ref', inner: pat, loc: pat.loc });

export const collapseIffe = (expr: Expr): Expr => {
    if (expr.type === 'block' && expr.result.type === 'block') {
        const result = collapseIffe(expr.result) as Expr & { type: 'block' };
        return {
            ...expr,
            block: [...expr.block, ...result.block],
            result: result.result,
            cleanup: [...result.cleanup, ...expr.cleanup],
        };
    }
    return expr;
};

export const patToPatd = (ctx: Ctx, pat: Pat, ref: boolean): Patd => {
    switch (pat.type) {
        case 'id': {
            const id = ctx.counter.current++;
            ctx.scope[pat.text] = { type: ref ? 'ref' : 'stack', id };
            return { ...pat, type: 'idd', id };
        }
        case 'string':
        case 'number':
        case 'bool':
            return pat;
        case 'drop':
            return { ...pat, type: 'idd', text: '_', id: ctx.counter.current++ };
        // return { ...pat, id: ctx.counter.current++ };
        case 'tuple':
            return { ...pat, items: pat.items.map((p) => patToPatd(ctx, p, ref)) };
        case 'constructor':
            return { ...pat, args: pat.args.map((p) => patToPatd(ctx, p, ref)) };
        case 'lens':
            throw new Error(`pat lens cant be deified`);
        // return { ...pat, inner: patToPatd(ctx, pat.inner) };
    }
};

import { dsl as l, Loc, Node, stringify } from '../parser-generator/lexer.ts';

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

export const lpat = (pat: Patd): Node => {
    switch (pat.type) {
        case 'idd':
            return l.i(pat.id === -1 ? pat.text : pat.text + pat.id);
        case 'number':
        case 'bool':
            return l.i(pat.value + '');
        case 'string':
            return l.l('"', [pat.text]);
        // case 'drop':
        //     return l.i('_' + (pat.id ?? ''));
        case 'deref':
            return l.l(``, [l.i('*'), lpat(pat.inner)]);
        case 'ref':
            return l.l(``, [l.i('&'), lpat(pat.inner)]);
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
        case 'closure':
            return l.l(``, [
                l.i('closure'),
                l.l('(,', [l.l('(,', expr.names.map(lexpr)), lexpr(expr.fn)]),
            ]);
        case 'deref':
            return l.l(``, [l.i('*'), lexpr(expr.inner)]);
        case 'ref':
            return l.l(``, [l.i('&'), lexpr(expr.inner)]);
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
        case 'block': {
            return l.l('', [
                `block`,
                l.l('{;', expr.block.map(lstmt)),
                l.w('{', lexpr(expr.result)),
                l.l('{;', expr.cleanup.map(lexpr)),
            ]);
        }
        case 'fn':
            return l.l('', [
                l.l(`(,`, expr.args.map(lpat)),
                '=>',
                Array.isArray(expr.body)
                    ? l.l(`{;`, expr.body.map(lstmt))
                    : maybeWrap(lexpr(expr.body)),
            ]);
        case 'apply': {
            const res = l.l('', [lexpr(expr.fn), l.l('(,', expr.args.map(lexpr))]);
            if (expr.fn.type === 'idd' && expr.fn.text === '*') {
                return l.w('(', res);
            }
            return res;
        }
        case 'case':
            return l.w(
                `(`,
                l.l(' ', [
                    'match',
                    lexpr(expr.value),
                    l.l(
                        '{\n',
                        expr.cases.map((c) => l.l(' ', [lpat(c.pat), '->', lexpr(c.body)])),
                    ),
                ]),
            );
        case 'tuple':
            if (expr.items.length === 1) return lexpr(expr.items[0]);
            return l.l(`(,`, expr.items.map(lexpr));
    }
    throw new Error('oks' + JSON.stringify(expr));
};

const maybeWrap = (node: Node): Node =>
    node.type === 'list' &&
    node.kind === '' &&
    node.children[0].type === 'id' &&
    !node.children[0].text.match(/^[a-zA-Z]/)
        ? {
              type: 'wrapper',
              kind: '(',
              loc: node.loc,
              child: node,
          }
        : node;

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

export const notEmpty = <T>(v: T | null): v is NonNullable<T> => v != null;
