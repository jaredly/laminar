import type { TargetConfig } from './backend/target.ts';
import type { SpecializedProgram } from './specialize.ts';
import type { RepresentationAnalysis, ValueRepresentation } from './infer-representations.ts';
import type { IRBlock, Instruction, IRPattern, Cleanup, SlotRef } from './typed-ir.ts';

export type ConcreteField = { name: string } & (
    | { kind: 'value'; layout: string }
    | { kind: 'pointer'; layout?: string }
    | { kind: 'code'; abi: string }
);
export type ConcreteLayout = {
    id: string;
    key: string;
    kind: 'f64' | 'bool' | 'unit' | 'record' | 'union';
    fields: ConcreteField[];
};
/** Every callable entry receives one opaque environment pointer before its typed arguments. */
export type ConcreteABI = {
    id: string;
    key: string;
    environment: 'opaque-pointer';
    arguments: string[];
    result: string;
};
export type ConcreteWrapper = {
    id: string;
    key: string;
    abi: string;
    environment: string;
} & (
    | { kind: 'invoke'; code: string; ownership: 'transfer-captures-and-free' }
    | { kind: 'native'; definition: string; ownership: 'no-environment' }
    | {
          kind: 'adapt-result';
          source: string;
          from: string;
          to: string;
          entries: { source: string; target: string }[];
          ownership: 'transfer-result';
      }
    | {
          kind: 'adapt-aggregate-result';
          source: string;
          adapter: ConcreteValueAdapter;
          ownership: 'transfer-result';
      }
    | {
          kind: 'adapt-lens-result';
          source: string;
          from: string;
          to: string;
          ownership: 'restore-source-and-release';
          order: ['restore-source', 'release'];
      }
    | { kind: 'dispose'; captures: string[]; ownership: 'drop-captures-and-free' }
    | {
          kind: 'dispatch';
          targets: { callable: string; wrapper: string }[];
          ownership: 'selected-environment';
      }
);
export type CallableLayout = {
    id: string;
    descriptor: ValueRepresentation;
    layout: string;
    environment: string;
    dispose: string;
    entries: { wrapper: string; abi: string; field: string }[];
};
type ConcreteOutput = {
    out: Instruction extends infer I
        ? I extends { out: infer O }
            ? O & { layout: string }
            : never
        : never;
};
/** Affine by-value conversion of one selected branch result. */
export type ConcreteValueAdapter = { from: string; to: string } & (
    | { kind: 'move' }
    | { kind: 'aggregate'; items: ConcreteValueAdapter[] }
    | { kind: 'callable'; callable: string; entries: { source: string; target: string }[] }
);
export type ConcreteInstruction =
    | Extract<Instruction, { op: 'bind' | 'borrow' }>
    | (Exclude<
          Instruction,
          { op: 'bind' | 'borrow' | 'scope' | 'case' | 'call' | 'global' | 'closure' | 'manual' }
      > &
          ConcreteOutput)
    | ({
          op: 'manual';
          reconstruction?: IRPattern;
          origin: string;
          lens: string;
          holds: SlotRef[];
          cleanup: ConcreteBlock;
          restoration: {
              kind: 'deferred';
              frontend: string;
              result: string;
              order: ['stage', 'cleanup', 'dispose-result', 'restore', 'release'];
              retention: 'through-enclosing-cleanup';
              storageTransitions?: {
                  place: string;
                  before: string;
                  after: string;
                  ownership: 'transfer-cleanup-storage';
              }[];
          };
      } & ConcreteOutput)
    | ({ op: 'scope'; origin: string; body: ConcreteBlock } & ConcreteOutput)
    | ({
          op: 'case';
          origin: string;
          value: string;
          cases: {
              pattern: IRPattern;
              body: ConcreteBlock;
              setup?: Cleanup[];
              restored?: Cleanup[];
          }[];
          cleanupJoins?: {
              place: string;
              ownership: 'transfer-selected-cleanup-storage';
              order: ['cleanup', 'normalize', 'merge'];
              arms: ConcreteValueAdapter[];
          }[];
          storageJoins?: {
              place: string;
              ownership: 'transfer-selected-storage';
              arms: ConcreteValueAdapter[];
              restoration?: {
                  ownership: 'retain-selected-storage';
                  order: ['restore-retained', 'cleanup', 'normalize'];
                  retained: string[];
              };
          }[];
          aggregateJoin?: { ownership: 'transfer-selected-result'; arms: ConcreteValueAdapter[] };
          lensJoin?: { kind: 'selected'; arms: string[]; result: string };
          callableJoin?: {
              kind: 'erased-environment';
              result: string;
              arms: { callable: string; entries: { source: string; target: string }[] }[];
          };
      } & ConcreteOutput)
    | ({
          op: 'invoke';
          origin: string;
          callee: string;
          args: string[];
          wrapper: string;
          abi: string;
          field: string;
      } & ConcreteOutput)
    | ({
          op: 'make-callable';
          origin: string;
          callable: string;
          captures: { place: string; value: string }[];
      } & ConcreteOutput);
export type ConcreteBlock = {
    origin: string;
    instructions: ConcreteInstruction[];
    result: string;
    layout: string;
    cleanup: Cleanup[];
};
export type ConcreteCode = {
    id: string;
    unit: string;
    function?: string;
    abi: string;
    environment: string;
    captures: { place: string; layout: string }[];
    parameters: { pattern: IRPattern; lensPlace?: string; layout: string }[];
    body: ConcreteBlock;
};
export type ConcreteProgram = {
    schemaVersion: 1;
    target: TargetConfig;
    graphKey: string;
    /** Diagnostic/reference inputs; these are not emitted generic code. */
    semantic: SpecializedProgram;
    analysis: RepresentationAnalysis;
    layouts: ConcreteLayout[];
    abis: ConcreteABI[];
    wrappers: ConcreteWrapper[];
    callables: CallableLayout[];
    code: ConcreteCode[];
    entries: string[];
    /** C emitters declare these names before definitions, including pointer-recursive data. */
    forward: { layouts: string[]; abis: string[]; code: string[] };
};
