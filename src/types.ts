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
    /**
     * Structural record. Fields are unique and sorted by name. `rest` is a row variable (a meta
     * or rigid) standing for the other fields; absent means closed. An open record always has a
     * field: a record that is only its remainder is written as the row variable itself.
     */
    | { tag: 'record'; fields: { name: string; type: Ty }[]; rest?: Ty }
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
export type Scheme = {
    quantified: number[];
    bounds?: Bound[];
    /** Callback parameters this callable invokes or forwards exactly once on every path. */
    callsOnce?: readonly number[];
    /** Quantified parameters that are row variables, with the labels each must lack. */
    rows?: RowConstraint[];
    body: Ty;
};
export type RowConstraint = { parameter: number; lacks: string[] };
export const con = (name: string, ...args: Ty[]): Ty => ({ tag: 'con', name, args });
export const tuple = (...items: Ty[]): Ty => ({ tag: 'tuple', items });
const byName = (a: { name: string }, b: { name: string }) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
/** Build a record, absorbing a remainder that is already known. Use `Solver.row` to check lacks. */
export const record = (fields: { name: string; type: Ty }[], rest?: Ty): Ty => {
    if (rest?.tag === 'record') return record([...fields, ...rest.fields], rest.rest);
    if (rest && !fields.length) return rest;
    return { tag: 'record', fields: [...fields].sort(byName), ...(rest ? { rest } : {}) };
};
export type RecordTy = Ty & { tag: 'record' };
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
            return record(
                t.fields.map((f) => ({ name: f.name, type: mapType(f.type, replace) })),
                t.rest && mapType(t.rest, replace),
            );
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
    /** Row variables, metas and rigids alike, with the labels each must lack. */
    private lacks = new Map<number, Set<string>>();
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
        else if (t.tag === 'record') {
            t.fields.forEach((f) => this.carried(f.type));
            if (t.rest) this.carried(t.rest);
        } else if (t.tag === 'con' && t.name !== CHANNEL) t.args.forEach((v) => this.carried(v));
    }
    /** Apply `carried` to what every channel type within `t` carries. */
    channels(t: Ty): void {
        mapType(t, (v) => {
            if (v.tag === 'con' && v.name === CHANNEL) v.args.forEach((a) => this.carried(a));
            return undefined;
        });
    }
    prune(t: Ty): Ty {
        if (t.tag === 'record') {
            if (!t.rest) return t;
            const rest = this.prune(t.rest);
            return rest === t.rest ? t : record(t.fields, rest);
        }
        if (t.tag !== 'meta') return t;
        const value = this.substitutions.get(t.id);
        if (!value) return t;
        const result = this.prune(value);
        this.substitutions.set(t.id, result);
        return result;
    }
    /** The labels a row variable must lack, or undefined for a variable that is not a row. */
    rowLacks(id: number): ReadonlySet<string> | undefined {
        return this.lacks.get(id);
    }
    /** Require that `row` is a record, or a row variable, without a field `label`. */
    requireLacks(row: Ty, label: string, loc: number): void {
        const t = this.prune(row);
        if (t.tag === 'record') {
            if (t.fields.some((f) => f.name === label))
                throw new TypeDiagnostic(
                    'row-lacks',
                    loc,
                    `Record already has a field ${label}, which this use requires it to lack`,
                );
            if (t.rest) this.requireLacks(t.rest, label, loc);
        } else if (t.tag === 'meta' || t.tag === 'rigid') {
            this.markRow(t).add(label);
        } else
            throw new TypeDiagnostic(
                'type-mismatch',
                loc,
                `Expected a record, found ${printType(this.resolve(t))}`,
            );
    }
    /** Record that a variable stands for the fields of a record. */
    markRow(t: Ty & { tag: 'meta' | 'rigid' }): Set<string> {
        let set = this.lacks.get(t.id);
        if (!set) this.lacks.set(t.id, (set = new Set()));
        return set;
    }
    /** An open or closed record whose remainder lacks every one of `fields`. */
    row(fields: { name: string; type: Ty }[], rest: Ty | undefined, loc: number): Ty {
        if (!rest) return record(fields);
        const tail = this.prune(rest);
        if (tail.tag === 'meta' || tail.tag === 'rigid') this.markRow(tail);
        else if (tail.tag !== 'record')
            throw new TypeDiagnostic(
                'type-mismatch',
                loc,
                `Expected a record, found ${printType(this.resolve(tail))}`,
            );
        for (const f of fields) this.requireLacks(tail, f.name, loc);
        return record(fields, tail);
    }
    private unifyRecords(a: Ty, b: Ty, loc: number): void {
        const mismatch = (): never => {
            throw new TypeDiagnostic(
                'type-mismatch',
                loc,
                `Cannot unify ${printType(this.resolve(a))} with ${printType(this.resolve(b))}`,
            );
        };
        const left = this.prune(a),
            right = this.prune(b);
        // A field's payload may settle either remainder, so decompose again until none does.
        if (left.tag !== 'record' || right.tag !== 'record') return this.unify(left, right, loc);
        const other = new Map(right.fields.map((f) => [f.name, f.type]));
        for (const f of left.fields) {
            const match = other.get(f.name);
            if (match) this.unify(f.type, match, loc);
        }
        if (this.prune(left) !== left || this.prune(right) !== right)
            return this.unifyRecords(left, right, loc);
        const onlyLeft = left.fields.filter((f) => !other.has(f.name)),
            onlyRight = right.fields.filter((f) => !left.fields.some((g) => g.name === f.name));
        const l = left.rest,
            r = right.rest;
        if (!l && !r) {
            if (onlyLeft.length || onlyRight.length) mismatch();
            return;
        }
        if (!l || !r) {
            // The closed side cannot gain a field, so the open side's remainder is the surplus.
            const [open, missing, surplus] = l
                ? [l, onlyLeft, onlyRight]
                : [r!, onlyRight, onlyLeft];
            if (missing.length || open.tag !== 'meta') mismatch();
            return this.unify(open, record(surplus), loc);
        }
        if ((l.tag === 'meta' || l.tag === 'rigid') && (r.tag === 'meta' || r.tag === 'rigid')) {
            if (l.id === r.id) {
                if (onlyLeft.length || onlyRight.length) mismatch();
                return;
            }
        }
        if (!onlyLeft.length && !onlyRight.length)
            return l.tag === 'meta' ? this.unify(l, r, loc) : this.unify(r, l, loc);
        if (l.tag === 'rigid' && r.tag === 'rigid') mismatch();
        // A rigid side cannot gain a field, so the flexible side may bring none of its own.
        if (l.tag === 'rigid') {
            if (onlyRight.length) mismatch();
            return this.unify(r, this.row(onlyLeft, l, loc), loc);
        }
        if (r.tag === 'rigid') {
            if (onlyLeft.length) mismatch();
            return this.unify(l, this.row(onlyRight, r, loc), loc);
        }
        // With one side's surplus empty, its remainder is all of the other side.
        if (!onlyLeft.length) return this.unify(l, this.row(onlyRight, r, loc), loc);
        if (!onlyRight.length) return this.unify(r, this.row(onlyLeft, l, loc), loc);
        const tail = this.fresh() as Ty & { tag: 'meta' };
        this.markRow(tail);
        this.unify(l, this.row(onlyRight, tail, loc), loc);
        this.unify(r, this.row(onlyLeft, tail, loc), loc);
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
        for (const r of s.rows ?? []) {
            const value = vars.get(s.quantified[r.parameter]!);
            if (!value || (value.tag !== 'meta' && value.tag !== 'rigid'))
                throw new TypeDiagnostic(
                    'open-signature',
                    loc,
                    'Row constraint on an unquantified parameter',
                );
            const lacks = this.markRow(value);
            r.lacks.forEach((label) => lacks.add(label));
        }
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
        const quantified = [...this.free(t)].filter((id) => !excluded.has(id));
        const rows = this.rowConstraints(quantified);
        return { body: this.resolve(t), quantified, ...(rows.length ? { rows } : {}) };
    }
    rowConstraints(ids: readonly number[]): RowConstraint[] {
        return ids.flatMap((id, parameter) => {
            const lacks = this.lacks.get(id);
            return lacks ? [{ parameter, lacks: [...lacks].sort() }] : [];
        });
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
            // A row variable only ever becomes fields of a record, and keeps what it lacks.
            const required = this.lacks.get(variable.id);
            if (required) {
                if (value.tag === 'meta' || value.tag === 'rigid') this.markRow(value);
                else if (value.tag !== 'record')
                    throw new TypeDiagnostic(
                        'type-mismatch',
                        loc,
                        `Expected a record, found ${printType(this.resolve(value))}`,
                    );
                required.forEach((label) => this.requireLacks(value, label, loc));
            }
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
        if (a.tag === 'record' && b.tag === 'record') return this.unifyRecords(a, b, loc);
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
    /** Row parameters print as the records they stand for; labels a record shows are implied. */
    const rows = new Map(
        (scheme?.rows ?? []).map((r) => [scheme!.quantified[r.parameter]!, new Set(r.lacks)]),
    );
    const shown = new Map<number, Set<string>>();
    const show = (t: Ty, asRest = false): string => {
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
                const name = (t.tag === 'rigid' ? '!' : '') + names.get(t.id);
                return !asRest && rows.has(t.id) ? `{...${name}}` : name;
            }
            case 'con':
                return t.name + (t.args.length ? `<${t.args.map((a) => show(a)).join(', ')}>` : '');
            case 'tuple':
                return `(${t.items.map((a) => show(a)).join(', ')})`;
            case 'record': {
                const parts = t.fields.map((f) => `${f.name}: ${show(f.type)}`);
                if (t.rest) {
                    if (t.rest.tag === 'meta' || t.rest.tag === 'rigid') {
                        const labels = shown.get(t.rest.id) ?? new Set<string>();
                        t.fields.forEach((f) => labels.add(f.name));
                        shown.set(t.rest.id, labels);
                    }
                    parts.push(`...${show(t.rest, true)}`);
                }
                return `{${parts.join(', ')}}`;
            }
            case 'fn':
                return `${t.linear ? 'linear ' : ''}(${t.args.map(sf).join(', ')}) => ${sf(t.result)}`;
        }
    };
    const sf = (t: FlowTy): string =>
        t.tag === 'plain'
            ? (t.mode.tag === 'con' && t.mode.name === SHARED_NAME ? '&' : '') + show(t.value)
            : `${t.owned.tag === 'con' && t.owned.name === OWNED_LENS_NAME ? 'mut ' : ''}${show(t.read)}/${t.replaceable.tag === 'con' && t.replaceable.name === FIXED_NAME ? '=' : ''}${show(t.write)}`;
    const body = show(t);
    const parameter = (id: number) => show({ tag: 'meta', id }, true);
    const where = (scheme?.bounds ?? []).map(
        (b) => `${b.predicate}(${parameter(scheme!.quantified[b.parameter]!)})`,
    );
    for (const [id, lacks] of rows) {
        const hidden = [...lacks].filter((label) => !shown.get(id)?.has(label));
        if (hidden.length && names.has(id))
            where.push(`${parameter(id)} lacks ${hidden.join(' ')}`);
    }
    return where.length ? `${body} where ${where.join(', ')}` : body;
}
