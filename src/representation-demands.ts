import { BackendDiagnostic } from './backend/target.ts';

/** Compile-time equations: forcing a node resolves only its dependencies. Values
 * never contain unresolved nodes, so provisional identities cannot enter ABI keys. */
export class RepresentationDemands<T> {
    private readonly equations = new Map<string, () => T>();
    private readonly resolved = new Map<string, T>();
    private readonly active = new Set<string>();
    constructor(private readonly limit = 4096) {}
    define(id: string, equation: () => T): void {
        if (this.equations.has(id))
            throw new BackendDiagnostic('representation-demand', `Duplicate demand ${id}`);
        if (this.equations.size >= this.limit)
            throw new BackendDiagnostic(
                'representation-demand',
                'Representation demand budget exceeded',
            );
        this.equations.set(id, equation);
    }
    get(id: string): T {
        if (this.resolved.has(id)) return this.resolved.get(id)!;
        const equation = this.equations.get(id);
        if (!equation)
            throw new BackendDiagnostic(
                'representation-demand',
                `Unavailable replacement demand ${id}`,
            );
        if (this.active.has(id))
            throw new BackendDiagnostic('representation-demand', `Cyclic replacement demand ${id}`);
        this.active.add(id);
        try {
            const value = equation();
            this.resolved.set(id, value);
            return value;
        } finally {
            this.active.delete(id);
        }
    }
}
