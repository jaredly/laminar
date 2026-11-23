import {
    deriveNominalLayoutDefinitions,
    type NominalLayoutDefinition,
} from './layout-definitions.ts';
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
import type { IRUnit, IRBlock } from './typed-ir.ts';
import { typeKey } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import { memberKey, representationKey } from './representation-key.ts';
import { escapes } from './callable-escape.ts';
import { verifyRepresentations } from './verify-representations.ts';
import {
    canonicalCallLensTopology,
    canonicalLensPolicies,
    lensSpecializationSelectors,
    specializeLensCall,
} from './lens-specialization.ts';

export type ValueRepresentation =
    | { kind: 'data'; layout: LayoutId }
    | { kind: 'aggregate'; items: ValueRepresentation[] }
    | { kind: 'lens'; shape: LensRepId }
    /** Any callable value of a semantic function type (its `typeKey`). Callable
     * values are type-determined; which code may occupy them is the program-wide
     * member set for that type (`RepresentationAnalysis.callables`). */
    | { kind: 'callable'; type: string };
/** Code that can occupy a callable value: a lambda or definition entry with its
 * (type-determined) capture representations, or a native intrinsic. */
export type CallableMember =
    | { kind: 'closure'; unit: string; function: string; captures: ValueRepresentation[] }
    | { kind: 'native'; definition: string };
/** A call target: known code, or every member of the callee's type. */
type Callee = CallableMember | { kind: 'dispatch'; type: string; options: CallableMember[] };
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
    }[];
    calls: {
        value: string;
        target: string;
        targets?: string[];
        arguments: ValueRepresentation[];
        result: ValueRepresentation;
        /** The statically known callee of a direct call; absent for indirect calls,
         * which dispatch over every member of the callee's type. */
        callee?: CallableMember;
    }[];
};
export type LensTopology = { kind: 'thin' } | { kind: 'tuple'; items: LensTopology[] };
export type EntryRepresentationArgument =
    | { kind: 'data' }
    | { kind: 'lens'; topology: LensTopology };
