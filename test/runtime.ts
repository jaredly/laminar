let log: null | ((...args: any[]) => void) = null;
let id0 = 0;
const genid = () => {
    return `_tmp${id0++}`;
};

export const drop = Symbol();

export const back = (scope: Scope, names: Names): any => {
    if (Array.isArray(names)) {
        return names.map((name) => back(scope, name));
    } else {
        return get(scope, names);
    }
};

type Scope = Record<string, any>;
export const wrap = (inner: (scope: Scope) => any, allowed?: Names, outer?: Scope) => {
    const scope: Scope = { ...outer };
    const result = inner(scope);
    checkUnused(scope, allowed);
    return result;
};

const namesList = (names: Names, dest: string[]) => {
    if (typeof names === 'string') {
        dest.push(names);
    } else {
        names.forEach((n) => namesList(n, dest));
    }
};

export const checkUnused = (scope: Scope, allowed?: Names) => {
    let remaining = Object.keys(scope);
    if (remaining.length) {
        const names: string[] = [];
        namesList(allowed ?? [], names);
        remaining = remaining.filter((n) => !names.includes(n));
        if (remaining.length) {
            console.log(scope);
            throw new Error(`some variables not used up ${remaining.join(',')}`);
        }
    }
};

export const run = (inner: (scope: Scope) => any, dolog = false) => {
    consumed = [];
    id0 = 0;
    if (dolog) {
        log = (...values: any[]) => console.log(...values);
    } else {
        log = null;
    }
    const scope: Scope = {};
    const result = inner(scope);
    checkUnused(scope);
    return consumed.length ? [consumed.length === 1 ? consumed[0] : consumed, result] : result;
};

let consumed: any[] = [];

export const builtins: Record<string, (...args: any[]) => any> = {
    '+': (a, b) => a + b,
    '*': (a, b) => a * b,
    '-': (a, b) => a - b,
    consume: (x) => {
        consumed.push(x);
    },
    log: (message, x) => {
        consumed.push([message, x]);
    },
};

export const addFn = (name: string, fn: (...args: any[]) => void) => {
    builtins[name] = fn;
};

export const get = (gamma: Scope, name: string) => {
    if (!Object.hasOwn(gamma, name)) {
        if (Object.hasOwn(builtins, name)) {
            return builtins[name];
        }
        throw new Error(`unbound ${name}`);
    }
    log?.('GET', gamma[name], name);
    const value = gamma[name];
    delete gamma[name];
    return value;
};

type Names = Names[] | string;
export const recv = (gamma: Scope, value: any, names: Names | typeof drop): any => {
    if (names === drop) {
        return; // dropping
    }
    log?.('RECV', value, names);
    if (Array.isArray(names)) {
        if (names.length === 0) {
            if (value == null) return; // success
            if (Array.isArray(value) && value.every((v) => v == null)) return;
            throw new Error(`Unused value ${JSON.stringify(value)}`);
        }
        if (!Array.isArray(value)) throw new Error('expected tuple');
        if (value.length !== names.length) throw new Error(`arrays dont match length`);
        return names.map((name, i) => recv(gamma, value[i], name));
    } else {
        if (typeof names !== 'string') {
            throw new Error('wat');
        }
        if (value === undefined) {
            throw new Error(`BUG recevigin ${names} got undefined`);
        }
        const old = gamma[names];
        gamma[names] = value;
        return old;
    }
};

export const tee = (scope: Scope, [a, b]: [any, any], c: Names) => {
    recv(scope, b, c);
    return a;
};
export const tee2 = (
    scope: Scope,
    [value, next]: [any, any],
    target: (names: Names) => void,
    as: Names,
) => {
    const tmp = genid();
    recv(scope, value, tmp);
    let final = target(tmp);
    recv(scope, next(get(scope, tmp)), as);
    return final;
};
