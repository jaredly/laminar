import { builtins } from '../test/runtime.ts';
import { free, names } from './flowparse.ts';
import type { Term, Pat, Lens } from './ast.ts';

let id0 = 0;
export const resetId0 = () => (id0 = 0);
const nextId = () => id0++;

export class TSError extends Error {
    value: Term | Pat | Lens;
    constructor(value: Term | Pat | Lens, message: string) {
        super(message);
        this.value = value;
    }
}

export const lensAs = (lens: Lens): string => {
    switch (lens.type) {
        case 'id':
            return JSON.stringify(lens.text);
        case 'tuple':
            return `[${lens.items.map(lensAs).join(', ')}]`;
        default:
            throw new TSError(lens, 'complex lens sorry for as');
    }
};

export const patAs = (pat: Pat): string => {
    switch (pat.type) {
        case 'id':
            return JSON.stringify(pat.text);
        case 'drop':
            return `$.drop`;
        case 'tuple':
            return `[${pat.items.map(patAs).join(', ')}]`;
        case 'constructor':
            throw new Error('not yert');
        case 'lens':
            throw new TSError(pat, 'not pat lens');
    }
};

type Tail = null | {
    lensCaptured?: null | string;
    lensBack?: (string | { lens: string; pat: string })[];
};

export type Ctx = { globals: string[] };

export const toTS = (ctx: Ctx, expr: Term | Lens, tail: Tail = null): string => {
    if (expr.type === 'let') {
        if (expr.value.type === 'lens') {
            if (expr.value.lens.type === 'aslens') {
                // let pat = toTS(expr.value.lens.value)
                // let _res = [body]
                // [cleanup(back(pat))]
                // return result
                // STOPSHIP we need to get the used vbls out of scope so they're there for cleanup time
                // return `return [${toTS(expr.value.lens.value)}, (res: any) => {
                //     $.recv(gamma, res, ${patAs(expr.value.lens.pat)});
                //     ${toTS(expr.value.lens.body, { lensCaptured: "" })};
                //     // assert that all values have been used (except lenscaptured)
                //     $.checkUnused(gamma, ${tail?.lensCaptured ?? "[]"});
                //     ${
                //         tail?.lensCaptured
                //             ? `return $.back(gamma, ${tail.lensCaptured});`
                //             : ""
                //     }
                // }];`;
                const bound = names(expr.value.lens.pat);
                const freeNames = free(expr.value.lens.body).filter((t) => !bound.includes(t));
                const result = `$.recv(gamma, ${toTS(ctx, expr.value.lens.value)}, ${patAs(expr.pat)});\n${toTS(
                    ctx,
                    expr.body,
                    {
                        ...tail,
                        lensBack: [
                            `$.wrap((gamma) => {$.recv(gamma, $.back(gamma, ${patAs(expr.pat)}), ${patAs(expr.value.lens.pat)});\n${toTS(ctx, expr.value.lens.body, { lensCaptured: '' })};\n$.checkUnused(gamma, ${tail?.lensCaptured ?? '[]'});}, ${JSON.stringify(freeNames)});`,
                            ...(tail?.lensBack ?? []),
                        ],
                    },
                )}`;
                return tail ? result : `(() => {${result}})()`;
            }
            let isWrapped = false;
            const result = lensToTs(ctx, expr.value.lens, (name, wrapped) => {
                isWrapped = wrapped;
                const ntail: Tail = {
                    ...tail,
                    lensBack: [{ lens: name, pat: patAs(expr.pat) }, ...(tail?.lensBack ?? [])],
                };
                return `$.recv(gamma, $.back(gamma, ${name}), ${patAs(expr.pat)});\n${toTS(ctx, expr.body, ntail)}`;
            });
            return tail
                ? isWrapped
                    ? 'return ' + result
                    : result
                : isWrapped
                  ? result
                  : `(() => {${result}})()`;
        }
        const result = `$.recv(gamma, ${toTS(ctx, expr.value)}, ${patAs(expr.pat)});\n${toTS(ctx, expr.body, tail ?? {})}`;
        return tail ? result : `(() => {${result}})()`;
    } else {
        if (tail) {
            if (expr.type === 'lens') {
                if (expr.lens.type === 'aslens') {
                    return `return [${toTS(ctx, expr.lens.value)}, (res: any) => {
                        $.recv(gamma, res, ${patAs(expr.lens.pat)});
                        ${toTS(ctx, expr.lens.body, { lensCaptured: '' })};
                        // assert that all values have been used (except lenscaptured)
                        $.checkUnused(gamma, ${tail.lensCaptured ?? '[]'});
                        ${tail.lensCaptured ? `return $.back(gamma, ${tail.lensCaptured});` : ''}
                    }];`;
                }
            }
            let vbl: string | null = null;
            let pre = '';
            if (tail?.lensBack) {
                vbl = `res` + nextId();
                pre = `const ${vbl} = ${expr.type === 'lens' ? _toTS(ctx, expr.lens) : _toTS(ctx, expr)};\n`;
                tail.lensBack.forEach((back) => {
                    if (typeof back === 'string') {
                        pre += back;
                    } else {
                        pre += `$.recv(gamma, $.back(gamma, ${back.pat}), ${back.lens})\n`;
                    }
                });
            }

            if (tail?.lensCaptured != null) {
                // we're in a `lens <-` block
                if (tail.lensCaptured === '') {
                    if (expr.type === 'lens') {
                        throw new Error(`lens <- block has linear body`);
                    }
                    // assert that expr has void return value
                    return pre + `$.recv(gamma, ${_toTS(ctx, expr)}, [])`;
                }
                if (expr.type === 'lens') {
                    return (
                        pre +
                        `return [${vbl ?? _toTS(ctx, expr.lens)}, (recv: any) => {
        $.recv(gamma, recv, ${lensAs(expr.lens)});
        return $.back(gamma, ${tail.lensCaptured})
    }];`
                    );
                }
                return (
                    pre + `return [${vbl ?? _toTS(ctx, expr)}, $.back(gamma, ${tail.lensCaptured})]`
                );
            }
            // the only possiblity here is that
            // you're returning a null lens
            if (expr.type === 'lens') {
                return (
                    pre +
                    `return [${vbl ?? _toTS(ctx, expr.lens)}, (recv: any) => {
    $.recv(gamma, recv, ${lensAs(expr.lens)});
    return null // this should be right I think
}];`
                );
            }
            return pre + `return ${vbl ?? _toTS(ctx, expr)}`;
        }

        return _toTS(ctx, expr);
    }
};

