import { createHash } from 'node:crypto';
import type { ConcreteProgram } from '../concrete-ir.ts';
import type { NameAllocator } from './names.ts';

export const fingerprint = (key: string) =>
    createHash('sha256').update(key).digest('hex').slice(0, 10);
const semantic = (key: string): string => {
    const t = JSON.parse(key);
    if (t[0] === 'con')
        return [t[1][0].toUpperCase() + t[1].slice(1), ...t[2].map(semantic)].join('_');
    if (t[0] === 'tuple') return t[1].length ? `Tuple_${t[1].map(semantic).join('_')}` : 'Unit';
    return 'Function';
};

/** Target spellings of the scalar layouts, which are never allocated names. */
export type ScalarNames = { f64: string; bool: string; string: string };

/** Presentation names only: distinct concrete layouts/ABIs remain distinct. */
export function layoutNames(
    program: ConcreteProgram,
    allocator: NameAllocator,
    scalars: ScalarNames,
) {
    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const names = new Map<string, string>();
    const label = (id: string, seen = new Set<string>()): string => {
        const l = layouts.get(id)!;
        if (l.kind === 'f64' || l.kind === 'bool' || l.kind === 'string') return scalars[l.kind];
        if (l.kind === 'unit') return 'Unit';
        if (seen.has(id)) return 'Recursive';
        const next = new Set([...seen, id]);
        const key = JSON.parse(l.key);
        if (key[2] === 'data') return semantic(key[3]);
        if (key[2] === 'environment')
            return `Environment_${l.fields.map((f) => (f.kind === 'value' ? label(f.layout, next) : 'pointer')).join('_') || 'Empty'}_${fingerprint(l.key)}`;
        if (key[2] === 'callable') {
            const entry = program.callables.find((c) => c.layout === id)?.entries[0];
            const abi = entry && program.abis.find((a) => a.id === entry.abi);
            return `Callable_${abi ? abi.arguments.map((a) => label(a, next)).join('_') + '_to_' + label(abi.result, next) : 'Value'}_${fingerprint(l.key)}`;
        }
        const read = l.fields.find((f) => f.name === 'read');
        if (read?.kind === 'pointer' && read.layout) {
            const write = l.fields.find((f) => f.name === 'replacement');
            return `Lens_${label(read.layout, next)}${write?.kind === 'pointer' && write.layout ? `_to_${label(write.layout, next)}` : ''}`;
        }
        const items = l.fields.filter((f) => f.name.startsWith('item'));
        return `Scattered_${items.map((f) => label((f as { layout: string }).layout, next)).join('_')}`;
    };
    for (const l of [...program.layouts].sort((a, b) => a.key.localeCompare(b.key))) {
        const base = label(l.id);
        names.set(
            l.id,
            ['f64', 'bool', 'string'].includes(l.kind)
                ? base
                : allocator.source(
                      base.length > 90 ? `${base.slice(0, 70)}_${fingerprint(l.key)}` : base,
                  ),
        );
    }
    const abis = new Map(
        program.abis.map((a) => {
            const signature = [
                ...a.arguments.map((id) => names.get(id)),
                'to',
                names.get(a.result),
            ].join('_');
            return [a.id, allocator.source(`Func_${signature.slice(0, 65)}_${fingerprint(a.key)}`)];
        }),
    );
    return { names, abis };
}

/** Constructor constants share the package namespace with types and functions. */
export function unionTagNames(
    program: ConcreteProgram,
    names: ReadonlyMap<string, string>,
    allocator: NameAllocator,
) {
    return new Map(
        program.layouts
            .filter((l) => l.kind === 'union')
            .map((l) => [
                l.id,
                l.fields.map((f) => allocator.source(`${names.get(l.id)}_${f.name}`)),
            ]),
    );
}
