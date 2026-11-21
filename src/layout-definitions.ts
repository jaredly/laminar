import type { SemanticType } from './elaborated.ts';
import { mapSemantic, typeKey } from './typed-ir.ts';
import { BackendDiagnostic } from './backend/target.ts';
export type NominalLayoutDefinition = {
    name: string;
    parameters: string[];
    /** A `vector` holds a runtime-length array of its single `elements` field's type. */
    kind: 'record' | 'union' | 'vector';
    fields: { name: string; type: SemanticType; indirect?: boolean }[];
};
/** The builtin `Vector<a>`: an owned, heap-allocated, runtime-length element array. */
export const vectorLayoutDefinition: NominalLayoutDefinition = {
    name: 'Vector',
    parameters: ['p0'],
    kind: 'vector',
    fields: [
        { name: 'elements', type: { tag: 'variable', id: 'p0', rigid: false }, indirect: true },
    ],
};
/** Registry identity ignores generic parameter spelling; field order is ABI relevant. */
export function layoutDefinitionsKey(definitions: readonly NominalLayoutDefinition[]): string {
    const names = new Set<string>();
    const entries = definitions.map((d) => {
        if (
            names.has(d.name) ||
            !d.name ||
            !['record', 'union', 'vector'].includes(d.kind) ||
            new Set(d.parameters).size !== d.parameters.length ||
            new Set(d.fields.map((f) => f.name)).size !== d.fields.length
        )
            throw new BackendDiagnostic(
                'invalid-layout-definition',
                `Invalid or duplicate layout definition ${d.name}`,
            );
        names.add(d.name);
        const fields = d.fields.map((f) => [
            f.name,
            !!f.indirect,
            typeKey(
                mapSemantic(f.type, (id) => {
                    const i = d.parameters.indexOf(id);
                    if (i < 0)
                        throw new BackendDiagnostic(
                            'invalid-layout-definition',
                            `Unbound layout parameter ${id}`,
                        );
                    return { tag: 'variable', id: `parameter${i}`, rigid: false };
                }),
            ),
        ]);
        return [d.name, d.parameters.length, d.kind, fields];
    });
    return JSON.stringify(entries.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)));
}

/**
 * Derive union storage schemas from the program's constructor imports. Every
 * constructor of a union is imported, in declaration order, so grouping by result
 * type yields each union's complete, ordered variant list (the tag order).
 * A payload is one argument as-is, several as a tuple, none as unit.
 *
 * A variant is boxed (`indirect`) when its generic payload mentions any nominal
 * type. Every recursive cycle passes through such a payload, so by-value layouts
 * stay finite, and the policy depends only on the declaration, not on an instance.
 */
export function deriveNominalLayoutDefinitions(
    imports: readonly { definition: string; quantified: string[]; type: SemanticType }[],
): NominalLayoutDefinition[] {
    const unions = new Map<string, NominalLayoutDefinition>();
    const fail = (message: string): never => {
        throw new BackendDiagnostic('invalid-layout-definition', message);
    };
    const mentionsNominal = (t: SemanticType): boolean =>
        t.tag === 'con'
            ? !['Number', 'Bool', 'String'].includes(t.name) || t.args.some(mentionsNominal)
            : t.tag === 'tuple'
              ? t.items.some(mentionsNominal)
              : t.tag === 'fn'
                ? [...t.args, t.result].some((f) =>
                      f.tag === 'plain'
                          ? mentionsNominal(f.value)
                          : mentionsNominal(f.read) || mentionsNominal(f.write),
                  )
                : false;
    for (const scheme of imports) {
        if (!scheme.definition.startsWith('constructor/')) continue;
        const name = scheme.definition.slice('constructor/'.length);
        const t = scheme.type;
        if (t.tag !== 'fn' || t.result.tag !== 'plain' || t.result.value.tag !== 'con')
            return fail(`Constructor ${name} lacks a nominal result`);
        const result = t.result.value;
        const parameters = result.args.map((a) =>
            a.tag === 'variable' ? a.id : fail(`Constructor ${name} result is not generic`),
        );
        if (new Set(parameters).size !== parameters.length)
            return fail(`Constructor ${name} repeats a result parameter`);
        const rename = new Map(parameters.map((p, i) => [p, `p${i}`]));
        const args = t.args.map((a) =>
            a.tag === 'plain'
                ? mapSemantic(a.value, (id) =>
                      rename.has(id)
                          ? { tag: 'variable', id: rename.get(id)!, rigid: false }
                          : fail(`Constructor ${name} field has a free type variable`),
                  )
                : fail(`Constructor ${name} field is a lens`),
        );
        const payload: SemanticType = args.length === 1 ? args[0]! : { tag: 'tuple', items: args };
        let union = unions.get(result.name);
        if (!union) {
            union = {
                name: result.name,
                parameters: parameters.map((_, i) => `p${i}`),
                kind: 'union',
                fields: [],
            };
            unions.set(result.name, union);
        } else if (union.parameters.length !== parameters.length)
            return fail(`Constructors of ${result.name} disagree on its arity`);
        union.fields.push({
            name,
            type: payload,
            ...(mentionsNominal(payload) ? { indirect: true } : {}),
        });
    }
    return [...unions.values(), vectorLayoutDefinition];
}

/** Definitions a set of types reaches, transitively through definition fields. */
export function relevantDefinitions(
    definitions: readonly NominalLayoutDefinition[],
    types: readonly SemanticType[],
): NominalLayoutDefinition[] {
    const byName = new Map(definitions.map((d) => [d.name, d]));
    const reached = new Set<string>();
    const visit = (t: SemanticType): void => {
        if (t.tag === 'con') {
            const d = byName.get(t.name);
            if (d && !reached.has(d.name)) {
                reached.add(d.name);
                d.fields.forEach((f) => visit(f.type));
            }
            t.args.forEach(visit);
        } else if (t.tag === 'tuple') t.items.forEach(visit);
        else if (t.tag === 'fn')
            [...t.args, t.result].forEach((f) =>
                f.tag === 'plain' ? visit(f.value) : (visit(f.read), visit(f.write)),
            );
    };
    types.forEach(visit);
    return definitions.filter((d) => reached.has(d.name));
}
/**
 * Schema identity of one type's layout: only the definitions it reaches, so adding
 * an unrelated union (or the always-derived builtins) leaves other layouts unchanged.
 */
export function layoutSchemaKey(
    definitions: readonly NominalLayoutDefinition[],
    type: SemanticType,
): string {
    const used = relevantDefinitions(definitions, [type]);
    return used.length ? layoutDefinitionsKey(used) : '';
}
