import type { Linear } from './ast.ts';

/**
 * Untyped lowering of records for the legacy decomposition pipeline: a record is
 * the tuple of its fields in name order (the same shape the typed IR gives it).
 * Applies to expressions, patterns and annotations alike. A tuple cannot say which
 * fields a pattern left out, so every record pattern must name them all:
 * `fieldCount` gives how many the checker found a pattern's record to have.
 */
export function desugarRecords(
    source: Linear,
    fieldCount: (pattern: object) => number | undefined,
): Linear {
    const visit = (n: unknown): unknown => {
        if (!n || typeof n !== 'object') return n;
        if (Array.isArray(n)) return n.map(visit);
        const node = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, visit(v)])) as {
            type?: string;
            fields?: { name: string; value?: unknown; pat?: unknown; type?: unknown }[];
            rest?: unknown;
            loc?: number;
        };
        if (node.type === 'field')
            throw new Error('Field access is not supported by the legacy decomposition');
        if (node.type === 'update')
            throw new Error('Record updates are not supported by the legacy decomposition');
        if (node.type !== 'record' || !node.fields) return node;
        const count = fieldCount(n);
        if (node.rest || (count !== undefined && count !== node.fields.length))
            throw new Error(
                'Partial or open record patterns are not supported by the legacy decomposition',
            );
        const sorted = [...node.fields].sort((a, b) => (a.name < b.name ? -1 : 1));
        const items = sorted.map((f) => f.value ?? f.pat ?? f.type);
        return { type: 'tuple', items, loc: node.loc };
    };
    return visit(source) as Linear;
}
