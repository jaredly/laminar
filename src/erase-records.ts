/**
 * Removes records from a specialized program, where every row is known. A record is stored as
 * the tuple of its name-sorted fields: field paths become positions, record patterns become
 * tuple patterns, and record updates become moves out of their sources and one tuple.
 */
import { semanticRecord, type SemanticType, type Step } from './elaborated.ts';
import { BackendDiagnostic } from './backend/target.ts';
import {
    eraseRecords,
    irPlain,
    irUnit,
    type Cleanup,
    type Instruction,
    type IRBlock,
    type IRPattern,
    type IRUnit,
    type SlotRef,
    type TypedProgram,
    type ValueId,
} from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';

type RecordUpdate = Extract<Instruction, { op: 'record' }>;
type Field = { name: string; type: SemanticType };
/** A pattern, plus what must run once it has bound: building each `...rest`. */
type ErasedPattern = { pattern: IRPattern; after: Instruction[]; places: string[] };

const fail = (message: string, origin?: string): never => {
    throw new BackendDiagnostic('record-erasure', message, origin);
};
const named = (path: Step[]) => path.some((step) => typeof step === 'string');
const fieldsOf = (t: SemanticType, origin: string): Field[] => {
    const record = t.tag === 'tuple' && !t.items.length ? semanticRecord([]) : t;
    return record.tag === 'record' && !record.rest
        ? record.fields
        : fail('A record is still open after specialization', origin);
};
const drops = (places: string[]): Cleanup[] =>
    places.map((place) => ({ kind: 'drop-place', slot: { place, path: [] } }));

