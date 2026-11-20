import type { Expr } from './ast.ts';

/**
 * Logical cells over Zig expression trees. This mirrors src/c/storage.ts, which holds
 * strings. The Zig backend needs structured expressions so `tidy` can rewrite
 * them. Merge the two once that file can become generic.
 */
export type Data = { expression: Expr; layout: string } | Data[];
export type Cell = { data: Data };
export type View = { cell: Cell; path: number[] } | View[];
export class Storage {
    readonly cells = new Set<Cell>();
    constructor(readonly split: (data: Exclude<Data, Data[]>) => Data[]) {}
    own(data: Data): View {
        const cell = { data };
        this.cells.add(cell);
        return { cell, path: [] };
    }
    parts(data: Data): Data[] {
        return Array.isArray(data) ? data : this.split(data);
    }
    project(view: View, path: number[]): View {
        if (!path.length) return view;
        if (Array.isArray(view)) return this.project(view[path[0]!]!, path.slice(1));
        return { cell: view.cell, path: [...view.path, ...path] };
    }
    get(view: View): Data {
        if (Array.isArray(view)) return view.map((v) => this.get(v));
        return view.path.reduce((d, n) => this.parts(d)[n]!, view.cell.data);
    }
    put(view: View, data: Data): void {
        if (Array.isArray(view)) {
            const parts = this.parts(data);
            view.forEach((v, i) => this.put(v, parts[i]!));
            return;
        }
        const replace = (old: Data, path: number[]): Data => {
            if (!path.length) return data;
            return this.parts(old).map((d, i) => (i === path[0] ? replace(d, path.slice(1)) : d));
        };
        view.cell.data = replace(view.cell.data, view.path);
    }
}
