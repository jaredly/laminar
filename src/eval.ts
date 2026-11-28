import { displayValue } from './display.ts';
import { Expr, Idd, Patd, Ref, Stmt } from './expr.ts';
import { lexpr, lpat, unwrap } from './decompose.ts';
import { Loc, stringify } from '../parser-generator/lexer.ts';
import { string } from '../parser-generator/grammar-lexer.ts';

/**
 * Here's the pointer-based one.
 * Hope it works.
 */

/*

So...
how does scope and stuff work, with pointers.

a name maps to a location.
We could ... have like a stack-based allocator. which feels appropriate.
and then we'll also want a heap.

ok but it's not like scopes based, is it? I guess it could be.
*/

type PPath = (number | [string, number])[];

export type Pointer =
    | {
          type: 'value';
          at:
              | { type: 'stack'; level: number; id: string; loc: number }
              | { type: 'heap'; loc: number };
          path: PPath;
      }
    | { type: 'tuple'; items: Pointer[] };
// {
//     type: 'constructor',
//     name: string,
//     items: Pointer[]
// }

export type Scope = { bindings: Record<string, Pointer> };
export type Frame = { values: { loc: Loc; contents: any }[]; id: string };
export type Ctx = {
    scopes: Scope[];
    stack: Frame[];
    builtins: Record<string, any>;
    heap: {
        lid: number;
        data: Record<number, any>;
    };
};

const deleted = Symbol('deleted');

// const findScope = (ctx: Ctx, k: string) => {
//     for (let i = 0; i < ctx.scopes.length; i++) {
//         if (k in ctx.scopes[i]) return ctx.scopes[i];
//     }
// };

// export const valueToExpr = (value: any): Expr => {
//     if (typeof value === 'string') {
//         return { type: 'string', head: value, interp: [], loc: -1 };
//     }
//     if (typeof value === 'number' || typeof value === 'boolean') {
//         return { type: 'const', loc: -1, value };
//     }
//     if (typeof value === 'function') {
//         throw new Error(`cant do functions sorry`);
//     }
//     if (Array.isArray(value)) {
//         let res: Expr = { type: 'constructor', name: 'nil', loc: -1, args: [] };
//         while (value.length) {
//             const last = value.pop()!;
//             res = { type: 'constructor', name: 'cons', loc: -1, args: [valueToExpr(last), res] };
//         }
//         return res;
//     }
//     if (value == null) return { type: 'tuple', items: [], loc: -1 };
//     if (typeof value === 'object' && 'type' in value && typeof value.type === 'string') {
//         return {
//             type: 'constructor',
//             name: value.type,
//             args: value.args?.map(valueToExpr) ?? [],
//             loc: -1,
//         };
//     }
//     throw new Error('cant make expr ' + JSON.stringify(value));
// };

export const modat = <T, R>(
    ctx: Ctx,
    pointer: Pointer & { type: 'value' },
    loc: Loc,
    mod: (value: T) => R,
): T => {
    let value: any;
    if (pointer.at.type === 'stack') {
        if (pointer.at.type !== 'stack') throw new Error('no heap yet');
        if (pointer.at.level >= ctx.stack.length) {
            console.log(pointer, ctx.stack);
            throw new Error(`pointer to a stack frame that has been dropped`);
        }
        // const scope = ctx.scopes[pointer.at.level];
        const stack = ctx.stack[pointer.at.level];
        if (stack.id !== pointer.at.id) {
            console.log(ctx.stack, pointer);
            throw new Error(
                `stack id mismatch! Stack ${pointer.at.id} has probably been disposed (${stack.id} is now at position ${pointer.at.level}). This is a reference leak!`,
            );
        }
        if (pointer.at.loc >= stack.values.length) {
            console.log(pointer, stack);
            throw new Error(`invalid stack pointer`);
        }
        value = stack.values[pointer.at.loc].contents;
        if (!pointer.path.length) {
            stack.values[pointer.at.loc] = { contents: mod(value), loc };
            return value;
        }
    } else {
        value = ctx.heap.data[pointer.at.loc];
        if (!pointer.path.length) {
            // console.log('heap pre', ctx.heap.data);
            ctx.heap.data[pointer.at.loc] = mod(value);
            // console.log('heap is now', ctx.heap.data);
            return value;
        }
    }
    // Rebuild list tails on the way out. A tail projection uses slice(), so
    // mutating a deeper field without propagation would update a detached copy.
    const modify = (current: any, path: PPath): T => {
        if (!path.length) throw new Error('Missing projection');
        const [at, ...rest] = path;
        const update = (child: any): any => {
            if (!rest.length) return mod(child);
            modify(child, rest);
            return child;
        };
        if (typeof at === 'number') {
            if (!Array.isArray(current)) throw new Error('value not tuple');
            const before = current[at];
            current[at] = update(before);
            return before;
        }
        if (at[0] === 'cons' && Array.isArray(current)) {
            const before = at[1] === 0 ? current[0] : current.slice(1);
            const after = update(before);
            if (at[1] === 0) current[0] = after;
            else if (after === deleted) current.splice(1);
            else {
                if (!Array.isArray(after)) throw new Error('bad mod from tail');
                current.splice(1, current.length - 1, ...after);
            }
            return before;
        }
        if (!current || current.type !== at[0]) throw new LocError(loc, `bad constructor ${at[0]}`);
        const before = current.args[at[1]];
        current.args[at[1]] = update(before);
        return before;
    };
    // Return the old value at the final projection, rather than its ancestor.
    let previous: T;
    const originalMod = mod;
    mod = (old: T) => {
        previous = old;
        return originalMod(old);
    };
    modify(value, pointer.path);
    return previous!;
};

