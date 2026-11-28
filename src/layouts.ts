import { freezeTree, type SemanticType } from './elaborated.ts';
import { typeKey, mapSemantic } from './typed-ir.ts';
import { BackendDiagnostic, targetConfig, targetKey, type TargetConfig } from './backend/target.ts';
import {
    layoutDefinitionsKey,
    layoutSchemaKey,
    type NominalLayoutDefinition,
} from './layout-definitions.ts';
export type LayoutId = string;
export type Layout = {
    id: LayoutId;
    type: SemanticType;
    storage: 'f64' | 'bool' | 'string' | 'unit' | 'tuple' | 'nominal' | 'callable';
    dependencies: LayoutId[];
    indirect?: boolean[];
};
/** Semantic storage descriptions. Pointer-recursive definitions are declared before being expanded. */
export class LayoutTable {
    readonly target: TargetConfig;
    readonly targetKey: string;
    readonly definitions: readonly NominalLayoutDefinition[];
    private readonly records = new Map<LayoutId, Layout>();
    private schemaKey: string;
    constructor(
        target: TargetConfig,
        definitions: readonly NominalLayoutDefinition[] = [],
        readonly maxLayouts = 512,
    ) {
        if (!Number.isSafeInteger(maxLayouts) || maxLayouts < 1)
            throw new BackendDiagnostic(
                'invalid-layout-budget',
                'Layout budget must be a positive integer',
            );
        this.target = targetConfig(target);
        this.targetKey = targetKey(this.target);
        this.definitions = freezeTree(structuredClone([...definitions]));
        this.schemaKey = definitions.length ? layoutDefinitionsKey(definitions) : '';
    }
    intern(type: SemanticType): LayoutId {
        const before = new Map(this.records);
        try {
            return this.internType(type);
        } catch (error) {
            this.records.clear();
            before.forEach((v, k) => this.records.set(k, v));
            throw error;
        }
    }
    private internType(type: SemanticType): LayoutId {
        const id = JSON.stringify([
            'layout',
            this.targetKey,
            typeKey(type),
            ...(this.schemaKey ? [layoutSchemaKey(this.definitions, type)].filter(Boolean) : []),
        ]);
        if (this.records.has(id)) return id;
        if (this.records.size >= this.maxLayouts)
            throw new BackendDiagnostic(
                'layout-budget',
                `Unbounded semantic layout expansion at ${typeKey(type)}`,
            );
        if (type.tag === 'variable')
            throw new BackendDiagnostic(
                'unsolved-layout',
                `Reachable layout contains type variable ${type.id}`,
            );
        let storage: Layout['storage'];
        let dependencies: SemanticType[] = [];
        let indirect: boolean[] | undefined;
        if (type.tag === 'record')
            throw new BackendDiagnostic(
                'unsupported-layout',
                'Record types are erased to tuples before layout',
            );
        if (type.tag === 'needs')
            throw new BackendDiagnostic(
                'unsupported-layout',
                'Specialization passes dependencies as an ordinary parameter',
            );
        if (type.tag === 'fn') storage = 'callable';
        else if (type.tag === 'tuple') {
            storage = type.items.length ? 'tuple' : 'unit';
            dependencies = type.items;
        } else if (type.name === 'Number' && !type.args.length) storage = 'f64';
        // A channel is a handle, whatever it carries.
        else if (type.name === 'Chan' && type.args.length === 1) storage = 'f64';
        else if (!type.args.length && type.name === 'Bool') storage = 'bool';
        else if (!type.args.length && type.name === 'String') storage = 'string';
        else {
            const schema = this.definitions.find((d) => d.name === type.name);
            if (!schema || schema.parameters.length !== type.args.length)
                throw new BackendDiagnostic(
                    'unsupported-layout',
                    `No storage definition for ${type.name}`,
                );
            const substitution = new Map(schema.parameters.map((p, i) => [p, type.args[i]!]));
            storage = 'nominal';
            dependencies = schema.fields.map((f) =>
                mapSemantic(f.type, (p) => substitution.get(p)),
            );
            indirect = schema.fields.map((f) => !!f.indirect);
        }
        // Reservation makes exact recursive type requests terminate; snapshot checks by-value cycles.
        this.records.set(id, {
            id,
            type: structuredClone(type),
            storage,
            dependencies: [],
            ...(indirect ? { indirect } : {}),
        });
        const children = dependencies.map((t) => this.internType(t));
        this.records.set(
            id,
            freezeTree({
                id,
                type: structuredClone(type),
                storage,
                dependencies: children,
                ...(indirect ? { indirect } : {}),
            }),
        );
        return id;
    }
    get(id: LayoutId): Layout {
        const r = this.records.get(id);
        if (!r) throw new BackendDiagnostic('invalid-layout', 'Unknown layout ID');
        return r;
    }
    snapshot(): readonly Layout[] {
        const out: Layout[] = [],
            done = new Set<string>(),
            active = new Set<string>();
        const visit = (id: string) => {
            if (active.has(id))
                throw new BackendDiagnostic(
                    'infinite-layout',
                    `Infinitely sized by-value layout ${id}`,
                );
            if (done.has(id)) return;
            active.add(id);
            const r = this.get(id);
            r.dependencies.forEach((d, i) => {
                this.get(d);
                if (!r.indirect?.[i]) visit(d);
            });
            active.delete(id);
            done.add(id);
            out.push(r);
        };
        [...this.records.keys()].sort().forEach(visit);
        return freezeTree(out);
    }
}
