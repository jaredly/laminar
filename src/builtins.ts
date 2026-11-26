import { Solver, con, fn, plain, reads, type Scheme } from './types.ts';
import { checkConventions, checkReads, runtimeImports } from './runtime-imports.ts';

/** Source signatures, derived from the runtime import registry. */
export function builtinTypes(linearTypes = false): Map<string, Scheme> {
    const s = new Solver(),
        result = new Map<string, Scheme>();
    for (const entry of runtimeImports) {
        const type = entry.signature(s);
        checkConventions(entry, type);
        checkReads(entry, type);
        const scheme = s.generalize(type, []);
        if (entry.name === '==' || entry.name === '!=')
            scheme.bounds = [{ predicate: 'Comparable', parameter: 0 }];
        if (linearTypes && ['dup', '==', '!='].includes(entry.name))
            (scheme.bounds ??= []).push({ predicate: 'Copyable', parameter: 0 });
        result.set(entry.name, scheme);
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
        ['cons', s.generalize(fn([reads(a), reads(list)], plain(list)), [])],
        ['Some', s.generalize(fn([reads(b)], plain(option)), [])],
        ['None', s.generalize(fn([], plain(option)), [])],
    ]);
}
