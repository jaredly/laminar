import { Expr, Patd } from './ast.ts';
import { sexpr, spat, unwrap } from './decompose.ts';

export type Ctx = { scopes: Record<string, any>[]; builtins: Record<string, any> };

const deleted = Symbol('deleted');

const findScope = (ctx: Ctx, k: string) => {
    for (let i = 0; i < ctx.scopes.length; i++) {
        if (k in ctx.scopes[i]) return ctx.scopes[i];
    }
};

export const evalExpr = (ctx: Ctx, expr: Expr): any => {
    switch (expr.type) {
        case 'string':
            return expr.head + expr.interp.map((i) => evalExpr(ctx, i.value) + i.tail).join('');
        case 'idd': {
            const k = expr.text + expr.id;
            const scope = findScope(ctx, k);
            if (!scope) {
                if (ctx.builtins[expr.text]) {
                    return ctx.builtins[expr.text];
                }
                console.log(ctx.builtins, ctx.scopes);
                throw new Error(`unbound ${k}`);
            }
            const v = scope[k];
            scope[k] = deleted;
            return v;
        }
        case 'swap': {
            const v = evalExpr(ctx, expr.value);
            return setPat(ctx, expr.pat, v, false);
        }
        case 'iffe': {
            expr.block.forEach((stmt) => {
                if (stmt.type === 'let') {
                    const v = evalExpr(ctx, stmt.value);
                    setPat(ctx, stmt.pat, v, true);
                } else {
                    evalExpr(ctx, stmt);
                }
            });
            const res = evalExpr(ctx, expr.result);
            expr.cleanup.forEach((swap) => {
                const v = evalExpr(ctx, swap.value);
                setPat(ctx, swap.pat, v, false);
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
                const scope: Record<string, any> = {};
                const nctx = { ...ctx, scopes: [scope, ...ctx.scopes] };
                args.forEach((item, i) => setPat(nctx, expr.args[i], item, true));
                const result = evalExpr(nctx, expr.body);
                // NEXT STEP:
                // -> this is ... catching things that ... get captured by sub functions that get returned
                //    I need a way to track that somehow? like "the function returned from here has claim on this vbl"
                //
                // Object.keys(scope).forEach((k) => {
                //     if (scope[k] !== deleted) {
                //         throw new Error(
                //             `Linear variable ${k} not used up: ${JSON.stringify(scope[k])}`,
                //         );
                //     }
                // });
                return result;
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
            if (expr.items.length === 1) return evalExpr(ctx, expr.items[0]);
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
            if (!expr.args.length) return { type: expr.name };
            return { type: expr.name, args: expr.args.map((expr) => evalExpr(ctx, expr)) };
            // throw new Error(`unknown constructor ${expr.name}`);
        }
        case 'case': {
            const value = evalExpr(ctx, expr.value);
            for (let { pat, body } of expr.cases) {
                if (matches(pat, value)) {
                    setPat(ctx, pat, value, true);
                    return evalExpr(ctx, body);
                }
            }
            console.log(value, expr.cases);
            throw new Error(`no arms matched the value`);
        }
    }
    throw new Error('unknown expr type ' + (expr as any).type);
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
            let scope = findScope(ctx, k);
            if (fresh && scope) {
                throw new Error(`pat set but ${k} already bound`);
            }
            // console.log(`SET`, spat(pat), value);
            scope = scope || ctx.scopes[0];
            const res = scope[k];
            scope[k] = value;
            return res === deleted ? undefined : res;
        }
        case 'drop': {
            if (pat.id != null) {
                const k = '_' + pat.id;
                let scope = findScope(ctx, k) ?? ctx.scopes[0];
                scope[k] = value;
            }
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
