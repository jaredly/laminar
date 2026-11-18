import type { ValueRepresentation } from './infer-representations.ts';
/** Canonical field order, including nested callable environments, for cache identities. */
export function representationKey(v: ValueRepresentation): string {
    switch (v.kind) {
        case 'data':
            return JSON.stringify({ kind: 'data', layout: v.layout });
        case 'aggregate':
            return JSON.stringify({
                kind: v.kind,
                items: v.items.map((c) => JSON.parse(representationKey(c))),
            });
        case 'local-focus':
            return JSON.stringify({
                kind: v.kind,
                read: JSON.parse(representationKey(v.read)),
                replacement: JSON.parse(representationKey(v.replacement)),
            });
        case 'lens':
            return JSON.stringify({ kind: 'lens', shape: v.shape });
        case 'native':
            return JSON.stringify({ kind: 'native', definition: v.definition });
        case 'callable-choice':
            return JSON.stringify({
                kind: v.kind,
                options: v.options.map((c) => JSON.parse(representationKey(c))),
            });
        case 'callable':
            return JSON.stringify({
                kind: 'callable',
                unit: v.unit,
                function: v.function,
                captures: v.captures.map((c) => JSON.parse(representationKey(c))),
            });
    }
}
