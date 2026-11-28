import type { Capture } from './constraints.ts';
import type { Bound } from './constraints.ts';
import { normalizeBorrowed } from './normalize-borrowed.ts';
import { normalizeVectors } from './normalize-vectors.ts';
import type { Decl, Linear } from './ast.ts';
import { type FlowTy, type RowConstraint, type Scheme, type Solver, type Ty } from './types.ts';

export type NodeId = string;
export type BindingId = string;
export type DefinitionId = string;
export type PlaceId = string;
const byName = (a: { name: string }, b: { name: string }) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
/** A row of dependencies, absorbing a remainder that substitution has made known. */
export function semanticNeeds(
    entries: { name: string; type: SemanticType }[],
    rest?: SemanticType,
): SemanticType {
    if (rest?.tag === 'needs') return semanticNeeds([...entries, ...rest.entries], rest.rest);
    if (rest?.tag === 'tuple' && !rest.items.length) rest = undefined;
    if (rest && !entries.length) return rest;
    // Stable, so entries of one name keep their order.
    return { tag: 'needs', entries: [...entries].sort(byName), ...(rest ? { rest } : {}) };
}
/** A function type's `needs` property: omitted when it needs nothing. */
export const needsProperty = (row: SemanticType | undefined): { needs?: SemanticType } =>
    !row ||
    (row.tag === 'needs' && !row.entries.length && !row.rest) ||
    // An unconstrained row specializes to unit.
    (row.tag === 'tuple' && !row.items.length)
        ? {}
        : { needs: row };
/** A record type, absorbing a remainder that substitution has made known. */
export function semanticRecord(
    fields: { name: string; type: SemanticType }[],
    rest?: SemanticType,
): SemanticType {
    if (rest?.tag === 'record') return semanticRecord([...fields, ...rest.fields], rest.rest);
    // An unconstrained row defaults to the unit type, which stands for no more fields.
    if (rest?.tag === 'tuple' && !rest.items.length) rest = undefined;
    if (rest && !fields.length) return rest;
    const sorted = [...fields].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { tag: 'record', fields: sorted, ...(rest ? { rest } : {}) };
}
export type TypeVariableId = string;
export type SemanticType =
    | { tag: 'variable'; id: TypeVariableId; rigid: boolean }
    | { tag: 'con'; name: string; args: SemanticType[] }
    | { tag: 'tuple'; items: SemanticType[] }
    /**
     * Record, fields sorted by name. `rest` is the row variable of an open record; specialization
     * replaces it, after which the runtime shape is the tuple of the fields in name order.
     */
    | { tag: 'record'; fields: { name: string; type: SemanticType }[]; rest?: SemanticType }
    /**
     * `capture`: a closure restricted by what it captured. Not part of type identity.
     * `needs`: the dependencies a call supplies; absent means none. Specialization turns them
     * into an ordinary first parameter.
     */
    | {
          tag: 'fn';
          args: SemanticFlow[];
          result: SemanticFlow;
          capture?: Capture;
          needs?: SemanticType;
      }
    /** A row of dependencies. A name may repeat; the first entry hides the later ones. */
    | { tag: 'needs'; entries: { name: string; type: SemanticType }[]; rest?: SemanticType };
export type SemanticFlow =
    /** `mode: 'shared'` marks a plain (shared, immutable) position; absent means owned (`mut`). */
    | { tag: 'plain'; value: SemanticType; mode?: 'shared' }
    /** `replaceable: false` marks a constructor of lenses, whose whole value has no storage. */
    /**
     * `owned: true` marks an owned lens position in a function type: its callee takes the lens
     * and ends it. Part of a function type's identity, because the calling convention differs.
     * A lens value itself carries no flag.
     */
    | {
          tag: 'flow';
          read: SemanticType;
          write: SemanticType;
          replaceable?: false;
          owned?: true;
      };
