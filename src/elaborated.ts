import type { Decl, Linear } from './ast.ts';
import { type FlowTy, type Scheme, type Solver, type Ty } from './types.ts';

export type NodeId = string;
export type BindingId = string;
export type DefinitionId = string;
export type PlaceId = string;
export type TypeVariableId = string;
export type SemanticType =
    | { tag: 'variable'; id: TypeVariableId; rigid: boolean }
    | { tag: 'con'; name: string; args: SemanticType[] }
    | { tag: 'tuple'; items: SemanticType[] }
    | { tag: 'fn'; args: SemanticFlow[]; result: SemanticFlow };
export type SemanticFlow =
    | { tag: 'plain'; value: SemanticType }
    | { tag: 'flow'; read: SemanticType; write: SemanticType };
export type PlaceState = {
    place: PlaceId;
    type: SemanticType;
    empty: number[][];
    borrows: string[];
};
export type BindingRecord = {
    id: BindingId;
    name: string;
    declaration?: NodeId;
    definition?: DefinitionId;
    place: PlaceId;
    path: number[];
    kind: 'global' | 'local' | 'alias' | 'capture';
    borrow?: string;
    initialType: SemanticType;
};
export type Elaboration = {
    schemaVersion: 1;
    id: string;
    source: Linear;
    declaration?: Decl;
    root: NodeId;
    nodes: { id: NodeId; kind: string; loc?: number; type?: SemanticFlow }[];
    bindings: BindingRecord[];
    uses: { node: NodeId; binding: BindingId; mode: 'value' | 'lens' }[];
    borrows: {
        id: string;
        node: NodeId;
        place: PlaceId;
        path: number[];
        parent?: string;
        /** Present for independent computed focuses; absent for direct aliases. */
        owners?: { place: PlaceId; path: number[]; permit?: string }[];
    }[];
    manuals: {
        node: NodeId;
        frontend: NodeId;
        /** Owned backing for a pattern-bound temporary; absent for explicit manual lenses. */
        temporary?: BindingId;
        cleanup: NodeId;
        scoped: boolean;
        dependencies: BindingId[];
        staged: PlaceState[];
        cleaned: PlaceState[];
        restored: PlaceState[];
    }[];
    instantiations: {
        node: NodeId;
        definition: DefinitionId;
        type: SemanticType;
        arguments: { parameter: TypeVariableId; type: SemanticType }[];
    }[];
    captures: { node: NodeId; from: BindingId; to: BindingId; type: SemanticType }[];
    transitions: {
        node: NodeId;
        kind: 'move' | 'write' | 'borrow-open' | 'borrow-close';
        path: number[];
        before: PlaceState;
        after: PlaceState;
    }[];
    branches: {
        node: NodeId;
        input: PlaceState[];
        restored?: PlaceState[];
        arms: {
            node: NodeId;
            restored?: PlaceState[];
            output: PlaceState[];
            transitions: [number, number];
        }[];
        output: PlaceState[];
    }[];
    scopes: { node: NodeId; bindings: BindingId[]; exit: PlaceState[] }[];
    functions: {
        node: NodeId;
        parameters: BindingId[][];
        parameterPlaces: PlaceId[][];
        body: NodeId;
        transitions: [number, number];
        entry: PlaceState[];
        exit: PlaceState[];
    }[];
    signature: {
        quantified: TypeVariableId[];
        type: SemanticType;
        bodyType: SemanticType;
        bodyVariables: { variable: TypeVariableId; type: SemanticType }[];
        unresolved: TypeVariableId[];
    };
};

export type ElaborationContext = {
    /** Stable compilation-unit/definition namespace, independent of source locations. */
    id: string;
    definitions?: ReadonlyMap<string, DefinitionId>;
};

export function freezeTree<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freezeTree(child);
        Object.freeze(value);
    }
    return value;
}