export const _toTS = (ctx: Ctx, expr: Term | Lens, tail: Tail = null): string => {
    switch (expr.type) {
        case 'aslens': {
            throw new Error('cant actually support lenses here');
        }
        case 'id':
            if (expr.text === '~') {
                throw new Error('bad tilde ~');
            }
            return `$.get(gamma, "${expr.text}")`;
        case 'const':
            return expr.value + '';
        case 'string': {
            return (
                '`' +
                expr.head +
                expr.interp
                    .map((item) => '${' + _toTS(ctx, item.value) + '}' + item.tail)
                    .join('') +
                '`'
            );
        }
        case 'let':
            return `$.recv(gamma, ${toTS(ctx, expr.value)}, ${patAs(expr.pat)});\n${toTS(ctx, expr.body, tail)}`;
        case 'tuple':
            return `[${expr.items.map((item) => toTS(ctx, item)).join(', ')}]`;
        case 'apply':
            if (expr.args.length !== 1) {
                if (expr.fn.type === 'id' && builtins[expr.fn.text]) {
                    return (
                        toTS(ctx, expr.fn) +
                        `(${expr.args.map((arg) => toTS(ctx, arg)).join(', ')})`
                    );
                }
                throw new Error('no multi args uet');
            }
            // NOTE: here we need to know if its a lens
            const arg = expr.args[0];
            if (arg.type === 'lens') {
                return lensToTs(
                    ctx,
                    arg.lens,
                    (name, wrapped) =>
                        (wrapped ? 'return ' : '') +
                        `$.tee(gamma, ${toTS(ctx, expr.fn)}($.back(gamma, ${name})), ${name})`,
                );
            }
            return toTS(ctx, expr.fn) + `(${toTS(ctx, arg)})`;
        // const takesLens = arg.type === "lens";
        // const call =
        //     toTS(ctx,expr.fn) + `(${takesLens ? toTS(ctx,arg.lens) : toTS(ctx,arg)})`;
        // return takesLens
        //     ? `$.tee(gamma, ${call}, ${lensAs(arg.lens)})`
        //     : call;
        case 'assign': {
            const { lens, value } = expr;
            if (lens.type === 'apply') {
                if (lens.args.length !== 1) throw new Error('mutli arg');
                const inner = lens.args[0];
                if (inner.type !== 'lens') throw new Error('lens arg must lens');
                return `$.tee2(gamma, ${toTS(ctx, lens.fn)}(${toTS(ctx, inner.lens)}), tmp => $.recv(gamma, ${toTS(ctx, value)}, tmp), ${lensAs(inner.lens)})`;
            }
            return `$.recv(gamma, ${toTS(ctx, value)}, ${lensAs(lens)})`;
        }
        case 'fn': {
            if (expr.args.length !== 1) throw new Error(`no multi arg yet`);
            const arg = expr.args[0].pat;
            const takesLens = arg.type === 'lens';
            const named = names(arg);
            const captures = free(expr.body).filter(
                (f) => !named.includes(f) && !builtins[f] && !ctx.globals.includes(f),
            );
            const outer = captures.length ? `outer${nextId()}` : '';
            const prefix = captures.length ? `((${outer}) => ` : '';
            const suffix = captures.length
                ? `, ${outer}))({${captures.map((name) => `${name}: $.get(gamma, "${name}")`).join(',')}})`
                : ')';
            const defn =
                prefix +
                `(arg: any) => $.wrap((gamma) => {
    $.recv(gamma, arg, ${patAs(takesLens ? arg.inner : arg)});
    ${toTS(ctx, expr.body, { lensCaptured: takesLens ? patAs(arg.inner) : null })}
}, ${arg.type === 'lens' ? patAs(arg.inner) : '[]'}` +
                suffix;
            if (expr.name) {
                return `$.recv(gamma, ${defn}, ${JSON.stringify(expr.name)})`;
            } else {
                return defn;
            }
        }
        case 'case':
        // case "additive_product":
        // case "ifs":
        case 'lens':
        case 'constructor':
            throw new Error('not ' + expr.type);
    }
};

