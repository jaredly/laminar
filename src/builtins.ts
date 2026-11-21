import { Solver, con, fn, plain, type Scheme } from './types.ts';
import { checkConventions, runtimeImports } from './runtime-imports.ts';

/** Source signatures, derived from the runtime import registry. */
export function builtinTypes(): Map<string, Scheme> {
    const s = new Solver(),
        result = new Map<string, Scheme>();
    for (const entry of runtimeImports) {
        const type = entry.signature(s);
        checkConventions(entry, type);
        result.set(entry.name, s.generalize(type, []));
    }
    return result;
}

export function constructorTypes(): Map<string, Scheme> {
    const s = new Solver(),
        a = s.fresh(),
        list = con('List', a),
        b = s.fresh(),
        option = con('Option', b);
    return new Map([
        ['nil', s.generalize(fn([], plain(list)), [])],
        ['cons', s.generalize(fn([plain(a), plain(list)], plain(list)), [])],
        ['Some', s.generalize(fn([plain(b)], plain(option)), [])],
        ['None', s.generalize(fn([], plain(option)), [])],
    ]);
}
