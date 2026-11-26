import {
    requirements,
    predicateErrors,
    type comparableUnions,
    type Bound,
    type Predicate,
} from './constraints.ts';
/** Solver types are deliberately separate from parsed annotation syntax. */
export type Ty =
    | { tag: 'meta'; id: number }
    | { tag: 'rigid'; id: number }
    | { tag: 'con'; name: string; args: Ty[] }
    | { tag: 'tuple'; items: Ty[] }
    /** Closed structural record. Fields are sorted by name, so a field's index is its path step. */
    | { tag: 'record'; fields: { name: string; type: Ty }[] }
    /**
     * `linear` marks a closure that captured a linear value or an owned lens, so it cannot be
     * dropped or copied. It is decided where the closure is written, never inferred.
     */
    | { tag: 'fn'; args: FlowTy[]; result: FlowTy; linear?: true };
/**
 * `replaceable` says whether the whole value of the lens can be replaced (`:=`, move-out,
 * a stored-lens argument). It is a `Ty` so that it unifies, generalizes and instantiates
 * with the existing machinery: `REPLACEABLE`, `FIXED` or a meta (see
 * docs/scattered-constructor-lenses.md). Every lens built before constructor lenses
 * exist is `REPLACEABLE`.
 *
 * `owned` says who ends a lens (docs/owned-lenses.md): `OWNED_LENS` moves with its holder,
 * `BORROWED_LENS` stays with the caller. It only means something on a function's parameters
 * and result. Also a `Ty`, so that a call to a callee not yet known can leave it open.
 *
 * `mode` is the ownership of a plain position (docs/mut-and-linear-plan.md, 5a): `OWNED` for a
 * `mut` value that nothing else can read, `SHARED` for a plain value. Like `replaceable` it is a
 * `Ty`, so it unifies, generalizes and instantiates with the existing machinery.
 */
export type FlowTy =
    | { tag: 'plain'; value: Ty; mode: Ty }
    | { tag: 'flow'; read: Ty; write: Ty; replaceable: Ty; owned: Ty };
export type Scheme = { quantified: number[]; bounds?: Bound[]; body: Ty };
export const con = (name: string, ...args: Ty[]): Ty => ({ tag: 'con', name, args });
export const tuple = (...items: Ty[]): Ty => ({ tag: 'tuple', items });
export const record = (fields: { name: string; type: Ty }[]): Ty => ({
    tag: 'record',
    fields: [...fields].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
});
export const plain = (value: Ty, mode: Ty = OWNED): FlowTy => ({ tag: 'plain', value, mode });
/** A parameter that only reads its argument, so it accepts shared and owned values alike. */
export const reads = (value: Ty): FlowTy => plain(value, SHARED);
/** The builtin channel type, `Chan(a)`. */
export const CHANNEL = 'Chan';
/** The names start with `$` so they cannot collide with a user-declared type. */
const REPLACEABLE_NAME = '$replaceable';
const FIXED_NAME = '$fixed';
const OWNED_NAME = '$owned';
const SHARED_NAME = '$shared';
const OWNED_LENS_NAME = '$owned-lens';
const BORROWED_LENS_NAME = '$borrowed-lens';
export const OWNED_LENS: Ty = con(OWNED_LENS_NAME);
export const BORROWED_LENS: Ty = con(BORROWED_LENS_NAME);
export const REPLACEABLE: Ty = con(REPLACEABLE_NAME);
export const FIXED: Ty = con(FIXED_NAME);
export const OWNED: Ty = con(OWNED_NAME);
export const SHARED: Ty = con(SHARED_NAME);
export const flow = (
    read: Ty,
    write: Ty,
    replaceable: Ty = REPLACEABLE,
    owned: Ty = BORROWED_LENS,
): FlowTy => ({
    tag: 'flow',
    read,
    write,
    replaceable,
    owned,
});
export const fn = (args: FlowTy[], result: FlowTy, linear?: boolean): Ty => ({
    tag: 'fn',
    args,
    result,
    ...(linear ? { linear: true as const } : {}),
});
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
        case 'record':
            return record(t.fields.map((f) => ({ name: f.name, type: mapType(f.type, replace) })));
        case 'fn':
            return fn(
                t.args.map((a) => mapFlow(a, (v) => mapType(v, replace))),
                mapFlow(t.result, (v) => mapType(v, replace)),
                t.linear,
            );
    }
}
export function mapFlow(t: FlowTy, f: (t: Ty) => Ty): FlowTy {
    return t.tag === 'plain'
        ? plain(f(t.value), f(t.mode))
        : flow(f(t.read), f(t.write), f(t.replaceable), f(t.owned));
}

