import type { Lens, Linear } from './ast.ts';

/**
 * Runtime imports that implement vector syntax. Their names are not source
 * identifiers, so user definitions cannot shadow them.
 */
export const vectorImports = { index: '[]', empty: '[::]', push: '[:push:]' } as const;

/**
 * Core expansion of vector syntax into runtime import calls:
 * `v[i]` (a lens) becomes `[](i, ~v)`, and `[:a, b:]` becomes
 * `[:push:]([:push:]([::](), a), b)`, evaluating the items left to right.
 * A bare `v[i]` value is left for inference to reject.
 */
export function normalizeVectors(source: Linear): Linear {
    const visit = (n: any): any => {
        if (!n || typeof n !== 'object') return n;
        if (Array.isArray(n)) return n.map(visit);
        const c: any = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, visit(v)]));
        const name = (text: string, loc: number): Linear => ({ type: 'id', text, loc });
        if (c.type === 'index' && isLens(n)) {
            return {
                type: 'apply',
                fn: name(vectorImports.index, c.loc),
                args: [c.index, { type: 'lens', lens: c.target }],
                loc: c.loc,
            } satisfies Lens;
        }
        if (c.type === 'vector')
            return (c.items as Linear[]).reduce(
                (vector: Linear, item): Linear => ({
                    type: 'apply',
                    fn: name(vectorImports.push, item.loc),
                    args: [vector, item],
                    loc: c.loc,
                }),
                { type: 'apply', fn: name(vectorImports.empty, c.loc), args: [], loc: c.loc },
            );
        return c;
    };
    // Lens and value indexes share a node shape; only the parser's Lens rule
    // produces a Lens target, which is recorded before children are rewritten.
    const lensIndexes = new WeakSet<object>();
    const isLens = (n: object) => lensIndexes.has(n);
    const mark = (n: unknown, lens: boolean): void => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach((v) => mark(v, lens));
        const node = n as { type?: string } & Record<string, unknown>;
        if (node.type === 'index' && lens) lensIndexes.add(node);
        for (const [key, value] of Object.entries(node)) mark(value, childIsLens(node, key, lens));
    };
    mark(source, false);
    return visit(source);
}

/** Whether a child position holds a Lens rather than a Linear/Term. */
function childIsLens(node: { type?: string }, key: string, lens: boolean): boolean {
    switch (node.type) {
        case 'lens': // Term wrapper
            return key === 'lens';
        case 'assign':
            return key === 'lens';
        case 'index':
            return key === 'target' ? lens : false;
        case 'tuple':
        case 'let':
        case 'case':
            // Items, bodies and case bodies keep the parent's mode; values are Terms.
            return key === 'items' || key === 'body' || key === 'cases' ? lens : false;
        case 'aslens':
            return false;
        case 'apply':
            return false;
        case 'fn':
            return false;
        default:
            return lens;
    }
}
