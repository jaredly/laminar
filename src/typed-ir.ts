import type { Bound } from './constraints.ts';
import {
    semanticRecord,
    semanticNeeds,
    needsProperty,
    type BindingRecord,
    type DefinitionId,
    type SemanticFlow,
    type SemanticType,
    type Step,
} from './elaborated.ts';
import type { RecordOp } from './ast.ts';
import type { RowConstraint } from './types.ts';

export type ValueId = string;
export type EncodedNumber = number | { number: 'NaN' | 'Infinity' | '-Infinity' | '-0' };
export function encodeNumber(value: number): EncodedNumber {
    return Number.isNaN(value)
        ? { number: 'NaN' }
        : value === Infinity
          ? { number: 'Infinity' }
          : value === -Infinity
            ? { number: '-Infinity' }
            : Object.is(value, -0)
              ? { number: '-0' }
              : value;
}
export function decodeNumber(value: EncodedNumber): number {
    return typeof value === 'number'
        ? value
        : value.number === 'NaN'
          ? NaN
          : value.number === 'Infinity'
            ? Infinity
            : value.number === '-Infinity'
              ? -Infinity
              : -0;
}
export type SlotRef = { place: string; path: Step[]; permit?: string };
/** A path in specialized IR, where records are gone and every step is a position. */
export const positions = (path: Step[]): number[] => path as number[];
export type IRPattern = {
    type: SemanticType;
    reconstructionOwner?: SlotRef;
    reconstructionId?: string;
} & (
    | { kind: 'bind'; slot: SlotRef }
    | { kind: 'drop' }
    | { kind: 'literal'; value: EncodedNumber | boolean | string }
    | { kind: 'tuple'; items: IRPattern[] }
    /**
     * Matches a record by field name. Without `rest`, the unnamed fields are dropped, or in a
     * lens pattern left alone. Specialization turns it into a tuple pattern.
     */
    | { kind: 'record'; fields: { name: string; pattern: IRPattern }[]; rest?: IRPattern }
    | { kind: 'constructor'; name: string; items: IRPattern[]; instance: Instance }
);
/** The patterns nested directly in a record pattern. */
export const subpatterns = (p: IRPattern & { kind: 'record' }): IRPattern[] => [
    ...p.fields.map((f) => f.pattern),
    ...(p.rest ? [p.rest] : []),
];
export type Instance = {
    definition: DefinitionId;
    arguments: { parameter: string; type: SemanticType }[];
    type: SemanticType;
};
export type IRValue = { id: ValueId; type: SemanticFlow };
export type RecordPart =
    | {
          kind: 'spread';
          source: { slot: SlotRef } | { value: ValueId };
          /** What the source holds when it is taken; emptied parts are unit. */
          type: SemanticType;
      }
    | { kind: 'field'; op: RecordOp; name: string; value?: ValueId };
export type Cleanup =
    | { kind: 'drop-place'; slot: SlotRef }
    /** Run the restore of the owned lens held in this place: a `mut ~` parameter or capture. */
    | { kind: 'end'; slot: SlotRef }
    | { kind: 'release'; loan: string }
    | { kind: 'restored'; slot: SlotRef; type: SemanticType };