export class Solver {
    private next = 0;
    private obligations: {
        predicate: Predicate;
        type: Ty;
        loc: number;
        diagnostic?: [string, string];
    }[] = [];
    require(predicate: Predicate, type: Ty, loc: number, diagnostic?: [string, string]): void {
        this.obligations.push({ predicate, type, loc, diagnostic });
    }
    /** Discharge concrete obligations and export those on the final contract's parameters. */
    finishBounds(
        scheme: Scheme,
        bodyVariables: Map<number, Ty>,
        unions: ReturnType<typeof comparableUnions>,
        linear: (name: string) => boolean,
    ): void {
        const bounds: Bound[] = [];
        for (const { predicate, type, loc, diagnostic } of this.obligations) {
            const resolved = mapType(this.resolve(type), (t) =>
                t.tag === 'meta' ? bodyVariables.get(t.id) : undefined,
            );
            const remaining = requirements<number>(predicate, resolved, unions, linear);
            if (!remaining) {
                const [code, message] = diagnostic ?? predicateErrors[predicate];
                throw new TypeDiagnostic(code, loc, message);
            }
            for (const variable of remaining) {
                const parameter = scheme.quantified.indexOf(variable);
                if (
                    parameter >= 0 &&
                    !bounds.some((b) => b.parameter === parameter && b.predicate === predicate)
                )
                    bounds.push({ predicate, parameter });
            }
        }
        if (bounds.length) scheme.bounds = bounds;
        this.obligations = [];
    }
    private substitutions = new Map<number, Ty>();
    private modeMetas = new Set<number>();
    /** Variables standing for what a channel carries: any function they turn out to be is one-use. */
    private carriedMetas = new Set<number>();
    fresh(): Ty {
        return { tag: 'meta', id: this.next++ };
    }
    rigid(): Ty {
        return { tag: 'rigid', id: this.next++ };
    }
    /**
     * `value` is carried by a channel (docs/concurrency.md). A function sent over one may own
     * anything, so whoever receives it must call it exactly once: it is linear, even where the
     * receiver's code is all that has been seen of it. This marks the function's own type
     * object, so every reference to it agrees.
     */
    private carried(value: Ty): void {
        const t = this.prune(value);
        if (t.tag === 'meta') this.carriedMetas.add(t.id);
        else if (t.tag === 'fn') t.linear = true;
        else if (t.tag === 'tuple') t.items.forEach((v) => this.carried(v));
        else if (t.tag === 'record') t.fields.forEach((f) => this.carried(f.type));
        else if (t.tag === 'con' && t.name !== CHANNEL) t.args.forEach((v) => this.carried(v));
    }
    /** Apply `carried` to what every channel type within `t` carries. */
    channels(t: Ty): void {
        mapType(t, (v) => {
            if (v.tag === 'con' && v.name === CHANNEL) v.args.forEach((a) => this.carried(a));
            return undefined;
        });
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
        return this.instantiateWithArguments(s, rigid).type;
    }
    instantiateWithArguments(
        s: Scheme,
        rigid = false,
        loc = 0,
    ): { type: Ty; arguments: Map<number, Ty> } {
        const vars = new Map(s.quantified.map((id) => [id, rigid ? this.rigid() : this.fresh()]));
        const type = mapType(this.resolve(s.body), (t) =>
            t.tag === 'meta' ? vars.get(t.id) : undefined,
        );
        this.channels(type);
        for (const b of s.bounds ?? []) {
            const value = vars.get(s.quantified[b.parameter]!);
            if (!value)
                throw new TypeDiagnostic(
                    'open-signature',
                    loc,
                    'Constraint on an unquantified parameter',
                );
            this.require(b.predicate, value, loc);
        }
        return { type, arguments: vars };
    }
    generalize(t: Ty, environment: Scheme[]): Scheme {
        const excluded = new Set(
            environment.flatMap((s) =>
                [...this.free(s.body)].filter((id) => !s.quantified.includes(id)),
            ),
        );
        // A mode nothing decided is owned, and it is not a type parameter.
        for (const id of this.free(t))
            if (this.modeMetas.has(id) && !excluded.has(id)) this.substitutions.set(id, OWNED);
        return {
            body: this.resolve(t),
            quantified: [...this.free(t)].filter((id) => !excluded.has(id)),
        };
    }
    /** `unknown` while the flag is still a meta; callers decide how to treat it. */
    replaceability(t: FlowTy & { tag: 'flow' }): 'replaceable' | 'fixed' | 'unknown' {
        const r = this.prune(t.replaceable);
        return r.tag === 'con' && r.name === FIXED_NAME
            ? 'fixed'
            : r.tag === 'con' && r.name === REPLACEABLE_NAME
              ? 'replaceable'
              : 'unknown';
    }
    /** A mode that no constraint has decided yet; generalization makes it owned. */
    freshMode(): Ty {
        const mode = this.fresh();
        this.modeMetas.add((mode as Ty & { tag: 'meta' }).id);
        return mode;
    }
    /** `unknown` while the mode is still a meta. */
    ownership(t: FlowTy & { tag: 'plain' }): 'owned' | 'shared' | 'unknown' {
        return this.modeOf(t.mode);
    }
    modeOf(mode: Ty): 'owned' | 'shared' | 'unknown' {
        const r = this.prune(mode);
        return r.tag === 'con' && r.name === SHARED_NAME
            ? 'shared'
            : r.tag === 'con' && r.name === OWNED_NAME
              ? 'owned'
              : 'unknown';
    }
    unifyMode(a: Ty, b: Ty, loc: number): void {
        try {
            this.unify(a, b, loc);
        } catch (e) {
            if (e instanceof TypeDiagnostic && e.code === 'type-mismatch')
                throw new TypeDiagnostic(
                    'mode-mismatch',
                    loc,
                    'A `mut` value does not match a plain one here; `dup` it to change modes',
                );
            throw e;
        }
    }
    /** `unknown` while a call to an unknown callee has not been settled. */
    lensOwnership(owned: Ty): 'owned' | 'borrowed' | 'unknown' {
        const r = this.prune(owned);
        return r.tag === 'con' && r.name === OWNED_LENS_NAME
            ? 'owned'
            : r.tag === 'con' && r.name === BORROWED_LENS_NAME
              ? 'borrowed'
              : 'unknown';
    }
    unifyLensOwnership(a: Ty, b: Ty, loc: number): void {
        try {
            this.unify(a, b, loc);
        } catch (e) {
            if (e instanceof TypeDiagnostic && e.code === 'type-mismatch')
                throw new TypeDiagnostic(
                    'lens-ownership-mismatch',
                    loc,
                    'An owned lens position does not match a borrowed one; a callee that is not yet known borrows, so annotate it `mut ~A` if it takes ownership',
                );
            throw e;
        }
    }
    unifyReplaceable(a: Ty, b: Ty, loc: number): void {
        try {
            this.unify(a, b, loc);
        } catch (e) {
            if (e instanceof TypeDiagnostic && e.code === 'type-mismatch')
                throw new TypeDiagnostic(
                    'replaceable-mismatch',
                    loc,
                    'A lens whose whole value can be replaced does not match one built from a constructor of borrowed fields',
                );
            throw e;
        }
    }
    /**
     * Unify two positions. An annotation on a parameter or result says nothing about
     * ownership, so it skips the modes.
     */
    unifyFlow(a: FlowTy, b: FlowTy, loc: number, modes = true): void {
        if (a.tag === 'plain' && b.tag === 'plain') {
            this.unify(a.value, b.value, loc);
            if (modes) this.unifyMode(a.mode, b.mode, loc);
            return;
        }
        if (a.tag === 'flow' && b.tag === 'flow') {
            this.unify(a.read, b.read, loc);
            this.unify(a.write, b.write, loc);
            this.unifyReplaceable(a.replaceable, b.replaceable, loc);
            if (modes) this.unifyLensOwnership(a.owned, b.owned, loc);
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
            if (this.carriedMetas.has(variable.id)) this.carried(value);
            if (value.tag === 'con' && value.name === CHANNEL) this.channels(value);
            return;
        }
        if (
            a.tag === 'con' &&
            b.tag === 'con' &&
            a.name === b.name &&
            a.args.length === b.args.length
        ) {
            if (a.name === CHANNEL) {
                this.channels(a);
                this.channels(b);
            }
            a.args.forEach((v, i) => this.unify(v, b.args[i], loc));
            return;
        }
        if (a.tag === 'tuple' && b.tag === 'tuple' && a.items.length === b.items.length) {
            a.items.forEach((v, i) => this.unify(v, b.items[i], loc));
            return;
        }
        if (
            a.tag === 'record' &&
            b.tag === 'record' &&
            a.fields.length === b.fields.length &&
            a.fields.every((f, i) => f.name === b.fields[i].name)
        ) {
            a.fields.forEach((f, i) => this.unify(f.type, b.fields[i].type, loc));
            return;
        }
        if (a.tag === 'fn' && b.tag === 'fn') {
            if (a.args.length !== b.args.length)
                throw new TypeDiagnostic(
                    'arity-mismatch',
                    loc,
                    `Expected ${a.args.length} arguments, found ${b.args.length}`,
                );
            if (a.linear !== b.linear)
                throw new TypeDiagnostic(
                    'linear-closure-mismatch',
                    loc,
                    'A closure that captured a linear value or an owned lens must be called, or passed to a function that is known to consume it',
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

export function printScheme(scheme: Scheme): string {
    return printType(scheme.body, scheme);
}

export function printType(t: Ty, scheme?: Scheme): string {
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
            case 'record':
                return `{${t.fields.map((f) => `${f.name}: ${show(f.type)}`).join(', ')}}`;
            case 'fn':
                return `${t.linear ? 'linear ' : ''}(${t.args.map(sf).join(', ')}) => ${sf(t.result)}`;
        }
    };
    const sf = (t: FlowTy): string =>
        t.tag === 'plain'
            ? (t.mode.tag === 'con' && t.mode.name === SHARED_NAME ? '&' : '') + show(t.value)
            : `${t.owned.tag === 'con' && t.owned.name === OWNED_LENS_NAME ? 'mut ' : ''}${show(t.read)}/${t.replaceable.tag === 'con' && t.replaceable.name === FIXED_NAME ? '=' : ''}${show(t.write)}`;
    const body = show(t);
    if (!scheme?.bounds?.length) return body;
    return (
        body +
        ' where ' +
        scheme.bounds
            .map(
                (b) =>
                    `${b.predicate}(${show({ tag: 'meta', id: scheme.quantified[b.parameter]! })})`,
            )
            .join(', ')
    );
}
