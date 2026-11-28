/**
 * Writes dependencies out of a specialized program, where every row is known. A function that
 * needs anything takes a record of the entries it can read as a hidden first parameter; calls
 * pass it, and `#name` and `inject` become reads and constructions of such records. The result
 * is ordinary IR, with records, so no later stage knows about dependencies.
 */
import { semanticRecord, type SemanticFlow, type SemanticType } from './elaborated.ts';
import { BackendDiagnostic } from './backend/target.ts';
import {
    irPlain,
    irUnit,
    mapSemantic,
    typeKey,
    type Cleanup,
    type Instruction,
    type IRBlock,
    type IRFunction,
    type IRPattern,
    type IRScheme,
    type IRUnit,
    type SlotRef,
    type TypedProgram,
    type ValueId,
} from './typed-ir.ts';

type Entry = { name: string; type: SemanticType };
type FunctionType = SemanticType & { tag: 'fn' };
/** The record a block's code can read: where it is stored, and its entries. */
type Ambient = { place?: string; entries: Entry[] };

const fail = (code: string, message: string, origin?: string): never => {
    throw new BackendDiagnostic(code, message, origin);
};

/** The entries a row lets code read: the first of each name. */
const readable = (row: SemanticType | undefined): Entry[] => {
    if (!row || row.tag !== 'needs') return [];
    const seen = new Set<string>();
    return row.entries.filter((e) => !seen.has(e.name) && !!seen.add(e.name));
};
const recordOf = (entries: Entry[]): SemanticType => semanticRecord(entries);
const shared = (value: SemanticType): SemanticFlow => ({ tag: 'plain', value, mode: 'shared' });

/** A function type with its needs written as a first parameter. Open rows are left alone. */
function lowerType(t: SemanticType): SemanticType {
    const flow = (f: SemanticFlow): SemanticFlow =>
        f.tag === 'plain'
            ? { ...f, value: lowerType(f.value) }
            : { ...f, read: lowerType(f.read), write: lowerType(f.write) };
    switch (t.tag) {
        case 'variable':
            return t;
        case 'con':
            return { ...t, args: t.args.map(lowerType) };
        case 'tuple':
            return { ...t, items: t.items.map(lowerType) };
        case 'record':
            return {
                ...t,
                fields: t.fields.map((f) => ({ name: f.name, type: lowerType(f.type) })),
            };
        case 'needs':
            // A union's row argument. Its layouts are derived before specialization.
            return readable(t).length
                ? fail(
                      'unsupported-needs-in-union',
                      'A union holding a function that needs dependencies cannot be compiled yet',
                  )
                : irUnit();
        case 'fn': {
            const lowered: FunctionType = {
                ...t,
                args: t.args.map(flow),
                result: flow(t.result),
            };
            if (t.needs?.tag === 'variable') return lowered;
            const entries = readable(t.needs);
            delete lowered.needs;
            if (entries.length)
                lowered.args = [shared(lowerType(recordOf(entries))), ...lowered.args];
            return lowered;
        }
    }
}

/** Every type in a structure, whatever holds it. */
function lowerTypes<T>(value: T): T {
    if (Array.isArray(value)) return value.map(lowerTypes) as T;
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (['variable', 'con', 'tuple', 'record', 'needs', 'fn'].includes(String(node.tag)))
        return lowerType(value as unknown as SemanticType) as T;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, lowerTypes(v)])) as T;
}

/** Import signatures as the lowered program uses them: constructors may state needs. */
export const lowerImportNeeds = (imports: IRScheme[]): IRScheme[] =>
    imports.map((i) => ({ ...i, type: lowerType(i.type) }));

