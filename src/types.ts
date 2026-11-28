import {
    type Capture,
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
     * `capture` restricts a closure because of what it captured (see `Capture`). It is decided
     * where the closure is written, never inferred.
     * `needs` is the row of dependencies a call supplies; absent means the function needs none.
     */
    | {
          tag: 'fn';
          args: FlowTy[];
          result: FlowTy;
          capture?: Capture;
          needs?: Ty;
          /** Worked out from a call, so nothing yet says what kind of function it is. */
          unstated?: true;
          /** Carried by a channel with no stated kind: the whole item decides: see `OpenKind`. */
          open?: OpenKind;
      }
    /**
     * A row of dependencies (docs/done/dependency-injection-plan.md). Unlike a record's fields, a
     * name may repeat: the first entry hides the later ones. Sorted by name, keeping the order
     * of equal names. `rest` is a row variable; a row that is only its remainder is written as
     * the variable.
     */
    | { tag: 'needs'; entries: Need[]; rest?: Ty };
/** The function types that must turn out to be of one kind, not yet chosen. */
export type OpenKind = {
    /** The most restricted kind of function sent where this one is expected. */
    floor: number;
    /** A path leaves one behind, which only a function that may be dropped allows. */
    abandoned?: true;
    members: (Ty & { tag: 'fn' })[];
};
/** A kind restricts its holder more than the ones ranked below it. */
export const kindRank = (capture: Capture | undefined): number =>
    capture === 'linear' ? 2 : capture === 'state' ? 1 : 0;
const kinds = [undefined, 'state', 'linear'] as const;
/** `from` is the offset of the `#name` that first required an entry, for diagnostics. */
export type Need = { name: string; type: Ty; from?: number };
/**
 * `replaceable` says whether the whole value of the lens can be replaced (`:=`, move-out,
 * a stored-lens argument). It is a `Ty` so that it unifies, generalizes and instantiates
 * with the existing machinery: `REPLACEABLE`, `FIXED` or a meta (see
 * docs/done/scattered-constructor-lenses.md). Every lens built before constructor lenses
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
/** Build a row of dependencies, absorbing a remainder that is already known. */
export const needs = (entries: Need[], rest?: Ty): Ty => {
    if (rest?.tag === 'needs') return needs([...entries, ...rest.entries], rest.rest);
    if (rest && !entries.length) return rest;
    // A stable sort: entries of one name keep their order.
    return { tag: 'needs', entries: [...entries].sort(byName), ...(rest ? { rest } : {}) };
};
export const NO_NEEDS: Ty = needs([]);
export const isNothing = (t: Ty | undefined): boolean =>
    !t || (t.tag === 'needs' && !t.entries.length && !t.rest);
export const fn = (args: FlowTy[], result: FlowTy, capture?: Capture, needed?: Ty): Ty => ({
    tag: 'fn',
    args,
    result,
    ...(capture ? { capture } : {}),
    ...(isNothing(needed) ? {} : { needs: needed }),
});
export const mono = (body: Ty): Scheme => ({ quantified: [], body });

const STATEFUL_CLOSURE =
    'A closure that captured a `mut` value may change it, so it is called once and cannot be shared or copied. Keep it `mut`, and pass it to a `mut` parameter that calls it exactly once on every path';

export class TypeDiagnostic extends Error {
    /** The message already says which part of a function type it is about. */
    positioned?: true | boolean;
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
                t.capture,
                t.needs && mapType(t.needs, replace),
            );
        case 'needs':
            return needs(
                t.entries.map((e) => ({ ...e, type: mapType(e.type, replace) })),
                t.rest && mapType(t.rest, replace),
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
            const copiesNoFunction = this.singleUseFunctions && predicate === 'Copyable';
            const remaining = requirements<number>(
                predicate,
                resolved,
                unions,
                linear,
                copiesNoFunction,
            );
            if (!remaining) {
                if (copiesNoFunction) {
                    // A caller with a more particular reason to refuse says so.
                    const [code, message] = diagnostic ?? [
                        'function-copy',
                        'In pure mode a function value is used once, so it cannot be copied, and neither can a value that holds one',
                    ];
                    throw new TypeDiagnostic(code, loc, message);
                }
                // Such a closure may be dropped: if dropping is fine, copying it is what failed.
                if (
                    predicate === 'Copyable' &&
                    requirements<number>('Droppable', resolved, unions, linear)
                )
                    throw new TypeDiagnostic('shared-closure', loc, STATEFUL_CLOSURE);
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
    /** Modes that fall back to something other than owned: see `openMode`. */
    private modeDefaults = new Map<number, Ty>();
    /** Row variables, metas and rigids alike, with the labels each must lack. */
    private lacks = new Map<number, Set<string>>();
    /** Variables that may not be bound while a body is checked against a limit on its needs. */
    readonly frozen = new Set<number>();
    private isRigid(t: Ty): boolean {
        return t.tag === 'rigid' || (t.tag === 'meta' && this.frozen.has(t.id));
    }
    /** Variables standing for part of a dependency's type: see `selfContained`. */
    private entryMetas = new Set<number>();
    /** Pure mode: a function value is used once, so nothing that holds one can be copied. */
    singleUseFunctions = false;
    /** Dual mode: a function stored as a dependency reads its plain arguments. */
    plainEntries = false;
    /** Variables standing for what a channel carries: any function they turn out to be is one-use. */
    private carriedMetas = new Set<number>();
    fresh(): Ty {
        return { tag: 'meta', id: this.next++ };
    }
    rigid(): Ty {
        return { tag: 'rigid', id: this.next++ };
    }
    /**
     * `value` is carried by a channel (docs/concurrency.md). A channel's type says what kind of
     * function it carries. Where nothing does, because only a call has been seen, the kind
     * stays open until the whole item shows what it does with one.
     */
    private carried(value: Ty): void {
        const t = this.prune(value);
        if (t.tag === 'meta') this.carriedMetas.add(t.id);
        else if (t.tag === 'fn') {
            if (t.unstated && !t.open) this.openKind(t, 0);
        } else if (t.tag === 'tuple') t.items.forEach((v) => this.carried(v));
        else if (t.tag === 'record') {
            t.fields.forEach((f) => this.carried(f.type));
            if (t.rest) this.carried(t.rest);
        } else if (t.tag === 'con' && t.name !== CHANNEL) t.args.forEach((v) => this.carried(v));
    }
    /**
     * `t` is part of a dependency. A function there cannot itself need dependencies, or the
     * type of what it needs could contain itself; and in dual mode a parameter nothing says is
     * `mut` only reads. This applies to whatever its variables turn out to be.
     */
    selfContained(t: Ty, loc: number): void {
        const p = this.prune(t);
        switch (p.tag) {
            case 'meta':
                this.entryMetas.add(p.id);
                return;
            case 'rigid':
                return;
            case 'fn':
                if (p.needs) this.requireNothing(p.needs, loc);
                for (const a of [...p.args, p.result])
                    if (a.tag === 'plain') this.selfContained(a.value, loc);
                    else {
                        this.selfContained(a.read, loc);
                        this.selfContained(a.write, loc);
                    }
                if (this.plainEntries)
                    for (const a of p.args)
                        if (a.tag === 'plain' && this.isUndecided(a.mode))
                            this.unifyMode(a.mode, SHARED, loc);
                return;
            case 'tuple':
                p.items.forEach((v) => this.selfContained(v, loc));
                return;
            case 'record':
                p.fields.forEach((f) => this.selfContained(f.type, loc));
                if (p.rest) this.selfContained(p.rest, loc);
                return;
            case 'con':
                p.args.forEach((v) => this.selfContained(v, loc));
                return;
            case 'needs':
                return;
        }
    }
    /** Whether a value of this type is already known to be part of a dependency. */
    isDependency(t: Ty): boolean {
        const p = this.prune(t);
        return p.tag === 'meta' && this.entryMetas.has(p.id);
    }
    private requireNothing(row: Ty, loc: number): void {
        const t = this.prune(row);
        if (t.tag === 'needs' && t.entries.length)
            throw new TypeDiagnostic(
                'needy-dependency',
                loc,
                `A function stored in a dependency cannot need dependencies itself, but this one needs ${t.entries.map((e) => e.name).join(', ')}`,
            );
        this.unify(t, NO_NEEDS, loc);
    }
    /**
     * The type of the first entry `name` of `row`, which gains one if its remainder allows.
     * `from` is where the need arose.
     */
    requireEntry(row: Ty, name: string, loc: number, from: number = loc): Ty {
        const t = this.prune(row);
        const entry = t.tag === 'needs' ? t.entries.find((e) => e.name === name) : undefined;
        if (entry) return entry.type;
        const open = t.tag === 'meta' ? t : t.tag === 'needs' ? t.rest && this.prune(t.rest) : null;
        if (!open || open.tag !== 'meta' || this.frozen.has(open.id))
            throw new TypeDiagnostic(
                'missing-dependency',
                loc,
                `The dependency ${name} is not among what this function may need`,
            );
        const type = this.fresh();
        this.unify(open, needs([{ name, type, from }], this.fresh()), loc);
        this.selfContained(type, loc);
        return type;
    }
    private unifyNeeds(a: Ty, b: Ty, loc: number): void {
        const mismatch = (): never => {
            throw new TypeDiagnostic(
                'needs-mismatch',
                loc,
                `These functions need different dependencies: ${printNeeds(this.resolve(a))} and ${printNeeds(this.resolve(b))}`,
            );
        };
        const left = this.prune(a),
            right = this.prune(b);
        if (left.tag !== 'needs' || right.tag !== 'needs') return this.unify(left, right, loc);
        // Entries of one name match in order; what is left over goes to the other remainder.
        const unmatched = (from: Need[], other: Need[]) => {
            const seen = new Map<string, number>();
            return from.filter((e) => {
                const n = seen.get(e.name) ?? 0;
                seen.set(e.name, n + 1);
                const match = other.filter((o) => o.name === e.name)[n];
                return !match;
            });
        };
        const used = new Map<string, number>();
        for (const e of left.entries) {
            const n = used.get(e.name) ?? 0;
            used.set(e.name, n + 1);
            const match = right.entries.filter((o) => o.name === e.name)[n];
            if (match) this.unify(e.type, match.type, loc);
        }
        if (this.prune(left) !== left || this.prune(right) !== right)
            return this.unifyNeeds(left, right, loc);
        const onlyLeft = unmatched(left.entries, right.entries),
            onlyRight = unmatched(right.entries, left.entries);
        const l = left.rest,
            r = right.rest;
        if (!l && !r) {
            if (onlyLeft.length || onlyRight.length) mismatch();
            return;
        }
        if (!l || !r) {
            const [open, missing, surplus] = l
                ? [l, onlyLeft, onlyRight]
                : [r!, onlyRight, onlyLeft];
            if (missing.length || open.tag !== 'meta' || this.isRigid(open)) mismatch();
            return this.unify(open, needs(surplus), loc);
        }
        if ((l.tag === 'meta' || l.tag === 'rigid') && (r.tag === 'meta' || r.tag === 'rigid'))
            if (l.id === r.id) {
                // Different leftovers on one remainder would never stop being rewritten.
                if (onlyLeft.length || onlyRight.length) mismatch();
                return;
            }
        if (!onlyLeft.length && !onlyRight.length) return this.unify(l, r, loc);
        if (this.isRigid(l) && this.isRigid(r)) mismatch();
        if (this.isRigid(l)) {
            if (onlyRight.length) mismatch();
            return this.unify(r, needs(onlyLeft, l), loc);
        }
        if (this.isRigid(r)) {
            if (onlyLeft.length) mismatch();
            return this.unify(l, needs(onlyRight, r), loc);
        }
        if (!onlyLeft.length) return this.unify(l, needs(onlyRight, r), loc);
        if (!onlyRight.length) return this.unify(r, needs(onlyLeft, l), loc);
        const tail = this.fresh();
        this.unify(l, needs(onlyRight, tail), loc);
        this.unify(r, needs(onlyLeft, tail), loc);
    }
    private openKinds = new Set<OpenKind>();
    /** Leave the kind of `t` open. Until it is chosen it is treated as must-call. */
    openKind(t: Ty & { tag: 'fn' }, floor: number): void {
        const open: OpenKind = { floor, members: [] };
        this.openKinds.add(open);
        this.join(open, t);
    }
    private join(open: OpenKind, t: Ty & { tag: 'fn' }): void {
        open.members.push(t);
        t.open = open;
        t.capture = 'linear';
        delete t.unstated;
    }
    /** A copy of a function type is of the same kind, stated or not, as the original. */
    alike(copy: Ty, original: Ty): Ty {
        if (copy.tag === 'fn' && original.tag === 'fn' && copy !== original) {
            if (original.open) this.join(original.open, copy);
            else if (original.unstated) copy.unstated = true;
        }
        return copy;
    }
    /** Choose an open kind. Nothing below what has been sent where it is expected will do. */
    stateKind(open: OpenKind, capture: Capture | undefined): void {
        if (kindRank(capture) < open.floor) return;
        this.openKinds.delete(open);
        for (const member of open.members) {
            delete member.open;
            if (capture) member.capture = capture;
            else delete member.capture;
        }
    }
    private unifyKinds(a: Ty & { tag: 'fn' }, b: Ty & { tag: 'fn' }): void {
        if (a.open && b.open) {
            if (a.open === b.open) return;
            const gone = b.open;
            a.open.floor = Math.max(a.open.floor, gone.floor);
            if (gone.abandoned) a.open.abandoned = true;
            this.openKinds.delete(gone);
            for (const member of gone.members) this.join(a.open, member);
        } else if (a.open || b.open) {
            const [open, other] = a.open ? [a.open, b] : [b.open!, a];
            if (other.unstated) this.join(open, other);
            else this.stateKind(open, other.capture);
        } else if (a.unstated !== b.unstated) {
            delete a.unstated;
            delete b.unstated;
        }
    }
    /** A value of type `t` is left behind somewhere without having been consumed. */
    abandoned(t: Ty): void {
        const p = this.prune(t);
        if (p.tag === 'fn') {
            if (p.open) p.open.abandoned = true;
        } else if (p.tag === 'tuple') p.items.forEach((v) => this.abandoned(v));
        else if (p.tag === 'record') p.fields.forEach((f) => this.abandoned(f.type));
        else if (p.tag === 'con' && p.name !== CHANNEL) p.args.forEach((v) => this.abandoned(v));
    }
    /**
     * Each open kind becomes the one that accepts the most senders among those the item's
     * uses allow: must-call if every use only calls, a closure with state if one may drop
     * it, and a reusable function if one copies it.
     */
    settleOpenKinds(): void {
        const holds = (t: Ty, open: OpenKind): boolean => {
            const p = this.prune(t);
            if (p.tag === 'fn') return p.open === open;
            if (p.tag === 'tuple') return p.items.some((v) => holds(v, open));
            if (p.tag === 'record') return p.fields.some((f) => holds(f.type, open));
            return p.tag === 'con' && p.name !== CHANNEL && p.args.some((v) => holds(v, open));
        };
        for (const open of [...this.openKinds]) {
            let allowed = open.abandoned ? 1 : 2;
            for (const { predicate, type } of this.obligations)
                if (
                    (predicate === 'Copyable' || predicate === 'Droppable') &&
                    holds(type, open)
                )
                    allowed = Math.min(allowed, predicate === 'Copyable' ? 0 : 1);
            // A sender that needs more than the uses allow is reported where the uses are.
            this.stateKind(open, kinds[Math.max(allowed, open.floor)]);
        }
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
        if (t.tag === 'needs') {
            if (!t.rest) return t;
            const rest = this.prune(t.rest);
            return rest === t.rest ? t : needs(t.entries, rest);
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
                `Expected a record, found ${printType(this.resolve(t), undefined, !this.singleUseFunctions)}`,
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
                `Expected a record, found ${printType(this.resolve(tail), undefined, !this.singleUseFunctions)}`,
            );
        for (const f of fields) this.requireLacks(tail, f.name, loc);
        return record(fields, tail);
    }
    private unifyRecords(a: Ty, b: Ty, loc: number): void {
        const mismatch = (): never => {
            throw new TypeDiagnostic(
                'type-mismatch',
                loc,
                `Cannot unify ${this.printed(a)} with ${this.printed(b)}`,
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
        /** Quantified variables that stay open in a rigid instance. */
        flexible?: ReadonlySet<number>,
    ): { type: Ty; arguments: Map<number, Ty> } {
        const vars = new Map(
            s.quantified.map((id) => [
                id,
                rigid && !flexible?.has(id) ? this.rigid() : this.fresh(),
            ]),
        );
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
        // A mode nothing decided is owned, unless it says otherwise, and it is not a type
        // parameter.
        for (const id of this.free(t))
            if (this.modeMetas.has(id) && !excluded.has(id))
                this.substitutions.set(id, this.modeDefaults.get(id) ?? OWNED);
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
    /** A mode that may still change, and is `fallback` if nothing changes it. */
    openMode(fallback: Ty): Ty {
        const mode = this.freshMode();
        this.modeDefaults.set((mode as Ty & { tag: 'meta' }).id, fallback);
        return mode;
    }
    /** Nothing says yet what this mode is, not even what it would fall back to. */
    private isUndecided(mode: Ty): boolean {
        const r = this.prune(mode);
        return r.tag === 'meta' && !this.modeDefaults.has(r.id);
    }
    /**
     * A value that was converted where it was made is now being used itself: it is what it
     * was unless something has already said otherwise, and this use converts from there.
     */
    settleOpenMode(mode: Ty): void {
        const r = this.prune(mode);
        const fallback = r.tag === 'meta' ? this.modeDefaults.get(r.id) : undefined;
        if (r.tag === 'meta' && fallback) this.substitutions.set(r.id, fallback);
    }
    /** Give every open mode nothing changed its fallback, wherever it appears. */
    settleOpenModes(): void {
        for (const [id, fallback] of this.modeDefaults) {
            const mode = this.prune({ tag: 'meta', id });
            if (mode.tag === 'meta') this.substitutions.set(mode.id, fallback);
        }
        this.modeDefaults.clear();
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
    /** An ownership mismatch between two function types names where they differ. */
    private unifyPosition(a: Ty, b: Ty, what: string, loc: number, unify: () => void): void {
        try {
            unify();
        } catch (e) {
            // The innermost function types say the most.
            if (e instanceof TypeDiagnostic && e.code === 'mode-mismatch' && !e.positioned) {
                const located = new TypeDiagnostic(
                    'mode-mismatch',
                    loc,
                    `${this.printed(a)} and ${this.printed(b)} differ in who owns ${what}: it is \`mut\` in one and shared in the other, and neither fits where the other is expected`,
                );
                located.positioned = true;
                throw located;
            }
            throw e;
        }
    }
    private printed(t: Ty): string {
        // A mode nothing has decided yet prints as what it would become.
        const settled = mapType(this.resolve(t), (v) =>
            v.tag === 'meta' && this.modeMetas.has(v.id)
                ? (this.modeDefaults.get(v.id) ?? OWNED)
                : undefined,
        );
        return printType(settled, undefined, !this.singleUseFunctions);
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
        const bindable = (t: Ty) => t.tag === 'meta' && !this.frozen.has(t.id);
        if (bindable(a) || bindable(b)) {
            const variable = (bindable(a) ? a : b) as Ty & { tag: 'meta' };
            const value = variable === a ? b : a;
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
                        `Expected a record, found ${printType(this.resolve(value), undefined, !this.singleUseFunctions)}`,
                    );
                required.forEach((label) => this.requireLacks(value, label, loc));
            }
            this.substitutions.set(variable.id, value);
            const fallback = this.modeDefaults.get(variable.id);
            if (fallback && value.tag === 'meta' && !this.modeDefaults.has(value.id))
                this.modeDefaults.set(value.id, fallback);
            if (this.entryMetas.has(variable.id)) this.selfContained(value, loc);
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
        if (a.tag === 'needs' && b.tag === 'needs') return this.unifyNeeds(a, b, loc);
        if (a.tag === 'fn' && b.tag === 'fn') {
            if (a.args.length !== b.args.length)
                throw new TypeDiagnostic(
                    'arity-mismatch',
                    loc,
                    `Expected ${a.args.length} arguments, found ${b.args.length}`,
                );
            this.unifyKinds(a, b);
            if (a.capture !== b.capture)
                throw a.capture === 'linear' || b.capture === 'linear'
                    ? new TypeDiagnostic(
                          'linear-closure-mismatch',
                          loc,
                          'A closure that captured a linear value or an owned lens must be called, or passed to a function that is known to consume it',
                      )
                    : new TypeDiagnostic(
                          'stateful-closure-mismatch',
                          loc,
                          'One of these functions captured a `mut` value, so it is called only once, and the other can be called again. They cannot be mixed yet',
                      );
            const [first, second] = [a, b];
            a.args.forEach((v, i) =>
                this.unifyPosition(first, second, `parameter ${i + 1}`, loc, () =>
                    this.unifyFlow(v, second.args[i]!, loc),
                ),
            );
            this.unifyPosition(first, second, 'the result', loc, () =>
                this.unifyFlow(first.result, second.result, loc),
            );
            this.unify(a.needs ?? NO_NEEDS, b.needs ?? NO_NEEDS, loc);
            return;
        }
        throw new TypeDiagnostic(
            'type-mismatch',
            loc,
            `Cannot unify ${this.printed(a)} with ${this.printed(b)}`,
        );
    }
}

/** A row of dependencies on its own, for diagnostics. */
const printNeeds = (row: Ty): string =>
    row.tag === 'needs'
        ? `{${[...row.entries.map((e) => e.name), ...(row.rest ? ['...'] : [])].join(', ')}}`
        : '{...}';
/**
 * Types print as they are written. `marks` is dual mode's, where `mut` says a position is
 * owned and an unmarked one is shared; pure mode writes no marks, every position being owned.
 */
export function printScheme(scheme: Scheme, marks = false): string {
    return printType(scheme.body, scheme, marks);
}

export function printType(t: Ty, scheme?: Scheme, marks = false): string {
    const names = new Map<number, string>();
    /** Row parameters print as the records they stand for; labels a record shows are implied. */
    const rows = new Map(
        (scheme?.rows ?? []).map((r) => [scheme!.quantified[r.parameter]!, new Set(r.lacks)]),
    );
    const shown = new Map<number, Set<string>>();
    /** A needs row that appears nowhere else says nothing, so it is not printed. */
    const occurrences = new Map<number, number>();
    mapType(t, function count(v): Ty | undefined {
        if (v.tag === 'meta' || v.tag === 'rigid')
            occurrences.set(v.id, (occurrences.get(v.id) ?? 0) + 1);
        return undefined;
    });
    const arrow = (row: Ty | undefined): string => {
        if (!row) return '=>';
        if ((row.tag === 'meta' || row.tag === 'rigid') && occurrences.get(row.id) === 1)
            return '=>';
        return `=${showNeeds(row)}>`;
    };
    const showNeeds = (row: Ty): string => {
        if (row.tag !== 'needs') return `{${show(row, true)}}`;
        const parts = row.entries.map((e) => `${e.name}: ${show(e.type)}`);
        if (row.rest) parts.push(`...${show(row.rest, true)}`);
        return `{${parts.join(', ')}}`;
    };
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
                return t.name + (t.args.length ? `(${t.args.map((a) => show(a)).join(', ')})` : '');
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
            case 'fn': {
                // Named in the order they are read.
                const args = `(${t.args.map(sf).join(', ')})`;
                const sign = arrow(t.needs);
                const kind = t.capture === 'state' ? 'once ' : t.capture ? 'linear ' : '';
                return `${kind}${args} ${sign} ${sf(t.result)}`;
            }
            case 'needs':
                return showNeeds(t);
        }
    };
    const sf = (t: FlowTy): string => {
        if (t.tag === 'plain') {
            // A kind that cannot be shared says the position is owned by itself.
            const kinded = t.value.tag === 'fn' && !!t.value.capture;
            const owned = t.mode.tag === 'con' && t.mode.name === OWNED_NAME;
            return (marks && owned && !kinded ? 'mut ' : '') + show(t.value);
        }
        const fixed = t.replaceable.tag === 'con' && t.replaceable.name === FIXED_NAME;
        const owned = t.owned.tag === 'con' && t.owned.name === OWNED_LENS_NAME;
        // Next to `~`, `=` or `/`, a function type needs its parentheses.
        const side = (v: Ty) => (v.tag === 'fn' ? `(${show(v)})` : show(v));
        const read = side(t.read),
            write = side(t.write);
        const lens =
            read === write
                ? `${fixed ? '=' : '~'}${read}`
                : `${read}${fixed ? '/=' : '/'}${write}`;
        return (owned ? 'mut ' : '') + lens;
    };
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
