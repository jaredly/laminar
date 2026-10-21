/*

So "eval expr" takes a Gamma and an Expr and returns a Value and a Gamma

*/

import { free } from './flowparse.ts';
import { Term, Pat, Type } from './ast.ts';

export class EvalError extends Error {
    value: Term | Pat | Type | Value;
    constructor(value: Term | Pat | Type | Value, message: string) {
        super(message);
        this.value = value;
    }
}

export type Value =
    | { type: 'builtin'; value: (...args: Value[]) => Value }
    | { type: 'int'; value: number }
    | { type: 'bool'; value: boolean }
    // defined as linear
    // you might:
    // - have a lens arg
    // - have a lens result
    // there are 4 combos of these
    // (a/b) -> c   :: a -> (c, b)
    // (a/b) -> c/d :: a -> (c, d -> b)
    // (a)   -> b/c :: a -> (b, c -> ())
    // (a)   -> b   :: a -> b
    // "the presence or absence of ~ on function arguments can be
    //  fully inferred from the type of the function"
    // meaning, you can't ~ something that wasnt already that way.
    // although it might be used for inference I can imagine.
    | { type: 'fn'; args: Pat[]; body: Term; captured: Gamma }
    | { type: 'tuple'; items: Value[] }
    | { type: 'union'; side: 'left' | 'right'; value: Value }
    // | {type: 'bang', value: Value}
    | { type: 'unit' };

type Gamma = {
    bindings: Record<string, Value>;
    builtins: Record<string, (...args: Value[]) => Value>;
};

// type LensArrow<S, Sp, A, Ap> = (gamma: S) => [A, (next: Ap) => Sp]
//
// type SimpleLinear<S,A> = LensArrow<S, void, A, void>
//
//

export const bind = (pat: Pat, value: Value, gamma: Gamma) => {
    switch (pat.type) {
        case 'id':
            gamma.bindings[pat.text] = value;
            return;
        case 'tuple':
            if (value.type === 'tuple') {
                if (value.items.length !== pat.items.length) {
                    throw new EvalError(pat, 'wrong size tuple');
                }
                value.items.forEach((item, i) => bind(pat.items[i], item, gamma));
                return;
            }
            throw new Error('nto a tuple');
        case 'lens':
            throw new Error('cant do lenses yet');
    }
};

export const match = (pat: Pat, value: Value, gamma: Gamma): boolean => {
    switch (pat.type) {
        case 'id':
            gamma.bindings[pat.text] = value;
            return true;
        case 'drop':
            return true;
        case 'constructor': {
            if (value.type !== 'union') {
                throw new EvalError(pat, `Not a union cant match on it`);
            }
            if (value.side !== pat.name) {
                return false;
            }
            if (pat.args.length !== 1) {
                throw new EvalError(pat, 'wrong number of args for pat');
            }
            return match(pat.args[0], value.value, gamma);
        }
        case 'tuple':
            if (value.type === 'tuple') {
                if (value.items.length !== pat.items.length) {
                    return false;
                }
                for (let i = 0; i < value.items.length; i++) {
                    if (!match(pat.items[i], value.items[i], gamma)) {
                        return false;
                    }
                }
                return true;
            }
            throw new EvalError(value, 'nto a tuple');
        case 'lens':
            throw new EvalError(pat, 'cant do lenses yet');
    }
};

export const evaluate = (expr: Term, gamma: Gamma): [Value, Gamma] => {
    switch (expr.type) {
        case 'constructor':
        case 'string':
            throw new Error('no');
        // case "ifs": {
        //     // for (let cond of expr.conds) {
        //     //     const [v, g2] = evaluate(cond.cond, gamma);
        //     //     gamma = g2
        //     //     if (v.type !== "bool") {
        //     //         throw new EvalError(expr, "if cond not bool");
        //     //     }
        //     //     if (v.value) {
        //     //         return evaluate(cond.body, gamma);
        //     //     }
        //     // }
        //     // return evaluate(expr.else, gamma);
        //     throw new Error("if not really");
        // }
        case 'id':
            if (expr.text in gamma.builtins) {
                return [{ type: 'builtin', value: gamma.builtins[expr.text] }, gamma];
            }
            if (!(expr.text in gamma.bindings)) {
                throw new EvalError(expr, 'unbound');
            }
            const { [expr.text]: value, ...rest } = gamma.bindings;
            return [value, { ...gamma, bindings: rest }];
        case 'case': {
            const [value, g2] = evaluate(expr.value, gamma);
            gamma = g2;
            if (value.type !== 'union') {
                throw new EvalError(expr, 'cant case a non-union');
            }
            for (let kase of expr.cases) {
                const inner: Gamma = {
                    ...gamma,
                    bindings: { ...gamma.bindings },
                };
                if (match(kase.pat, value, inner)) {
                    return evaluate(kase.body, inner);
                }
            }
            throw new EvalError(expr, 'no matching case');
        }
        case 'const':
            return [
                typeof expr.value === 'boolean'
                    ? { type: 'bool', value: expr.value }
                    : expr.value === null
                      ? { type: 'unit' }
                      : { type: 'int', value: expr.value },
                gamma,
            ];
        case 'let': {
            const [value, g2] = evaluate(expr.value, gamma);
            gamma = g2;
            const next: Gamma = { ...gamma, bindings: { ...gamma.bindings } };
            bind(expr.pat, value, next);
            return evaluate(expr.body, next);
        }
        // case "additive_product":
        //     throw new Error("not yet");
        case 'tuple': {
            const items = expr.items.map((item) => {
                const [value, g2] = evaluate(item, gamma);
                gamma = g2;
                return value;
            });
            return [
                {
                    type: 'tuple',
                    items,
                },
                gamma,
            ];
        }
        case 'fn': {
            const value: Value & { type: 'fn' } = {
                type: 'fn',
                args: expr.args.map((p) => p.pat),
                body: expr.body,
                captured: { ...gamma, bindings: {} },
            };
            const res = { ...gamma, bindings: { ...gamma.bindings } };
            free(expr).forEach((name) => {
                if (!res.bindings[name]) {
                    if (res.builtins[name]) return;
                    throw new EvalError(expr, `unbound ${name}`);
                }
                value.captured.bindings[name] = res.bindings[name];
                delete res.bindings[name];
            });
            return [value, res];
        }
        case 'apply': {
            const [v, g2] = evaluate(expr.fn, gamma);
            gamma = g2;
            const args = expr.args.map((arg) => {
                const [v, g2] = evaluate(arg, gamma);
                gamma = g2;
                return v;
            });
            if (v.type === 'builtin') {
                return [v.value(...args), gamma];
            }
            if (v.type !== 'fn') {
                console.log(v);
                throw new Error('apply not fn');
            }
            const inner: Gamma = {
                ...gamma,
                bindings: { ...v.captured.bindings },
            };
            args.forEach((arg, i) => bind(v.args[i], arg, inner));
            return evaluate(v.body, inner);
        }
        case 'lens':
            throw new Error('no lens yet');
        case 'assign':
            throw new Error('no assign yet');
    }
};
