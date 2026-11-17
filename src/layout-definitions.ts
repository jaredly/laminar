import type { SemanticType } from './elaborated.ts';
import { mapSemantic, typeKey } from './typed-ir.ts';
import { BackendDiagnostic } from './backend/target.ts';
export type NominalLayoutDefinition = {
    name: string;
    parameters: string[];
    kind: 'record' | 'union';
    fields: { name: string; type: SemanticType; indirect?: boolean }[];
};
/** Registry identity ignores generic parameter spelling; field order is ABI relevant. */
export function layoutDefinitionsKey(definitions: readonly NominalLayoutDefinition[]): string {
    const names = new Set<string>();
    const entries = definitions.map((d) => {
        if (
            names.has(d.name) ||
            !d.name ||
            !['record', 'union'].includes(d.kind) ||
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