/** Mutable construction is internal; finish emits a detached, frozen, serializable DTO. */
export class ElaborationBuilder {
    private ids = new WeakMap<object, NodeId>();
    private nodes: { id: NodeId; kind: string; loc?: number; type?: FlowTy }[] = [];
    private records = new Map<NodeId, (typeof this.nodes)[number]>();
    private nextPlace = 0;
    private nextBinding = 0;
    private nextBorrow = 0;
    readonly bindings: (Omit<BindingRecord, 'initialType'> & { initialType: Ty })[] = [];
    readonly uses: Elaboration['uses'] = [];
    readonly borrows: Elaboration['borrows'] = [];
    readonly manuals: {
        node: NodeId;
        frontend: NodeId;
        /** Owned backing for a pattern-bound temporary; absent for explicit manual lenses. */
        temporary?: BindingId;
        cleanup: NodeId;
        scoped: boolean;
        dependencies: BindingId[];
        staged: RawState[];
        cleaned: RawState[];
        restored: RawState[];
    }[] = [];
    readonly instantiations: {
        node: NodeId;
        definition: DefinitionId;
        type: Ty;
        arguments: { parameter: TypeVariableId; type: Ty }[];
    }[] = [];
    readonly captures: { node: NodeId; from: BindingId; to: BindingId; type: Ty }[] = [];
    readonly transitions: {
        node: NodeId;
        kind: Elaboration['transitions'][number]['kind'];
        path: number[];
        before: RawState;
        after: RawState;
    }[] = [];
    readonly branches: {
        node: NodeId;
        input: RawState[];
        restored?: RawState[];
        arms: {
            node: NodeId;
            restored?: RawState[];
            output: RawState[];
            transitions: [number, number];
        }[];
        output: RawState[];
    }[] = [];
    readonly scopes: { node: NodeId; bindings: BindingId[]; exit: RawState[] }[] = [];
    readonly functions: {
        node: NodeId;
        parameters: BindingId[][];
        parameterPlaces: PlaceId[][];
        body: NodeId;
        transitions: [number, number];
        entry: RawState[];
        exit: RawState[];
    }[] = [];
    constructor(readonly context: ElaborationContext) {}
    node(value: object): NodeId {
        const previous = this.ids.get(value);
        if (previous) return previous;
        const id = `${this.context.id}/n${this.nodes.length}`;
        this.ids.set(value, id);
        const n = value as { type?: string; loc?: number };
        const record = { id, kind: n.type ?? 'generated', loc: n.loc };
        this.nodes.push(record);
        this.records.set(id, record);
        return id;
    }
    prepare(ast: Linear, declaration?: Decl): { ast: Linear; declaration?: Decl } {
        const copy = structuredClone({ ast, declaration });
        const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if ('type' in value) {
                const id = this.node(value);
                Object.assign(value, { nodeId: id });
            }
            // Deterministic traversal survives serialization and source-location changes.
            for (const key of Object.keys(value).sort())
                if (key !== 'nodeId') visit((value as Record<string, unknown>)[key]);
        };
        visit(copy.ast);
        visit(copy.declaration);
        return freezeTree(copy);
    }
    record(node: object, type: FlowTy): void {
        const id = this.node(node);
        this.records.get(id)!.type = type;
    }
    place(): PlaceId {
        return `${this.context.id}/p${this.nextPlace++}`;
    }
    borrow(): string {
        return `${this.context.id}/loan${this.nextBorrow++}`;
    }
    binding(record: Omit<(typeof this.bindings)[number], 'id'>): BindingId {
        const id = `${this.context.id}/b${this.nextBinding++}`;
        this.bindings.push({ id, ...record });
        return id;
    }
    finish(
        source: Linear,
        declaration: Decl | undefined,
        solver: Solver,
        scheme: Scheme,
        bodyType: Ty,
        bodyVariables: Map<number, Ty>,
    ): Elaboration {
        const variable = (id: number) => {
            const index = scheme.quantified.indexOf(id);
            return index < 0 ? `${this.context.id}/t${id}` : `${this.context.id}/q${index}`;
        };
        const rawType = (t: Ty): Ty => solver.resolve(t);
        const type = (t: Ty): SemanticType => {
            t = rawType(t);
            switch (t.tag) {
                case 'meta': {
                    const replacement = bodyVariables.get(t.id);
                    if (replacement && !(replacement.tag === 'meta' && replacement.id === t.id))
                        return convert(replacement);
                    return { tag: 'variable', id: variable(t.id), rigid: false };
                }
                default:
                    return convert(t);
            }
        };
        const convert = (t: Ty): SemanticType => {
            switch (t.tag) {
                case 'meta':
                    return { tag: 'variable', id: variable(t.id), rigid: false };
                case 'rigid':
                    return { tag: 'variable', id: `${this.context.id}/r${t.id}`, rigid: true };
                case 'con':
                    return { ...t, args: t.args.map(type) };
                case 'tuple':
                    return { ...t, items: t.items.map(type) };
                case 'fn':
                    return { tag: 'fn', args: t.args.map(flow), result: flow(t.result) };
            }
        };
        const flow = (f: FlowTy): SemanticFlow =>
            f.tag === 'plain'
                ? { tag: 'plain', value: type(f.value) }
                : { tag: 'flow', read: type(f.read), write: type(f.write) };
        const state = (s: RawState): PlaceState => ({ ...s, type: type(s.type) });
        const quantified = scheme.quantified.map(variable);
        const generic = new Set(quantified);
        const unresolved = new Set<string>();
        const body = type(bodyType);
        const scan = (t: SemanticType): void => {
            if (t.tag === 'variable') {
                if (!generic.has(t.id)) unresolved.add(t.id);
            } else if (t.tag === 'con') t.args.forEach(scan);
            else if (t.tag === 'tuple') t.items.forEach(scan);
            else {
                t.args.forEach(scanFlow);
                scanFlow(t.result);
            }
        };
        const scanFlow = (f: SemanticFlow) =>
            f.tag === 'plain' ? scan(f.value) : (scan(f.read), scan(f.write));
        scan(body);
        for (const node of this.nodes) if (node.type) scanFlow(flow(node.type));
        const result: Elaboration = {
            schemaVersion: 1,
            id: this.context.id,
            source,
            declaration,
            root: this.node(source),
            nodes: this.nodes.map((n) => ({ ...n, type: n.type ? flow(n.type) : undefined })),
            bindings: this.bindings.map((b) => ({ ...b, initialType: type(b.initialType) })),
            uses: this.uses,
            borrows: this.borrows,
            manuals: this.manuals.map((m) => ({
                ...m,
                staged: m.staged.map(state),
                cleaned: m.cleaned.map(state),
                restored: m.restored.map(state),
            })),
            instantiations: this.instantiations.map((i) => ({
                ...i,
                type: type(i.type),
                arguments: (i.definition === this.context.id && i.arguments.length === 0
                    ? scheme.quantified.map((id, index) => ({
                          parameter: `${this.context.id}/q${index}`,
                          type: { tag: 'meta' as const, id },
                      }))
                    : i.arguments
                ).map((a) => ({ ...a, type: type(a.type) })),
            })),
            captures: this.captures.map((c) => ({ ...c, type: type(c.type) })),
            transitions: this.transitions.map((e) => ({
                ...e,
                before: state(e.before),
                after: state(e.after),
            })),
            branches: this.branches.map((b) => ({
                ...b,
                input: b.input.map(state),
                restored: b.restored?.map(state),
                output: b.output.map(state),
                arms: b.arms.map((a) => ({
                    ...a,
                    output: a.output.map(state),
                    restored: a.restored?.map(state),
                })),
            })),
            scopes: this.scopes.map((s) => ({ ...s, exit: s.exit.map(state) })),
            functions: this.functions.map((f) => ({
                ...f,
                entry: f.entry.map(state),
                exit: f.exit.map(state),
            })),
            signature: {
                quantified,
                type: type(scheme.body),
                bodyType: body,
                bodyVariables: [...bodyVariables].map(([id, t]) => ({
                    variable: variable(id),
                    type: type(t),
                })),
                unresolved: [...unresolved],
            },
        };
        const detached = structuredClone(result);
        // Keep the indexed source objects used by the legacy occurrence-type map.
        detached.source = source;
        detached.declaration = declaration;
        return freezeTree(detached);
    }
}

export type RawState = { place: PlaceId; type: Ty; empty: number[][]; borrows: string[] };
