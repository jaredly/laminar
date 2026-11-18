import type { NominalLayoutDefinition } from './layout-definitions.ts';
import { createHash } from 'node:crypto';
import { freezeTree, type SemanticFlow, type SemanticType } from './elaborated.ts';
import { BackendDiagnostic, targetKey } from './backend/target.ts';
import { LayoutTable, type Layout, type LayoutId } from './layouts.ts';
import {
    RepresentationTable,
    type LensRep,
    type LensRepId,
    type Backing,
} from './representations.ts';
import type { SpecializedProgram } from './specialize.ts';
import type { IRUnit, IRBlock, IRPattern } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import { representationKey } from './representation-key.ts';
import { verifyRepresentations } from './verify-representations.ts';

export type ValueRepresentation =
    | { kind: 'data'; layout: LayoutId }
    | { kind: 'aggregate'; items: ValueRepresentation[] }
    | { kind: 'lens'; shape: LensRepId }
    | { kind: 'local-focus'; read: ValueRepresentation; replacement: ValueRepresentation }
    | { kind: 'callable'; unit: string; function: string; captures: ValueRepresentation[] }
    | { kind: 'native'; definition: string }
    | {
          kind: 'callable-choice';
          options: Extract<ValueRepresentation, { kind: 'callable' | 'native' }>[];
      };
export type RepresentationVariant = {
    id: string;
    key: string;
    unit: string;
    function: string;
    captures: ValueRepresentation[];
    arguments: ValueRepresentation[];
    result: ValueRepresentation;
    values: {
        value: string;
        representation: ValueRepresentation;
        cleanupStorage?: {
            place: string;
            before: ValueRepresentation;
            after: ValueRepresentation;
        }[];
        cleanupJoins?: {
            place: string;
            arms: ValueRepresentation[];
            result: ValueRepresentation;
        }[];
        storageJoins?: {
            place: string;
            arms: ValueRepresentation[];
            result: ValueRepresentation;
            restoration?: 'consume' | 'replace';
        }[];
    }[];
    calls: {
        value: string;
        target: string;
        targets?: string[];
        arguments: ValueRepresentation[];
        result: ValueRepresentation;
    }[];
};
export type LensTopology = { kind: 'thin' } | { kind: 'tuple'; items: LensTopology[] };
export type EntryRepresentationArgument =
    | { kind: 'data' }
    | { kind: 'lens'; topology: LensTopology };
export type RepresentationAnalysis = {
    schemaVersion: 1;
    layoutDefinitions: readonly NominalLayoutDefinition[];
    roots: { unit: string; result: ValueRepresentation }[];
    variants: RepresentationVariant[];
    exports: {
        entry: number;
        variant: string;
        arguments: ValueRepresentation[];
        result: ValueRepresentation;
    }[];
    entries: {
        unit: string;
        values: RepresentationVariant['values'];
        calls: RepresentationVariant['calls'];
    }[];
    layouts: readonly Layout[];
    shapes: readonly LensRep[];
    backings: readonly Backing[];
};
type State = {
    values: Map<string, ValueRepresentation>;
    places: Map<string, ValueRepresentation>;
    lenses: Map<string, LensRepId>;
    finishes: Map<string, (state: State, apply: boolean) => void>;
    loanFinishes: Map<string, string>;
};