export function lowerNeeds(program: TypedProgram, imports: readonly IRScheme[]): TypedProgram {
    const dup = imports.find((i) => i.definition === 'native/dup');
    let usedDup = false;

    const lowerUnit = (unit: IRUnit): IRUnit => {
        let next = 0;
        const fresh = (kind: string) => `${unit.id}/needs-${kind}${next++}`;
        const types = new Map<ValueId, SemanticType>();
        const index = (b: IRBlock): void =>
            b.instructions.forEach((i) => {
                if ('out' in i && i.out.type.tag === 'plain') types.set(i.out.id, i.out.type.value);
                if (i.op === 'scope' || i.op === 'inject') index(i.body);
                else if (i.op === 'aslens') index(i.cleanup);
                else if (i.op === 'case') i.cases.forEach((c) => index(c.body));
            });
        index(unit.entry);
        unit.functions.forEach((f) => index(f.body));
        const typeOf = (id: ValueId, origin: string) =>
            types.get(id) ?? fail('needs-lowering', 'A value has no type', origin);
        const functionType = (t: SemanticType, origin: string): FunctionType =>
            t.tag === 'fn' ? t : fail('needs-lowering', 'Expected a function', origin);
        /** Values that turned out to need no instruction of their own. */
        const renamed = new Map<ValueId, ValueId>();
        const wrappers: IRFunction[] = [];

        const emit = (
            into: Instruction[],
            origin: string,
            operation: object,
            type: SemanticFlow,
            id: ValueId = fresh('value'),
        ): ValueId => {
            into.push({ ...operation, origin, out: { id, type } } as Instruction);
            return id;
        };
        const move = (
            into: Instruction[],
            origin: string,
            place: string,
            type: SemanticType,
        ): ValueId => emit(into, origin, { op: 'move', slot: { place, path: [] } }, irPlain(type));
        const drop = (place: string): Cleanup => ({
            kind: 'drop-place',
            slot: { place, path: [] },
        });
        const bind = (place: string, type: SemanticType): IRPattern => ({
            kind: 'bind',
            type,
            slot: { place, path: [] },
        });
        /** A copy of stored data: shared, which nothing writes, unless it must be its own. */
        const read = (
            into: Instruction[],
            origin: string,
            slot: SlotRef,
            type: SemanticType,
            result: SemanticFlow,
            id?: ValueId,
        ): ValueId => {
            const scheme = dup ?? fail('needs-lowering', 'The program has no `dup`', origin);
            usedDup = true;
            const signature = mapSemantic(scheme.type, (v) =>
                v === scheme.quantified[0] ? type : undefined,
            );
            const focus = emit(
                into,
                origin,
                { op: 'acquire', slot },
                { tag: 'flow', read: type, write: type },
            );
            const callee = emit(
                into,
                origin,
                {
                    op: 'global',
                    instance: {
                        definition: scheme.definition,
                        arguments: [{ parameter: scheme.quantified[0]!, type }],
                        type: signature,
                    },
                },
                irPlain(signature),
            );
            const share = result.tag === 'plain' && result.mode === 'shared';
            return emit(
                into,
                origin,
                { op: 'call', callee, args: [focus], ...(share ? { share: true } : {}) },
                result,
                id,
            );
        };
        const entrySlot = (ambient: Ambient, name: string, origin: string): SlotRef => ({
            place: ambient.place ?? fail('needs-lowering', `Nothing provides ${name} here`, origin),
            path: [name],
        });
        /** Reads of `names` from the ambient record. */
        const reads = (
            into: Instruction[],
            origin: string,
            ambient: Ambient,
            wanted: Entry[],
            copies: boolean,
        ): Map<string, ValueId> =>
            new Map(
                wanted.map((e) => [
                    e.name,
                    read(
                        into,
                        origin,
                        entrySlot(ambient, e.name, origin),
                        e.type,
                        copies ? irPlain(e.type) : shared(e.type),
                    ),
                ]),
            );
        const record = (
            into: Instruction[],
            origin: string,
            entries: Entry[],
            values: Map<string, ValueId>,
        ): ValueId => {
            const type = recordOf(entries);
            const items = type.tag === 'record' ? type.fields.map((f) => values.get(f.name)!) : [];
            return emit(into, origin, { op: 'tuple', items }, shared(type));
        };
        /** The record to hand a callee that reads `wanted`. */
        const supplyRecord = (
            into: Instruction[],
            origin: string,
            ambient: Ambient,
            wanted: Entry[],
            copies: boolean,
        ): ValueId => {
            const type = recordOf(wanted);
            if (ambient.place && typeKey(type) === typeKey(recordOf(ambient.entries)))
                return read(
                    into,
                    origin,
                    { place: ambient.place, path: [] },
                    type,
                    copies ? irPlain(type) : shared(type),
                );
            return record(into, origin, wanted, reads(into, origin, ambient, wanted, copies));
        };

        /**
         * A closure around the function value `inner` that either ignores the dependencies it
         * is given (`widen`), or passes on the ones it was built with (`supply`).
         */
        const adapter = (
            into: Instruction[],
            origin: string,
            out: { id: ValueId; type: SemanticFlow },
            inner: ValueId,
            captured?: { value: ValueId; type: SemanticType },
        ): void => {
            const id = `${out.id}/adapter`;
            const type = functionType(
                out.type.tag === 'plain'
                    ? out.type.value
                    : fail('needs-lowering', 'An adapter is not a function', origin),
                origin,
            );
            const held = typeOf(inner, origin);
            const innerPlace = `${id}/inner`,
                recordPlace = `${id}/record`;
            const ignored = readable(type.needs);
            const parameters = type.args.map((arg, n) => ({
                place: `${id}/a${n}`,
                type:
                    arg.tag === 'plain'
                        ? arg.value
                        : fail(
                              'unsupported-dependency',
                              'A function with lens parameters cannot be adapted',
                              origin,
                          ),
            }));
            const instructions: Instruction[] = [];
            const callee = move(instructions, origin, innerPlace, held);
            const args = [
                ...(captured ? [move(instructions, origin, recordPlace, captured.type)] : []),
                ...parameters.map((p) => move(instructions, origin, p.place, p.type)),
            ];
            const result = emit(instructions, origin, { op: 'call', callee, args }, type.result);
            const ignoredPlace = `${id}/ignored`;
            wrappers.push({
                id,
                origin,
                // Written lowered, apart from the types, which are lowered with the rest.
                type,
                captures: [
                    { place: innerPlace, type: held },
                    ...(captured ? [{ place: recordPlace, type: captured.type }] : []),
                ],
                parameters: [
                    ...(ignored.length ? [{ pattern: bind(ignoredPlace, recordOf(ignored)) }] : []),
                    ...parameters.map((p) => ({ pattern: bind(p.place, p.type) })),
                ],
                body: {
                    origin,
                    instructions,
                    result,
                    cleanup: [
                        ...(ignored.length ? [drop(ignoredPlace)] : []),
                        ...parameters.map((p) => drop(p.place)),
                        drop(innerPlace),
                        ...(captured ? [drop(recordPlace)] : []),
                    ],
                },
            });
            into.push({
                op: 'closure',
                origin,
                function: id,
                captures: [
                    { place: innerPlace, value: inner },
                    ...(captured ? [{ place: recordPlace, value: captured.value }] : []),
                ],
                out,
            });
        };

        const block = (b: IRBlock, ambient: Ambient): IRBlock => {
            const out: Instruction[] = [];
            const name = (id: ValueId) => renamed.get(id) ?? id;
            /** `i` with its operands renamed. Places and types are not operands. */
            const operands = (i: any): any => ({
                ...i,
                ...(i.value !== undefined && typeof i.value === 'string'
                    ? { value: name(i.value) }
                    : {}),
                ...(i.items ? { items: i.items.map(name) } : {}),
                ...(i.callee ? { callee: name(i.callee) } : {}),
                ...(i.args ? { args: i.args.map(name) } : {}),
                ...(i.lens ? { lens: name(i.lens) } : {}),
                ...(i.initial ? { initial: name(i.initial) } : {}),
                ...(i.captures
                    ? {
                          captures: i.captures.map((c: any) => ({ ...c, value: name(c.value) })),
                      }
                    : {}),
                ...(i.parts
                    ? {
                          parts: i.parts.map((p: any) => ({
                              ...p,
                              ...(typeof p.value === 'string' ? { value: name(p.value) } : {}),
                              ...(p.source?.value
                                  ? { source: { value: name(p.source.value) } }
                                  : {}),
                          })),
                      }
                    : {}),
            });
            for (const original of b.instructions) {
                // A `constant`'s value is data, not an operand.
                const i: Instruction = original.op === 'constant' ? original : operands(original);
                if (i.op === 'need') {
                    const type =
                        i.out.type.tag === 'plain'
                            ? i.out.type.value
                            : fail('needs-lowering', 'A dependency is not data', i.origin);
                    read(
                        out,
                        i.origin,
                        entrySlot(ambient, i.name, i.origin),
                        type,
                        i.out.type,
                        i.out.id,
                    );
                } else if (i.op === 'inject') {
                    const entry = { name: i.name, type: typeOf(i.value, i.origin) };
                    const kept = ambient.entries.filter((e) => e.name !== i.name);
                    const entries = [entry, ...kept];
                    const place = fresh('record');
                    const setup: Instruction[] = [];
                    const values = reads(setup, i.origin, ambient, kept, false);
                    values.set(i.name, i.value);
                    const value = record(setup, i.origin, entries, values);
                    setup.push({
                        op: 'bind',
                        origin: i.origin,
                        value,
                        pattern: bind(place, recordOf(entries)),
                    });
                    const body = block(i.body, { place, entries });
                    out.push({
                        op: 'scope',
                        origin: i.origin,
                        out: i.out,
                        body: {
                            ...body,
                            instructions: [...setup, ...body.instructions],
                            cleanup: [...body.cleanup, drop(place)],
                        },
                    });
                } else if (i.op === 'supply' || i.op === 'widen') {
                    const held = functionType(typeOf(i.value, i.origin), i.origin);
                    const target = functionType(typeOf(i.out.id, i.origin), i.origin);
                    const wanted = readable(i.op === 'supply' ? held.needs : target.needs);
                    if (!wanted.length) renamed.set(i.out.id, i.value);
                    else if (i.op === 'widen') adapter(out, i.origin, i.out, i.value);
                    else {
                        const value = supplyRecord(out, i.origin, ambient, wanted, false);
                        adapter(out, i.origin, i.out, i.value, {
                            value,
                            type: recordOf(wanted),
                        });
                    }
                } else if (i.op === 'call') {
                    const callee = functionType(typeOf(i.callee, i.origin), i.origin);
                    const wanted = readable(callee.needs);
                    if (!wanted.length) out.push(i);
                    else {
                        // A spawned task shares nothing that its spawner could change.
                        const value = supplyRecord(out, i.origin, ambient, wanted, !!i.detached);
                        out.push({ ...i, args: [value, ...i.args] });
                    }
                } else if (i.op === 'scope') out.push({ ...i, body: block(i.body, ambient) });
                else if (i.op === 'aslens')
                    out.push({ ...i, cleanup: block(i.cleanup, { entries: [] }) });
                else if (i.op === 'case')
                    out.push({
                        ...i,
                        cases: i.cases.map((c) => ({ ...c, body: block(c.body, ambient) })),
                    });
                else out.push(i);
            }
            return { ...b, instructions: out, result: name(b.result) };
        };

        const functions = unit.functions.map((f): IRFunction => {
            const entries = readable(f.type.needs);
            if (!entries.length) return { ...f, body: block(f.body, { entries }) };
            const place = `${f.id}/needs`;
            const body = block(f.body, { place, entries });
            return {
                ...f,
                parameters: [{ pattern: bind(place, recordOf(entries)) }, ...f.parameters],
                body: { ...body, cleanup: [...body.cleanup, drop(place)] },
            };
        });
        const entry = block(unit.entry, { entries: [] });
        const signature = { ...unit.signature };
        // The hidden parameter comes first, so the others move along.
        if (
            signature.callsOnce &&
            signature.type.tag === 'fn' &&
            readable(signature.type.needs).length
        )
            signature.callsOnce = signature.callsOnce.map((n) => n + 1);
        return lowerTypes({ ...unit, signature, functions: [...functions, ...wrappers], entry });
    };

    const units = program.units.map(lowerUnit);
    const present = new Set(program.imports.map((i) => i.definition));
    return {
        ...program,
        imports: lowerImportNeeds([
            ...program.imports,
            ...(usedDup && !present.has('native/dup') ? [dup!] : []),
        ]),
        units,
    };
}
