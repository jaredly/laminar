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
import { verifyRepresentations } from './verify-representations.ts';

export type ValueRepresentation =
    | { kind: 'data'; layout: LayoutId }
    | { kind: 'lens'; shape: LensRepId }
    | { kind: 'callable'; unit: string; function: string; captures: ValueRepresentation[] }
    | { kind: 'native'; definition: string };
export type RepresentationVariant = {
    id: string;
    key: string;
    unit: string;
    function: string;
    captures: ValueRepresentation[];
    arguments: ValueRepresentation[];
    result: ValueRepresentation;
    values: { value: string; representation: ValueRepresentation }[];
    calls: {
        value: string;
        target: string;
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
    const fresh = (): State => ({ values: new Map(), places: new Map(), lenses: new Map() });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        places: new Map(s.places),
        lenses: new Map(s.lenses),
    });
    const fail = (message: string): never => {
        throw new BackendDiagnostic('unsupported-representation', message);
    };
    const data = (type: SemanticType): ValueRepresentation => ({
        kind: 'data',
        layout: layouts.intern(type),
    });
    const get = (s: State, id: string): ValueRepresentation =>
        s.values.get(id) ?? fail(`Missing representation for ${id}`);
    const shape = (v: ValueRepresentation): LensRepId =>
        v.kind === 'lens' ? v.shape : fail('Expected lens representation');
    const key = (v: ValueRepresentation): string => JSON.stringify(v);
    const equal = (a: ValueRepresentation, b: ValueRepresentation) => key(a) === key(b);
    const join = (items: ValueRepresentation[]): ValueRepresentation => {
        const first = items[0] ?? fail('Empty representation join');
        if (items.every((v) => equal(first, v))) return first;
        throw new BackendDiagnostic(
            'unsupported-representation-join',
            'Different value or callable representations require an adapter',
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
    ): { target: string; result: ValueRepresentation } => {
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
        if (fn.type.result.tag === 'plain' && fn.type.result.value.tag !== 'fn')
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
        const deferred: IRBlock[] = [];
        for (const i of body.instructions) {
            if (i.op === 'bind') {
                bind(i.pattern, get(s, i.value), s);
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
                    if (i.out.type.tag !== 'plain') return fail('Data instruction produced a lens');
                    out = data(i.out.type.value);
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
                case 'manual':
                    if (i.out.type.tag !== 'flow') return fail('Manual produced data');
                    out = {
                        kind: 'lens',
                        shape: retype(shape(get(s, i.lens)), i.out.type.read, i.out.type.write),
                    };
                    deferred.push(i.cleanup);
                    break;
                case 'lens-tuple':
                    out = {
                        kind: 'lens',
                        shape: reps.tuple(i.items.map((id) => shape(get(s, id)))),
                    };
                    break;
                case 'swap':
                    if (i.out.type.tag !== 'plain') return fail('Swap produced a lens');
                    out = data(i.out.type.value);
                    break;
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
                            : invoke(callee, args, chain);
                    out = called.result;
                    record.calls.push({
                        value: i.out.id,
                        target: called.target,
                        arguments: args,
                        result: out,
                    });
                    break;
                }
                case 'scope':
                    out = block(unit, i.body, clone(s), record, chain);
                    break;
                case 'case': {
                    const branches = i.cases.map((arm) => {
                        const state = clone(s);
                        bind(arm.pattern, get(s, i.value), state);
                        return block(unit, arm.body, state, record, chain);
                    });
                    out =
                        i.out.type.tag === 'flow'
                            ? { kind: 'lens', shape: reps.thin(i.out.type.read, i.out.type.write) }
                            : join(branches);
                    break;
                }
            }
            s.values.set(i.out.id, out);
            record.values.push({ value: i.out.id, representation: out });
        }
        const result = get(s, body.result);
        // Analyze retained regions independently after setup, without applying
        // cleanup effects to setup state. Runtime staging/order remains in typed IR.
        for (const cleanup of deferred.reverse()) block(unit, cleanup, clone(s), record, chain);
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
    verifyRepresentations(source, analysis);
    return freezeTree(analysis);
}