/** `program` must be specialized: no type variables, though records and field names remain. */
export function eraseRecordForms(program: TypedProgram): TypedProgram {
    // Which position a name has depends on the record a place holds at that point, which the
    // verifier tracks. One path object is one use; the key serves the declarations of a use.
    const byUse = new Map<Step[], string>();
    const byKey = new Map<string, Set<string>>();
    const key = (unit: string, place: string, path: Step[]) => JSON.stringify([unit, place, path]);
    verifyTypedProgram(program, (unit, place, path, positions) => {
        if (!named(path)) return;
        const found = JSON.stringify(positions);
        if (byUse.has(path) && byUse.get(path) !== found)
            fail(`One use of a field path in ${unit} has two layouts`);
        byUse.set(path, found);
        const k = key(unit, place, path);
        byKey.set(k, (byKey.get(k) ?? new Set()).add(found));
    });
    const positionsOf = (unit: string, place: string, path: Step[]): number[] | undefined => {
        if (!named(path)) return path as number[];
        const use = byUse.get(path);
        if (use) return JSON.parse(use);
        const all = byKey.get(key(unit, place, path));
        return all?.size === 1 ? JSON.parse([...all][0]!) : undefined;
    };

    const eraseUnit = (unit: IRUnit): IRUnit => {
        let next = 0;
        const fresh = (kind: string) => `${unit.id}/record-${kind}${next++}`;
        const emit = (
            into: Instruction[],
            origin: string,
            operation: object,
            type: SemanticType,
            id: ValueId = fresh('value'),
        ): ValueId => {
            into.push({ ...operation, origin, out: { id, type: irPlain(type) } } as Instruction);
            return id;
        };
        const discard = (into: Instruction[], origin: string, value: ValueId, type: SemanticType) =>
            into.push({ op: 'bind', origin, value, pattern: { kind: 'drop', type } });
        const slot = (ref: SlotRef, origin: string): SlotRef => ({
            ...ref,
            path:
                positionsOf(unit.id, ref.place, ref.path) ??
                fail('A field path has no known position', origin),
        });

        const pattern = (p: IRPattern, origin: string): ErasedPattern => {
            if (p.kind === 'tuple' || p.kind === 'constructor') {
                const items = p.items.map((item) => pattern(item, origin));
                return {
                    pattern: { ...p, items: items.map((i) => i.pattern) },
                    after: items.flatMap((i) => i.after),
                    places: items.flatMap((i) => i.places),
                };
            }
            if (p.kind !== 'record') return { pattern: p, after: [], places: [] };
            const after: Instruction[] = [],
                places: string[] = [],
                others: { field: Field; place: string }[] = [];
            const items = fieldsOf(p.type, origin).map((field): IRPattern => {
                const match = p.fields.find((f) => f.name === field.name);
                if (match) {
                    const inner = pattern(match.pattern, origin);
                    after.push(...inner.after);
                    places.push(...inner.places);
                    return inner.pattern;
                }
                if (p.rest?.kind !== 'bind') return { kind: 'drop', type: field.type };
                const place = fresh('rest');
                others.push({ field, place });
                places.push(place);
                return { kind: 'bind', type: field.type, slot: { place, path: [] } };
            });
            if (p.rest?.kind === 'bind') {
                const values = others.map(({ field, place }) =>
                    emit(after, origin, { op: 'move', slot: { place, path: [] } }, field.type),
                );
                const rest = emit(after, origin, { op: 'tuple', items: values }, p.rest.type);
                after.push({ op: 'bind', origin, value: rest, pattern: p.rest });
            }
            const { fields: _, rest: __, kind: ___, ...common } = p;
            return { pattern: { ...common, kind: 'tuple', items }, after, places };
        };

        /** Returns the places it had to create, which the enclosing block disposes. */
        const update = (i: RecordUpdate, into: Instruction[]): string[] => {
            type Source = { value: ValueId } | { part: number };
            const result = new Map<string, Source & { type: SemanticType }>();
            const unused: { value: ValueId; type: SemanticType }[] = [];
            const operandTypes = new Map<ValueId, SemanticType>();
            for (const earlier of into)
                if ('out' in earlier && earlier.out.type.tag === 'plain')
                    operandTypes.set(earlier.out.id, earlier.out.type.value);
            const replaced = (name: string) => {
                const old = result.get(name);
                if (old && 'value' in old) unused.push({ value: old.value, type: old.type });
            };
            i.parts.forEach((part, index) => {
                if (part.kind === 'spread') {
                    for (const f of fieldsOf(part.type, i.origin))
                        result.set(f.name, { part: index, type: f.type });
                    return;
                }
                if (part.op !== 'extend') replaced(part.name);
                if (part.op === 'remove') {
                    result.delete(part.name);
                    return;
                }
                const type =
                    operandTypes.get(part.value!) ??
                    fail('A record operand is not in its block', i.origin);
                result.set(part.name, { value: part.value!, type });
            });
            const values = new Map<string, ValueId>(),
                places: string[] = [];
            i.parts.forEach((part, index) => {
                if (part.kind !== 'spread') return;
                const fields = fieldsOf(part.type, i.origin);
                const survives = fields.map((f) => {
                    const source = result.get(f.name);
                    return !!source && 'part' in source && source.part === index;
                });
                const take = (n: number, from: SlotRef) =>
                    values.set(
                        fields[n]!.name,
                        emit(into, i.origin, { op: 'move', slot: from }, fields[n]!.type),
                    );
                if ('slot' in part.source) {
                    const base = slot(part.source.slot, i.origin);
                    fields.forEach((_, n) => {
                        if (survives[n]) take(n, { ...base, path: [...base.path, n] });
                    });
                    // Whatever stays behind is dropped here, and the place becomes empty.
                    const nothing: Instruction[] = [];
                    const unit_ = emit(
                        nothing,
                        i.origin,
                        { op: 'constant', value: null },
                        irUnit(),
                    );
                    const done = emit(
                        into,
                        i.origin,
                        {
                            op: 'scope',
                            body: {
                                origin: i.origin,
                                instructions: nothing,
                                result: unit_,
                                cleanup: [{ kind: 'drop-place', slot: base }],
                            },
                        },
                        irUnit(),
                    );
                    discard(into, i.origin, done, irUnit());
                    return;
                }
                const targets = fields.map((f, n) => (survives[n] ? fresh('spread') : undefined));
                into.push({
                    op: 'bind',
                    origin: i.origin,
                    value: part.source.value,
                    pattern: {
                        kind: 'tuple',
                        type: semanticRecord(fields),
                        items: fields.map((f, n): IRPattern =>
                            targets[n]
                                ? {
                                      kind: 'bind',
                                      type: f.type,
                                      slot: { place: targets[n]!, path: [] },
                                  }
                                : { kind: 'drop', type: f.type },
                        ),
                    },
                });
                targets.forEach((place, n) => {
                    if (!place) return;
                    places.push(place);
                    take(n, { place, path: [] });
                });
            });
            for (const { value, type } of unused) discard(into, i.origin, value, type);
            const items = [...result]
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([name, source]) => ('value' in source ? source.value : values.get(name)!));
            into.push({ op: 'tuple', origin: i.origin, items, out: i.out });
            return places;
        };

        const block = (b: IRBlock): IRBlock => {
            const instructions: Instruction[] = [],
                places: string[] = [];
            for (const i of b.instructions) {
                if (i.op === 'record') places.push(...update(i, instructions));
                else if (i.op === 'bind') {
                    const erased = pattern(i.pattern, i.origin);
                    instructions.push({ ...i, pattern: erased.pattern }, ...erased.after);
                    places.push(...erased.places);
                } else if (i.op === 'scope') instructions.push({ ...i, body: block(i.body) });
                else if (i.op === 'aslens')
                    instructions.push({
                        ...i,
                        cleanup: block(i.cleanup),
                        ...(i.reconstruction
                            ? { reconstruction: pattern(i.reconstruction, i.origin).pattern }
                            : {}),
                    });
                else if (i.op === 'case')
                    instructions.push({
                        ...i,
                        cases: i.cases.map((arm) => {
                            const erased = pattern(arm.pattern, i.origin);
                            return {
                                ...arm,
                                pattern: erased.pattern,
                                body: prefixed(block(arm.body), [erased]),
                            };
                        }),
                    });
                else instructions.push(i);
            }
            return { ...b, instructions, cleanup: [...drops(places), ...b.cleanup] };
        };
        const prefixed = (b: IRBlock, patterns: ErasedPattern[]): IRBlock => ({
            ...b,
            instructions: [...patterns.flatMap((p) => p.after), ...b.instructions],
            cleanup: [...drops(patterns.flatMap((p) => p.places)), ...b.cleanup],
        });

        const rewritten: IRUnit = {
            ...unit,
            entry: block(unit.entry),
            functions: unit.functions.map((f) => {
                const patterns = f.parameters.map((p) => pattern(p.pattern, f.origin));
                return {
                    ...f,
                    parameters: f.parameters.map((p, i) => ({
                        ...p,
                        pattern: patterns[i]!.pattern,
                    })),
                    body: prefixed(block(f.body), patterns),
                };
            }),
        };
        // Every remaining place and path, in cleanups, loans and declarations alike.
        const visit = (value: unknown): unknown => {
            if (Array.isArray(value)) return value.map(visit);
            if (!value || typeof value !== 'object') return value;
            const object = value as Record<string, unknown>;
            const entries = Object.entries(object).map(([k, v]): [string, unknown] => [
                k,
                k === 'path' ? v : visit(v),
            ]);
            if (typeof object.place === 'string' && Array.isArray(object.path)) {
                const positions = positionsOf(unit.id, object.place, object.path as Step[]);
                // A binding nothing uses has no position to give; only its name is read later.
                if (!positions && !('initialType' in object))
                    fail(`A field path in ${unit.id} has no known position`);
                return { ...Object.fromEntries(entries), path: positions ?? [] };
            }
            return Object.fromEntries(entries);
        };
        return visit(rewritten) as IRUnit;
    };

    return eraseRecords({ ...program, units: program.units.map(eraseUnit) });
}