export type RepresentationAnalysis = {
    schemaVersion: 1;
    /** Absent/empty uses canonical call ABIs; selectors opt into legal topology variants. */
    specializeLenses?: readonly string[];
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
    /** Callable types with the members that may occupy their values, in canonical order. */
    callables: { type: string; signature: SemanticType; members: CallableMember[] }[];
    layouts: readonly Layout[];
    shapes: readonly LensRep[];
    backings: readonly Backing[];
};
type State = {
    values: Map<string, ValueRepresentation>;
    lenses: Map<string, LensRepId>;
    known: Map<string, CallableMember>;
    /** Bounded code hints for whole local slots; never part of a representation key.
     * Borrows and potentially effectful regions invalidate these hints. */
    knownPlaces: Map<string, CallableMember>;
};
/** Infer type-determined values and ordinary lens shapes at each callable ABI. */
export function inferRepresentations(
    input: SpecializedProgram,
    options: {
        specializeLenses?: readonly string[];
        maxVariants?: number;
        maxWorkItems?: number;
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
    const selected = options.specializeLenses ?? [];
    const validSelectors = lensSpecializationSelectors(source);
    if (
        !Array.isArray(selected) ||
        selected.some((n) => typeof n !== 'string' || !validSelectors.has(n))
    )
        throw new BackendDiagnostic(
            'invalid-lens-specialization',
            'Lens specialization selectors must name source definitions, function IDs, or *',
        );
    const specializeLenses = [...new Set(selected)].sort();
    const limit = options.maxVariants ?? 256;
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new BackendDiagnostic(
            'invalid-representation-budget',
            'Representation budget must be a positive integer',
        );
    const workLimit = options.maxWorkItems ?? 100_000;
    if (!Number.isSafeInteger(workLimit) || workLimit < 1)
        throw new BackendDiagnostic(
            'invalid-representation-budget',
            'Work item budget must be a positive integer',
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
    // Without explicit schemas, unions are derived from every constructor the
    // generic program imports (specialization filters unused ones out).
    const layouts = new LayoutTable(
            source.target,
            options.layoutDefinitions ?? deriveNominalLayoutDefinitions(source.generic.imports),
        ),
        reps = new RepresentationTable(layouts);
    const units = new Map(source.program.units.map((u) => [u.id, u]));
    const definitions = new Map(
        source.program.units.filter((u) => u.definition).map((u) => [u.definition!, u]),
    );
    const variants = new Map<
        string,
        Omit<RepresentationVariant, 'result'> & { result?: ValueRepresentation }
    >();
    const tasks = new Map<string, () => void>();
    const queue = new Set<string>();
    const dependents = new Map<string, Set<string>>();
    const dependencies = new Map<string, Set<string>>();
    let current = '';
    const depend = (key: string): void => {
        if (!current) return;
        if (!dependents.has(key)) dependents.set(key, new Set());
        dependents.get(key)!.add(current);
        if (!dependencies.has(current)) dependencies.set(current, new Set());
        dependencies.get(current)!.add(key);
    };
    const changed = (key: string): void => {
        dependents.get(key)?.forEach((id) => queue.add(id));
    };
    // Member discovery wakes only bodies that read this callable type's member set.
    const callableTypes = new Map<
        string,
        { signature: SemanticType; members: Map<string, CallableMember> }
    >();
    const addMember = (type: SemanticType, member: CallableMember): void => {
        const k = typeKey(type);
        let entry = callableTypes.get(k);
        if (!entry) callableTypes.set(k, (entry = { signature: type, members: new Map() }));
        const identity = memberKey(member);
        if (!entry.members.has(identity)) {
            entry.members.set(identity, member);
            changed(`members:${k}`);
        }
    };
    const membersOf = (type: string): CallableMember[] =>
        [...(callableTypes.get(type)?.members ?? new Map<string, CallableMember>())]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, m]) => m);
    const entries: RepresentationAnalysis['entries'] = [];
    const roots: RepresentationAnalysis['roots'] = [];
    const exports: RepresentationAnalysis['exports'] = [];
    const fresh = (): State => ({
        values: new Map(),
        lenses: new Map(),
        known: new Map(),
        knownPlaces: new Map(),
    });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        lenses: new Map(s.lenses),
        known: new Map(s.known),
        knownPlaces: new Map(s.knownPlaces),
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
    const typeRep = (t: SemanticType): ValueRepresentation =>
        t.tag === 'fn'
            ? { kind: 'callable', type: typeKey(t) }
            : t.tag === 'tuple' && t.items.some(containsCallable)
              ? { kind: 'aggregate', items: t.items.map(typeRep) }
              : data(t);
    const get = (s: State, id: string): ValueRepresentation =>
        s.values.get(id) ?? fail(`Missing representation for ${id}`);
    const shape = (v: ValueRepresentation): LensRepId =>
        v.kind === 'lens' ? v.shape : fail('Expected lens representation');
    const key = representationKey;
    const equal = (a: ValueRepresentation, b: ValueRepresentation) => key(a) === key(b);
    const join = (items: ValueRepresentation[], _aggregate = false): ValueRepresentation => {
        const first = items[0] ?? fail('Empty representation join');
        if (items.every((v) => equal(first, v))) return first;
        // Plain values are type-determined; lens joins normalize before reaching here.
        throw new BackendDiagnostic(
            'invalid-representation',
            'Plain value representations of one semantic type differ',
        );
    };
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
    const canonicalPolicies = canonicalLensPolicies(source);
    const canonicalArgument = (
        v: ValueRepresentation,
        type: string,
        argument: number,
        preserve = false,
    ): ValueRepresentation => {
        if (v.kind !== 'lens') return v;
        const topology = (id: LensRepId): LensTopology => {
            const r = reps.get(id);
            return r.kind === 'thin'
                ? { kind: 'thin' }
                : { kind: 'tuple', items: r.items.map(topology) };
        };
        const s = reps.get(v.shape),
            read = layouts.get(s.read).type,
            write = layouts.get(s.replacement).type;
        const build = (
            topology: LensTopology,
            read: SemanticType,
            write: SemanticType,
        ): LensRepId =>
            topology.kind === 'thin'
                ? reps.thin(read, write)
                : reps.tuple(
                      topology.items.map((t, n) =>
                          build(
                              t,
                              (read as Extract<SemanticType, { tag: 'tuple' }>).items[n]!,
                              (write as Extract<SemanticType, { tag: 'tuple' }>).items[n]!,
                          ),
                      ),
                  );
        return {
            kind: 'lens',
            shape: build(
                canonicalCallLensTopology(
                    canonicalPolicies,
                    type,
                    argument,
                    read,
                    write,
                    preserve ? topology(v.shape) : undefined,
                ),
                read,
                write,
            ),
        };
    };
    const nativeCall = (
        name: string,
        args: ValueRepresentation[],
        type: SemanticFlow,
    ): ValueRepresentation => {
        if (type.tag === 'plain') return typeRep(type.value);
        if (name === 'native/fst' && args[0])
            return {
                kind: 'lens',
                shape: retype(reps.project(shape(args[0]), 0), type.read, type.write),
            };
        // An element focus is a thin pointer into the vector's buffer.
        if (name === 'native/[]') return { kind: 'lens', shape: reps.thin(type.read, type.write) };
        return fail(`No returned-lens representation contract for ${name}`);
    };
    const invoke = (
        callee: Callee,
        args: ValueRepresentation[],
        chain: string[],
        resultType?: SemanticFlow,
    ): {
        target: string;
        targets?: string[];
        result: ValueRepresentation;
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
        if (callee.kind === 'dispatch') {
            // Specialize every member at this ABI; recursive members expose their
            // current result-shape approximation until the worklist stabilizes.
            const calls = callee.options.map((option) => invoke(option, args, chain, resultType));
            const results = calls.map((call) => call.result);
            let result: ValueRepresentation;
            if (!resultType) return fail('Missing dynamic result contract');
            if (resultType.tag === 'plain') result = typeRep(resultType.value);
            else if (
                !results.length ||
                (results.every((r) => r.kind === 'lens') &&
                    results.some((r) => !equal(r, results[0]!)))
            )
                result = { kind: 'lens', shape: reps.thin(resultType.read, resultType.write) };
            else result = join(results, true);
            const targets = calls.map((call) => call.target);
            return { target: JSON.stringify(['dispatch', targets]), targets, result };
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
        depend(variantKey);
        const cached = variants.get(variantKey);
        if (cached) {
            if (!cached.result) return fail('Missing recursive result approximation');
            return { target: cached.id, result: cached.result };
        }
        if (variants.size >= limit)
            throw new BackendDiagnostic(
                'representation-resource-limit',
                `Representation resource limit ${limit} exceeded: ${[...chain, identity].join(' -> ')}`,
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
        // Plain results are type-determined even before a recursive body is visited.
        variant.result =
            fn.type.result.tag === 'plain'
                ? typeRep(fn.type.result.value)
                : {
                      kind: 'lens',
                      shape: reps.thin(fn.type.result.read, fn.type.result.write),
                  };
        variants.set(variantKey, variant);
        tasks.set(variantKey, () => {
            const state = fresh();
            fn.parameters.forEach((p, i) => {
                if (p.lensPlace) state.lenses.set(p.lensPlace, shape(args[i]!));
            });
            variant.values = [];
            variant.calls = [];
            const result = block(unit, fn.body, state, variant, []);
            if (!equal(variant.result!, result)) {
                variant.result = result;
                changed(variantKey);
            }
        });
        queue.add(variantKey);
        return { target: variant.id, result: variant.result! };
    };
    function block(
        unit: IRUnit,
        body: IRBlock,
        s: State,
        record: Pick<RepresentationVariant, 'values' | 'calls'>,
        chain: string[],
    ): ValueRepresentation {
        for (const i of body.instructions) {
            if (i.op === 'bind') {
                const member = s.known.get(i.value);
                if (i.pattern.kind === 'bind' && member)
                    s.knownPlaces.set(i.pattern.slot.place, member);
                else s.knownPlaces.clear();
                continue;
            }
            if (i.op === 'borrow') {
                const loan = unit.loans.find((l) => l.id === i.loan)!;
                if (loan.owners) s.lenses.set(loan.place, shape(get(s, i.lens)));
                continue;
            }
            let out: ValueRepresentation;
            switch (i.op) {
                case 'constant':
                case 'string':
                case 'construct':
                case 'tuple':
                case 'swap':
                    if (i.out.type.tag !== 'plain') return fail('Data instruction produced a lens');
                    out = typeRep(i.out.type.value);
                    break;
                case 'move': {
                    if (i.out.type.tag !== 'plain') return fail('Move produced a lens');
                    const member = !i.slot.path.length && s.knownPlaces.get(i.slot.place);
                    if (member) s.known.set(i.out.id, member);
                    s.knownPlaces.delete(i.slot.place);
                    out = typeRep(i.out.type.value);
                    break;
                }
                case 'acquire': {
                    s.knownPlaces.delete(i.slot.place);
                    if (i.out.type.tag !== 'flow') return fail('Acquire produced data');
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
                case 'aslens':
                    s.knownPlaces.clear();
                    if (i.out.type.tag !== 'flow') return fail('Temporary lens produced data');
                    out = {
                        kind: 'lens',
                        shape: reps.thin(i.out.type.read, i.out.type.write),
                    };
                    block(unit, i.cleanup, clone(s), record, chain);
                    break;
                case 'lens-tuple':
                    out = {
                        kind: 'lens',
                        shape: reps.tuple(i.items.map((id) => shape(get(s, id)))),
                    };
                    break;
                case 'lens-construct':
                    return fail(
                        'Constructor lenses have no concrete representation yet (see docs/scattered-constructor-lenses.md)',
                    );
                case 'global':
                case 'closure': {
                    if (i.out.type.tag !== 'plain') return fail('Callable produced a lens');
                    let member: CallableMember;
                    if (i.op === 'closure')
                        member = {
                            kind: 'closure',
                            unit: unit.id,
                            function: i.function,
                            captures: i.captures.map((c) => get(s, c.value)),
                        };
                    else {
                        const target = definitions.get(i.instance.definition);
                        if (!target) member = { kind: 'native', definition: i.instance.definition };
                        else {
                            const closure = target.entry.instructions[0];
                            if (closure?.op !== 'closure' || closure.captures.length)
                                return fail('Reusable definition lacks a closed entry');
                            member = {
                                kind: 'closure',
                                unit: target.id,
                                function: closure.function,
                                captures: [],
                            };
                        }
                    }
                    out = typeRep(i.out.type.value);
                    s.known.set(i.out.id, member);
                    if (escapes(i.out.id, body)) addMember(i.out.type.value, member);
                    break;
                }
                case 'call': {
                    s.knownPlaces.clear();
                    const value = get(s, i.callee),
                        incoming = i.args.map((id) => get(s, id));
                    if (value.kind !== 'callable') return fail('Call operand is not callable');
                    depend(`members:${value.type}`);
                    const options = membersOf(value.type);
                    const direct =
                        s.known.get(i.callee) ??
                        (options.length === 1 && options[0]!.kind === 'native'
                            ? options[0]
                            : undefined);
                    const args =
                        direct?.kind === 'native'
                            ? incoming
                            : incoming.map((a, n) =>
                                  canonicalArgument(
                                      a,
                                      value.type,
                                      n,
                                      specializeLensCall(source, specializeLenses, direct),
                                  ),
                              );
                    const called = invoke(
                        direct ?? { kind: 'dispatch', type: value.type, options },
                        args,
                        chain,
                        i.out.type,
                    );
                    out = called.result;
                    record.calls.push({
                        value: i.out.id,
                        target: called.target,
                        ...(called.targets ? { targets: called.targets } : {}),
                        ...(direct ? { callee: direct } : {}),
                        arguments: args,
                        result: out,
                    });
                    break;
                }
                case 'scope': {
                    s.knownPlaces.clear();
                    const nested = clone(s);
                    out = block(unit, i.body, nested, record, chain);
                    const member = nested.known.get(i.body.result);
                    if (member) s.known.set(i.out.id, member);
                    break;
                }
                case 'case': {
                    s.knownPlaces.clear();
                    const branches = i.cases.map((arm) =>
                        block(unit, arm.body, clone(s), record, chain),
                    );
                    out =
                        i.out.type.tag === 'flow'
                            ? { kind: 'lens', shape: reps.thin(i.out.type.read, i.out.type.write) }
                            : join(branches, true);
                    break;
                }
            }
            s.values.set(i.out.id, out);
            record.values.push({ value: i.out.id, representation: out });
        }
        return get(s, body.result);
    }
    // Roots and variants are independent work items. Reading a result or member
    // set registers a reverse edge, so changes revisit only dependent bodies.
    for (const [rootIndex, id] of source.roots.entries()) {
        const task = `root:${rootIndex}`;
        tasks.set(task, () => {
            const unit = units.get(id) ?? fail('Unknown representation root');
            const entry = {
                unit: id,
                values: [] as RepresentationVariant['values'],
                calls: [] as RepresentationVariant['calls'],
            };
            const rootState = fresh();
            const result = block(unit, unit.entry, rootState, entry, []);
            const incoming = options.entryArguments?.find(
                (e) => e.unit === id && (e.entry === undefined || e.entry === rootIndex),
            );
            if (result.kind === 'callable') {
                const member = rootState.known.get(unit.entry.result);
                if (member?.kind === 'native') fail('Native entry roots require a host contract');
                if (member?.kind !== 'closure')
                    fail('Dynamic callable entry roots require a host adapter');
                const root = member as Extract<CallableMember, { kind: 'closure' }>;
                const contract =
                    incoming ??
                    fail(
                        'Callable entry roots require an explicit argument representation contract',
                    );
                const fn = units.get(root.unit)!.functions.find((f) => f.id === root.function)!;
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
                const called = invoke(root, args, []);
                exports[rootIndex] = {
                    entry: rootIndex,
                    variant: called.target,
                    arguments: args,
                    result: called.result,
                };
            } else if (incoming) fail('Expression root cannot have incoming arguments');
            entries[rootIndex] = entry;
            roots[rootIndex] = { unit: id, result };
        });
        queue.add(task);
    }
    let workItems = 0;
    while (queue.size) {
        if (++workItems > workLimit)
            throw new BackendDiagnostic(
                'representation-resource-limit',
                `Representation work item resource limit ${workLimit} exceeded`,
            );
        const id = queue.values().next().value!;
        queue.delete(id);
        for (const dependency of dependencies.get(id) ?? []) dependents.get(dependency)?.delete(id);
        dependencies.delete(id);
        current = id;
        tasks.get(id)!();
    }
    current = '';
    // Topology changes can leave earlier specializations cached but unreachable.
    const byId = new Map([...variants.values()].map((v) => [v.id, v]));
    const reachable = new Set<string>();
    const visit = (id: string): void => {
        if (reachable.has(id)) return;
        const v = byId.get(id);
        if (!v) return;
        reachable.add(id);
        v.calls.forEach((c) => (c.targets ?? [c.target]).forEach(visit));
    };
    entries.forEach((e) => e.calls.forEach((c) => (c.targets ?? [c.target]).forEach(visit)));
    const finalExports = exports.filter(Boolean);
    finalExports.forEach((e) => visit(e.variant));
    const analysis: RepresentationAnalysis = {
        schemaVersion: 1,
        ...(specializeLenses.length ? { specializeLenses } : {}),
        layoutDefinitions: layouts.definitions,
        roots,
        entries,
        exports: finalExports,
        variants: [...variants.values()]
            .filter((v) => reachable.has(v.id))
            .map((v) => ({ ...v, result: v.result ?? fail('Unsolved variant result') }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        callables: [...callableTypes.keys()].sort().map((type) => ({
            type,
            signature: callableTypes.get(type)!.signature,
            members: membersOf(type),
        })),
        layouts: layouts.snapshot(),
        shapes: reps.snapshot(),
        backings: reps.backingSnapshot(),
    };
    verifyRepresentations(source, analysis);
    return freezeTree(analysis);
}
