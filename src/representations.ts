import { freezeTree, type SemanticType } from './elaborated.ts';
import { BackendDiagnostic } from './backend/target.ts';
import { LayoutTable, type LayoutId } from './layouts.ts';

export type LensRepId = string;
export type BackingId = string;
export type Backing = {
    id: BackingId;
    read: LayoutId;
    replacement: LayoutId;
    access: 'same-layout' | 'separate-slots';
};
export type LensRep = { id: LensRepId; read: LayoutId; replacement: LayoutId } & (
    | { kind: 'thin'; backing: BackingId }
    | { kind: 'tuple'; items: LensRepId[] }
);

/** Contains concrete shapes only; generic parameters belong to constraint inference. */
export class RepresentationTable {
    private readonly backings = new Map<BackingId, Backing>();
    private readonly shapes = new Map<LensRepId, LensRep>();
    constructor(readonly layouts: LayoutTable) {}

    thin(readType: SemanticType, replacementType: SemanticType): LensRepId {
        const read = this.layouts.intern(readType),
            replacement = this.layouts.intern(replacementType);
        const backing = JSON.stringify(['backing', read, replacement]);
        if (!this.backings.has(backing))
            this.backings.set(
                backing,
                freezeTree({
                    id: backing,
                    read,
                    replacement,
                    access: read === replacement ? 'same-layout' : 'separate-slots',
                }),
            );
        return this.add({
            id: JSON.stringify(['thin', backing]),
            kind: 'thin',
            backing,
            read,
            replacement,
        });
    }

    tuple(items: readonly LensRepId[]): LensRepId {
        const children = items.map((id) => this.get(id));
        const read = this.layouts.intern({
            tag: 'tuple',
            items: children.map((c) => this.layouts.get(c.read).type),
        });
        const replacement = this.layouts.intern({
            tag: 'tuple',
            items: children.map((c) => this.layouts.get(c.replacement).type),
        });
        return this.add({
            id: JSON.stringify(['lens-tuple', items]),
            kind: 'tuple',
            items: [...items],
            read,
            replacement,
        });
    }

    /** A projection of a scattered tuple preserves its child's shape. */
    project(id: LensRepId, index: number): LensRepId {
        const shape = this.get(id);
        const read = this.layouts.get(shape.read).type,
            replacement = this.layouts.get(shape.replacement).type;
        if (
            !Number.isInteger(index) ||
            index < 0 ||
            read.tag !== 'tuple' ||
            replacement.tag !== 'tuple' ||
            index >= read.items.length ||
            index >= replacement.items.length
        )
            throw new BackendDiagnostic(
                'invalid-representation',
                'Lens projection requires a valid tuple component',
            );
        return shape.kind === 'tuple'
            ? shape.items[index]!
            : this.thin(read.items[index]!, replacement.items[index]!);
    }

    join(ids: readonly LensRepId[]): LensRepId {
        if (ids.length === 0)
            throw new BackendDiagnostic('invalid-representation', 'Empty representation join');
        ids.forEach((id) => this.get(id));
        if (ids.some((id) => id !== ids[0]))
            throw new BackendDiagnostic(
                'unsupported-representation-join',
                'Different lens shapes require a representation adapter',
            );
        return ids[0]!;
    }

    get(id: LensRepId): LensRep {
        const shape = this.shapes.get(id);
        if (!shape)
            throw new BackendDiagnostic('invalid-representation', 'Unknown lens representation ID');
        return shape;
    }
    backing(id: BackingId): Backing {
        const backing = this.backings.get(id);
        if (!backing) throw new BackendDiagnostic('invalid-representation', 'Unknown backing ID');
        return backing;
    }
    snapshot(): readonly LensRep[] {
        return freezeTree(
            [...this.shapes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        );
    }
    backingSnapshot(): readonly Backing[] {
        return freezeTree(
            [...this.backings.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        );
    }
    private add(shape: LensRep): LensRepId {
        if (!this.shapes.has(shape.id)) this.shapes.set(shape.id, freezeTree(shape));
        return shape.id;
    }
}
