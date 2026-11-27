import type { SemanticType } from './elaborated.ts';
import type { Ty } from './types.ts';

/** A parameter index is stable across solver renaming and serialized IR. */
export type Predicate = 'Comparable' | 'Copyable' | 'Droppable' | 'Display';
export type Bound = { predicate: Predicate; parameter: number };
type Nominal = { impossible: boolean; required: Set<number> };
type Constructor = { definition: string; type: SemanticType };

// Solver variables have numeric identities; detached IR variables have namespaced strings.
type Shape<V> =
    | { tag: 'meta' | 'rigid' | 'variable'; id: V }
    | { tag: 'fn'; linear?: boolean }
    | { tag: 'tuple'; items: Shape<V>[] }
    | { tag: 'record'; fields: { type: Shape<V> }[]; rest?: Shape<V> }
    | { tag: 'con'; name: string; args: Shape<V>[] };
/** Return the variable obligations, or undefined when the concrete shape cannot satisfy it. */
export function requirements<V>(
    predicate: Predicate,
    type: Shape<V>,
    nominal: ReadonlyMap<string, Nominal>,
    linear: (name: string) => boolean,
): V[] | undefined {
    const ownership = predicate === 'Copyable' || predicate === 'Droppable';
    let children: Shape<V>[];
    switch (type.tag) {
        case 'meta':
        case 'rigid':
        case 'variable':
            return [type.id];
        case 'fn':
            return ownership && !type.linear ? [] : undefined;
        case 'tuple':
            children = type.items;
            break;
        case 'record':
            if (predicate === 'Display') return undefined;
            // The remainder is a variable until it is known, so it carries the obligation.
            children = type.fields.map((f) => f.type);
            if (type.rest) children.push(type.rest);
            break;
        case 'con': {
            if (predicate === 'Display')
                return ['Number', 'String', 'Bool'].includes(type.name) ? [] : undefined;
            if (ownership) {
                if (linear(type.name)) return undefined;
                children = type.name === 'Chan' ? [] : type.args;
            } else {
                const summary = nominal.get(type.name);
                if (summary?.impossible) return undefined;
                children = summary
                    ? [...summary.required].map((index) => type.args[index]!)
                    : type.args;
            }
            break;
        }
    }
    const variables: V[] = [];
    for (const child of children) {
        const needed = requirements(predicate, child, nominal, linear);
        if (!needed) return undefined;
        variables.push(...needed);
    }
    return variables;
}

/** A recursive union starts with no field requirements. Each pass can only add them. */
export function comparableUnions(
    constructors: readonly { definition: string; type: SemanticType | Ty }[],
): Map<string, Nominal> {
    const unions = new Map<string, Nominal>();
    const variants = constructors.flatMap(({ definition, type }) => {
        if (
            !definition.startsWith('constructor/') ||
            type.tag !== 'fn' ||
            type.result.tag !== 'plain' ||
            type.result.value.tag !== 'con'
        )
            return [];
        const result = type.result.value;
        if (!unions.has(result.name))
            unions.set(result.name, { impossible: false, required: new Set() });
        return [{ result, fields: type.args.flatMap((a) => (a.tag === 'plain' ? [a.value] : [])) }];
    });
    let changed = true;
    while (changed) {
        changed = false;
        for (const { result, fields } of variants) {
            const summary = unions.get(result.name)!;
            if (summary.impossible) continue;
            for (const field of fields) {
                const needed = requirements<string | number>(
                    'Comparable',
                    field,
                    unions,
                    () => false,
                );
                if (!needed) {
                    summary.impossible = changed = true;
                    break;
                }
                for (const variable of needed) {
                    const i = result.args.findIndex(
                        (a) => (a.tag === 'variable' || a.tag === 'meta') && a.id === variable,
                    );
                    if (i >= 0 && !summary.required.has(i)) {
                        summary.required.add(i);
                        changed = true;
                    }
                }
            }
        }
    }
    return unions;
}

/** Nominal linear types are identified by their exported constructors. */
export function linearUnions(
    imports: readonly (Constructor & { linearResult?: true })[],
): Set<string> {
    return new Set(
        imports.flatMap(({ linearResult, type }) =>
            linearResult &&
            type.tag === 'fn' &&
            type.result.tag === 'plain' &&
            type.result.value.tag === 'con'
                ? [type.result.value.name]
                : [],
        ),
    );
}

export const predicateErrors: Record<Predicate, [string, string]> = {
    Display: [
        'not-displayable',
        'Interpolation requires Display (String, Number, Bool, or a tuple of displayable values)',
    ],
    Comparable: [
        'not-comparable',
        'Functions cannot be compared with == or !=, including inside data',
    ],
    Droppable: ['linear-unconsumed', 'This function may drop the argument, so it cannot be linear'],
    Copyable: ['dup-linear', 'This function may copy the argument, so it cannot be linear'],
};
