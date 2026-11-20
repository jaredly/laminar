import { createHash } from 'node:crypto';
import { freezeTree, type SemanticType } from './elaborated.ts';
import { BackendDiagnostic, targetConfig, targetKey, type TargetConfig } from './backend/target.ts';
import { mapSemantic, typeKey, type Instance, type IRUnit, type TypedProgram } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';

export type SpecializationRoot = { unit: string; arguments: SemanticType[] };
export type SemanticSpecialization = {
    id: string;
    key: string;
    source: string;
    arguments: SemanticType[];
    type: SemanticType;
    imported: boolean;
    dependencies: string[];
};
export type SpecializedProgram = {
    schemaVersion: 1;
    target: TargetConfig;
    generic: TypedProgram;
    program: TypedProgram;
    roots: string[];
    instances: SemanticSpecialization[];
};

function concrete(type: SemanticType): SemanticType {
    return mapSemantic(type, (id) => {
        throw new BackendDiagnostic(
            'unsolved-specialization',
            `Reachable semantic type contains ${id}`,
        );
    });
}

const unitType: SemanticType = { tag: 'tuple', items: [] };
/**
 * A body variable still unsolved after substituting the instance's arguments is
 * unconstrained by every use, e.g. the parameter of a closure that is never called.
 * No value of that type is ever produced, so any closed type is sound; choose unit
 * uniformly so every occurrence (and every dependent instance) agrees.
 */
function defaulted(type: SemanticType): SemanticType {
    return mapSemantic(type, () => unitType);
}

/** Rewrite semantic annotations and explicit instances, without inference or source ASTs. */
function rewrite<T>(
    input: T,
    type: (t: SemanticType) => SemanticType,
    instance?: (i: Instance) => Instance,
): T {
    const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit);
        if (!value || typeof value !== 'object') return value;
        const object = value as Record<string, unknown>;
        if (['variable', 'con', 'tuple', 'fn'].includes(String(object.tag)))
            return type(value as SemanticType);
        if (instance && 'definition' in object && 'arguments' in object && 'type' in object)
            return instance(value as Instance);
        return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, visit(v)]));
    };
    return visit(input) as T;
}

/** Reachable semantic specialization. Representation arguments and concrete ABIs are a later pass. */
export function specializeProgram(
    input: TypedProgram,
    target: TargetConfig,
    roots: readonly SpecializationRoot[],
    options: { maxInstances?: number } = {},
): SpecializedProgram {
    const generic = freezeTree(structuredClone(input));
    verifyTypedProgram(generic);
    const config = targetConfig(target),
        targetIdentity = targetKey(config);
    const limit = options.maxInstances ?? 256;
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new BackendDiagnostic(
            'invalid-specialization-budget',
            'Specialization budget must be a positive integer',
        );
    if (!roots.length)
        throw new BackendDiagnostic(
            'invalid-specialization-root',
            'Explicit entry roots are required',
        );
    const units = new Map(generic.units.map((u) => [u.id, u]));
    const definitions = new Map(
        generic.units.filter((u) => u.definition).map((u) => [u.definition!, u]),
    );
    const imports = new Map(generic.imports.map((s) => [s.definition, s]));
    const cache = new Map<string, SemanticSpecialization>();
    const emitted: IRUnit[] = [],
        usedImports = new Set<string>();
    const request = (
        source: string,
        args: SemanticType[],
        chain: string[],
        root = false,
    ): SemanticSpecialization => {
        const unit = root ? units.get(source) : definitions.get(source);
        const imported = root ? undefined : imports.get(source);
        const scheme = unit?.signature ?? imported;
        if (!scheme)
            throw new BackendDiagnostic(
                'invalid-specialization-root',
                `Unknown entry or definition ${source}`,
            );
        if (scheme.quantified.length !== args.length)
            throw new BackendDiagnostic(
                'invalid-specialization-arguments',
                `Wrong type argument count for ${source}`,
            );
        args = args.map(concrete);
        const identity = unit?.definition ?? unit?.id ?? source;
        const key = JSON.stringify([
            'semantic-specialization',
            targetIdentity,
            identity,
            args.map(typeKey),
        ]);
        const existing = cache.get(key);
        if (existing) return existing;
        if (!imported && chain.includes(identity))
            throw new BackendDiagnostic(
                'changing-specialization-recursion',
                `Changing-specialization recursion is unsupported: ${[...chain, identity].join(' -> ')}`,
            );
        if (cache.size >= limit)
            throw new BackendDiagnostic(
                'specialization-budget',
                `Specialization budget ${limit} exceeded: ${[...chain, source].join(' -> ')}`,
            );
        const substitutions = new Map(scheme.quantified.map((p, i) => [p, args[i]!]));
        const substitute = (t: SemanticType) =>
            defaulted(mapSemantic(t, (id) => substitutions.get(id)));
        const record: SemanticSpecialization = {
            id: `spec_${createHash('sha256').update(key).digest('hex')}`,
            key,
            source: identity,
            arguments: args,
            type: substitute(scheme.type),
            imported: !!imported,
            dependencies: [],
        };
        // Reserve before walking the body: recursive requests reuse this instance.
        cache.set(key, record);
        if (imported) {
            usedImports.add(source);
            return record;
        }
        const copy = structuredClone(unit!);
        copy.id = record.id;
        if (copy.definition) copy.definition = record.id;
        copy.signature.quantified = [];
        // Global binding schemes are provenance only, and remain in `generic`.
        copy.bindings = copy.bindings.filter((b) => b.kind !== 'global');
        const specialized = rewrite(copy, substitute, (i) => {
            const applied: Instance = {
                ...i,
                type: substitute(i.type),
                arguments: i.arguments.map((a) => ({ ...a, type: substitute(a.type) })),
            };
            const schema = definitions.get(i.definition)?.signature ?? imports.get(i.definition);
            if (!schema)
                throw new BackendDiagnostic(
                    'invalid-specialization',
                    `Unknown definition ${i.definition}`,
                );
            const byParameter = new Map(applied.arguments.map((a) => [a.parameter, a.type]));
            const dependency = request(
                i.definition,
                schema.quantified.map((p) => byParameter.get(p)!),
                [...chain, identity],
            );
            record.dependencies.push(dependency.id);
            return dependency.imported
                ? applied
                : { definition: dependency.id, arguments: [], type: applied.type };
        });
        record.dependencies = [...new Set(record.dependencies)].sort();
        emitted.push(specialized);
        return record;
    };
    const rootIds = roots.map((r) => request(r.unit, r.arguments, [], true).id);
    const program: TypedProgram = {
        schemaVersion: 1,
        imports: generic.imports.filter((i) => usedImports.has(i.definition)),
        units: emitted,
    };
    // Self recursion is visible before verification of a unit; dependencies precede consumers.
    verifyTypedProgram(program);
    return freezeTree({
        schemaVersion: 1,
        target: config,
        generic,
        program,
        roots: rootIds,
        instances: [...cache.values()].sort((a, b) => a.id.localeCompare(b.id)),
    });
}
