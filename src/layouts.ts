import { freezeTree, type SemanticType } from './elaborated.ts';
import { typeKey } from './typed-ir.ts';
import { BackendDiagnostic, targetConfig, targetKey, type TargetConfig } from './backend/target.ts';

export type LayoutId = string;
export type Layout = {
    id: LayoutId;
    type: SemanticType;
    storage: 'f64' | 'bool' | 'unit' | 'tuple';
    dependencies: LayoutId[];
};

/** Structural storage descriptions, not C sizeof/offsetof calculations. */
export class LayoutTable {
    readonly target: TargetConfig;
    readonly targetKey: string;
    private readonly records = new Map<LayoutId, Layout>();

    constructor(target: TargetConfig) {
        this.target = targetConfig(target);
        this.targetKey = targetKey(this.target);
    }

    intern(type: SemanticType): LayoutId {
        const id = JSON.stringify(['layout', this.targetKey, typeKey(type)]);
        if (this.records.has(id)) return id;
        let storage: Layout['storage'];
        let dependencies: LayoutId[] = [];
        switch (type.tag) {
            case 'variable':
                throw new BackendDiagnostic(
                    'unsolved-layout',
                    `Reachable layout contains type variable ${type.id}`,
                );
            case 'fn':
                throw new BackendDiagnostic(
                    'unsupported-callable-layout',
                    'Callable storage requires an explicit closure representation',
                );
            case 'tuple':
                dependencies = type.items.map((item) => this.intern(item));
                storage = type.items.length ? 'tuple' : 'unit';
                break;
            case 'con':
                if (type.args.length === 0 && type.name === 'Number') storage = 'f64';
                else if (type.args.length === 0 && type.name === 'Bool') storage = 'bool';
                else
                    throw new BackendDiagnostic(
                        'unsupported-layout',
                        `No storage definition for ${type.name}`,
                    );
        }
        this.records.set(
            id,
            freezeTree({ id, type: structuredClone(type), storage, dependencies }),
        );
        return id;
    }

    get(id: LayoutId): Layout {
        const record = this.records.get(id);
        if (!record) throw new BackendDiagnostic('invalid-layout', 'Unknown layout ID');
        return record;
    }

    /** Stable dependency-first order, independent of discovery order. */
    snapshot(): readonly Layout[] {
        const result: Layout[] = [],
            seen = new Set<LayoutId>();
        const visit = (id: LayoutId) => {
            if (seen.has(id)) return;
            seen.add(id);
            const record = this.get(id);
            record.dependencies.forEach(visit);
            result.push(record);
        };
        [...this.records.keys()].sort().forEach(visit);
        return freezeTree(result);
    }
}
