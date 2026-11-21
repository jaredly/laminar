/** Logical cells survive physical version changes. Views retain cell/path identities,
 * never a pointer into an obsolete target aggregate. Each backend supplies its own
 * leaf data (an emitted expression plus whatever facts it tracks about it). */
export type Data<L> = L | Data<L>[];
export type Cell<L> = { data: Data<L> };
export type View<L> = { cell: Cell<L>; path: number[] } | View<L>[];

export class Storage<L extends object> {
    readonly cells = new Set<Cell<L>>();
    constructor(readonly split: (data: L) => Data<L>[]) {}

    own(data: Data<L>): View<L> {
        const cell = { data };
        this.cells.add(cell);
        return { cell, path: [] };
    }

    parts(data: Data<L>): Data<L>[] {
        return Array.isArray(data) ? data : this.split(data);
    }

    project(view: View<L>, path: number[]): View<L> {
        if (!path.length) return view;
        if (Array.isArray(view)) return this.project(view[path[0]!]!, path.slice(1));
        return { cell: view.cell, path: [...view.path, ...path] };
    }

    get(view: View<L>): Data<L> {
        if (Array.isArray(view)) return view.map((v) => this.get(v));
        return view.path.reduce((d, n) => this.parts(d)[n]!, view.cell.data);
    }

    put(view: View<L>, data: Data<L>): void {
        if (Array.isArray(view)) {
            const parts = this.parts(data);
            view.forEach((v, i) => this.put(v, parts[i]!));
            return;
        }
        const replace = (old: Data<L>, path: number[]): Data<L> => {
            if (!path.length) return data;
            return this.parts(old).map((d, i) => (i === path[0] ? replace(d, path.slice(1)) : d));
        };
        view.cell.data = replace(view.cell.data, view.path);
    }

    snapshot(): Map<Cell<L>, Data<L>> {
        return new Map([...this.cells].map((c) => [c, c.data]));
    }

    reset(snapshot: Map<Cell<L>, Data<L>>): void {
        snapshot.forEach((d, c) => (c.data = d));
    }
}