export const dupAt = (ctx: Ctx, pointer: Pointer, loc: Loc): any => {
    // console.log('dupat', JSON.stringify(pointer), ctx.heap);
    if (pointer.type === 'tuple') {
        return pointer.items.map((item) => dupAt(ctx, item, loc));
    } else {
        return modat(ctx, pointer, loc, (v) => {
            if (typeof v === 'number' || typeof v === 'string' || v == null) {
                return v;
            }
            return structuredClone(v);
        });
    }
};

const getset = (ctx: Ctx, pointer: Pointer, loc: Loc, newValue = deleted): any => {
    if (pointer.type === 'tuple') {
        let arrv: null | any[] = [];
        if (newValue !== deleted) {
            if (pointer.items.length === 0 && newValue == null) {
                return; // its fine
            }
            if (!Array.isArray(newValue) || newValue.length !== pointer.items.length) {
                console.log(newValue, pointer);
                throw new Error(`Bad newValue for tuple pointer`);
            }
            arrv = newValue;
        }
        return pointer.items.map((item, i) =>
            getset(ctx, item, loc, newValue === deleted ? deleted : arrv[i]),
        );
    } else {
        if (newValue === deleted) {
            // console.log('DELETING', pointer);
        }
        return modat(ctx, pointer, loc, (_) => newValue);
    }
};

const showPointer = (p: Pointer): string => {
    switch (p.type) {
        case 'value':
            return `${p.at.type}:${p.at.loc}::${p.path.join(';')}`;
        case 'tuple':
            return `(${p.items.map(showPointer).join(',')})`;
    }
};

const findPointer = (ctx: Ctx, id: Idd) => {
    const key = id.text + id.id;
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        const scope = ctx.scopes[i];
        if (Object.hasOwn(scope.bindings, key)) {
            return scope.bindings[key];
        }
    }
};

const resolvePointer = (ctx: Ctx, expr: Expr | Patd): Pointer | void => {
    if (expr.type === 'idd') return findPointer(ctx, expr);
    if (expr.type === 'tuple') {
        return {
            type: 'tuple',
            items: expr.items.map((item) => {
                const found = resolvePointer(ctx, item);
                if (!found) throw new Error(`pointer not found`);
                return found;
            }),
        };
    }
};

export type Mem = { stack: Frame[]; heap: Ctx['heap'] };

// const setRef = (pat: Patd, value: Expr) => {};

