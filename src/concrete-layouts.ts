import { createHash } from 'node:crypto';
import { BackendDiagnostic, targetKey, type TargetConfig } from './backend/target.ts';
import { freezeTree, type SemanticType } from './elaborated.ts';
import { mapSemantic, typeKey } from './typed-ir.ts';
import type { ConcreteLayout, ConcreteField, ConcreteABI } from './concrete-ir.ts';

export const concreteName = (prefix: string, key: string): string =>
    `${prefix}_${createHash('sha256').update(key).digest('hex')}`;
export type { NominalLayoutDefinition } from './layout-definitions.ts';
import {
    layoutDefinitionsKey,
    layoutSchemaKey,
    scatterFieldName,
    scatterVariants,
    type NominalLayoutDefinition,
} from './layout-definitions.ts';

/**
 * The fields of a scattered constructor lens over `readType` (a union stored by value): the
 * tag, a pointer to each payload field of every constructor, then the restoration callback.
 * `layout` maps a semantic type to its physical layout. Concrete lowering and its independent
 * verifier both derive the record from this, so they cannot disagree.
 */
export function sumLensFields(
    readType: SemanticType,
    definitions: readonly NominalLayoutDefinition[],
    layout: (type: SemanticType) => string,
): ConcreteField[] {
    const variants = scatterVariants(definitions, readType);
    if (!variants)
        throw new BackendDiagnostic('invalid-layout', 'A scattered lens needs a by-value union');
    return [
        { name: 'tag', kind: 'tag', layout: layout(readType) },
        ...variants.flatMap((variant, k) =>
            variant.fields.map(
                (type, i): ConcreteField => ({
                    name: scatterFieldName(k, variant.tuple, i),
                    kind: 'pointer',
                    layout: layout(type),
                }),
            ),
        ),
    ];
}

