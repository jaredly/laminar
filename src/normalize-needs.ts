import type { Linear } from './ast.ts';
import { TypeDiagnostic } from './types.ts';

/**
 * Rewrites that dependency syntax needs before the modes are decided. `#a.b` reads a field of a
 * copy of the entry, `{ let $need = #a\n $need.b }`, since fields are only read from storage.
 */
export function normalizeNeeds(source: Linear): Linear {
    let next = 0;
    const rootNeed = (n: any): any =>
        n.type === 'field' ? rootNeed(n.target) : n.type === 'need' ? n : undefined;
    const reroot = (n: any, name: string): any =>
        n.type === 'field'
            ? { ...n, target: reroot(n.target, name) }
            : { type: 'id', text: name, loc: n.loc };
    const visit = (n: any): any => {
        if (!n || typeof n !== 'object') return n;
        if (Array.isArray(n)) return n.map(visit);
        if (n.type === 'apply' && n.fn?.type === 'op' && n.fn.text === ':=' && rootNeed(n.args[0]))
            throw new TypeDiagnostic(
                'dependency-assignment',
                n.loc,
                'A dependency cannot be assigned; `inject` a new value for the rest of a block',
            );
        if (n.type === 'field') {
            const need = rootNeed(n);
            if (need) {
                const name = `$need${next++}`;
                return {
                    type: 'let',
                    pat: { type: 'id', text: name, loc: need.loc },
                    value: need,
                    body: reroot(n, name),
                    loc: n.loc,
                };
            }
        }
        return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, visit(v)]));
    };
    return visit(source);
}
