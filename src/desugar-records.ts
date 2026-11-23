import type { Linear } from './ast.ts';

/**
 * Untyped lowering of records for the legacy decomposition pipeline: a record is
 * the tuple of its fields in name order (the same shape the typed IR gives it).
 * Applies to expressions, patterns and annotations alike.
 */
export function desugarRecords(source: Linear): Linear {
    const visit = (n: unknown): unknown => {
        if (!n || typeof n !== 'object') return n;
        if (Array.isArray(n)) return n.map(visit);
        const node = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, visit(v)])) as {
            type?: string;
            fields?: { name: string; value?: unknown; pat?: unknown; type?: unknown }[];
            loc?: number;
        };
        if (node.type === 'field')
            throw new Error('Field access is not supported by the legacy decomposition');
        if (node.type !== 'record' || !node.fields) return node;
        const sorted = [...node.fields].sort((a, b) => (a.name < b.name ? -1 : 1));
        const items = sorted.map((f) => f.value ?? f.pat ?? f.type);
        return { type: 'tuple', items, loc: node.loc };
    };
    return visit(source) as Linear;
}