/** One projection of a place: a tuple item by position, or a record field by name. */
export type Step = number | string;
export type PlaceState = {
    place: PlaceId;
    type: SemanticType;
    empty: Step[][];
    borrows: string[];
};
export type BindingRecord = {
    id: BindingId;
    name: string;
    declaration?: NodeId;
    definition?: DefinitionId;
    place: PlaceId;
    path: Step[];
    kind: 'global' | 'local' | 'alias' | 'capture' | 'projection';
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
        path: Step[];
        parent?: string;
        /** Present for independent computed focuses; absent for direct aliases. */
        owners?: { place: PlaceId; path: Step[]; permit?: string }[];
    }[];
    temporaryLenses: {
        node: NodeId;
        initial: NodeId;
        temporary: BindingId;
        reconstruction?: NodeId;
        cleanup: NodeId;
        dependencies: BindingId[];
        staged: PlaceState[];
        cleaned: PlaceState[];
    }[];
    instantiations: {
        node: NodeId;
        definition: DefinitionId;
        type: SemanticType;
        arguments: { parameter: TypeVariableId; type: SemanticType }[];
    }[];
    captures: { node: NodeId; from: BindingId; to: BindingId; type: SemanticType }[];
    /**
     * Bindings that give their owned lens away. `node` is the lens argument, or the closure
     * that captures it; `write` is then what the closure's body leaves in it. A temporary lens
     * moved straight into a call has no binding, so no entry.
     */
    lensMoves: { node: NodeId; binding: BindingId; write?: SemanticType }[];
    transitions: {
        node: NodeId;
        kind: 'move' | 'write' | 'borrow-open' | 'borrow-close';
        path: Step[];
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
        /** Which parameters the function owns: not lenses, and not plain (shared) values. */
        ownedParameters: boolean[];
        body: NodeId;
        transitions: [number, number];
        entry: PlaceState[];
        exit: PlaceState[];
    }[];
    signature: {
        quantified: TypeVariableId[];
        bounds?: Bound[];
        callsOnce?: readonly number[];
        rows?: RowConstraint[];
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
    readonly temporaryLenses: {
        node: NodeId;
        initial: NodeId;
        temporary: BindingId;
        reconstruction?: NodeId;
        cleanup: NodeId;
        dependencies: BindingId[];
        staged: RawState[];
        cleaned: RawState[];
    }[] = [];
    readonly instantiations: {
        node: NodeId;
        definition: DefinitionId;
        type: Ty;
        arguments: { parameter: TypeVariableId; type: Ty }[];
    }[] = [];
    readonly captures: { node: NodeId; from: BindingId; to: BindingId; type: Ty }[] = [];
    readonly lensMoves: { node: NodeId; binding: BindingId; write?: Ty }[] = [];
    readonly transitions: {
        node: NodeId;
        kind: Elaboration['transitions'][number]['kind'];
        path: Step[];
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
        /** Which parameters the function owns: not lenses, and not plain (shared) values. */
        ownedParameters: boolean[];
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
        const copy = structuredClone({
            ast: normalizeBorrowed(normalizeVectors(ast)),
            declaration,
        });
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
                case 'record': {
                    const fields = t.fields.map((f) => ({ name: f.name, type: type(f.type) }));
                    // `type` may expand a body variable, so absorb a remainder that became known.
                    return semanticRecord(fields, t.rest && type(t.rest));
                }
                case 'fn':
                    return {
                        tag: 'fn',
                        args: t.args.map(flow),
                        result: flow(t.result),
                        ...(t.capture ? { capture: t.capture } : {}),
                        ...needsProperty(t.needs && type(t.needs)),
                    };
                case 'needs':
                    return semanticNeeds(
                        t.entries.map((e) => ({ name: e.name, type: type(e.type) })),
                        t.rest && type(t.rest),
                    );
            }
        };
        const flow = (f: FlowTy): SemanticFlow =>
            f.tag === 'plain'
                ? {
                      tag: 'plain',
                      value: type(f.value),
                      ...(solver.ownership(f) === 'shared' ? { mode: 'shared' as const } : {}),
                  }
                : {
                      tag: 'flow',
                      read: type(f.read),
                      write: type(f.write),
                      ...(solver.replaceability(f) === 'fixed'
                          ? { replaceable: false as const }
                          : {}),
                      ...(solver.lensOwnership(f.owned) === 'owned'
                          ? { owned: true as const }
                          : {}),
                  };
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
            else if (t.tag === 'record') {
                t.fields.forEach((f) => scan(f.type));
                if (t.rest) scan(t.rest);
            } else if (t.tag === 'needs') {
                t.entries.forEach((e) => scan(e.type));
                if (t.rest) scan(t.rest);
            } else {
                t.args.forEach(scanFlow);
                scanFlow(t.result);
                if (t.needs) scan(t.needs);
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
            temporaryLenses: this.temporaryLenses.map((m) => ({
                ...m,
                staged: m.staged.map(state),
                cleaned: m.cleaned.map(state),
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
            lensMoves: this.lensMoves.map((m) => ({
                node: m.node,
                binding: m.binding,
                ...(m.write ? { write: type(m.write) } : {}),
            })),
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
                ...(scheme.bounds && { bounds: scheme.bounds }),
                ...(scheme.rows && { rows: scheme.rows }),
                ...(scheme.callsOnce && { callsOnce: scheme.callsOnce }),
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

export type RawState = { place: PlaceId; type: Ty; empty: Step[][]; borrows: string[] };
