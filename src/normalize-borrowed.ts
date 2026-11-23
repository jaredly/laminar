import { TypeDiagnostic } from './types.ts';
import type { Id, Lens, Linear, Pat, Term } from './ast.ts';

/** Hygienic core expansion. Pattern storage is owned privately and exposed only
 * through scoped aliases; the whole borrowed value stays empty until reconstruction. */
export function normalizeBorrowed(source: Linear): Linear {
    let next = 0;
    const used = new Set<string>();
    const collect = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        if ('text' in v && typeof v.text === 'string') used.add(v.text);
        Object.values(v).forEach(collect);
    };
    collect(source);
    const fresh = (loc: number): Id => {
        let text: string;
        do text = `$borrowed${next++}`;
        while (used.has(text));
        used.add(text);
        return { type: 'id', text, loc };
    };
    const copy = (id: Id): Id => ({ ...id });
    const hasConstructor = (p: Pat): boolean =>
        p.type === 'constructor' ||
        (p.type === 'tuple' && p.items.some(hasConstructor)) ||
        (p.type === 'record' && p.fields.some((f) => hasConstructor(f.pat)));
    const letNode = (
        pat: Pat,
        value: Term,
        body: Linear | Lens,
        loc: number,
        borrowedOwner = false,
    ): any => ({
        type: 'let',
        pat,
        value,
        body,
        loc,
        ...(borrowedOwner ? { borrowedOwner } : {}),
    });
    const prepare = (
        p: Pat,
    ): { owned: Pat; public: Pat; initial: Linear; final: Pat; restore: Linear } => {
        if (p.type === 'constructor' || p.type === 'tuple' || p.type === 'record') {
            const children = (
                p.type === 'constructor'
                    ? p.args
                    : p.type === 'record'
                      ? p.fields.map((f) => f.pat)
                      : p.items
            ).map((v) => prepare(v));
            const singleton =
                p.type === 'constructor' && children.length === 1 ? children[0] : undefined;
            return {
                owned:
                    p.type === 'constructor'
                        ? { ...p, args: children.map((c) => c.owned) }
                        : p.type === 'record'
                          ? {
                                ...p,
                                fields: p.fields.map((f, i) => ({ ...f, pat: children[i].owned })),
                            }
                          : { ...p, items: children.map((c) => c.owned) },
                public: singleton?.public ?? {
                    type: 'tuple',
                    items: children.map((c) => c.public),
                    loc: p.loc,
                },
                initial: singleton?.initial ?? {
                    type: 'tuple',
                    items: children.map((c) => c.initial),
                    loc: p.loc,
                },
                final: singleton?.final ?? {
                    type: 'tuple',
                    items: children.map((c) => c.final),
                    loc: p.loc,
                },
                restore:
                    p.type === 'constructor'
                        ? {
                              type: 'constructor',
                              name: p.name,
                              args: children.map((c) => c.restore),
                              loc: p.loc,
                          }
                        : p.type === 'record'
                          ? {
                                type: 'record',
                                fields: p.fields.map((f, i) => ({
                                    name: f.name,
                                    value: children[i].restore,
                                    loc: f.loc,
                                })),
                                loc: p.loc,
                            }
                          : { type: 'tuple', items: children.map((c) => c.restore), loc: p.loc },
            };
        }
        if (p.type === 'id' || p.type === 'drop') {
            const privateName = fresh(p.loc);
            const final = fresh(p.loc);
            return {
                owned: privateName,
                public: p,
                initial: copy(privateName),
                final,
                restore: copy(final),
            };
        }
        // Literal constraints select a branch, and their contents are preserved.
        if (p.type === 'lens')
            throw new TypeDiagnostic(
                'invalid-lens-pattern',
                p.loc,
                'Nested lens patterns are not allowed in borrowed matching',
            );
        return {
            owned: p,
            public: { type: 'drop', loc: p.loc },
            initial: { type: 'tuple', items: [], loc: p.loc },
            final: { type: 'tuple', items: [], loc: p.loc },
            restore:
                p.type === 'string'
                    ? { type: 'string', head: p.text, interp: [], loc: p.loc }
                    : { ...p },
        };
    };
    const wrap = (p: Pat, body: Linear | Lens, owner: Id, loc: number) => {
        const parts = prepare(p);
        const target = copy(owner);
        // Shared identity links the retained input pattern to its exact owner.
        parts.owned.reconstructionOwner = target;
        const focus: Lens = {
            type: 'aslens',
            value: parts.initial,
            pat: parts.final,
            body: { type: 'assign', lens: target, value: parts.restore, loc },
            reconstructionPattern: parts.owned,
            loc,
        };
        return {
            pattern: parts.owned,
            body: letNode(parts.public, { type: 'lens', lens: focus }, body, loc),
        };
    };
    const visit = (n: any): any => {
        if (!n || typeof n !== 'object') return n;
        if (Array.isArray(n)) return n.map(visit);
        // Normalize children before expansion; generated core nodes need no second pass.
        const c: any = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, visit(v)]));
        if (c.type === 'fn') {
            const last = c.args.at(-1);
            if (last?.pat?.type === 'lens' && hasConstructor(last.pat.inner)) {
                const owner = fresh(last.pat.loc);
                const body = c.body.type === 'lens' ? c.body.lens : c.body;
                const arm = wrap(last.pat.inner, body, owner, c.loc);
                const expanded = {
                    type: 'case',
                    value: copy(owner),
                    cases: [{ pat: arm.pattern, body: arm.body }],
                    loc: c.loc,
                };
                return {
                    ...c,
                    args: [...c.args.slice(0, -1), { ...last, pat: { ...last.pat, inner: owner } }],
                    body: c.body.type === 'lens' ? { type: 'lens', lens: expanded } : expanded,
                };
            }
        }
        if (c.type === 'let' && c.value.type === 'lens' && hasConstructor(c.pat)) {
            const owner = fresh(c.loc);
            const arm = wrap(c.pat, c.body, owner, c.loc);
            return letNode(
                owner,
                c.value,
                {
                    type: 'case',
                    value: copy(owner),
                    cases: [{ pat: arm.pattern, body: arm.body }],
                    loc: c.loc,
                },
                c.loc,
                true,
            );
        }
        if (c.type === 'case' && c.value.type === 'lens') {
            const owner = fresh(c.loc);
            const cases = c.cases.map((arm: any) => {
                const expanded = wrap(arm.pat, arm.body, owner, arm.body.loc);
                return { pat: expanded.pattern, body: expanded.body };
            });
            return letNode(owner, c.value, { ...c, value: copy(owner), cases }, c.loc, true);
        }
        return c;
    };
    return visit(source);
}
