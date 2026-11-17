/** Solver types are deliberately separate from parsed annotation syntax. */
export type Ty =
    | { tag: 'meta'; id: number }
    | { tag: 'rigid'; id: number }
    | { tag: 'con'; name: string; args: Ty[] }
    | { tag: 'tuple'; items: Ty[] }
    | { tag: 'fn'; args: FlowTy[]; result: FlowTy };
export type FlowTy = { tag: 'plain'; value: Ty } | { tag: 'flow'; read: Ty; write: Ty };
export type Scheme = { quantified: number[]; body: Ty };
export const con = (name: string, ...args: Ty[]): Ty => ({ tag: 'con', name, args });
export const tuple = (...items: Ty[]): Ty => ({ tag: 'tuple', items });
export const plain = (value: Ty): FlowTy => ({ tag: 'plain', value });
export const flow = (read: Ty, write: Ty): FlowTy => ({ tag: 'flow', read, write });
export const fn = (args: FlowTy[], result: FlowTy): Ty => ({ tag: 'fn', args, result });
export const mono = (body: Ty): Scheme => ({ quantified: [], body });

export class TypeDiagnostic extends Error {
    constructor(
        public code: string,
        public loc: number,
        message: string,
    ) {
        super(message);
        this.name = 'TypeDiagnostic';
    }
}

export function mapType(t: Ty, replace: (t: Ty) => Ty | undefined): Ty {
    const replacement = replace(t);
    if (replacement) return replacement;
    switch (t.tag) {
        case 'meta':
        case 'rigid':
            return t;
        case 'con':
            return { ...t, args: t.args.map((a) => mapType(a, replace)) };
        case 'tuple':
            return tuple(...t.items.map((a) => mapType(a, replace)));
        case 'fn':
            return fn(
                t.args.map((a) => mapFlow(a, (v) => mapType(v, replace))),
                mapFlow(t.result, (v) => mapType(v, replace)),
            );
    }
}
export function mapFlow(t: FlowTy, f: (t: Ty) => Ty): FlowTy {
    return t.tag === 'plain' ? plain(f(t.value)) : flow(f(t.read), f(t.write));
}

export class Solver {
    private next = 0;
    private substitutions = new Map<number, Ty>();
    fresh(): Ty {
        return { tag: 'meta', id: this.next++ };
    }
    rigid(): Ty {
        return { tag: 'rigid', id: this.next++ };
    }
    prune(t: Ty): Ty {
        if (t.tag !== 'meta') return t;
        const value = this.substitutions.get(t.id);
        if (!value) return t;
        const result = this.prune(value);
        this.substitutions.set(t.id, result);
        return result;
    }
    resolve(t: Ty): Ty {
        return mapType(t, (v) => {
            const p = this.prune(v);
            return p !== v ? this.resolve(p) : undefined;
        });
    }
    free(t: Ty): Set<number> {
        const ids = new Set<number>();
        mapType(this.resolve(t), (v) => {
            if (v.tag === 'meta') ids.add(v.id);
            return undefined;
        });
        return ids;
    }
    instantiate(s: Scheme, rigid = false): Ty {
        const vars = new Map(s.quantified.map((id) => [id, rigid ? this.rigid() : this.fresh()]));
        return mapType(this.resolve(s.body), (t) =>
            t.tag === 'meta' ? vars.get(t.id) : undefined,
        );
    }
    generalize(t: Ty, environment: Scheme[]): Scheme {
        const excluded = new Set(
            environment.flatMap((s) =>
                [...this.free(s.body)].filter((id) => !s.quantified.includes(id)),
            ),
        );
        return {
            body: this.resolve(t),
            quantified: [...this.free(t)].filter((id) => !excluded.has(id)),
        };
    }
    unifyFlow(a: FlowTy, b: FlowTy, loc: number): void {
        if (a.tag === 'plain' && b.tag === 'plain') return this.unify(a.value, b.value, loc);
        if (a.tag === 'flow' && b.tag === 'flow') {
            this.unify(a.read, b.read, loc);
            this.unify(a.write, b.write, loc);
            return;
        }
        throw new TypeDiagnostic('mode-mismatch', loc, 'Expected matching value/lens modes');
    }
    unify(a: Ty, b: Ty, loc: number): void {
        a = this.prune(a);
        b = this.prune(b);
        if (
            a === b ||
            (a.tag === b.tag &&
                (a.tag === 'meta' || a.tag === 'rigid') &&
                a.id === (b as typeof a).id)
        )
            return;
        if (a.tag === 'meta' || b.tag === 'meta') {
            const variable = a.tag === 'meta' ? a : (b as Ty & { tag: 'meta' });
            const value = a.tag === 'meta' ? b : a;
            if (this.free(value).has(variable.id))
                throw new TypeDiagnostic('infinite-type', loc, 'Type contains itself');
            this.substitutions.set(variable.id, value);
            return;
        }
        if (
            a.tag === 'con' &&
            b.tag === 'con' &&
            a.name === b.name &&
            a.args.length === b.args.length
        ) {
            a.args.forEach((v, i) => this.unify(v, b.args[i], loc));
            return;
        }
        if (a.tag === 'tuple' && b.tag === 'tuple' && a.items.length === b.items.length) {
            a.items.forEach((v, i) => this.unify(v, b.items[i], loc));
            return;
        }
        if (a.tag === 'fn' && b.tag === 'fn') {
            if (a.args.length !== b.args.length)
                throw new TypeDiagnostic(
                    'arity-mismatch',
                    loc,
                    `Expected ${a.args.length} arguments, found ${b.args.length}`,
                );
            a.args.forEach((v, i) => this.unifyFlow(v, b.args[i], loc));
            this.unifyFlow(a.result, b.result, loc);
            return;
        }
        throw new TypeDiagnostic(
            'type-mismatch',
            loc,
            `Cannot unify ${printType(this.resolve(a))} with ${printType(this.resolve(b))}`,
        );
    }
}

export function printType(t: Ty): string {
    const names = new Map<number, string>();
    const show = (t: Ty): string => {
        switch (t.tag) {
            case 'meta':
            case 'rigid': {
                if (!names.has(t.id)) {
                    const n = names.size;
                    names.set(
                        t.id,
                        String.fromCharCode(97 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : ''),
                    );
                }
                return (t.tag === 'rigid' ? '!' : '') + names.get(t.id);
            }
            case 'con':
                return t.name + (t.args.length ? `<${t.args.map(show).join(', ')}>` : '');
            case 'tuple':
                return `(${t.items.map(show).join(', ')})`;
            case 'fn':
                return `(${t.args.map(sf).join(', ')}) => ${sf(t.result)}`;
        }
    };
    const sf = (t: FlowTy): string =>
        t.tag === 'plain' ? show(t.value) : `${show(t.read)}/${show(t.write)}`;
    return show(t);
}
