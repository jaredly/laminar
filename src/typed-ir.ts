import type { BindingRecord, DefinitionId, SemanticFlow, SemanticType } from './elaborated.ts';

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
export type SlotRef = { place: string; path: number[]; permit?: string };
export type IRPattern = { type: SemanticType } & (
    | { kind: 'bind'; slot: SlotRef }
    | { kind: 'drop' }
    | { kind: 'literal'; value: EncodedNumber | boolean | string }
    | { kind: 'tuple'; items: IRPattern[] }
    | { kind: 'constructor'; name: string; items: IRPattern[]; instance: Instance }
);
export type Instance = {
    definition: DefinitionId;
    arguments: { parameter: string; type: SemanticType }[];
    type: SemanticType;
};
export type IRValue = { id: ValueId; type: SemanticFlow };
export type Cleanup =
    | { kind: 'drop-place'; slot: SlotRef }
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
    | (Output & { op: 'construct'; name: string; items: ValueId[]; instance: Instance })
    | (Output & { op: 'global'; instance: Instance })
    | (Output & { op: 'move'; slot: SlotRef })
    | (Output & { op: 'acquire'; slot: SlotRef })
    | (Output & { op: 'lens-tuple'; items: ValueId[] })
    | (Output & { op: 'manual'; lens: ValueId; holds: SlotRef[]; cleanup: IRBlock })
    | (Output & { op: 'swap'; lens: ValueId; value: ValueId })
    | (Output & { op: 'call'; callee: ValueId; args: ValueId[] })
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
    captures: { place: string; type: SemanticType }[];
    parameters: { pattern: IRPattern; lensPlace?: string }[];
    body: IRBlock;
};
export type IRUnit = {
    id: string;
    definition?: string;
    signature: { quantified: string[]; type: SemanticType };
    origins: { id: string; loc?: number }[];
    bindings: BindingRecord[];
    loans: { id: string; place: string; path: number[]; parent?: string; owners?: SlotRef[] }[];
    functions: IRFunction[];
    entry: IRBlock;
};
export type IRScheme = { definition: string; quantified: string[]; type: SemanticType };
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
        case 'fn':
            return {
                tag: 'fn',
                args: type.args.map((t) => mapSemanticFlow(t, variable)),
                result: mapSemanticFlow(type.result, variable),
            };
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
        case 'fn':
            return JSON.stringify(['fn', type.args.map(flowKey), flowKey(type.result)]);
    }
}
export const flowKey = (type: SemanticFlow): string =>
    type.tag === 'plain'
        ? `value:${typeKey(type.value)}`
        : `lens:${typeKey(type.read)}:${typeKey(type.write)}`;
