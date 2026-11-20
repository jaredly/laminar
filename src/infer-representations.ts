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
    | {
          kind: 'focus-manual';
          read: ValueRepresentation;
          replacement: ValueRepresentation;
          frontend: ValueRepresentation;
      }
    | { kind: 'local-focus'; read: ValueRepresentation; replacement: ValueRepresentation }
    | {
          kind: 'focus-tuple';
          read: ValueRepresentation;
          replacement: ValueRepresentation;
          items: ValueRepresentation[];
      }
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
    resultDemand?: ValueRepresentation;
    values: {
        value: string;
        representation: ValueRepresentation;
        retainedStorage?: { place: string; representation: ValueRepresentation }[];
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
        demand?: {
            value?: string;
            loan?: string;
            consumer?: string;
            replacement: ValueRepresentation;
        };
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
type FocusTarget =
    | { value: Extract<ValueRepresentation, { kind: 'focus-manual' }>; inner: FocusTarget }
    | { value: ValueRepresentation; place: string; path: number[] }
    | { value: ValueRepresentation; items: FocusTarget[] };
type State = {
    values: Map<string, ValueRepresentation>;
    places: Map<string, ValueRepresentation>;
    lenses: Map<string, LensRepId>;
    focusOwners: Map<string, { place: string; path: number[] }>;
    focusWrites: Map<string, SemanticType>;
    callResults: Map<string, FocusTarget>;
    /** Focuses whose replacement is installed only by their own completion: callee-private returned backing and branch-selected focuses. */
    deferredFocuses: Set<string>;
    nativeProjections: Set<string>;
    focusTargets: Map<string, FocusTarget>;
    dataOwners: Map<string, { place: string; path: number[] }>;
    finishes: Map<string, (state: State, apply: boolean) => void>;
    loanFinishes: Map<string, string>;
};

/** Infer representation variants from explicit expression roots. No physical callable ABI is selected. */
/** Raised while seeding a recursive fixed point: the arm is treated as divergent. */
class RecursionPending extends Error {}
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
    // Returned callable focuses whose replacement demand awaits its consumer.
    const pendingDemands = new Set<RepresentationVariant['calls'][number]>();
    const entries: RepresentationAnalysis['entries'] = [];
    const roots: RepresentationAnalysis['roots'] = [];
    const exports: RepresentationAnalysis['exports'] = [];
    const fresh = (): State => ({
        values: new Map(),
        places: new Map(),
        lenses: new Map(),
        focusOwners: new Map(),
        focusWrites: new Map(),
        callResults: new Map(),
        deferredFocuses: new Set(),
        nativeProjections: new Set(),
        focusTargets: new Map(),
        dataOwners: new Map(),
        finishes: new Map(),
        loanFinishes: new Map(),
    });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        places: new Map(s.places),
        lenses: new Map(s.lenses),
        focusOwners: new Map(s.focusOwners),
        focusWrites: new Map(s.focusWrites),
        callResults: new Map(s.callResults),
        deferredFocuses: new Set(s.deferredFocuses),
        nativeProjections: new Set(s.nativeProjections),
        focusTargets: new Map(s.focusTargets),
        dataOwners: new Map(s.dataOwners),
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
    function replaceValue(
        v: ValueRepresentation,
        path: number[],
        replacement: ValueRepresentation,
    ): ValueRepresentation {
        if (!path.length) return replacement;
        const members =
            v.kind === 'aggregate'
                ? [...v.items]
                : v.kind === 'data' && layouts.get(v.layout).type.tag === 'tuple'
                  ? (layouts.get(v.layout).type as SemanticType & { tag: 'tuple' }).items.map(data)
                  : fail('Invalid focus owner projection');
        const index = path[0]!;
        members[index] = replaceValue(
            members[index] ?? fail('Invalid focus owner projection'),
            path.slice(1),
            replacement,
        );
        return members.every((m) => m.kind === 'data')
            ? data({
                  tag: 'tuple',
                  items: members.map(
                      (m) =>
                          layouts.get((m as Extract<ValueRepresentation, { kind: 'data' }>).layout)
                              .type,
                  ),
              })
            : { kind: 'aggregate', items: members };
    }
    function tupleValue(items: ValueRepresentation[]): ValueRepresentation {
        return items.every((v) => v.kind === 'data')
            ? data({
                  tag: 'tuple',
                  items: items.map(
                      (v) =>
                          layouts.get((v as Extract<ValueRepresentation, { kind: 'data' }>).layout)
                              .type,
                  ),
              })
            : { kind: 'aggregate', items };
    }
    function focusEndpoint(value: ValueRepresentation, replacement = false): ValueRepresentation {
        if (
            value.kind === 'local-focus' ||
            value.kind === 'focus-tuple' ||
            value.kind === 'focus-manual'
        )
            return replacement ? value.replacement : value.read;
        if (value.kind !== 'lens') return fail('Missing scattered focus endpoint');
        const r = reps.get(value.shape);
        return data(layouts.get(replacement ? r.replacement : r.read).type);
    }
    function readTarget(
        target: FocusTarget,
        state: State,
        expected: SemanticType,
    ): ValueRepresentation {
        if (!containsCallable(expected)) return data(expected);
        if ('inner' in target) return readTarget(target.inner, state, expected);
        if ('items' in target) {
            if (expected.tag !== 'tuple') return fail('Scattered focus semantic topology changed');
            return tupleValue(
                target.items.map((child, i) => readTarget(child, state, expected.items[i]!)),
            );
        }
        return projectValue(state.places.get(target.place)!, target.path);
    }
    function targetPlaces(target: FocusTarget): string[] {
        if ('inner' in target) return targetPlaces(target.inner);
        if ('items' in target) return target.items.flatMap(targetPlaces);
        return [target.place];
    }
    function enclosingTarget(target: FocusTarget, state: State): boolean {
        if ('inner' in target) return enclosingTarget(target.inner, state);
        if ('items' in target) return target.items.every((child) => enclosingTarget(child, state));
        return state.places.has(target.place);
    }
    function targetFor(state: State, id: string): FocusTarget | undefined {
        const existing = state.callResults.get(id) ?? state.focusTargets.get(id);
        if (existing) return existing;
        const owner = state.focusOwners.get(id) ?? state.dataOwners.get(id);
        return owner && { value: get(state, id), ...owner };
    }
    function writeTarget(target: FocusTarget, value: ValueRepresentation, state: State): void {
        if ('inner' in target) {
            target.value.replacement = value;
            writeTarget(target.inner, value, state);
        } else if ('items' in target) {
            if (target.value.kind === 'focus-tuple') target.value.replacement = value;
            target.items.forEach((child, i) => writeTarget(child, projectValue(value, [i]), state));
        } else {
            if (target.value.kind === 'local-focus') target.value.replacement = value;
            state.places.set(
                target.place,
                replaceValue(state.places.get(target.place)!, target.path, value),
            );
        }
    }
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
        if (
            name === 'native/fst' &&
            (args[0]?.kind === 'focus-tuple' || args[0]?.kind === 'focus-manual')
        ) {
            const child = scatteredTuple(args[0]).items[0] ?? fail('Missing fst focus child');
            // Manual cleanup later rewrites its frontend children to their post-cleanup
            // descriptors, so the projection keeps its own replacement endpoint.
            return args[0].kind === 'focus-manual' ? structuredClone(child) : child;
        }
        if (name === 'native/fst' && args[0]?.kind === 'local-focus') {
            if (!containsCallable(type.read) && !containsCallable(type.write))
                return { kind: 'lens', shape: reps.thin(type.read, type.write) };
            const read = projectValue(args[0].read, [0]);
            return { kind: 'local-focus', read, replacement: read };
        }
        if (name === 'native/fst' && args[0])
            return {
                kind: 'lens',
                shape: retype(reps.project(shape(args[0]), 0), type.read, type.write),
            };
        return fail(`No returned-lens representation contract for ${name}`);
    };
    /** The parent replacement after `fst` completes over a frontend without a local owner. */
    const fstParentReplacement = (
        read: ValueRepresentation,
        write: SemanticType,
        projection: ValueRepresentation,
        type: SemanticFlow,
    ): ValueRepresentation =>
        !containsCallable(write)
            ? data(write)
            : replaceValue(
                  read,
                  [0],
                  projection.kind === 'local-focus'
                      ? projection.replacement
                      : type.tag === 'flow'
                        ? data(type.write)
                        : fail('Callable fst projection lacks a flow type'),
              );
    /** A scattered focus beneath any manual wrappers; `fst` projects its first child
     * while the wrappers' cleanup runs after projection completion. */
    const scatteredTuple = (
        v: ValueRepresentation,
    ): Extract<ValueRepresentation, { kind: 'focus-tuple' }> =>
        v.kind === 'focus-manual'
            ? scatteredTuple(v.frontend)
            : v.kind === 'focus-tuple'
              ? v
              : fail('Expected a scattered callable focus');
    const isFocus = (
        v: ValueRepresentation,
    ): v is Extract<
        ValueRepresentation,
        { kind: 'local-focus' | 'focus-tuple' | 'focus-manual' }
    > => v.kind === 'local-focus' || v.kind === 'focus-tuple' || v.kind === 'focus-manual';
    function setContract(v: ValueRepresentation, replacement: ValueRepresentation): void {
        if (v.kind === 'local-focus') v.replacement = replacement;
        else if (v.kind === 'focus-tuple') {
            v.replacement = replacement;
            v.items.forEach((child, i) => setContract(child, projectValue(replacement, [i])));
        } else if (v.kind !== 'lens')
            return fail('Manual callable parameter demands require a completion adapter');
    }
    function projectedTarget(target: FocusTarget, path: number[]): FocusTarget {
        if (!path.length) return target;
        if ('inner' in target)
            return fail('Manual callable parameter demands require a completion adapter');
        if ('items' in target)
            return projectedTarget(
                target.items[path[0]!] ?? fail('Invalid demanded projection'),
                path.slice(1),
            );
        return { ...target, path: [...target.path, ...path] };
    }
    function targetLeaves(target: FocusTarget): { place: string; path: number[] }[] {
        if ('inner' in target) return targetLeaves(target.inner);
        if ('items' in target) return target.items.flatMap(targetLeaves);
        return [target];
    }
    /** A user call with focus arguments, analyzed through lens setup. Its variant
     * identity includes the caller's replacement demand, so a returned focus is
     * interned only when its consumer (swap, alias release or forwarding caller)
     * has installed a concrete replacement representation. */
    type FocusCallSetup = {
        unit: IRUnit;
        fn: IRUnit['functions'][number];
        identity: string;
        callee: Extract<ValueRepresentation, { kind: 'callable' }>;
        inputArgs: ValueRepresentation[];
        args: ValueRepresentation[];
        state: State;
        record: Pick<RepresentationVariant, 'values' | 'calls'>;
        result: ValueRepresentation;
        target?: FocusTarget;
        route?: { argument: number; path: number[] };
        completed?: {
            demand?: ValueRepresentation;
            call: { target: string; result: ValueRepresentation; writes: ValueRepresentation[] };
        };
        /** A recursive call answered by the enclosing fixed-point hypothesis. */
        hypothesis?: RecursionHypothesis;
        /** The solved hypothesis whose recursive call entries name this variant. */
        solved?: RecursionHypothesis;
    };
    type RecursionHypothesis = {
        seeding: boolean;
        used: boolean;
        contract: (ValueRepresentation | undefined)[];
        result?: ValueRepresentation;
        entries: RepresentationVariant['calls'][number][];
    };
    // Recursive focus calls with identical setup inputs share one variant whose
    // parameter contracts and result are solved as a least fixed point.
    const hypotheses = new Map<string, RecursionHypothesis>();
    const setupKey = (
        identity: string,
        callee: Extract<ValueRepresentation, { kind: 'callable' }>,
        args: ValueRepresentation[],
    ) =>
        JSON.stringify([
            identity,
            callee.captures.map(key),
            args.map((a) => (isFocus(a) ? [a.kind, key(a.read)] : key(a))),
        ]);
    function focusContract(
        fn: IRUnit['functions'][number],
        args: ValueRepresentation[],
        state: State,
    ): (ValueRepresentation | undefined)[] {
        return fn.parameters.map((p, i) => {
            if (!p.lensPlace || !isFocus(args[i]!)) return undefined;
            const type = fn.type.args[i]!;
            if (type.tag !== 'flow') return fail('Demanded parameter lacks flow type');
            return containsCallable(type.write) ? state.places.get(p.lensPlace)! : data(type.write);
        });
    }
    function setupFocusCall(
        callee: Extract<ValueRepresentation, { kind: 'callable' }>,
        inputArgs: ValueRepresentation[],
        chain: string[],
    ): FocusCallSetup {
        const unit = units.get(callee.unit) ?? fail('Unknown callable unit');
        const fn =
            unit.functions.find((f) => f.id === callee.function) ?? fail('Unknown callable body');
        const identity = JSON.stringify([unit.id, fn.id]);
        const sk = setupKey(identity, callee, inputArgs);
        const hypothesisFor = chain.includes(identity) ? hypotheses.get(sk) : undefined;
        // Recursion with new setup inputs starts a nested fixed point, bounded
        // per function so changing representations cannot expand indefinitely.
        if (!hypothesisFor && chain.filter((c) => c === identity).length >= 4)
            return fail('Recursive callable endpoint demands require stable recursive inputs');
        if (hypothesisFor) {
            const hypothesis = hypothesisFor;
            hypothesis.used = true;
            if (hypothesis.seeding) throw new RecursionPending();
            return {
                unit,
                fn,
                identity,
                callee,
                inputArgs,
                args: structuredClone(inputArgs),
                state: fresh(),
                record: { values: [], calls: [] },
                result: structuredClone(hypothesis.result!),
                hypothesis,
            };
        }
        const hypothesis: RecursionHypothesis = {
            seeding: true,
            used: false,
            contract: [],
            entries: [],
        };
        hypotheses.set(sk, hypothesis);
        try {
            for (let iteration = 0; ; iteration++) {
                if (iteration > 16)
                    return fail('Recursive callable endpoint contract did not converge');
                const interned = new Set(variants.keys()),
                    pendingBefore = new Set(pendingDemands);
                hypothesis.used = false;
                hypothesis.entries = [];
                let setup: FocusCallSetup;
                try {
                    setup = analyzeFocusSetup(unit, fn, identity, callee, inputArgs, chain);
                } catch (error) {
                    if (error instanceof RecursionPending)
                        return fail('Recursive callable endpoint demands require a base case');
                    throw error;
                }
                if (!hypothesis.used) return setup;
                if (isFocus(setup.result))
                    return fail('Recursive callable lens results require a result route contract');
                const contract = focusContract(fn, setup.args, setup.state);
                if (
                    !hypothesis.seeding &&
                    contract.every((c, i) => (c ? equal(c, hypothesis.contract[i]!) : true)) &&
                    equal(setup.result, hypothesis.result!)
                ) {
                    setup.solved = hypothesis;
                    return setup;
                }
                // Discard this pass: its variants and pending demands used a stale hypothesis.
                for (const k of variants.keys()) if (!interned.has(k)) variants.delete(k);
                for (const entry of pendingDemands)
                    if (!pendingBefore.has(entry)) pendingDemands.delete(entry);
                hypothesis.seeding = false;
                hypothesis.contract = contract;
                hypothesis.result = setup.result;
            }
        } finally {
            hypotheses.delete(sk);
        }
    }
    function analyzeFocusSetup(
        unit: IRUnit,
        fn: IRUnit['functions'][number],
        identity: string,
        callee: Extract<ValueRepresentation, { kind: 'callable' }>,
        inputArgs: ValueRepresentation[],
        chain: string[],
    ): FocusCallSetup {
        if (variants.size >= limit) return fail('Representation demand variant budget exceeded');
        const args = structuredClone(inputArgs);
        const state = fresh(),
            record = {
                values: [] as RepresentationVariant['values'],
                calls: [] as RepresentationVariant['calls'],
            };
        fn.captures.forEach((c, i) => state.places.set(c.place, callee.captures[i]!));
        fn.parameters.forEach((p, i) => {
            const arg = args[i]!;
            if (p.lensPlace && isFocus(arg)) {
                if (arg.kind === 'focus-manual')
                    return fail('Manual callable parameter demands require a completion adapter');
                state.places.set(p.lensPlace, arg.read);
            } else if (p.lensPlace) state.lenses.set(p.lensPlace, shape(arg));
            else bind(p.pattern, arg, state);
        });
        const result = block(unit, fn.body, state, record, [...chain, identity], true);
        const setup: FocusCallSetup = {
            unit,
            fn,
            identity,
            callee,
            inputArgs,
            args,
            state,
            record,
            result,
        };
        // A deferred result (callee-private backing or a branch-selected focus) has no
        // parameter route: its completion installs the replacement in callee storage,
        // and the caller observes it through the parameter contracts.
        if (isFocus(result) && !state.deferredFocuses.has(fn.body.result)) {
            const target =
                targetFor(state, fn.body.result) ?? fail('Demanded result lacks logical backing');
            const leaves = targetLeaves(target);
            if (leaves.length !== 1)
                return fail('Demanded result requires one forwarded parameter projection');
            const argument = fn.parameters.findIndex((p) => p.lensPlace === leaves[0]!.place);
            setup.target = target;
            // Without a parameter route, the call retains callee-private backing
            // (its residual context) until the caller completes the focus.
            if (argument >= 0) setup.route = { argument, path: leaves[0]!.path };
        }
        return setup;
    }
    function completeFocusCall(
        setup: FocusCallSetup,
        resultDemand?: ValueRepresentation,
    ): { target: string; result: ValueRepresentation; writes: ValueRepresentation[] } {
        // Every consumer of one call site must agree on its replacement contract.
        if (setup.completed) {
            const previous = setup.completed.demand;
            if (
                (previous === undefined) !== (resultDemand === undefined) ||
                (previous && !equal(previous, resultDemand!))
            )
                return fail('Callable lens result completed with divergent replacement demands');
            return setup.completed.call;
        }
        const { unit, fn, identity, callee, args, state, record, result } = setup;
        if (setup.hypothesis) {
            // The enclosing fixed point names this call's variant once solved.
            setup.hypothesis.contract.forEach((replacement, i) => {
                if (!replacement) return;
                setContract(args[i]!, replacement);
                setContract(setup.inputArgs[i]!, replacement);
            });
            const call = { target: '', result, writes: args };
            setup.completed = { call };
            return call;
        }
        if (isFocus(result)) {
            if (!resultDemand) return fail('Callable lens result requires a replacement demand');
            result.replacement = resultDemand;
            // A forwarded private result is installed by its own call's completion.
            if (setup.target) writeTarget(setup.target, resultDemand, state);
            state.finishes.get(fn.body.result)?.(state, true);
        }
        focusContract(fn, args, state).forEach((replacement, i) => {
            if (!replacement) return;
            setContract(args[i]!, replacement);
            setContract(setup.inputArgs[i]!, replacement);
        });
        const variantKey = JSON.stringify([
            'representation-variant',
            targetKey(source.target),
            identity,
            callee.captures.map(key),
            args.map(key),
            ...(resultDemand ? [key(resultDemand)] : []),
        ]);
        const cached = variants.get(variantKey);
        const call = { target: cached?.id ?? '', result, writes: args };
        if (!cached) {
            if (variants.size >= limit)
                throw new BackendDiagnostic(
                    'representation-budget',
                    `Representation budget ${limit} exceeded: ${identity}`,
                );
            call.target = `rep_${createHash('sha256').update(variantKey).digest('hex')}`;
            variants.set(variantKey, {
                id: call.target,
                key: variantKey,
                unit: unit.id,
                function: fn.id,
                captures: callee.captures,
                arguments: args,
                values: record.values,
                calls: record.calls,
                result,
                ...(resultDemand ? { resultDemand } : {}),
            });
        }
        setup.completed = { demand: resultDemand, call };
        setup.solved?.entries.forEach((entry) => (entry.target = call.target));
        return call;
    }
    const invoke = (
        callee: ValueRepresentation,
        args: ValueRepresentation[],
        chain: string[],
        resultType?: SemanticFlow,
    ): {
        target: string;
        targets?: string[];
        result: ValueRepresentation;
        writes?: ValueRepresentation[];
    } => {
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
        if (args.some(isFocus)) {
            const setup = setupFocusCall(callee, args, chain);
            if (isFocus(setup.result))
                return fail('Callable lens result requires a replacement demand');
            return completeFocusCall(setup);
        }
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
        // Derive escaping private cleanup contracts without changing the setup
        // descriptor state used by the returned lens ABI.
        if (result.kind === 'lens') state.finishes.get(fn.body.result)?.(clone(state), true);
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
        allowLocalFocusResult = false,
    ): ValueRepresentation {
        // Cleanup is a separate executable region. Its data moves carry the
        // restoration-time types verified by typed IR, rather than setup types.
        // Callable dependencies retain their protected lexical provenance.
        const deferred: { value: string; body: IRBlock }[] = [];
        // Direct aliases keep the same logical place, even across lexical scopes.
        // Computed lenses instead have private backing and remain a separate ABI.
        function borrows(value: string, b: IRBlock): string[] {
            return b.instructions.flatMap((use) =>
                use.op === 'borrow' && use.lens === value
                    ? [use.loan]
                    : use.op === 'scope'
                      ? borrows(value, use.body)
                      : [],
            );
        }

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
                const focus = get(s, i.lens);
                if (focus.kind === 'focus-tuple' || focus.kind === 'focus-manual') {
                    const target = s.focusTargets.get(i.lens),
                        write = s.focusWrites.get(i.lens);
                    if (!loan.owners || !target || !write)
                        return fail('Scattered callable aliases require computed backing');
                    s.places.set(loan.place, focus.read);
                    const complete = s.finishes.get(i.lens);
                    s.finishes.set(i.lens, (state, apply) => {
                        if (!apply) return;
                        const replacement = containsCallable(write)
                            ? (state.places.get(loan.place) ??
                              fail('Missing scattered alias backing'))
                            : data(write);
                        focus.replacement = replacement;
                        writeTarget(target, replacement, state);
                        complete?.(state, true);
                    });
                } else if (focus.kind === 'local-focus') {
                    const owner = s.focusOwners.get(i.lens);
                    if (loan.owners) {
                        const write = s.focusWrites.get(i.lens);
                        const callTarget = s.callResults.get(i.lens);
                        if ((!owner && !callTarget && !s.deferredFocuses.has(i.lens)) || !write)
                            return fail('Computed callable alias lacks a logical frontend');
                        s.places.set(loan.place, focus.read);
                        const complete = s.finishes.get(i.lens);
                        s.finishes.set(i.lens, (state, apply) => {
                            if (!apply) return;
                            const replacement = containsCallable(write)
                                ? (state.places.get(loan.place) ??
                                  fail('Missing computed callable alias backing'))
                                : data(write);
                            focus.replacement = replacement;
                            if (callTarget) writeTarget(callTarget, replacement, state);
                            else if (owner)
                                state.places.set(
                                    owner.place,
                                    replaceValue(
                                        state.places.get(owner.place)!,
                                        owner.path,
                                        replacement,
                                    ),
                                );
                            complete?.(state, true);
                        });
                    } else if (
                        !owner ||
                        JSON.stringify(owner.path) !== JSON.stringify(loan.path) ||
                        owner.place !== loan.place
                    )
                        return fail('Callable aliases require a direct owned-local loan');
                } else if (loan.owners) s.lenses.set(loan.place, shape(focus));
                s.loanFinishes.set(i.loan, i.lens);
                continue;
            }
            let out: ValueRepresentation;
            const storageJoins: NonNullable<
                RepresentationVariant['values'][number]['storageJoins']
            > = [];
            const retainedStorage: NonNullable<
                RepresentationVariant['values'][number]['retainedStorage']
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
                            s.lenses.has(i.slot.place) ||
                            (body.instructions.filter(
                                (use) => use.op === 'swap' && use.lens === i.out.id,
                            ).length !== 1 &&
                                borrows(i.out.id, body).length !== 1 &&
                                body.instructions.filter(
                                    (use) => use.op === 'call' && use.args.includes(i.out.id),
                                ).length !== 1 &&
                                !body.instructions.some(
                                    (use) =>
                                        use.op === 'lens-tuple' && use.items.includes(i.out.id),
                                ) &&
                                !(allowLocalFocusResult && body.result === i.out.id) &&
                                !body.instructions.some(
                                    (use) => use.op === 'manual' && use.lens === i.out.id,
                                ))
                        )
                            return fail('Callable focuses require a direct whole-owned-local swap');
                        const owner = s.places.get(i.slot.place);
                        const stored = owner && projectValue(owner, i.slot.path);
                        const read = containsCallable(i.out.type.read)
                            ? (stored ?? fail('Callable focus lacks owned provenance'))
                            : data(i.out.type.read);
                        // Resolve replacement provenance at the ordered swap, or at
                        // lexical release for a direct persistent alias. Neither route
                        // materializes a pointer into a superseded storage version.
                        out = { kind: 'local-focus', read, replacement: read };
                        s.focusOwners.set(i.out.id, {
                            place: i.slot.place,
                            path: [...i.slot.path],
                        });
                        const borrowed = borrows(i.out.id, body);
                        if (borrowed.length) {
                            const loan = unit.loans.find((l) => l.id === borrowed[0])!;
                            if (
                                loan.owners ||
                                loan.place !== i.slot.place ||
                                JSON.stringify(loan.path) !== JSON.stringify(i.slot.path)
                            )
                                return fail('Callable aliases require a direct owned-local loan');
                        }
                        if (
                            borrowed.length ||
                            body.instructions.some(
                                (use) => use.op === 'manual' && use.lens === i.out.id,
                            )
                        ) {
                            const focus = out;
                            const write = i.out.type.write;
                            s.finishes.set(i.out.id, (state, apply) => {
                                if (apply)
                                    focus.replacement = containsCallable(write)
                                        ? projectValue(
                                              state.places.get(i.slot.place) ??
                                                  fail('Missing callable alias owner'),
                                              i.slot.path,
                                          )
                                        : data(write);
                            });
                        }
                        break;
                    }
                    if (
                        i.slot.path.length &&
                        !s.lenses.has(i.slot.place) &&
                        s.places.has(i.slot.place)
                    )
                        s.focusOwners.set(i.out.id, {
                            place: i.slot.place,
                            path: [...i.slot.path],
                        });
                    if (!s.lenses.has(i.slot.place) && s.places.has(i.slot.place))
                        s.dataOwners.set(i.out.id, { place: i.slot.place, path: [...i.slot.path] });
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
                    const frontend = get(s, i.lens);
                    out =
                        frontend.kind === 'focus-tuple' || frontend.kind === 'focus-manual'
                            ? {
                                  kind: 'focus-manual',
                                  read: frontend.read,
                                  replacement: frontend.read,
                                  frontend,
                              }
                            : frontend.kind === 'local-focus'
                              ? {
                                    kind: 'local-focus',
                                    read: frontend.read,
                                    replacement: frontend.read,
                                }
                              : {
                                    kind: 'lens',
                                    shape: retype(
                                        shape(frontend),
                                        i.out.type.read,
                                        i.out.type.write,
                                    ),
                                };
                    const owner = s.focusOwners.get(i.lens);
                    if (frontend.kind === 'local-focus') {
                        if (!owner) return fail('Manual callable focus lacks a logical owner');
                        s.focusOwners.set(i.out.id, owner);
                    }
                    const target = s.focusTargets.get(i.lens);
                    if (out.kind === 'focus-manual') {
                        if (!target) return fail('Scattered manual lacks logical targets');
                        s.focusTargets.set(i.out.id, { value: out, inner: target });
                    }
                    const dataOwner = s.dataOwners.get(i.lens);
                    if (dataOwner) s.dataOwners.set(i.out.id, dataOwner);
                    const frontendWrite = s.focusWrites.get(i.lens);
                    const manualFocus = out;
                    const write = i.out.type.write;
                    const frontendFinish = s.finishes.get(i.lens);
                    // Analyze each retained region once. A release reuses its verified
                    // descriptor effects without replaying SSA/call annotations.
                    let analyzed = false;
                    const finish = (state: State, apply: boolean) => {
                        // Callable cleanup needs the actual installed representation,
                        // which is known when the forwarded focus completes.
                        if (
                            !apply &&
                            (manualFocus.kind === 'local-focus' ||
                                manualFocus.kind === 'focus-manual')
                        )
                            return;
                        const annotation = record.values.find((v) => v.value === i.out.id)!;
                        if (apply && manualFocus.kind === 'focus-manual')
                            manualFocus.replacement = readTarget(target!, state, write);
                        if (apply && manualFocus.kind === 'local-focus')
                            manualFocus.replacement = containsCallable(write)
                                ? projectValue(state.places.get(owner!.place)!, owner!.path)
                                : data(write);
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
                            if (frontend.kind === 'focus-tuple')
                                writeTarget(
                                    target!,
                                    readTarget(target!, state, frontendWrite!),
                                    state,
                                );
                            frontendFinish?.(state, true);
                        }
                    };
                    s.finishes.set(i.out.id, finish);
                    deferred.push({ value: i.out.id, body: i.cleanup });
                    break;
                }
                case 'lens-tuple': {
                    const members = i.items.map((id) => get(s, id));
                    if (members.some((v) => v.kind !== 'lens')) {
                        const read = tupleValue(members.map((v) => focusEndpoint(v)));
                        out = { kind: 'focus-tuple', read, replacement: read, items: members };
                    } else out = { kind: 'lens', shape: reps.tuple(members.map(shape)) };
                    const targets = i.items.map((id) => targetFor(s, id));
                    if (targets.every((t) => t !== undefined))
                        s.focusTargets.set(i.out.id, { value: out, items: targets });
                    else if (out.kind === 'focus-tuple')
                        return fail('Scattered callable focus lacks a logical owner');
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
                    if (focus.kind === 'focus-tuple' || focus.kind === 'focus-manual') {
                        focus.replacement = get(s, i.value);
                        out = focus.read;
                        writeTarget(
                            s.focusTargets.get(i.lens) ?? fail('Missing scattered focus targets'),
                            get(s, i.value),
                            s,
                        );
                    } else if (focus.kind === 'local-focus') {
                        focus.replacement = get(s, i.value);
                        out = focus.read;
                        const callTarget = s.callResults.get(i.lens);
                        const owner = s.focusOwners.get(i.lens);
                        if (callTarget) writeTarget(callTarget, focus.replacement, s);
                        else if (!owner && !s.deferredFocuses.has(i.lens))
                            return fail('Nonlocal callable focus swap');
                        if (owner)
                            s.places.set(
                                owner.place,
                                replaceValue(
                                    s.places.get(owner.place) ??
                                        fail('Missing callable focus owner'),
                                    owner.path,
                                    focus.replacement,
                                ),
                            );
                    } else {
                        out = data(i.out.type.value);
                        const owner = s.focusOwners.get(i.lens);
                        if (owner)
                            s.places.set(
                                owner.place,
                                replaceValue(
                                    s.places.get(owner.place)!,
                                    owner.path,
                                    get(s, i.value),
                                ),
                            );
                    }
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
                    // Callable endpoints may cross this call only when verified
                    // callee provenance identifies the direct native projection.
                    if (
                        args.some(
                            (arg) =>
                                arg.kind === 'local-focus' ||
                                arg.kind === 'focus-tuple' ||
                                arg.kind === 'focus-manual',
                        ) &&
                        !(
                            callee.kind === 'callable' ||
                            callee.kind === 'callable-choice' ||
                            (callee.kind === 'native' &&
                                callee.definition === 'native/fst' &&
                                args.length === 1)
                        )
                    )
                        return fail('Callable focus calls require verified native fst provenance');
                    // The consumer that installs a returned focus's replacement: an
                    // immediate swap, a persistent alias release, a consuming focus call,
                    // or a forwarding caller's own completion.
                    const demandSource = (
                        read: ValueRepresentation,
                    ): NonNullable<RepresentationVariant['calls'][number]['demand']> => {
                        const swap = body.instructions.find(
                            (use) => use.op === 'swap' && use.lens === i.out.id,
                        );
                        const loan = borrows(i.out.id, body);
                        const consumer = body.instructions.find(
                            (use) => use.op === 'call' && use.args.includes(i.out.id),
                        );
                        if (swap?.op === 'swap') return { value: swap.value, replacement: read };
                        if (loan.length === 1) return { loan: loan[0]!, replacement: read };
                        // The consuming call's completion sets this focus's parameter
                        // contract before argument finishes run.
                        if (consumer?.op === 'call')
                            return { consumer: consumer.out.id, replacement: read };
                        if (body.result === i.out.id && allowLocalFocusResult)
                            return { replacement: read };
                        return fail(
                            'Callable lens result needs a swap, alias or forwarded replacement demand',
                        );
                    };
                    if (callee.kind === 'callable-choice' && args.some(isFocus)) {
                        // Each alternative is specialized independently on the same
                        // demand; the caller's backing holds the join of their parameter
                        // contracts, and each option keeps its exact contract behind a
                        // dispatch argument adapter.
                        const setups = callee.options.map((option) =>
                            option.kind === 'callable'
                                ? setupFocusCall(option, args, chain)
                                : fail('Native alternatives cannot receive callable focuses'),
                        );
                        const joinWrites = (
                            calls: { writes: ValueRepresentation[] }[],
                        ): ValueRepresentation[] =>
                            args.map((arg, n) => {
                                const options = calls.map((call) => call.writes[n]!);
                                if (options.every((o) => equal(o, options[0]!))) {
                                    if (
                                        arg.kind === 'local-focus' &&
                                        options[0]!.kind === 'local-focus'
                                    )
                                        setContract(arg, options[0]!.replacement);
                                    return options[0]!;
                                }
                                if (
                                    arg.kind !== 'local-focus' ||
                                    options.some(
                                        (o) => o.kind !== 'local-focus' || !equal(o.read, arg.read),
                                    )
                                )
                                    return fail(
                                        'Branch-selected scattered focus callees require a common parameter contract',
                                    );
                                const replacement = join(
                                    options.map(
                                        (o) =>
                                            (
                                                o as Extract<
                                                    ValueRepresentation,
                                                    { kind: 'local-focus' }
                                                >
                                            ).replacement,
                                    ),
                                    true,
                                );
                                setContract(arg, replacement);
                                return { ...arg, replacement };
                            });
                        const backing = i.args.map((id, n) =>
                            isFocus(args[n]!) ? targetFor(s, id) : undefined,
                        );
                        const writeBack = (state: State, writes: ValueRepresentation[]): void =>
                            backing.forEach((target, n) => {
                                if (target)
                                    writeTarget(
                                        target,
                                        (
                                            writes[n] as Extract<
                                                ValueRepresentation,
                                                { kind: 'local-focus' }
                                            >
                                        ).replacement,
                                        state,
                                    );
                            });
                        const results = setups.map((setup) => setup.result);
                        const entry: RepresentationVariant['calls'][number] = {
                            value: i.out.id,
                            target: '',
                            targets: [],
                            arguments: args,
                            result: results[0]!,
                        };
                        record.calls.push(entry);
                        if (results.some(isFocus)) {
                            // Dispatched lens result: its read joins the options' reads,
                            // and every option completes on the consumer's demand. Options
                            // route through their parameter contracts, so the result is
                            // deferred like a callee-private one.
                            const reads = results.map((r) =>
                                r.kind === 'local-focus'
                                    ? r.read
                                    : fail(
                                          'Dispatched scattered callable lens results require arm targets',
                                      ),
                            );
                            const read = join(reads, true);
                            const focus: Extract<ValueRepresentation, { kind: 'local-focus' }> = {
                                kind: 'local-focus',
                                read,
                                replacement: read,
                            };
                            out = focus;
                            entry.result = focus;
                            entry.demand = demandSource(read);
                            s.deferredFocuses.add(i.out.id);
                            pendingDemands.add(entry);
                            s.finishes.set(i.out.id, (state, apply) => {
                                const calls = setups.map((setup) =>
                                    completeFocusCall(setup, focus.replacement),
                                );
                                const writes = joinWrites(calls);
                                entry.targets = calls.map((call) => call.target);
                                entry.target = JSON.stringify(['dispatch', entry.targets]);
                                entry.demand!.replacement = focus.replacement;
                                pendingDemands.delete(entry);
                                if (apply) writeBack(state, writes);
                            });
                        } else {
                            const calls = setups.map((setup) => completeFocusCall(setup));
                            const writes = joinWrites(calls);
                            out = join(
                                calls.map((call) => call.result),
                                true,
                            );
                            entry.result = out;
                            entry.targets = calls.map((call) => call.target);
                            entry.target = JSON.stringify(['dispatch', entry.targets]);
                            s.finishes.set(i.out.id, (state, apply) => {
                                if (apply) writeBack(state, writes);
                            });
                            s.finishes.get(i.out.id)!(s, true);
                        }
                    } else if (
                        callee.kind === 'callable' &&
                        (args.some(isFocus) ||
                            (i.out.type.tag === 'flow' &&
                                (containsCallable(i.out.type.read) ||
                                    containsCallable(i.out.type.write))))
                    ) {
                        const setup = setupFocusCall(callee, args, chain);
                        out = setup.result;
                        const targets = i.args.map((id, n) =>
                            isFocus(args[n]!) ? targetFor(s, id) : undefined,
                        );
                        const entry: RepresentationVariant['calls'][number] = {
                            value: i.out.id,
                            target: '',
                            arguments: args,
                            result: out,
                        };
                        record.calls.push(entry);
                        const writeBack = (state: State, writes: ValueRepresentation[]): void =>
                            targets.forEach((target, n) => {
                                if (target)
                                    writeTarget(
                                        target,
                                        (
                                            writes[n] as Extract<
                                                ValueRepresentation,
                                                { kind: 'local-focus' }
                                            >
                                        ).replacement,
                                        state,
                                    );
                            });
                        if (!isFocus(out)) {
                            entry.target = completeFocusCall(setup).target;
                            setup.hypothesis?.entries.push(entry);
                            s.finishes.set(i.out.id, (state, apply) => {
                                if (apply) writeBack(state, setup.args);
                            });
                            if (i.out.type.tag === 'plain') s.finishes.get(i.out.id)!(s, true);
                        } else {
                            // The returned focus is completed by whichever consumer
                            // installs its replacement: an immediate swap, a persistent
                            // alias release, or a forwarding caller's own completion.
                            entry.demand = demandSource(out.read);
                            if (setup.route) {
                                const target =
                                    targets[setup.route.argument] ??
                                    fail('Demanded call lacks argument backing');
                                s.callResults.set(
                                    i.out.id,
                                    projectedTarget(target, setup.route.path),
                                );
                            } else s.deferredFocuses.add(i.out.id);
                            const focus = out;
                            pendingDemands.add(entry);
                            s.finishes.set(i.out.id, (state, apply) => {
                                const done = completeFocusCall(setup, focus.replacement);
                                entry.target = done.target;
                                entry.demand!.replacement = focus.replacement;
                                pendingDemands.delete(entry);
                                if (apply) writeBack(state, done.writes);
                            });
                        }
                    } else {
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
                    }
                    // Returned lenses retain argument backing and its completion;
                    // plain calls complete argument adapters before continuation.
                    if (
                        callee.kind === 'native' &&
                        callee.definition === 'native/fst' &&
                        args[0]?.kind === 'local-focus'
                    ) {
                        const parent = args[0],
                            owner = s.focusOwners.get(i.args[0]!);
                        const write = s.focusWrites.get(i.args[0]!);
                        const callTarget = s.callResults.get(i.args[0]!);
                        const privateResult = s.deferredFocuses.has(i.args[0]!);
                        if ((!owner && !callTarget && !privateResult) || !write)
                            return fail('Callable fst completion requires a direct owned frontend');
                        if (owner) {
                            s.focusOwners.set(i.out.id, {
                                place: owner.place,
                                path: [...owner.path, 0],
                            });
                            s.finishes.set(i.out.id, (state, apply) => {
                                if (apply)
                                    parent.replacement = containsCallable(write)
                                        ? projectValue(state.places.get(owner.place)!, owner.path)
                                        : data(write);
                            });
                        } else {
                            // A returned-lens frontend completes after this projection
                            // (argument cleanup follows projection completion); it reads
                            // the rebuilt parent replacement as its demand. The sibling
                            // is exclusively borrowed, so it retains its setup read.
                            if (callTarget)
                                s.callResults.set(i.out.id, projectedTarget(callTarget, [0]));
                            else s.deferredFocuses.add(i.out.id);
                            const projection = out,
                                type = i.out.type;
                            s.finishes.set(i.out.id, (_state, apply) => {
                                if (apply)
                                    parent.replacement = fstParentReplacement(
                                        parent.read,
                                        write,
                                        projection,
                                        type,
                                    );
                            });
                        }
                    }
                    if (
                        callee.kind === 'native' &&
                        callee.definition === 'native/fst' &&
                        (args[0]?.kind === 'focus-tuple' || args[0]?.kind === 'focus-manual')
                    ) {
                        const target = s.focusTargets.get(i.args[0]!),
                            write = s.focusWrites.get(i.args[0]!);
                        let tuple = target;
                        while (tuple && 'inner' in tuple) tuple = tuple.inner;
                        if (!target || !tuple || !('items' in tuple) || !write)
                            return fail(
                                'Callable fst completion requires a direct scattered frontend',
                            );
                        const child = tuple.items[0] ?? fail('Missing fst logical child');
                        if ('place' in child)
                            s.focusOwners.set(i.out.id, {
                                place: child.place,
                                path: [...child.path],
                            });
                        else s.focusTargets.set(i.out.id, child);
                        s.finishes.set(i.out.id, (state, apply) => {
                            if (apply) writeTarget(target, readTarget(target, state, write), state);
                        });
                    }
                    const projectionFinish = s.finishes.get(i.out.id);
                    if (
                        projectionFinish &&
                        callee.kind === 'native' &&
                        callee.definition === 'native/fst'
                    )
                        s.nativeProjections.add(i.out.id);
                    const finishes = i.args.map((id) => s.finishes.get(id));
                    if (i.out.type.tag === 'flow') {
                        if (projectionFinish || finishes.some(Boolean))
                            s.finishes.set(i.out.id, (state, apply) => {
                                projectionFinish?.(state, apply);
                                finishes.forEach((finish) => finish?.(state, apply));
                            });
                    } else finishes.forEach((finish) => finish?.(s, true));
                    break;
                }
                case 'scope': {
                    const nested = clone(s);
                    out = block(unit, i.body, nested, record, chain, true);
                    const callTarget = nested.callResults.get(i.body.result);
                    if (callTarget) s.callResults.set(i.out.id, callTarget);
                    const privateResult = nested.deferredFocuses.has(i.body.result);
                    if (privateResult) s.deferredFocuses.add(i.out.id);
                    if (out.kind === 'local-focus' && !callTarget && !privateResult) {
                        const owner = nested.focusOwners.get(i.body.result);
                        if (!owner) return fail('Escaping callable focus lacks a logical owner');
                        if (!s.places.has(owner.place)) {
                            const representation =
                                nested.places.get(owner.place) ??
                                fail('Missing retained callable backing');
                            retainedStorage.push({ place: owner.place, representation });
                            s.places.set(owner.place, representation);
                        }
                        s.focusOwners.set(i.out.id, owner);
                    }
                    s.places.forEach((_, place) => s.places.set(place, nested.places.get(place)!));
                    const target = nested.focusTargets.get(i.body.result);
                    if (target && (out.kind === 'focus-tuple' || out.kind === 'focus-manual'))
                        for (const place of new Set(targetPlaces(target)))
                            if (!s.places.has(place)) {
                                const representation =
                                    nested.places.get(place) ??
                                    fail('Missing retained scattered backing');
                                retainedStorage.push({ place, representation });
                                s.places.set(place, representation);
                            }

                    if (target && enclosingTarget(target, s)) s.focusTargets.set(i.out.id, target);
                    else if (out.kind === 'focus-tuple' || out.kind === 'focus-manual')
                        return fail('Escaping scattered focus requires retained local backing');
                    const dataOwner = nested.dataOwners.get(i.body.result);
                    if (dataOwner && s.places.has(dataOwner.place))
                        s.dataOwners.set(i.out.id, dataOwner);
                    const finish = nested.finishes.get(i.body.result);
                    if (finish) {
                        // Escaping completion may still need descriptors for locals
                        // that are no longer present in the enclosing scope.
                        const retained = clone(nested);
                        const enclosing = [...s.places.keys()];
                        s.finishes.set(i.out.id, (current, apply) => {
                            const restored = clone(retained);
                            enclosing.forEach((place) =>
                                restored.places.set(place, current.places.get(place)!),
                            );
                            finish(restored, apply);
                            if (apply)
                                enclosing.forEach((place) =>
                                    current.places.set(place, restored.places.get(place)!),
                                );
                        });
                    }
                    break;
                }
                case 'case': {
                    const states: State[] = [];
                    // A branch-selected callable focus: each arm yields a focus whose
                    // replacement is installed when the selected focus completes.
                    const selectedCallable =
                        i.out.type.tag === 'flow' &&
                        (containsCallable(i.out.type.read) || containsCallable(i.out.type.write));
                    let pending: RecursionPending | undefined;
                    const branches = i.cases.flatMap((arm) => {
                        const state = clone(s);
                        bind(arm.pattern, get(s, i.value), state);
                        try {
                            const result = block(
                                unit,
                                arm.body,
                                state,
                                record,
                                chain,
                                selectedCallable,
                            );
                            states.push(state);
                            return [result];
                        } catch (error) {
                            // A seeding pass treats an arm that reaches an unsolved
                            // recursive call as divergent: the least fixed point
                            // starts from the remaining (base) arms.
                            if (!(error instanceof RecursionPending)) throw error;
                            // A recursive lens result's parameter contracts depend on the
                            // replacement demand, known only at completion.
                            if (i.out.type.tag === 'flow')
                                return fail(
                                    'Recursive callable lens results require a demand-dependent fixed point',
                                );
                            pending = error;
                            return [];
                        }
                    });
                    if (pending && !branches.length) throw pending;
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
                    const armFocuses = selectedCallable
                        ? branches.map((b) =>
                              b.kind === 'local-focus'
                                  ? b
                                  : fail('Selected scattered callable focuses require arm targets'),
                          )
                        : [];
                    const armTargets = armFocuses.map((_, n) =>
                        targetFor(states[n]!, i.cases[n]!.body.result),
                    );
                    armTargets.forEach((target, n) => {
                        if (!target && !states[n]!.deferredFocuses.has(i.cases[n]!.body.result))
                            fail('Selected callable focus arm lacks a logical target');
                    });
                    if (selectedCallable) {
                        const read = join(
                            armFocuses.map((f) => f.read),
                            true,
                        );
                        out = { kind: 'local-focus', read, replacement: read };
                        s.deferredFocuses.add(i.out.id);
                    } else
                        out =
                            i.out.type.tag === 'flow'
                                ? {
                                      kind: 'lens',
                                      shape: reps.thin(i.out.type.read, i.out.type.write),
                                  }
                                : join(branches, true);
                    const selected = out;
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
                        if (finishes.some(Boolean) || selectedCallable)
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
                                    if (selectedCallable && selected.kind === 'local-focus') {
                                        // Only this arm's owner receives the replacement
                                        // when it is selected; the union below joins arms.
                                        armFocuses[n]!.replacement = selected.replacement;
                                        const target = armTargets[n];
                                        if (target)
                                            writeTarget(target, selected.replacement, restored);
                                    }
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
            if (
                (out.kind === 'local-focus' ||
                    out.kind === 'focus-tuple' ||
                    out.kind === 'focus-manual') &&
                i.out.type.tag === 'flow'
            )
                s.focusWrites.set(i.out.id, i.out.type.write);
            s.values.set(i.out.id, out);
            record.values.push({
                value: i.out.id,
                representation: out,
                ...(storageJoins.length ? { storageJoins } : {}),
                ...(retainedStorage.length ? { retainedStorage } : {}),
            });
        }
        for (const instruction of body.instructions)
            if (instruction.op === 'call') {
                const demand = record.calls.find(
                    (call) => call.value === instruction.out.id,
                )?.demand;
                if (demand?.value && !equal(demand.replacement, get(s, demand.value)))
                    return fail('Replacement demand differs from ordered RHS representation');
            }
        const result = get(s, body.result);
        if (
            (result.kind === 'focus-tuple' || result.kind === 'focus-manual') &&
            !allowLocalFocusResult
        )
            return fail('Scattered callable focus forwarding requires a completion contract');
        if (result.kind === 'local-focus' && !allowLocalFocusResult)
            return fail('Callable focus results require an explicit return ABI');
        // A plain block releases its lexical loans before its caller continues.
        // Lens results defer those releases; analyze remaining regions without
        // applying their effects to setup state.
        if (
            result.kind !== 'lens' &&
            result.kind !== 'local-focus' &&
            result.kind !== 'focus-tuple' &&
            result.kind !== 'focus-manual'
        )
            for (const action of body.cleanup)
                if (action.kind === 'release') {
                    const value = s.loanFinishes.get(action.loan);
                    if (value) s.finishes.get(value)?.(s, true);
                }
        if (
            result.kind === 'lens' ||
            result.kind === 'local-focus' ||
            result.kind === 'focus-tuple' ||
            result.kind === 'focus-manual'
        ) {
            const finish = s.finishes.get(body.result);
            const releases = body.cleanup.flatMap((action) => {
                if (action.kind !== 'release') return [];
                const value = s.loanFinishes.get(action.loan);
                const release = value && s.finishes.get(value);
                return release ? [release] : [];
            });
            if (releases.length)
                s.finishes.set(body.result, (state, apply) => {
                    finish?.(state, apply);
                    releases.forEach((release) => release(state, apply));
                });
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
    if (pendingDemands.size) fail('Callable lens result was never completed');
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