export type IRBlock = {
    origin: string;
    instructions: Instruction[];
    result: ValueId;
    cleanup: Cleanup[];
};
type Output = { origin: string; out: IRValue };
export type Instruction =
    | (Output & { op: 'constant'; value: EncodedNumber | boolean | null })
    | (Output & { op: 'string'; head: string; parts: { value: ValueId; tail: string }[] })
    | (Output & { op: 'tuple'; items: ValueId[] })
    /**
     * A record update: the parts apply in order to an empty record. A spread takes its source,
     * a value or a place whose emptied fields a later part removes or replaces. Specialization
     * expands it into moves and a tuple.
     */
    | (Output & { op: 'record'; parts: RecordPart[] })
    /** A copy of the visible entry `name` of what the enclosing function needs. */
    | (Output & { op: 'need'; name: string })
    /** Run `body` needing `name` too: the value goes in front, hiding any other of that name. */
    | (Output & { op: 'inject'; name: string; value: ValueId; body: IRBlock })
    /** Supply a function what it needs, from here: the result needs nothing. */
    | (Output & { op: 'supply'; value: ValueId })
    /** The converse: a function that needs nothing, as one with needs, which it ignores. */
    | (Output & { op: 'widen'; value: ValueId })
    | (Output & { op: 'construct'; name: string; items: ValueId[]; instance: Instance })
    | (Output & { op: 'global'; instance: Instance })
    | (Output & { op: 'move'; slot: SlotRef })
    | (Output & { op: 'acquire'; slot: SlotRef })
    | (Output & { op: 'lens-tuple'; items: ValueId[] })
    /**
     * A constructor of lenses: a tag plus one lens per field, with no storage of its own.
     * `instance` is the constructor at the fields' read types and `writeInstance` at their
     * write types; `out` is a lens from the first result type to the second. Over a
     * multi-constructor type `out` is not replaceable.
     */
    | (Output & {
          op: 'lens-construct';
          name: string;
          items: ValueId[];
          instance: Instance;
          writeInstance: Instance;
      })
    | (Output & {
          op: 'aslens';
          initial: ValueId;
          backing: string;
          reconstruction?: IRPattern;
          holds: SlotRef[];
          cleanup: IRBlock;
      })
    | (Output & { op: 'swap'; lens: ValueId; value: ValueId })
    /**
     * Take an owned lens out of whatever holds it, a scope's loan or a place, without restoring
     * it. Its restore leaves with the value, which a `mut ~` argument or a capture consumes.
     */
    | (Output & { op: 'give'; from: { loan: string } | { place: string } })
    /**
     * `share` marks the read of a plain binding: the result is shared storage (the out type's
     * mode is `shared`) instead of a fresh owned copy. A backend may alias it; until then it
     * is still a `dup`.
     */
    | (Output & { op: 'call'; callee: ValueId; args: ValueId[]; share?: true; detached?: true })
    | (Output & { op: 'closure'; function: string; captures: { place: string; value: ValueId }[] })
    | (Output & { op: 'scope'; body: IRBlock })
    | (Output & {
          op: 'case';
          value: ValueId;
          cases: { pattern: IRPattern; body: IRBlock; setup?: Cleanup[]; restored?: Cleanup[] }[];
      })
    | { op: 'bind'; origin: string; value: ValueId; pattern: IRPattern }
    | { op: 'borrow'; origin: string; loan: string; lens: ValueId };
export type IRFunction = {
    id: string;
    origin: string;
    type: SemanticType & { tag: 'fn' };
    /** `lens`: the capture is an owned lens focusing `type`, which must end holding `write`. */
    captures: { place: string; type: SemanticType; lens?: { write: SemanticType } }[];
    parameters: { pattern: IRPattern; lensPlace?: string }[];
    body: IRBlock;
};
export type IRUnit = {
    id: string;
    definition?: string;
    signature: Pick<IRScheme, 'quantified' | 'bounds' | 'rows' | 'callsOnce' | 'type'>;
    origins: { id: string; loc?: number }[];
    bindings: BindingRecord[];
    loans: { id: string; place: string; path: Step[]; parent?: string; owners?: SlotRef[] }[];
    functions: IRFunction[];
    entry: IRBlock;
};
export type IRScheme = {
    definition: string;
    linearResult?: true;
    quantified: string[];
    bounds?: Bound[];
    rows?: RowConstraint[];
    callsOnce?: readonly number[];
    type: SemanticType;
};
export type TypedProgram = { schemaVersion: 1; imports: IRScheme[]; units: IRUnit[] };

export const irPlain = (value: SemanticType): SemanticFlow => ({ tag: 'plain', value });
export const irUnit = (): SemanticType => ({ tag: 'tuple', items: [] });
export const irCon = (name: string, ...args: SemanticType[]): SemanticType => ({
    tag: 'con',
    name,
    args,
});

