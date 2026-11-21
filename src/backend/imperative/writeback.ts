import type { Data as StorageData } from '../storage.ts';
import { isExpr, same, type Expr } from './code.ts';
import { bodies, type Statement } from './statements.ts';

/** Storage facts write-back needs: a leaf's layout and, for a live read, its address. */
export type Leaf = { layout: string; address?: Expr };
type Data<L extends Leaf> = StorageData<L>;

export type JoinGroup = { boundary: Statement[] };
export type PendingJoin<L extends Leaf> = {
    group: JoinGroup;
    inputs: () => { data: Data<L>; body: Statement[] }[];
    materialized: boolean;
};
export type WriteDestination<L extends Leaf> = { pointer: Expr; layout: string; data: Data<L> };
export type Writeback<L extends Leaf> = {
    body: Statement[];
    destinations: () => WriteDestination<L>[];
    fallback: () => void;
};

/** Consume terminal storage joins at their destinations, before demanding phi
 * expressions. Reads and nonterminal stores retain the ordinary materialization
 * path. No statement text is inspected to infer effects or rewrite identifiers. */
export function lowerWritebacks<L extends Leaf>(
    body: Statement[],
    sites: Writeback<L>[],
    pending: WeakMap<object, PendingJoin<L>>,
    read: (data: Data<L>, layout: string) => Expr,
    assign: (pointers: Expr[], values: Expr[]) => Statement,
) {
    const columns = new Map(sites.map((s) => [s, s.destinations()]));
    const groups = new Map<Statement[], JoinGroup>();
    for (const writes of columns.values())
        for (const w of writes) {
            const join = pending.get(w.data);
            if (join) groups.set(join.group.boundary, join.group);
        }
    const siteBodies = new Set(sites.map((s) => s.body));
    const predecessors = () => {
        const result = new Map<Statement[], JoinGroup | undefined>();
        const scope = (array: Statement[]) => {
            let previous: JoinGroup | undefined;
            const walk = (items: Statement[]) => {
                for (const s of items) {
                    if (Array.isArray(s)) {
                        if (siteBodies.has(s)) {
                            // A retained cleanup body can occur on several
                            // edges. Every occurrence must have the same tail.
                            result.set(
                                s,
                                result.has(s) && result.get(s) !== previous ? undefined : previous,
                            );
                            previous = undefined;
                        }
                        walk(s);
                        const group = groups.get(s);
                        if (group) previous = group;
                    } else if (!isExpr(s) || String(s).trim()) {
                        previous = undefined;
                        bodies(s).forEach(scope);
                    }
                }
            };
            walk(array);
        };
        scope(body);
        return result;
    };
    const unresolved = new Set(sites);
    const prepared = new Map<Writeback<L>, { body: Statement[]; values: Expr[] }[]>();
    while (unresolved.size) {
        const before = predecessors();
        const plans = new Map<Writeback<L>, { body: Statement[]; data: Data<L>[] }[]>();
        for (const site of unresolved) {
            const writes = columns.get(site)!;
            const joins = writes.map((w) => pending.get(w.data));
            const first = joins.find((j) => j !== undefined);
            if (
                !first ||
                before.get(site.body) !== first.group ||
                joins.some((j, n) =>
                    j
                        ? j.group !== first.group || j.materialized
                        : Array.isArray(writes[n]!.data) ||
                          writes[n]!.data.layout !== writes[n]!.layout ||
                          !same(writes[n]!.data.address, writes[n]!.pointer),
                )
            )
                continue;
            const inputs = joins.map((j) => j?.inputs());
            const arms = first.inputs();
            if (
                inputs.some(
                    (items) =>
                        items &&
                        (items.length !== arms.length ||
                            items.some((x, n) => x.body !== arms[n]!.body)),
                )
            )
                continue;
            plans.set(
                site,
                arms.map((arm, n) => ({
                    body: arm.body,
                    data: writes.map((w, k) => inputs[k]?.[n]?.data ?? w.data),
                })),
            );
        }
        // Fallback reads can demand other joins and fill sequencing anchors.
        // Resolve those first, then reconsider adjacency and materialization.
        const rejected = [...unresolved].filter((s) => !plans.has(s));
        if (rejected.length) {
            for (const site of rejected) {
                site.fallback();
                unresolved.delete(site);
                prepared.delete(site);
            }
            continue;
        }
        let demanded = false;
        for (const [site, arms] of plans) {
            if (prepared.has(site)) continue;
            const writes = columns.get(site)!;
            prepared.set(
                site,
                arms
                    .filter(
                        (arm) =>
                            !arm.data.every(
                                (d, n) =>
                                    !Array.isArray(d) &&
                                    d.layout === writes[n]!.layout &&
                                    same(d.address, writes[n]!.pointer),
                            ),
                    )
                    .map((arm) => ({
                        body: arm.body,
                        values: arm.data.map((d, n) => read(d, writes[n]!.layout)),
                    })),
            );
            demanded = true;
        }
        if (demanded) continue;
        for (const site of unresolved) {
            const pointers = columns.get(site)!.map((w) => w.pointer);
            for (const arm of prepared.get(site)!) arm.body.push(assign(pointers, arm.values));
        }
        break;
    }
}