/** C storage descriptions. Pointer/code edges are distinct from by-value dependencies. */
export class ConcreteLayoutTable {
    readonly layouts = new Map<string, ConcreteLayout>();
    readonly abis = new Map<string, ConcreteABI>();
    readonly targetIdentity: string;
    private active: string[] = [];
    private schemaKey: string;
    private nominal: Map<string, NominalLayoutDefinition>;
    constructor(
        target: TargetConfig,
        definitions: readonly NominalLayoutDefinition[] = [],
        readonly maxLayouts = 512,
        readonly callableLayout?: (type: SemanticType) => string,
    ) {
        if (!Number.isSafeInteger(maxLayouts) || maxLayouts < 1)
            throw new BackendDiagnostic(
                'invalid-layout-budget',
                'Layout budget must be a positive integer',
            );
        this.targetIdentity = targetKey(target);
        this.schemaKey = definitions.length ? layoutDefinitionsKey(definitions) : '';
        this.nominal = new Map(definitions.map((d) => [d.name, structuredClone(d)]));
        if (this.nominal.size !== definitions.length)
            throw new BackendDiagnostic(
                'invalid-layout-definition',
                'Duplicate nominal definition',
            );
        for (const d of this.nominal.values()) {
            if (
                new Set(d.parameters).size !== d.parameters.length ||
                new Set(d.fields.map((f) => f.name)).size !== d.fields.length
            )
                throw new BackendDiagnostic(
                    'invalid-layout-definition',
                    `Duplicate parameter or field in ${d.name}`,
                );
            d.fields.forEach((f) =>
                mapSemantic(f.type, (id) => {
                    if (!d.parameters.includes(id))
                        throw new BackendDiagnostic(
                            'invalid-layout-definition',
                            `Unbound layout parameter ${id}`,
                        );
                    return undefined;
                }),
            );
        }
    }
    record(keyParts: unknown[], kind: ConcreteLayout['kind'], fields: ConcreteField[]): string {
        const key = JSON.stringify(['physical-layout', this.targetIdentity, ...keyParts]);
        const id = concreteName('layout', key);
        if (!this.layouts.has(id)) {
            if (this.layouts.size >= this.maxLayouts)
                throw new BackendDiagnostic(
                    'layout-budget',
                    `Layout budget exceeded: ${this.active.join(' -> ')}`,
                );
            this.layouts.set(id, freezeTree({ id, key, kind, fields: structuredClone(fields) }));
        }
        return id;
    }
    abi(args: string[], result: string): string {
        const key = JSON.stringify([
            'call-abi',
            this.targetIdentity,
            'opaque-pointer',
            args,
            result,
        ]);
        const id = concreteName('abi', key);
        if (!this.abis.has(id))
            this.abis.set(
                id,
                freezeTree({
                    id,
                    key,
                    environment: 'opaque-pointer',
                    arguments: [...args],
                    result,
                }),
            );
        return id;
    }
    data(type: SemanticType): string {
        const before = new Map(this.layouts),
            active = [...this.active];
        try {
            return this.dataType(type);
        } catch (error) {
            this.layouts.clear();
            before.forEach((v, k) => this.layouts.set(k, v));
            this.active = active;
            throw error;
        }
    }
    private dataType(type: SemanticType): string {
        if (type.tag === 'fn') {
            if (!this.callableLayout)
                throw new BackendDiagnostic(
                    'unsupported-layout',
                    'Missing callable type layout resolver',
                );
            return this.callableLayout(type);
        }
        const containsCallable = (t: SemanticType): boolean =>
            t.tag === 'fn' || (t.tag === 'tuple' && t.items.some(containsCallable));
        if (type.tag === 'tuple' && containsCallable(type)) {
            const items = type.items.map((t) => this.dataType(t));
            return this.record(
                ['aggregate', items],
                'record',
                items.map((layout, i) => ({ name: `item${i}`, kind: 'value', layout })),
            );
        }
        mapSemantic(type, (id) => {
            throw new BackendDiagnostic('unsolved-layout', `Unsolved concrete data type ${id}`);
        });
        const typeIdentity = typeKey(type),
            schema = this.schemaKey ? layoutSchemaKey([...this.nominal.values()], type) : '',
            parts = ['data', typeIdentity, ...(schema ? [schema] : [])];
        const key = JSON.stringify(['physical-layout', this.targetIdentity, ...parts]),
            id = concreteName('layout', key);
        // All recursive references use forward names. finish() checks only by-value edges.
        if (this.active.includes(id)) return id;
        if (this.layouts.has(id)) return id;
        if (this.active.length + this.layouts.size >= this.maxLayouts)
            throw new BackendDiagnostic(
                'layout-budget',
                `Unbounded layout expansion: ${[...this.active, typeIdentity].join(' -> ')}`,
            );
        this.active.push(id);
        let kind: ConcreteLayout['kind'],
            fields: ConcreteField[] = [];
        if (type.tag === 'tuple') {
            kind = type.items.length ? 'record' : 'unit';
            fields = type.items.map((t, i) => ({
                name: `item${i}`,
                kind: 'value',
                layout: this.dataType(t),
            }));
        } else if (
            type.tag === 'con' &&
            !type.args.length &&
            ['Number', 'Bool', 'String'].includes(type.name)
        )
            kind = type.name === 'Number' ? 'f64' : type.name === 'Bool' ? 'bool' : 'string';
        else if (type.tag === 'con') {
            const d = this.nominal.get(type.name);
            if (!d || d.parameters.length !== type.args.length)
                throw new BackendDiagnostic(
                    'unsupported-layout',
                    `Missing concrete layout schema for ${type.name}`,
                );
            const substitution = new Map(d.parameters.map((p, i) => [p, type.args[i]!]));
            kind = d.kind;
            fields = d.fields.map((f) => ({
                name: f.name,
                kind: f.indirect ? 'pointer' : 'value',
                layout: this.dataType(mapSemantic(f.type, (p) => substitution.get(p))),
            }));
        } else
            throw new BackendDiagnostic(
                'unsupported-layout',
                'Function data needs an explicit callable representation',
            );
        this.active.pop();
        return this.record(parts, kind, fields);
    }
    /** Independently check all by-value edges, including cycles passing through indirect roots. */
    finish(): { layouts: ConcreteLayout[]; abis: ConcreteABI[]; forward: string[] } {
        const active = new Set<string>(),
            done = new Set<string>(),
            ordered: ConcreteLayout[] = [];
        const visit = (id: string) => {
            if (active.has(id))
                throw new BackendDiagnostic(
                    'infinite-layout',
                    `Infinitely sized by-value layout ${id}`,
                );
            if (done.has(id)) return;
            const l = this.layouts.get(id);
            if (!l) throw new BackendDiagnostic('invalid-layout', 'Missing layout dependency');
            active.add(id);
            for (const f of l.fields)
                if (f.kind === 'value') visit(f.layout);
                else if (f.kind === 'pointer' && f.layout && !this.layouts.has(f.layout))
                    throw new BackendDiagnostic('invalid-layout', 'Missing pointer referent');
            active.delete(id);
            done.add(id);
            ordered.push(l);
        };
        [...this.layouts.keys()].sort().forEach(visit);
        return {
            layouts: ordered,
            abis: [...this.abis.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
            forward: [...this.layouts.keys()].sort(),
        };
    }
}