export function mapSemantic(
    type: SemanticType,
    variable: (id: string) => SemanticType | undefined,
): SemanticType {
    switch (type.tag) {
        case 'variable':
            return variable(type.id) ?? type;
        case 'con':
            return { ...type, args: type.args.map((t) => mapSemantic(t, variable)) };
        case 'tuple':
            return { ...type, items: type.items.map((t) => mapSemantic(t, variable)) };
        case 'record':
            return semanticRecord(
                type.fields.map((f) => ({ name: f.name, type: mapSemantic(f.type, variable) })),
                type.rest && mapSemantic(type.rest, variable),
            );
        case 'fn':
            return {
                tag: 'fn',
                args: type.args.map((t) => mapSemanticFlow(t, variable)),
                result: mapSemanticFlow(type.result, variable),
                ...(type.capture ? { capture: type.capture } : {}),
                ...needsProperty(type.needs && mapSemantic(type.needs, variable)),
            };
        case 'needs':
            return semanticNeeds(
                type.entries.map((e) => ({ name: e.name, type: mapSemantic(e.type, variable) })),
                type.rest && mapSemantic(type.rest, variable),
            );
    }
}
export function mapSemanticFlow(
    type: SemanticFlow,
    variable: (id: string) => SemanticType | undefined,
): SemanticFlow {
    return type.tag === 'plain'
        ? irPlain(mapSemantic(type.value, variable))
        : {
              tag: 'flow',
              read: mapSemantic(type.read, variable),
              write: mapSemantic(type.write, variable),
              ...(type.replaceable === false ? { replaceable: false as const } : {}),
              ...(type.owned ? { owned: true as const } : {}),
          };
}
/** Types are structural; property insertion order and solver-local identities do not participate. */
export function typeKey(type: SemanticType): string {
    switch (type.tag) {
        case 'variable':
            return JSON.stringify(['variable', type.id, type.rigid]);
        case 'con':
            return JSON.stringify(['con', type.name, type.args.map(typeKey)]);
        case 'tuple':
            return JSON.stringify(['tuple', type.items.map(typeKey)]);
        case 'record':
            return JSON.stringify([
                'record',
                type.fields.map((f) => [f.name, typeKey(f.type)]),
                type.rest ? typeKey(type.rest) : null,
            ]);
        case 'fn':
            return JSON.stringify([
                'fn',
                type.args.map(flowKey),
                flowKey(type.result),
                ...(type.needs ? [typeKey(type.needs)] : []),
            ]);
        case 'needs':
            return JSON.stringify([
                'needs',
                type.entries.map((e) => [e.name, typeKey(e.type)]),
                type.rest ? typeKey(type.rest) : null,
            ]);
    }
}
export const flowKey = (type: SemanticFlow): string =>
    type.tag === 'plain'
        ? `value:${typeKey(type.value)}`
        : `lens${type.replaceable === false ? '!' : ''}${type.owned ? 'own' : ''}:${typeKey(type.read)}:${typeKey(type.write)}`;
/** A lens value against the position it fills: ownership belongs to the position alone. */
export const valueKey = (type: SemanticFlow): string =>
    flowKey(type.tag === 'flow' ? { ...type, owned: undefined } : type);

/**
 * Backends never see record types: a record is stored as the tuple of its
 * name-sorted fields. Open records stay, for the generic program a specialization keeps
 * beside its output; specialization itself erases only after substituting rows.
 */
export function eraseRecords<T>(value: T): T {
    if (Array.isArray(value)) return value.map(eraseRecords) as T;
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (node.tag === 'record' && Array.isArray(node.fields) && !node.rest)
        return {
            tag: 'tuple',
            items: (node.fields as { type: unknown }[]).map((f) => eraseRecords(f.type)),
        } as T;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, eraseRecords(v)])) as T;
}
