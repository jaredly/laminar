import { Expr, Patd, Stmt } from './ast.ts';
import { sexpr, spat, unwrap } from './decompose.ts';

export type Ctx = { scopes: Record<string, any>[]; builtins: Record<string, any> };

const deleted = Symbol('deleted');

const findScope = (ctx: Ctx, k: string) => {
    for (let i = 0; i < ctx.scopes.length; i++) {
        if (k in ctx.scopes[i]) return ctx.scopes[i];
    }
};

export const valueToExpr = (value: any): Expr => {
    if (typeof value === 'string') {
        return { type: 'string', head: value, interp: [], loc: -1 };
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return { type: 'const', loc: -1, value };
    }
    if (typeof value === 'function') {
        throw new Error(`cant do functions sorry`);
    }
    if (Array.isArray(value)) {
        let res: Expr = { type: 'constructor', name: 'nil', loc: -1, args: [] };
        while (value.length) {
            const last = value.pop()!;
            res = { type: 'constructor', name: 'cons', loc: -1, args: [valueToExpr(last), res] };
        }
        return res;
    }
    if (value == null) return { type: 'tuple', items: [], loc: -1 };
    throw new Error('cant make expr');
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
        case 'block': {
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
                // const allUses: Uses = {};
                // collectVariableUses(expr, allUses);
                // const stuffs = returnValueDelayedConsumption(expr.body);
                // Object.keys(scope).forEach((k) => {
                //     if (scope[k] !== deleted) {
                //         if (stuffs.includes(k)) {
                //             return;
                //         }
                //         console.log('all uses', allUses);
                //         console.log('oh no bad scope', scope);
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
            const args = expr.args.map((arg) => evalExpr(ctx, arg));
            // if (expr.fn.type === 'idd') {
            //     console.log(`CALL`, expr.fn.text, args);
            // }
            const res = fn.apply(null, args);
            // if (expr.fn.type === 'idd') {
            //     console.log(`GOT`, expr.fn.text, res);
            // }
            return res;
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
            throw new EvalError(expr, `no arms matched the value ` + JSON.stringify(value));
        }
    }
    throw new Error('unknown expr type ' + (expr as any).type);
};

export class EvalError extends Error {
    expr: Expr;
    constructor(expr: Expr, message: string) {
        super(message + '; ' + sexpr(expr));
        this.expr = expr;
    }
    toString() {
        return 'lol';
    }
}

export const matches = (pat: Patd, value: any): boolean => {
    switch (pat.type) {
        case 'number':
        case 'bool':
            return value === pat.value;
        case 'idd':
            return true;
        case 'string':
            return value === pat.text;
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

// 0 -> set or swap
// 1 -> use
type Uses = Record<string, ('put' | 'get' | 'swap')[]>;
const addUse = (uses: Uses, id: string, which: 'put' | 'get' | 'swap') => {
    // console.log('   ' + id + ' : ' + which);
    if (!uses[id]) uses[id] = [which];
    else uses[id].push(which);
};

export const patIds = (pat: Patd): string[] => {
    switch (pat.type) {
        case 'idd':
            return [pat.text + pat.id];
        case 'bool':
        case 'number':
        case 'string':
            return [];
        case 'drop':
            return pat.id != null ? ['_' + pat.id] : [];
        case 'tuple':
            return pat.items.flatMap(patIds);
        case 'constructor':
            return pat.args.flatMap(patIds);
    }
};

export const returnValueDelayedConsumption = (expr: Expr): string[] => {
    switch (expr.type) {
        case 'string':
            return expr.interp.flatMap((i) => returnValueDelayedConsumption(i.value));
        case 'tuple':
            return expr.items.flatMap(returnValueDelayedConsumption);
        case 'case':
            return expr.cases.flatMap((k) => returnValueDelayedConsumption(k.body));
        case 'constructor':
            return expr.args.flatMap(returnValueDelayedConsumption);
        case 'idd':
        case 'const':
        case 'apply':
        case 'swap':
            return [];
        case 'block':
            return returnValueDelayedConsumption(expr.result);
        case 'fn': {
            const uses: Uses = {};
            collectVariableUses(expr, uses);
            console.log('found a fn', uses);
            return Object.keys(uses).filter(
                (k) => uses[k][0] !== 'put' && uses[k][uses[k].length - 1] === 'get',
            );
        }
    }
};

export const collectVariableUses = (expr: Stmt, uses: Uses): void => {
    // console.log('<-', expr.type, expr.loc);
    switch (expr.type) {
        case 'idd': {
            return addUse(uses, expr.text + expr.id, 'get');
        }
        case 'string': {
            return expr.interp.forEach((i) => collectVariableUses(i.value, uses));
        }
        case 'swap': {
            patIds(expr.pat).forEach((i) => addUse(uses, i, 'swap'));
            return collectVariableUses(expr.value, uses);
        }
        case 'block': {
            expr.block.forEach((s) => collectVariableUses(s, uses));
            collectVariableUses(expr.result, uses);
            expr.cleanup.forEach((s) => collectVariableUses(s, uses));
            return;
        }
        case 'let': {
            patIds(expr.pat).forEach((i) => addUse(uses, i, 'put'));
            return collectVariableUses(expr.value, uses);
        }
        case 'const': {
            return;
        }
        case 'fn': {
            expr.args.forEach((pat) => patIds(pat).forEach((i) => addUse(uses, i, 'put')));
            return collectVariableUses(expr.body, uses);
        }
        case 'apply': {
            collectVariableUses(expr.fn, uses);
            return expr.args.forEach((arg) => collectVariableUses(arg, uses));
        }
        case 'tuple':
            return expr.items.forEach((item) => collectVariableUses(item, uses));
        case 'constructor':
            return expr.args.forEach((arg) => collectVariableUses(arg, uses));
        case 'case': {
            const cases = expr.cases.map((k) => {
                const uses: Uses = {};
                patIds(k.pat).forEach((i) => addUse(uses, i, 'put'));
                collectVariableUses(k.body, uses);
                return { uses, vbls: new Set(consumedVbls(uses)) };
            });
            for (let i = 1; i < cases.length; i++) {
                if (cases[i].vbls.symmetricDifference(cases[0].vbls).size > 0) {
                    throw new Error(
                        `case arms disagree as to what vbls they consume: case ${i}: ${[...cases[i].vbls]}, case 0: ${[...cases[0].vbls]}`,
                    );
                }
            }
            return;
        }
    }
    throw new Error('not handled ' + (expr as any).type);
};

const consumedVbls = (uses: Uses) => {
    return Object.keys(uses).filter(
        (k) => uses[k][0] !== 'put' && uses[k][uses[k].length - 1] === 'get',
    );
};

// export const returnedLambdaUses = ()

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
                throw new Error(`value not an array in tuple pat ${spat(pat)} ${pat.loc}`);
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
