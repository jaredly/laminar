/**
 * Linear types (dual mode): values that cannot be copied. A type is linear when it is declared
 * `type linear`, or when it contains a linear type as a type argument, tuple item or record field.
 * A closure is linear when it captured a linear value or an owned lens (docs/owned-lenses.md).
 */
type Shape = {
    tag: string;
    name?: string;
    args?: Shape[];
    items?: Shape[];
    fields?: { type: Shape }[];
    linear?: boolean;
};

/** `isDeclaredLinear` says whether a named union was declared `type linear`. */
export function isLinear(type: Shape, isDeclaredLinear: (name: string) => boolean): boolean {
    const any = (types: Shape[] | undefined) =>
        (types ?? []).some((t) => isLinear(t, isDeclaredLinear));
    switch (type.tag) {
        case 'con':
            // A channel is a handle, shared between tasks, whatever it carries.
            if (type.name === 'Chan') return false;
            return isDeclaredLinear(type.name!) || any(type.args);
        case 'tuple':
            return any(type.items);
        case 'record':
            return any(type.fields?.map((f) => f.type));
        case 'fn':
            return !!type.linear;
        default:
            return false;
    }
}