/** Infer representation variants from explicit expression roots. No physical callable ABI is selected. */
export function inferRepresentations(
    input: SpecializedProgram,
    options: {
        maxVariants?: number;
        layoutDefinitions?: readonly NominalLayoutDefinition[];
        entryArguments?: {
            unit: string;
            entry?: number;
            arguments: EntryRepresentationArgument[];
        }[];
    } = {},
): RepresentationAnalysis {
    // Operate on a detached verified snapshot, including when the caller deserialized it.
    const source = freezeTree(structuredClone(input));
    verifyTypedProgram(source.program);
    const limit = options.maxVariants ?? 256;
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new BackendDiagnostic(
            'invalid-representation-budget',
            'Representation budget must be a positive integer',
        );
    const entryContracts = options.entryArguments ?? [];
    if (
        entryContracts.some(
            (e) =>
                !source.roots.includes(e.unit) ||
                (e.entry !== undefined &&
                    (!Number.isInteger(e.entry) || source.roots[e.entry] !== e.unit)),
        ) ||
        source.roots.some(
            (id, i) =>
                entryContracts.filter(
                    (e) => e.unit === id && (e.entry === undefined || e.entry === i),
                ).length > 1,
        )
    )
        throw new BackendDiagnostic(
            'invalid-entry-contract',
            'Entry contracts must identify requested roots without overlap',
        );
    const layouts = new LayoutTable(source.target, options.layoutDefinitions),
        reps = new RepresentationTable(layouts);
    const units = new Map(source.program.units.map((u) => [u.id, u]));
    const definitions = new Map(
        source.program.units.filter((u) => u.definition).map((u) => [u.definition!, u]),
    );
    const variants = new Map<
        string,
        Omit<RepresentationVariant, 'result'> & { result?: ValueRepresentation }
    >();
    const entries: RepresentationAnalysis['entries'] = [];
    const roots: RepresentationAnalysis['roots'] = [];
    const exports: RepresentationAnalysis['exports'] = [];
    const fresh = (): State => ({
        values: new Map(),
        places: new Map(),
        lenses: new Map(),
        finishes: new Map(),
        loanFinishes: new Map(),
    });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        places: new Map(s.places),
        lenses: new Map(s.lenses),
        finishes: new Map(s.finishes),
        loanFinishes: new Map(s.loanFinishes),
    });
    const fail = (message: string): never => {
        throw new BackendDiagnostic('unsupported-representation', message);
    };
    const containsCallable = (t: SemanticType): boolean =>
        t.tag === 'fn' || (t.tag === 'tuple' && t.items.some(containsCallable));
    const data = (type: SemanticType): ValueRepresentation => ({
        kind: 'data',
        layout: layouts.intern(type),
    });
    const get = (s: State, id: string): ValueRepresentation =>
        s.values.get(id) ?? fail(`Missing representation for ${id}`);
    const shape = (v: ValueRepresentation): LensRepId =>
        v.kind === 'lens' ? v.shape : fail('Expected lens representation');
    const key = representationKey;
    const equal = (a: ValueRepresentation, b: ValueRepresentation) => key(a) === key(b);
    const join = (items: ValueRepresentation[], aggregate = false): ValueRepresentation => {
        const first = items[0] ?? fail('Empty representation join');
        if (items.every((v) => equal(first, v))) return first;
        if (
            items.every(
                (v) => v.kind === 'callable' || v.kind === 'native' || v.kind === 'callable-choice',
            )
        ) {
            const options = new Map<
                string,
                Extract<ValueRepresentation, { kind: 'callable' | 'native' }>
            >();
            for (const v of items) {
                const members = v.kind === 'callable-choice' ? v.options : [v];
                for (const member of members) {
                    if (member.kind !== 'callable' && member.kind !== 'native')
                        return fail('Invalid callable join member');
                    options.set(key(member), member);
                }
            }
            return {
                kind: 'callable-choice',
                options: [...options.entries()]
                    .sort(([a], [b]) => (a < b ? -1 : 1))
                    .map(([, v]) => v),
            };
        }
        if (
            aggregate &&
            first.kind === 'aggregate' &&
            items.every((v) => v.kind === 'aggregate' && v.items.length === first.items.length)
        )
            return {
                kind: 'aggregate',
                items: first.items.map((_, index) =>
                    join(
                        items.map(
                            (v) =>
                                (v as Extract<ValueRepresentation, { kind: 'aggregate' }>).items[
                                    index
                                ]!,
                        ),
                        true,
                    ),
                ),
            };
        throw new BackendDiagnostic(
            'unsupported-representation-join',
            'Different value representations require an adapter',
        );
    };
    // Preserve topology while revising typed backing endpoints after a move or update.
    const retype = (id: LensRepId, read: SemanticType, write: SemanticType): LensRepId => {
        const r = reps.get(id);
        if (r.kind === 'thin') return reps.thin(read, write);
        if (
            read.tag !== 'tuple' ||
            write.tag !== 'tuple' ||
            read.items.length !== r.items.length ||
            write.items.length !== r.items.length
        )
            return fail('Scattered lens topology changed across a storage transition');
        return reps.tuple(
            r.items.map((child, i) => retype(child, read.items[i]!, write.items[i]!)),
        );
    };
    const projectValue = (v: ValueRepresentation, path: number[]): ValueRepresentation => {
        if (!path.length) return v;
        if (v.kind === 'aggregate')
            return projectValue(
                v.items[path[0]!] ?? fail('Invalid aggregate projection'),
                path.slice(1),
            );
        if (v.kind !== 'data')
            return fail('Projection of a callable aggregate requires a callable layout');
        let type = layouts.get(v.layout).type;
        for (const i of path) {
            if (type.tag !== 'tuple' || !type.items[i])
                return fail('Invalid representation projection');
            type = type.items[i]!;
        }
        return data(type);
    };
    const bind = (p: IRPattern, v: ValueRepresentation, s: State): void => {
        if (p.kind === 'bind') s.places.set(p.slot.place, v);
        else if (p.kind === 'tuple')
            p.items.forEach((child, i) => bind(child, projectValue(v, [i]), s));
        else if (p.kind === 'constructor') {
            if (v.kind !== 'data') return fail('Constructor pattern needs data storage');
            // Constructor semantic field types are checked independently against import schemas.
            p.items.forEach((child) => bind(child, data(child.type), s));
        }
    };
    const nativeCall = (
        name: string,
        args: ValueRepresentation[],
        type: SemanticFlow,
    ): ValueRepresentation => {
        if (type.tag === 'plain') return data(type.value);
        if (name === 'native/fst' && args[0])
            return {
                kind: 'lens',
                shape: retype(reps.project(shape(args[0]), 0), type.read, type.write),
            };
        return fail(`No returned-lens representation contract for ${name}`);
    };
    const invoke = (
        callee: ValueRepresentation,
        args: ValueRepresentation[],
        chain: string[],
        resultType?: SemanticFlow,
    ): { target: string; targets?: string[]; result: ValueRepresentation } => {
        if (callee.kind === 'native')
            return {
                target: callee.definition,
                result: nativeCall(
                    callee.definition,
                    args,
                    resultType ?? fail('Missing native result contract'),
                ),
            };
        if (callee.kind === 'callable-choice') {
            const calls = callee.options.map((option) => invoke(option, args, chain, resultType));
            const results = calls.map((call) => call.result);
            let result: ValueRepresentation;
            if (
                results.every((r) => r.kind === 'lens') &&
                results.some((r) => !equal(r, results[0]!))
            ) {
                if (resultType?.tag !== 'flow') return fail('Missing dynamic lens result contract');
                result = { kind: 'lens', shape: reps.thin(resultType.read, resultType.write) };
            } else result = join(results, true);
            const targets = calls.map((call) => call.target);
            return { target: JSON.stringify(['dispatch', targets]), targets, result };
        }
        if (callee.kind !== 'callable')
            return fail('Indirect call requires a known callable representation');
        const unit = units.get(callee.unit) ?? fail('Unknown callable unit');
        const fn =
            unit.functions.find((f) => f.id === callee.function) ?? fail('Unknown callable body');
        const identity = JSON.stringify([unit.id, fn.id]);
        const variantKey = JSON.stringify([
            'representation-variant',
            targetKey(source.target),
            identity,
            callee.captures.map(key),
            args.map(key),
        ]);
        const cached = variants.get(variantKey);
        if (cached)
            return {
                target: cached.id,
                result:
                    cached.result ??
                    fail('Recursive returned representation requires a result constraint'),
            };
        if (chain.includes(identity))
            throw new BackendDiagnostic(
                'changing-representation-recursion',
                `Changing representation recursion: ${[...chain, identity].join(' -> ')}`,
            );
        if (variants.size >= limit)
            throw new BackendDiagnostic(
                'representation-budget',
                `Representation budget ${limit} exceeded: ${[...chain, identity].join(' -> ')}`,
            );
        const variant: Omit<RepresentationVariant, 'result'> & { result?: ValueRepresentation } = {
            id: `rep_${createHash('sha256').update(variantKey).digest('hex')}`,
            key: variantKey,
            unit: unit.id,
            function: fn.id,
            captures: callee.captures,
            arguments: args,
            values: [],
            calls: [],
        };
        // Scalar/tuple results have known layouts even before a recursive body is visited.
        if (fn.type.result.tag === 'plain' && !containsCallable(fn.type.result.value))
            variant.result = data(fn.type.result.value);
        variants.set(variantKey, variant);
        const state = fresh();
        fn.captures.forEach((c, i) => state.places.set(c.place, callee.captures[i]!));
        fn.parameters.forEach((p, i) => {
            const arg = args[i] ?? fail('Missing argument representation');
            if (p.lensPlace) state.lenses.set(p.lensPlace, shape(arg));
            else bind(p.pattern, arg, state);
        });
        const result = block(unit, fn.body, state, variant, [...chain, identity]);
        if (variant.result && !equal(variant.result, result))
            return fail('Function result representation disagrees with its semantic layout');
        variant.result = result;
        return { target: variant.id, result };
    };
    function block(
        unit: IRUnit,
        body: IRBlock,
        s: State,
        record: Pick<RepresentationVariant, 'values' | 'calls'>,
        chain: string[],
    ): ValueRepresentation {
        // Cleanup is a separate executable region. Its data moves carry the
        // restoration-time types verified by typed IR, rather than setup types.
        // Callable dependencies retain their protected lexical provenance.
        const deferred: { value: string; body: IRBlock }[] = [];
        const localFocusPlaces = new Map<string, string>();

        function deferredStorageUse(
            body: IRBlock,
            place: string,
            delayed = false,
            writes = false,
        ): boolean {
            const actionUses = (actions: IRBlock['cleanup'] | undefined) =>
                actions?.some((a) =>
                    a.kind === 'release'
                        ? unit.loans.some(
                              (l) =>
                                  l.id === a.loan &&
                                  (l.place === place || l.owners?.some((s) => s.place === place)),
                          )
                        : a.slot.place === place && (!writes || a.kind !== 'drop-place'),
                ) ?? false;
            const result = record.values.find((v) => v.value === body.result)?.representation;
            if ((delayed || result?.kind === 'lens') && actionUses(body.cleanup)) return true;
            return body.instructions.some((i) => {
                if (
                    delayed &&
                    (i.op === 'acquire' || (!writes && i.op === 'move')) &&
                    i.slot.place === place
                )
                    return true;
                if (i.op === 'manual')
                    return (
                        (!writes && i.holds.some((s) => s.place === place)) ||
                        deferredStorageUse(i.cleanup, place, true, writes)
                    );
                if (i.op === 'scope') return deferredStorageUse(i.body, place, delayed, writes);
                if (i.op === 'case')
                    return i.cases.some(
                        (arm) =>
                            deferredStorageUse(arm.body, place, delayed, writes) ||
                            actionUses(arm.restored) ||
                            (delayed && actionUses(arm.setup)),
                    );
                return false;
            });
        }
        for (const i of body.instructions) {
            if (i.op === 'bind') {
                bind(i.pattern, get(s, i.value), s);
                continue;
            }
            if (i.op === 'borrow') {
                const loan = unit.loans.find((l) => l.id === i.loan)!;
                if (loan.owners) s.lenses.set(loan.place, shape(get(s, i.lens)));
                s.loanFinishes.set(i.loan, i.lens);
                continue;
            }
            let out: ValueRepresentation;
            const storageJoins: NonNullable<
                RepresentationVariant['values'][number]['storageJoins']
            > = [];
            switch (i.op) {
                case 'constant':
                case 'string':
                case 'construct':
                    if (i.out.type.tag !== 'plain') return fail('Data instruction produced a lens');
                    out = data(i.out.type.value);
                    break;
                case 'tuple':
                    if (i.out.type.tag !== 'plain') return fail('Tuple produced a lens');
                    out = containsCallable(i.out.type.value)
                        ? { kind: 'aggregate', items: i.items.map((id) => get(s, id)) }
                        : data(i.out.type.value);
                    break;
                case 'move': {
                    const value = s.places.get(i.slot.place);
                    out =
                        value && value.kind !== 'data'
                            ? projectValue(value, i.slot.path)
                            : i.out.type.tag === 'plain'
                              ? data(i.out.type.value)
                              : fail('Move produced a lens');
                    // Data layouts may have changed since the binding; annotations describe current storage.
                    if (out.kind === 'data' && i.out.type.tag === 'plain')
                        out = data(i.out.type.value);
                    break;
                }
                case 'acquire': {
                    if (i.out.type.tag !== 'flow') return fail('Acquire produced data');
                    if (containsCallable(i.out.type.read) || containsCallable(i.out.type.write)) {
                        if (
                            i.slot.path.length ||
                            s.lenses.has(i.slot.place) ||
                            unit.loans.some((l) => l.place === i.slot.place) ||
                            body.instructions.filter(
                                (use) => use.op === 'swap' && use.lens === i.out.id,
                            ).length !== 1
                        )
                            return fail('Callable focuses require a direct whole-owned-local swap');
                        const stored = s.places.get(i.slot.place);
                        const read = containsCallable(i.out.type.read)
                            ? (stored ?? fail('Callable focus lacks owned provenance'))
                            : data(i.out.type.read);
                        // The only consumer is the direct swap below. Resolve replacement
                        // provenance after its ordered RHS has been analyzed.
                        out = { kind: 'local-focus', read, replacement: read };
                        localFocusPlaces.set(i.out.id, i.slot.place);
                        break;
                    }
                    let base = s.lenses.get(i.slot.place);
                    if (base) for (const index of i.slot.path) base = reps.project(base, index);
                    out = {
                        kind: 'lens',
                        shape: base
                            ? retype(base, i.out.type.read, i.out.type.write)
                            : reps.thin(i.out.type.read, i.out.type.write),
                    };
                    break;
                }
                case 'manual': {
                    if (i.out.type.tag !== 'flow') return fail('Manual produced data');
                    out = {
                        kind: 'lens',
                        shape: retype(shape(get(s, i.lens)), i.out.type.read, i.out.type.write),
                    };
                    const frontendFinish = s.finishes.get(i.lens);
                    // Analyze each retained region once. A release reuses its verified
                    // descriptor effects without replaying SSA/call annotations.
                    let analyzed = false;
                    const finish = (state: State, apply: boolean) => {
                        const annotation = record.values.find((v) => v.value === i.out.id)!;
                        if (!analyzed) {
                            analyzed = true;
                            const restored = clone(state);
                            block(unit, i.cleanup, restored, record, chain);
                            const transitions = [...state.places].flatMap(([place, before]) => {
                                const after = restored.places.get(place)!;
                                return equal(before, after) ? [] : [{ place, before, after }];
                            });
                            if (transitions.length) annotation.cleanupStorage = transitions;
                        }
                        if (apply) {
                            annotation.cleanupStorage?.forEach(({ place, before, after }) => {
                                if (!equal(state.places.get(place)!, before))
                                    fail('Cleanup storage input provenance changed');
                                state.places.set(place, after);
                            });
                            frontendFinish?.(state, true);
                        }
                    };
                    s.finishes.set(i.out.id, finish);
                    deferred.push({ value: i.out.id, body: i.cleanup });
                    break;
                }
                case 'lens-tuple': {
                    out = {
                        kind: 'lens',
                        shape: reps.tuple(i.items.map((id) => shape(get(s, id)))),
                    };
                    // Capture member handlers before forwarding this value through
                    // scopes; their local IDs need not exist in the release state.
                    const finishes = i.items.map((id) => s.finishes.get(id));
                    if (finishes.some(Boolean))
                        s.finishes.set(i.out.id, (state, apply) =>
                            finishes.forEach((finish) => finish?.(state, apply)),
                        );
                    break;
                }
                case 'swap': {
                    if (i.out.type.tag !== 'plain') return fail('Swap produced a lens');
                    const focus = get(s, i.lens);
                    if (focus.kind === 'local-focus') {
                        focus.replacement = get(s, i.value);
                        out = focus.read;
                        s.places.set(
                            localFocusPlaces.get(i.lens) ?? fail('Nonlocal callable focus swap'),
                            focus.replacement,
                        );
                    } else out = data(i.out.type.value);
                    s.finishes.get(i.lens)?.(s, true);
                    break;
                }
                case 'global': {
                    const target = definitions.get(i.instance.definition);
                    if (!target) {
                        out = { kind: 'native', definition: i.instance.definition };
                        break;
                    }
                    const closure = target.entry.instructions[0];
                    if (closure?.op !== 'closure' || closure.captures.length)
                        return fail('Reusable definition lacks a closed entry');
                    out = {
                        kind: 'callable',
                        unit: target.id,
                        function: closure.function,
                        captures: [],
                    };
                    break;
                }
                case 'closure':
                    out = {
                        kind: 'callable',
                        unit: unit.id,
                        function: i.function,
                        captures: i.captures.map((c) => get(s, c.value)),
                    };
                    break;
                case 'call': {
                    const callee = get(s, i.callee),
                        args = i.args.map((id) => get(s, id));
                    const called =
                        callee.kind === 'native'
                            ? {
                                  target: callee.definition,
                                  result: nativeCall(callee.definition, args, i.out.type),
                              }
                            : invoke(callee, args, chain, i.out.type);
                    out = called.result;
                    record.calls.push({
                        value: i.out.id,
                        target: called.target,
                        ...('targets' in called ? { targets: called.targets } : {}),
                        arguments: args,
                        result: out,
                    });
                    // Returned lenses retain argument backing and its completion;
                    // plain calls complete argument adapters before continuation.
                    const finishes = i.args.map((id) => s.finishes.get(id));
                    if (i.out.type.tag === 'flow') {
                        if (finishes.some(Boolean))
                            s.finishes.set(i.out.id, (state, apply) =>
                                finishes.forEach((finish) => finish?.(state, apply)),
                            );
                    } else finishes.forEach((finish) => finish?.(s, true));
                    break;
                }
                case 'scope': {
                    const nested = clone(s);
                    out = block(unit, i.body, nested, record, chain);
                    s.places.forEach((_, place) => s.places.set(place, nested.places.get(place)!));
                    const finish = nested.finishes.get(i.body.result);
                    if (finish) s.finishes.set(i.out.id, finish);
                    break;
                }
                case 'case': {
                    const states: State[] = [];
                    const branches = i.cases.map((arm) => {
                        const state = clone(s);
                        bind(arm.pattern, get(s, i.value), state);
                        const result = block(unit, arm.body, state, record, chain);
                        states.push(state);
                        return result;
                    });
                    s.places.forEach((_, place) => {
                        const current = (
                            states[0] ?? fail('Branch has no storage continuation')
                        ).places.get(place)!;
                        if (states.some((state) => !equal(current, state.places.get(place)!))) {
                            const uses = (writes = false) =>
                                i.out.type.tag === 'flow' &&
                                i.cases.some((arm) =>
                                    deferredStorageUse(
                                        {
                                            ...arm.body,
                                            cleanup: [...arm.body.cleanup, ...(arm.restored ?? [])],
                                        },
                                        place,
                                        false,
                                        writes,
                                    ),
                                );
                            const restoration = uses(true)
                                ? ('replace' as const)
                                : uses()
                                  ? ('consume' as const)
                                  : undefined;
                            const arms = states.map((state) => state.places.get(place)!);
                            const result = join(arms, true);
                            storageJoins.push({
                                place,
                                arms,
                                result,
                                ...(restoration ? { restoration } : {}),
                            });
                            s.places.set(place, result);
                        } else s.places.set(place, current);
                    });
                    out =
                        i.out.type.tag === 'flow'
                            ? { kind: 'lens', shape: reps.thin(i.out.type.read, i.out.type.write) }
                            : join(branches, true);
                    if (i.out.type.tag === 'flow') {
                        const finishes = i.cases.map((arm, n) =>
                            states[n]!.finishes.get(arm.body.result),
                        );
                        if (storageJoins.some((j) => j.restoration === 'replace'))
                            i.cases.forEach((arm, n) => {
                                if (
                                    !finishes[n] &&
                                    storageJoins.some(
                                        (j) =>
                                            j.restoration === 'replace' &&
                                            deferredStorageUse(
                                                {
                                                    ...arm.body,
                                                    cleanup: [
                                                        ...arm.body.cleanup,
                                                        ...(arm.restored ?? []),
                                                    ],
                                                },
                                                j.place,
                                                false,
                                                true,
                                            ),
                                    )
                                )
                                    fail(
                                        'Deferred callable storage replacement requires a restoration adapter',
                                    );
                            });
                        // Complete against current owner versions, keeping each arm's
                        // private state. Post-cleanup unions are separate from setup
                        // joins so original cleanup keeps its exact representation.
                        const places = [...s.places.keys()];
                        if (finishes.some(Boolean))
                            s.finishes.set(i.out.id, (current, apply) => {
                                if (!apply) return;
                                const completed = states.map((setup, n) => {
                                    const restored = clone(setup);
                                    places.forEach((place) =>
                                        restored.places.set(place, current.places.get(place)!),
                                    );
                                    storageJoins
                                        .filter((j) => j.restoration === 'replace')
                                        .forEach((j) =>
                                            restored.places.set(
                                                j.place,
                                                setup.places.get(j.place)!,
                                            ),
                                        );
                                    finishes[n]?.(restored, true);
                                    return restored;
                                });
                                const joins: NonNullable<
                                    RepresentationVariant['values'][number]['cleanupJoins']
                                > = [];
                                const merged = places.map((place) => {
                                    const arms = completed.map((state) => state.places.get(place)!);
                                    const result = join(arms, true);
                                    if (
                                        arms.some((arm) => !equal(arm, arms[0]!)) ||
                                        storageJoins.some(
                                            (j) => j.place === place && j.restoration === 'replace',
                                        )
                                    )
                                        joins.push({ place, arms, result });
                                    return [place, result] as const;
                                });
                                const annotation = record.values.find((v) => v.value === i.out.id)!;
                                if (joins.length) annotation.cleanupJoins = joins;
                                merged.forEach(([place, result]) =>
                                    current.places.set(place, result),
                                );
                            });
                    }
                    break;
                }
            }
            s.values.set(i.out.id, out);
            record.values.push({
                value: i.out.id,
                representation: out,
                ...(storageJoins.length ? { storageJoins } : {}),
            });
        }
        const result = get(s, body.result);
        // A plain block releases its lexical loans before its caller continues.
        // Lens results defer those releases; analyze remaining regions without
        // applying their effects to setup state.
        if (result.kind !== 'lens' && result.kind !== 'local-focus')
            for (const action of body.cleanup)
                if (action.kind === 'release') {
                    const value = s.loanFinishes.get(action.loan);
                    if (value) s.finishes.get(value)?.(s, true);
                }
        for (const cleanup of deferred.reverse()) s.finishes.get(cleanup.value)!(s, false);
        return result;
    }
    for (const [rootIndex, id] of source.roots.entries()) {
        const unit = units.get(id) ?? fail('Unknown representation root');
        const entry = {
            unit: id,
            values: [] as RepresentationVariant['values'],
            calls: [] as RepresentationVariant['calls'],
        };
        const result = block(unit, unit.entry, fresh(), entry, []);
        const incoming = options.entryArguments?.find(
            (e) => e.unit === id && (e.entry === undefined || e.entry === rootIndex),
        );
        if (result.kind === 'callable-choice')
            fail('Dynamic callable entry roots require a host adapter');
        if (result.kind === 'native') fail('Native entry roots require a host contract');
        if (result.kind === 'callable') {
            const contract =
                incoming ??
                fail('Callable entry roots require an explicit argument representation contract');
            const fn = units.get(result.unit)!.functions.find((f) => f.id === result.function)!;
            if (contract.arguments.length !== fn.type.args.length)
                fail('Entry representation argument arity mismatch');
            const topology = (
                t: LensTopology,
                read: SemanticType,
                write: SemanticType,
            ): LensRepId => {
                if (t.kind === 'thin') return reps.thin(read, write);
                if (
                    read.tag !== 'tuple' ||
                    write.tag !== 'tuple' ||
                    t.items.length !== read.items.length ||
                    t.items.length !== write.items.length
                )
                    return fail('Entry lens topology does not match semantic endpoints');
                return reps.tuple(
                    t.items.map((child, i) => topology(child, read.items[i]!, write.items[i]!)),
                );
            };
            const args = contract.arguments.map((a, i): ValueRepresentation => {
                const expected = fn.type.args[i]!;
                if (a.kind === 'data' && expected.tag === 'plain') return data(expected.value);
                if (a.kind === 'lens' && expected.tag === 'flow')
                    return {
                        kind: 'lens',
                        shape: topology(a.topology, expected.read, expected.write),
                    };
                return fail('Entry argument representation mode mismatch');
            });
            const called = invoke(result, args, []);
            exports.push({
                entry: roots.length,
                variant: called.target,
                arguments: args,
                result: called.result,
            });
        } else if (incoming) fail('Expression root cannot have incoming arguments');
        entries.push(entry);
        roots.push({ unit: id, result });
    }
    const analysis: RepresentationAnalysis = {
        schemaVersion: 1,
        layoutDefinitions: layouts.definitions,
        roots,
        entries,
        exports,
        variants: [...variants.values()]
            .map((v) => ({ ...v, result: v.result ?? fail('Unsolved variant result') }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        layouts: layouts.snapshot(),
        shapes: reps.snapshot(),
        backings: reps.backingSnapshot(),
    };
    for (const record of [...analysis.entries, ...analysis.variants])
        for (const value of record.values)
            if (
                value.storageJoins?.some(
                    (j) =>
                        j.restoration === 'replace' &&
                        !value.cleanupJoins?.some((after) => after.place === j.place),
                )
            )
                fail(
                    'Deferred callable storage replacement requires a completed restoration contract',
                );
    verifyRepresentations(source, analysis);
    return freezeTree(analysis);
}
