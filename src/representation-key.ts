import type { CallableMember, ValueRepresentation } from './infer-representations.ts';
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
        case 'lens':
            return JSON.stringify({ kind: 'lens', shape: v.shape });
        case 'callable':
            return JSON.stringify({ kind: 'callable', type: v.type });
    }
}
/** Canonical identity of a callable member (closure code with captures, or a native). */
export function memberKey(m: CallableMember): string {
    return m.kind === 'native'
        ? JSON.stringify({ kind: 'native', definition: m.definition })
        : JSON.stringify({
              kind: 'closure',
              unit: m.unit,
              function: m.function,
              captures: m.captures.map((c) => JSON.parse(representationKey(c))),
          });
}
