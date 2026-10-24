import { builtins } from '../test/runtime.ts';
import { free, names } from './ast.ts';
import type { Term, Pat, Lens, Linear } from './ast.ts';

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
            throw new TSError(lens, `complex lens sorry for as: ${lens.type}`);
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

export type Ctx = { globals: string[]; scopes: Set<string>[] };

const withScope = (ctx: Ctx, set: Set<string>): Ctx => ({ ...ctx, scopes: [set, ...ctx.scopes] });

// export const linearToTS = (ctx: Ctx, lin: Linear, tail: Tail = null) => {
//     switch (lin.type) {
//         case 'let':
//         case 'string':
//         case 'id':
//         case 'op':
//         case 'assign':
//         case 'const':
//         case 'fn':
//         case 'apply':
//         case 'tuple':
//         case 'constructor':
//         case 'case':
//     }
// };

export const letLens = (
    ctx: Ctx,
    lens: Lens & { type: 'aslens' },
    pat: Pat,
    body: Term,
    tail: Tail,
): string => {
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
    const bound = names(lens.pat);
    const freeNames = free(lens.body).filter((t) => !bound.includes(t));
    const result = `${recv(ctx, toTS(ctx, lens.value), pat)};\n${toTS(ctx, body, {
        ...tail,
        lensBack: [
            `$.wrap((gamma) => {${recv(ctx, back(ctx, pat), lens.pat)};\n${toTS(ctx, lens.body, { lensCaptured: '' })};\n$.checkUnused(gamma, ${tail?.lensCaptured ?? '[]'});}, ${JSON.stringify(freeNames)});`,
            ...(tail?.lensBack ?? []),
        ],
    })}`;
    return tail ? result : `(() => {${result}})()`;
};

export const letToTS = (ctx: Ctx, expr: Term & { type: 'let' }, tail: Tail = null): string => {
    if (expr.value.type === 'lens') {
        if (expr.value.lens.type === 'aslens') {
            return letLens(ctx, expr.value.lens, expr.pat, expr.body, tail);
        }
        let isWrapped = false;
        const result = lensToTs(ctx, expr.value.lens, (name, wrapped) => {
            isWrapped = wrapped;
            const ntail: Tail = {
                ...tail,
                lensBack: [{ lens: name, pat: patAs(expr.pat) }, ...(tail?.lensBack ?? [])],
            };
            return `${recv(ctx, back(ctx, name), expr.pat)};\n${toTS(ctx, expr.body, ntail)}`;
        });
        return tail
            ? isWrapped
                ? 'return ' + result
                : result
            : isWrapped
              ? result
              : `(() => {${result}})()`;
    }
    const result = `${recv(ctx, toTS(ctx, expr.value), expr.pat)};\n${toTS(ctx, expr.body, tail ?? {})}`;
    return tail ? result : `(() => {${result}})()`;
};

export const back = (ctx: Ctx, name: string | Pat) => {
    return `$.back(gamma, ${typeof name === 'string' ? name : patAs(name)})`;
};

export const recv = (ctx: Ctx, name: string, pat: null | string | Pat) => {
    return `$.recv(gamma, ${name}, ${pat === null ? '[]' : typeof pat === 'string' ? pat : patAs(pat)});`;
};

