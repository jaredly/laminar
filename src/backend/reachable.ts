import type { ConcreteProgram } from '../concrete-ir.ts';

/** Package identity and dependencies, supplied by lowering rather than parsed text. */
export class Declaration {
    constructor(
        readonly name: string,
        readonly text: string,
        readonly dependencies: readonly string[] = [],
        /** Initializers with effects must run even when their value is unused. */
        readonly root = false,
    ) {}
    toString(): string {
        return this.text;
    }
}

/** Follow named declaration edges; unreachable cycles never become roots. */
export function reachableNames(
    graph: ReadonlyMap<string, Iterable<string>>,
    roots: Iterable<string>,
): Set<string> {
    const live = new Set<string>();
    const pending = [...roots];
    while (pending.length) {
        const name = pending.pop()!;
        if (live.has(name) || !graph.has(name)) continue;
        live.add(name);
        pending.push(...graph.get(name)!);
    }
    return live;
}

/** Layout fields and callable signatures are the declaration dependency graph.
 * Scalar spellings may name builtins; graph consumers ignore absent declarations. */
export function typeDependencies(
    program: Pick<ConcreteProgram, 'layouts' | 'abis'>,
    layouts: ReadonlyMap<string, string>,
    abis: ReadonlyMap<string, string>,
): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const l of program.layouts)
        graph.set(
            layouts.get(l.id)!,
            l.fields.flatMap((f) =>
                f.kind === 'code' ? [abis.get(f.abi)!] : f.layout ? [layouts.get(f.layout)!] : [],
            ),
        );
    for (const a of program.abis)
        graph.set(
            abis.get(a.id)!,
            [...a.arguments, a.result].map((id) => layouts.get(id)!),
        );
    return graph;
}

/**
 * Records which package symbols each generated declaration mentions, as lowering
 * mentions them. Nothing is recovered from printed text. Lowering wraps the
 * construction of a declaration in `within` and routes every mention of another
 * package symbol (a function, a runtime helper, a type) through `use`.
 *
 * Mentions are conservative: building an expression that a later pass simplifies
 * away still records its symbols. A mention made outside any `within` has no owner
 * and is a root.
 */
export class References {
    readonly edges = new Map<string, Set<string>>();
    readonly roots = new Set<string>();
    private owner: string | undefined;

    /** Attribute every mention made while `build` runs to `owner`. */
    within<T>(owner: string, build: () => T): T {
        const outer = this.owner;
        this.owner = owner;
        if (!this.edges.has(owner)) this.edges.set(owner, new Set());
        try {
            return build();
        } finally {
            this.owner = outer;
        }
    }
    /** Record a mention of `name` by the current owner and return it unchanged. */
    use<T extends string>(name: T): T {
        if (this.owner === undefined) this.roots.add(name);
        else this.edges.get(this.owner)!.add(name);
        return name;
    }
    /**
     * The declaration graph: `base` edges plus the recorded mentions. Every mentioned
     * name is a node, so a declaration with nothing to mention (a counter, a leaf
     * function, `main`) is live when something reaches it.
     */
    graph(base: ReadonlyMap<string, Iterable<string>> = new Map()): Map<string, Set<string>> {
        const graph = new Map([...base].map(([k, v]) => [k, new Set(v)]));
        for (const [owner, uses] of this.edges)
            graph.set(owner, new Set([...(graph.get(owner) ?? []), ...uses]));
        for (const name of [...this.roots, ...[...this.edges.values()].flatMap((u) => [...u])])
            if (!graph.has(name)) graph.set(name, new Set());
        return graph;
    }
}