export const evalExpr = (ctx: Ctx, expr: Expr): any => {
    switch (expr.type) {
        case 'string':
            return expr.head + expr.interp.map((i) => displayValue(evalExpr(ctx, i.value)) + i.tail).join('');
        case 'deref': {
            if (expr.inner.type === 'idd') {
                // walk back through scopes
                const pointer = findPointer(ctx, expr.inner);
                if (!pointer) {
                    throw new Error(`Unbound reference ${expr.inner.text + expr.inner.id}`);
                }
                const res = getset(ctx, pointer, expr.loc);
                // console.log(`DEREF ${stringify(lexpr(expr))}`, res, showPointer(pointer));
                return res;
            }
            throw new Error('cnt deref that yet: ' + stringify(lexpr(expr)));
        }
        case 'ref': {
            const pointer = resolvePointer(ctx, expr.inner);
            if (!pointer) {
                throw new Error(`Unbound reference ${stringify(lexpr(expr))}`);
            }
            return pointer;
        }
        case 'swap': {
            const v = evalExpr(ctx, expr.value);
            if (expr.pat.type === 'ref') {
                const pointer = resolvePointer(ctx, expr.pat.inner);
                if (!pointer) {
                    console.log(ctx.scopes);
                    throw new Error(`Unbound reference ${stringify(lpat(expr.pat))}`);
                }
                // console.log('SWAP', stringify(lpat(expr.pat)), showPointer(pointer), v);
                return getset(ctx, pointer, expr.loc, v);
            }
            // console.log('SWAP', stringify(lpat(expr.pat)), v);
            return setPat(ctx, expr.pat, v, false);
        }
        case 'block': {
            const nctx: Ctx = subCtx(ctx, ctx.stack, expr.loc);
            expr.block.forEach((stmt) => {
                if (stmt.type === 'let') {
                    if (stmt.pat.type === 'ref' && stmt.value.type === 'ref') {
                        // if (stmt.value.inner.type === 'idd') {
                        const pointer = resolvePointer(nctx, stmt.value.inner);
                        if (!pointer) {
                            throw new Error(`cant find pointer ${stringify(lexpr(stmt.value))}`);
                        }
                        const scope = nctx.scopes[nctx.scopes.length - 1];
                        patPaths(stmt.pat.inner, [], (id, path) => {
                            scope.bindings[id.text + id.id] = subPointer(pointer, path);
                        });
                    } else {
                        const v = evalExpr(nctx, stmt.value);
                        setPat(nctx, stmt.pat, v, true);
                    }
                } else {
                    evalExpr(nctx, stmt);
                }
            });
            const res = evalExpr(nctx, expr.result);
            expr.cleanup.forEach((fin) => {
                evalExpr(nctx, fin);
                // const v = evalExpr(ctx, swap.value);
                // setPat(ctx, swap.pat, v, false);
            });
            return res;
        }
        case 'const': {
            return expr.value;
        }
        case 'fn': {
            // const hasRef = expr.args.some((a) => a.type === 'ref');
            // if (hasRef) {
            const f = (mem: Mem, ...args: any[]) => {
                // console.log('EXPECTING STSACK');
                if (args.length !== expr.args.length) {
                    throw new Error(
                        `wrong number of args, got ${args.length}, expected ${expr.args.length}`,
                    );
                }
                if (!mem) throw new Error(`getting called tho with bad stack`);
                const nctx: Ctx = subCtx(ctx, expr.retained ? ctx.stack : mem.stack, expr.loc);
                if ((f as any).closure) {
                    const items = (f as any).closure as { id: Idd; value: any }[];
                    items.forEach(({ id, value }) => {
                        setPat(nctx, id, value, true);
                    });
                }
                args.forEach((item, i) => setPat(nctx, expr.args[i], item, true));
                return evalExpr(nctx, expr.body);
            };
            return f;
            // }
            // return (...args: any[]) => {
            //     console.log('NOT EXPECTING STACK');
            //     if (args.length !== expr.args.length) {
            //         throw new Error(
            //             `wrong number of args, got ${args.length}, expected ${expr.args.length}`,
            //         );
            //     }
            //     const scope: Scope = { bindings: {} };
            //     const nctx = {
            //         ...ctx,
            //         scopes: [...ctx.scopes, scope],
            //         stack: [
            //             { values: [], id: Math.random().toString(36).slice(2) + ':' + expr.loc },
            //         ],
            //     };
            //     args.forEach((item, i) => setPat(nctx, expr.args[i], item, true));
            //     return evalExpr(nctx, expr.body);
            // };
        }
        case 'apply': {
            if (expr.fn.type === 'idd' && expr.fn.text === 'heap') {
                if (expr.args.length !== 1) throw new Error(`expected 1 arg`);
                const id = ctx.heap.lid++;
                ctx.heap.data[id] = evalExpr(ctx, expr.args[0]);
                // console.log('heap()', ctx.heap.data);
                const p: Pointer = { type: 'value', path: [], at: { type: 'heap', loc: id } };
                return [
                    p,
                    () => {
                        // console.log('Dleteting from heap', id);
                        delete ctx.heap.data[id];
                        return null;
                    },
                ];
            }
            if (expr.fn.type === 'idd' && expr.fn.text === 'heapsize') {
                return Object.keys(ctx.heap.data).length;
            }
            // console.log('APPLY', stringify(lexpr(expr.fn)));
            const fn = evalExpr(ctx, expr.fn) as Function;
            if (typeof fn !== 'function') {
                throw new Error(`fn not a function: ${typeof fn}`);
            }
            const args = expr.args.map((arg) => evalExpr(ctx, arg));
            if (expr.fn.type === 'idd') {
                // console.log(`CALL`, expr.fn.text + expr.fn.id, args);
            }
            const res = fn.apply(null, [ctx, ...args]);
            if (expr.fn.type === 'idd') {
                // console.log(`GOT`, expr.fn.text, res);
            }
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
            if (expr.value.type === 'ref') {
                // throw new Error('match ref');
                const value = resolvePointer(ctx, expr.value.inner);
                if (!value) throw new Error(`cant resolve pointer ${stringify(lexpr(expr.value))}`);
                for (let { pat, body } of expr.cases) {
                    if (matchesPointer(ctx, pat, value)) {
                        setPat(ctx, pat, value, true);
                        return evalExpr(ctx, body);
                    }
                }
                console.log(value, expr.cases);
                throw new EvalError(expr, `no arms matched the value ` + JSON.stringify(value));
            }
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
        case 'idd': {
            if (expr.id === -1 && ctx.builtins[expr.text]) {
                return ctx.builtins[expr.text];
            }
            const key = expr.text + expr.id;
            for (let i = ctx.scopes.length - 1; i >= 0; i--) {
                const scope = ctx.scopes[i];
                if (Object.hasOwn(scope.bindings, key)) {
                    return scope.bindings[key];
                }
            }
            throw new Error(`malformed idd, should be wrapped in a ref or deref`);
        }
        case 'closure': {
            const items = expr.names.map((name): { id: Patd; value: any } => {
                // Move the contents, retaining the storage binding so a lens can be restored.
                const ptr = findPointer(ctx, name);
                if (!ptr) throw new Error(`could not resolve ${stringify(lexpr(name))}`);
                return {
                    id: { type: 'deref', inner: name, loc: name.loc },
                    value: getset(ctx, ptr, expr.loc),
                };
            });
            if (expr.fn.type === 'fn') {
                const f = evalExpr(ctx, expr.fn);
                f.closure = items;
                return f;
            } else {
                const nctx = subCtx(ctx, [], expr.loc);
                items.forEach(({ id, value }) => {
                    setPat(nctx, id, value, true);
                });
                return evalExpr(nctx, expr.fn);
            }
        }
    }
    throw new Error('unknown expr type ' + (expr as any).type);
};

export class LocError extends Error {
    loc: Loc;
    constructor(loc: Loc, message: string) {
        super(message);
        this.loc = loc;
    }
}

export class EvalError extends Error {
    expr: Expr;
    constructor(expr: Expr, message: string) {
        super(message + '; ' + stringify(lexpr(expr)));
        this.expr = expr;
    }
}

export const matchesPointer = (ctx: Ctx, pat: Patd, ptr: Pointer): boolean => {
    if (ptr.type === 'tuple') {
        if (pat.type === 'tuple') {
            if (ptr.items.length !== pat.items.length) return false;
            return pat.items.every((pi, i) => matchesPointer(ctx, pi, ptr.items[i]));
        } else {
            return false;
        }
    } else {
        let match = false;
        modat(ctx, ptr, pat.loc, (v) => {
            match = matches(pat, v);
            return v;
        });
        return match;
    }
};

export const matches = (pat: Patd, value: any): boolean => {
    switch (pat.type) {
        case 'number':
        case 'bool':
            return value === pat.value;
        case 'idd':
            return true;
        case 'ref':
        case 'deref':
            return matches(pat.inner, value);
        case 'string':
            return value === pat.text;
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
            if (value === deleted) {
                throw new Error('value is deleted sry ' + stringify(lpat(pat)));
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
// const addUse = (uses: Uses, id: string, which: 'put' | 'get' | 'swap') => {
//     // console.log('   ' + id + ' : ' + which);
//     if (!uses[id]) uses[id] = [which];
//     else uses[id].push(which);
// };

export const patIds = (pat: Patd): string[] => {
    switch (pat.type) {
        case 'idd':
            return [pat.text + pat.id];
        case 'ref':
        case 'deref':
            return patIds(pat.inner);
        case 'bool':
        case 'number':
        case 'string':
            return [];
        // case 'drop':
        //     return pat.id != null ? ['_' + pat.id] : [];
        case 'tuple':
            return pat.items.flatMap(patIds);
        case 'constructor':
            return pat.args.flatMap(patIds);
    }
};

// export const returnValueDelayedConsumption = (expr: Expr): string[] => {
//     switch (expr.type) {
//         case 'string':
//             return expr.interp.flatMap((i) => returnValueDelayedConsumption(i.value));
//         // case 'addr':
//         //     throw new Error('addr not here');
//         case 'tuple':
//             return expr.items.flatMap(returnValueDelayedConsumption);
//         case 'case':
//             return expr.cases.flatMap((k) => returnValueDelayedConsumption(k.body));
//         case 'constructor':
//             return expr.args.flatMap(returnValueDelayedConsumption);
//         case 'idd':
//         case 'const':
//         case 'apply':
//         case 'swap':
//             return [];
//         case 'block':
//             return returnValueDelayedConsumption(expr.result);
//         case 'fn': {
//             const uses: Uses = {};
//             collectVariableUses(expr, uses);
//             console.log('found a fn', uses);
//             return Object.keys(uses).filter(
//                 (k) => uses[k][0] !== 'put' && uses[k][uses[k].length - 1] === 'get',
//             );
//         }
//     }
// };
//
// export const collectVariableUses = (expr: Stmt, uses: Uses): void => {
//     // console.log('<-', expr.type, expr.loc);
//     switch (expr.type) {
//         case 'idd': {
//             return addUse(uses, expr.text + expr.id, 'get');
//         }
//         case 'string': {
//             return expr.interp.forEach((i) => collectVariableUses(i.value, uses));
//         }
//         case 'swap': {
//             patIds(expr.pat).forEach((i) => addUse(uses, i, 'swap'));
//             return collectVariableUses(expr.value, uses);
//         }
//         case 'block': {
//             expr.block.forEach((s) => collectVariableUses(s, uses));
//             collectVariableUses(expr.result, uses);
//             expr.cleanup.forEach((s) => collectVariableUses(s, uses));
//             return;
//         }
//         case 'let': {
//             patIds(expr.pat).forEach((i) => addUse(uses, i, 'put'));
//             return collectVariableUses(expr.value, uses);
//         }
//         case 'const': {
//             return;
//         }
//         case 'fn': {
//             expr.args.forEach((pat) => patIds(pat).forEach((i) => addUse(uses, i, 'put')));
//             return collectVariableUses(expr.body, uses);
//         }
//         case 'apply': {
//             collectVariableUses(expr.fn, uses);
//             return expr.args.forEach((arg) => collectVariableUses(arg, uses));
//         }
//         case 'tuple':
//             return expr.items.forEach((item) => collectVariableUses(item, uses));
//         case 'constructor':
//             return expr.args.forEach((arg) => collectVariableUses(arg, uses));
//         case 'case': {
//             const cases = expr.cases.map((k) => {
//                 const uses: Uses = {};
//                 patIds(k.pat).forEach((i) => addUse(uses, i, 'put'));
//                 collectVariableUses(k.body, uses);
//                 return { uses, vbls: new Set(consumedVbls(uses)) };
//             });
//             for (let i = 1; i < cases.length; i++) {
//                 if (cases[i].vbls.symmetricDifference(cases[0].vbls).size > 0) {
//                     throw new Error(
//                         `case arms disagree as to what vbls they consume: case ${i}: ${[...cases[i].vbls]}, case 0: ${[...cases[0].vbls]}`,
//                     );
//                 }
//             }
//             return;
//         }
//     }
//     throw new Error('not handled ' + (expr as any).type);
// };
// //
// const consumedVbls = (uses: Uses) => {
//     return Object.keys(uses).filter(
//         (k) => uses[k][0] !== 'put' && uses[k][uses[k].length - 1] === 'get',
//     );
// };
//
// export const returnedLambdaUses = ()

// const addBindings = (scope: Scope, pat: Patd, path: string[]) => {
//     switch (pat.type) {
//     }
// }

const patPaths = (pat: Patd, path: PPath, on: (id: Idd, path: PPath) => void) => {
    switch (pat.type) {
        case 'string':
        case 'number':
        case 'bool':
            return;
        case 'idd':
            on(pat, path);
            return;
        case 'ref':
        case 'deref':
            throw new Error('nested ' + pat.type);
        case 'tuple':
            pat.items.forEach((item, i) => {
                patPaths(item, path.concat([i]), on);
            });
            return;
        case 'constructor':
            pat.args.forEach((arg, i) => {
                patPaths(arg, path.concat([[pat.name, i]]), on);
            });
            return;
    }
    throw new Error();
};

// const replaceBinding = (ctx: Ctx, id: Idd, pointer: Pointer) => {
//     const key = id.text + id.id;
//     for (let i = ctx.scopes.length - 1; i >= 0; i--) {
//         const scope = ctx.scopes[i];
//         if (Object.hasOwn(scope.bindings, key)) {
//             scope.bindings[key] = pointer;
//             return true;
//         }
//     }
// };

const setNewPat = (ctx: Ctx, pat: Patd, value: any) => {
    const scope = ctx.scopes[ctx.scopes.length - 1];
    const stack = ctx.stack[ctx.stack.length - 1];
    const at = stack.values.length;
    stack.values.push({ contents: value, loc: pat.loc });
    // console.log('set new stack vbalue', pat.loc, value);
    patPaths(pat, [], (id, path) => {
        scope.bindings[id.text + id.id] = {
            type: 'value',
            at: { type: 'stack', level: ctx.stack.length - 1, loc: at, id: stack.id },
            path,
        };
    });
};

const subPointer = (pointer: Pointer, path: PPath) => {
    if (!path.length) return pointer;
    if (pointer.type === 'value') {
        return { ...pointer, path: pointer.path.concat(path) };
    } else if (pointer.type === 'tuple') {
        if (typeof path[0] === 'number') {
            if (path[0] >= pointer.items.length) throw new Error(`bad pointer`);
            const next = pointer.items[path[0]];
            return subPointer(next, path.slice(1));
        } else {
            throw new Error('constr pointer in tuple');
        }
    }
    throw new Error('bad pointer');
};

export const setPat = (ctx: Ctx, pat: Patd, value: any, fresh: boolean): any => {
    if (pat.type === 'deref') {
        if (fresh) {
            setNewPat(ctx, pat.inner, value);
            return;
        } else {
            throw new Error('not fresh');
        }
    } else if (pat.type === 'ref') {
        // value MUST be of type pointer!
        if (!value || !('type' in value) || (value.type !== 'tuple' && value.type !== 'value')) {
            throw new Error(`bad value, expected a pointer`);
        }
        const scope = ctx.scopes[ctx.scopes.length - 1];
        patPaths(pat.inner, [], (id, path) => {
            scope.bindings[id.text + id.id] = subPointer(value, path);
        });
        if (!value) throw new Error('not point idk');
        return;
    } else if (pat.type === 'tuple') {
        if (pat.items.length === 2) {
            const [one, two] = pat.items;
            if (one.type === 'ref' && two.type === 'idd') {
                if (!Array.isArray(value) || value.length !== 2) {
                    throw new Error(`tuple trying to do a thing and its not`);
                }
                setPat(ctx, one, value[0], true);
                setPat(ctx, two, value[1], true);
                return;
            }
        }
        // special casing? feels icky
        throw new Error('tuuuple idk');
    } else {
        if (pat.type === 'idd') {
            const scope = ctx.scopes[ctx.scopes.length - 1];
            scope.bindings[pat.text + pat.id] = value;
            return;
        }
        throw new Error(`bare pat? ${pat.type} ${stringify(lpat(pat))}`);
    }
};

export const setPat_ = (ctx: Ctx, pat: Patd, value: any, fresh: boolean): any => {
    console.log('setpat', pat);
    switch (pat.type) {
        case 'tuple': {
            if (pat.items.length === 0) {
                if (value == null) return;
                if (Array.isArray(value) && value.every((v) => v == null)) return;
                throw new Error(`[] pat should only match null. ${JSON.stringify(value)}`);
            }
            if (!Array.isArray(value)) {
                throw new Error(
                    `value not an array in tuple pat ${stringify(lpat(pat))} ${pat.loc}`,
                );
            }
            if (value.length !== pat.items.length) {
                throw new Error(
                    `value wrong length. found ${value.length}, expected ${pat.items.length}. ${stringify(lpat(pat))}`,
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
    throw new Error(`bad setPat ${pat.type}`);
};

const subCtx = (ctx: Ctx, stack: Frame[], loc: Loc): Ctx => ({
    ...ctx,
    scopes: [...ctx.scopes, { bindings: {} }],
    stack: [
        ...stack,
        {
            values: [],
            id: Math.random().toString(36).slice(2) + ':' + loc,
        },
    ],
});
