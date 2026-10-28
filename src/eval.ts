import { Expr, Patd } from './ast.ts';
import { sexpr, spat, unwrap } from './decompose.ts';

export type Ctx = { scope: Record<string, any>; builtins: Record<string, any> };

export const evalExpr = (ctx: Ctx, expr: Expr): any => {
    switch (expr.type) {
        case 'string':
            return expr.head + expr.interp.map((i) => evalExpr(ctx, i.value) + i.tail).join('');
        case 'idd': {
            const k = expr.text + expr.id;
            if (!(k in ctx.scope)) {
                if (ctx.builtins[expr.text]) {
                    return ctx.builtins[expr.text];
                }
                throw new Error(`unbound ${k}`);
            }
            const v = ctx.scope[k];
            delete ctx.scope[k];
            return v;
        }
        case 'swap': {
            return setPat(ctx, expr.pat, evalExpr(ctx, expr.value), false);
        }
        case 'iffe': {
            expr.block.forEach((stmt) => {
                if (stmt.type === 'let') {
                    setPat(ctx, stmt.pat, evalExpr(ctx, stmt.value), true);
                } else {
                    evalExpr(ctx, stmt);
                }
            });
            const res = evalExpr(ctx, expr.result);
            expr.cleanup.forEach((swap) => {
                setPat(ctx, swap.pat, evalExpr(ctx, swap.value), true);
            });
            return res;
        }
        case 'const': {
            return expr.value;
        }
        case 'fn': {
            return (...args: any[]) => {
                if (args.length !== expr.args.length) {
                    throw new Error(
                        `wrong number of args, got ${args.length}, expected ${expr.args.length}`,
                    );
                }
                args.forEach((item, i) => setPat(ctx, expr.args[i], item, true));
                return evalExpr(ctx, expr.body);
            };
        }
        case 'apply': {
            const fn = evalExpr(ctx, expr.fn) as Function;
            if (typeof fn !== 'function') {
                throw new Error(`fn not a function: ${typeof fn}`);
            }
            return fn.apply(
                null,
                expr.args.map((arg) => evalExpr(ctx, arg)),
            );
        }
        case 'tuple': {
            if (!expr.items.length) return null;
            return expr.items.map((item) => evalExpr(ctx, item));
        }
        case 'constructor': {
            const list = unwrap(expr);
            if (list) {
                const items = list.items.map((item) => evalExpr(ctx, item));
                if (list.tail) {
                    return items.concat(evalExpr(ctx, list.tail));
                }
                return items;
            }
            throw new Error(`unknown constructor ${expr.name}`);
        }
        case 'case': {
            const value = evalExpr(ctx, expr.value);
            for (let { pat, body } of expr.cases) {
                if (matches(pat, value)) {
                    setPat(ctx, pat, value, true);
                    return evalExpr(ctx, body);
                }
            }
            throw new Error(`no arms matched the value`);
        }
    }
    throw new Error('unknown expr type ' + expr.type);
};

export const matches = (pat: Patd, value: any): boolean => {
    switch (pat.type) {
        case 'idd':
            return true;
        case 'drop':
            return true;
        case 'tuple':
            return (
                Array.isArray(value) &&
                value.length === pat.items.length &&
                pat.items.every((pi, i) => matches(pi, value[i]))
            );
        case 'constructor': {
            if (pat.name === 'nil') return Array.isArray(value) && value.length === 0;
            if (pat.name === 'cons') {
                if (pat.args.length !== 2) throw new Error(`cons pat needs two args`);
                if (!Array.isArray(value) || !value.length) return false;
                if (!matches(pat.args[0], value[0])) return false;
                return matches(pat.args[1], value.slice(1));
            }
            if (!value || !('type' in value) || value.type !== pat.name) {
                return false;
            }
            if (!pat.args.length) return true;
            const args = value.args;
            if (!args || !Array.isArray(args) || pat.args.length !== args.length) {
                return false;
            }
            return args.every((arg, i) => matches(pat.args[i], arg));
        }
    }
};

export const setPat = (ctx: Ctx, pat: Patd, value: any, fresh: boolean): any => {
    switch (pat.type) {
        case 'idd': {
            const k = pat.text + pat.id;
            if (k in ctx.scope === fresh) {
                if (fresh) {
                    throw new Error(
                        fresh ? `pat set but ${k} already bound` : `pat swap but ${k} not bound`,
                    );
                }
                // the replace case needs to be ignorable for the 'use and then set' use case
            }
            const res = ctx.scope[k];
            ctx.scope[k] = value;
            return res;
        }
        case 'drop': {
            ctx.scope['_' + pat.id] = value;
            return;
        }
        case 'tuple': {
            if (pat.items.length === 0) {
                if (value == null) return;
                throw new Error(`[] pat should only match null. ${JSON.stringify(value)}`);
            }
            if (!Array.isArray(value)) {
                throw new Error(`value not an array in tuple pat ${spat(pat)}`);
            }
            if (value.length !== pat.items.length) {
                throw new Error(
                    `value wrong length. found ${value.length}, expected ${pat.items.length}`,
                );
            }
            return value.map((item, i) => setPat(ctx, pat.items[i], item, fresh));
        }
        case 'constructor': {
            if (pat.name === 'nil') {
                if (!Array.isArray(value)) throw new Error('not an array');
                if (value.length !== 0) throw new Error(`pat [] but array not empty`);
                return [];
            }
            if (pat.name === 'cons') {
                if (!Array.isArray(value)) throw new Error('not an array');
                if (!value.length) throw new Error(`array is empty`);
                if (pat.args.length !== 2) throw new Error(`cons pat needs two args`);
                const first = setPat(ctx, pat.args[0], value[0], fresh);
                const inner = setPat(ctx, pat.args[1], value.slice(1), fresh);
                if (!fresh && !inner) {
                    console.log(pat.args[1], value, fresh);
                    throw new Error(`rest wasnt an array`);
                }
                return fresh ? undefined : [first, ...inner];
            }
            if (!value || !('type' in value) || value.type !== pat.name)
                throw new Error(`wrong constr name`);
            if (!pat.args.length) return;
            const args = value.args;
            if (!Array.isArray(args) || args.length !== pat.args.length)
                throw new Error(`bad args`);
            return {
                type: pat.name,
                args: pat.args.map((arg, i) => setPat(ctx, arg, args[i], fresh)),
            };
        }
    }
};