const lensToTs = (
    ctx: Ctx,
    lens: Lens,
    outer: (name: string, wrapped: boolean) => string,
): string => {
    if (lens.type === 'tuple') {
        const next = (i: number, names: string[], wrapped: boolean): string => {
            if (i >= lens.items.length) {
                return outer('[' + names.join(', ') + ']', wrapped);
            }
            const item = lens.items[i];
            return lensToTs(ctx, item, (name, nwrapped) =>
                next(i + 1, [...names, name], wrapped || nwrapped),
            );
        };
        return next(0, [], false);
    }

    if (lens.type === 'id') {
        const names = lensAs(lens);
        return outer(names, false);
    }

    if (lens.type === 'apply') {
        if (lens.args.length !== 1) throw new Error('only one arg');
        const id = 'tmp' + nextId();
        const arg = lens.args[0];
        if (arg.type !== 'lens') {
            // throw new TSError(arg, "expect lens arg");
            return `$.tee2(gamma, ${toTS(ctx, lens.fn)}(${toTS(ctx, arg)}), ${id} => {${outer(id, true)}}, [])`;
        }
        return lensToTs(
            ctx,
            arg.lens,
            (inner, wrapped) =>
                (wrapped ? 'return ' : '') +
                `$.tee2(gamma, ${toTS(ctx, lens.fn)}($.back(gamma, ${inner})), ${id} => {${outer(id, true)}}, ${inner})`,
        );
    }
    //
    //     if (lens.type === "aslens") {
    //         // if (lens.args.length !== 1) throw new Error("only one arg");
    //         // const arg = lens.args[0];
    //         // if (arg.type !== "lens") throw new TSError(arg, "expect lens arg");
    //         const id = "tmp" + nextId();
    //         return `$.tee2(gamma, [${toTS(ctx,lens.value)}, (res) => {
    //             $.recv(gamma, res, ${patAs(lens.pat)});
    //             ${toTS(ctx,lens.body, {})};
    //         }], ${id} => ${outer(id)}, [])`;
    //         // return lensToTs(
    //         //     arg.lens,
    //         //     (inner) =>
    //         //         `$.tee2(gamma, ${toTS(ctx,lens.fn)}($.back(gamma, ${inner})), ${id} => ${outer(id)}, ${inner})`,
    //         // );
    //     }

    throw new Error('not support lens');
};
