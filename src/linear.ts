/**
 * Linear types (dual mode): values that cannot be copied. A type is linear when it is declared
 * `type linear`, or when it contains a linear type as a type argument, tuple item or record field.
 * Closures are not yet considered.
 */
type Shape = {
    tag: string;
    name?: string;
    args?: Shape[];
    items?: Shape[];
    fields?: { type: Shape }[];
};

/** `isDeclaredLinear` says whether a named union was declared `type linear`. */
export function isLinear(type: Shape, isDeclaredLinear: (name: string) => boolean): boolean {
    const any = (types: Shape[] | undefined) =>
        (types ?? []).some((t) => isLinear(t, isDeclaredLinear));
    switch (type.tag) {
        case 'con':
            return isDeclaredLinear(type.name!) || any(type.args);
        case 'tuple':
            return any(type.items);
        case 'record':
            return any(type.fields?.map((f) => f.type));
        default:
            return false;
    }
}