export const tailToTS = (ctx: Ctx, expr: Term | Lens, tail: NonNullable<Tail>): string => {
    if (expr.type === 'lens') {
        if (expr.lens.type === 'aslens') {
            return `return [${toTS(ctx, expr.lens.value)}, (res: any) => {
                            ${recv(ctx, 'res', expr.lens.pat)}
                            ${toTS(ctx, expr.lens.body, { lensCaptured: '' })};
                            // assert that all values have been used (except lenscaptured)
                            $.checkUnused(gamma, ${tail.lensCaptured ?? '[]'});
                            ${tail.lensCaptured ? `return ${back(ctx, tail.lensCaptured)};` : ''}
                        }];`;
        }
        /*
        let isWrapped = false;
        const result = lensToTs(ctx, expr.lens, (name, wrapped) => {
            isWrapped = wrapped;
            return `$.recv(gamma, $.back(gamma, ${name}), ${patAs(expr.pat)});\n${toTS(ctx, expr.body, ntail)}`;
        });
        return isWrapped
                ? 'return ' + result
                : result
                */
    }
    let vbl: string | null = null;
    let pre = '';
    // lensBack consists of the 'cleanups that need to happen right before
    if (tail?.lensBack) {
        vbl = `res` + nextId();
        pre = `const ${vbl} = ${expr.type === 'lens' ? _toTS(ctx, expr.lens) : _toTS(ctx, expr)};\n`;
        tail.lensBack.forEach((lback) => {
            if (typeof lback === 'string') {
                pre += lback;
            } else {
                pre += recv(ctx, back(ctx, lback.pat), lback.lens) + `\n`;
            }
        });
    }

    if (tail?.lensCaptured != null) {
        // we're in a `lens <-` block
        if (tail.lensCaptured === '') {
            if (expr.type === 'lens') {
                throw new Error(`lens <- block must have a linear body; found a lens`);
            }
            // assert that expr has void return value
            // Q: should we do `let v = _toTS(ctx, expr)` and THEN do the `pre`?
            // like our expr might do things that would impact our lensBacks, right?
            return pre + recv(ctx, _toTS(ctx, expr), null);
        }
        if (expr.type === 'lens') {
            return (
                pre +
                `return [${vbl ?? _toTS(ctx, expr.lens)}, (recv: any) => {
                ${recv(ctx, 'recv', lensAs(expr.lens))};
            return $.back(gamma, ${tail.lensCaptured})
        }];`
            );
        }
        return pre + `return [${vbl ?? _toTS(ctx, expr)}, $.back(gamma, ${tail.lensCaptured})]`;
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
};

export const toTS = (ctx: Ctx, expr: Term | Lens, tail: Tail = null): string => {
    if (expr.type === 'let') {
        return letToTS(ctx, expr as Linear & { type: 'let' }, tail);
    }

    if (tail) {
        return tailToTS(ctx, expr, tail);
    }

    return _toTS(ctx, expr);
};

export const _toTS = (ctx: Ctx, expr: Term | Lens, tail: Tail = null): string => {
    switch (expr.type) {
        case 'aslens': {
            throw new Error('cant actually support lenses here');
        }
        case 'op':
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
            const lastArg = expr.args[expr.args.length - 1];
            if (lastArg?.type === 'lens') {
                return lensToTs(
                    ctx,
                    lastArg.lens,
                    (name, wrapped) =>
                        (wrapped ? 'return ' : '') +
                        `$.tee(gamma, ${toTS(ctx, expr.fn)}(${expr.args
                            .slice(0, -1)
                            .map((arg) => toTS(ctx, arg) + ', ')
                            .join('')}$.back(gamma, ${name})), ${name})`,
                );
            }
            return toTS(ctx, expr.fn) + `(${expr.args.map((arg) => toTS(ctx, arg)).join(', ')})`;
        case 'assign': {
            const { lens, value } = expr;
            return lensToTs(ctx, lens, (name, wrapped) => {
                return (wrapped ? 'return ' : '') + `$.recv(gamma, ${toTS(ctx, value)}, ${name})`;
            });
            // if (lens.type === 'apply') {
            //     if (lens.args.length !== 1) throw new Error('mutli arg');
            //     const inner = lens.args[0];
            //     if (inner.type !== 'lens') throw new Error('lens arg must lens');
            //     return `$.tee2(gamma, ${toTS(ctx, lens.fn)}(${toTS(ctx, inner.lens)}), tmp => $.recv(gamma, ${toTS(ctx, value)}, tmp), ${lensAs(inner.lens)})`;
            // }
            // return `$.recv(gamma, ${toTS(ctx, value)}, ${lensAs(lens)})`;
        }
        case 'fn': {
            const named = new Set(expr.args.flatMap((arg) => names(arg.pat)));
            const captures = free(expr.body).filter(
                (f) => !named.has(f) && !builtins[f] && !ctx.globals.includes(f),
            );
            const outer = captures.length ? `outer${nextId()}` : '';
            const prefix = captures.length ? `((${outer}) => ` : '';
            const suffix = captures.length
                ? `, ${outer}))({${captures.map((name) => `${name}: $.get(gamma, "${name}")`).join(',')}})`
                : ')';

            const lastArg = expr.args[expr.args.length - 1];

            expr.args.slice(0, -1).forEach((arg) => {
                if (arg.pat.type === 'lens') {
                    throw new Error(`only the last argument can be a lens`);
                }
            });

            const bindings = expr.args
                .map(
                    (arg, i) =>
                        `$.recv(gamma, arg${i}, ${patAs(arg.pat.type === 'lens' ? arg.pat.inner : arg.pat)});\n`,
                )
                .join('');
            const body = toTS(ctx, expr.body, {
                lensCaptured: lastArg?.pat.type === 'lens' ? patAs(lastArg.pat.inner) : null,
            });

            return withRecv(
                expr.name,
                prefix +
                    `(${expr.args.map((_, i) => `arg${i}: any`).join(', ')}) => $.wrap((gamma) => {
    ${bindings}
    ${body}
}, ${lastArg?.pat.type === 'lens' ? patAs(lastArg.pat.inner) : '[]'}` +
                    suffix,
            );
        }

        case 'case':
        // case "additive_product":
        // case "ifs":
        case 'lens':
        case 'constructor':
            throw new Error('not ' + expr.type);
    }
};

const withRecv = (name: string | null | undefined, defn: string) =>
    name ? `$.recv(gamma, ${defn}, ${JSON.stringify(name)})` : defn;

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

    throw new Error('not support lens');
};
