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
