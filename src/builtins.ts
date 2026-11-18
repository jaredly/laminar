import { Solver, con, fn, plain, flow, tuple, type Scheme, type Ty } from './types.ts';

/** Source signatures: the evaluator's hidden context argument is not a source argument. */
export function builtinTypes(): Map<string, Scheme> {
    const s = new Solver(),
        result = new Map<string, Scheme>();
    const add = (name: string, type: Ty) => result.set(name, s.generalize(type, []));
    const number = con('Number'),
        bool = con('Bool');
    for (const name of ['+', '-', '*', '/'])
        add(name, fn([plain(number), plain(number)], plain(number)));
    for (const name of ['==', '>=', '<='])
        add(name, fn([plain(number), plain(number)], plain(bool)));
    add('round', fn([plain(number)], plain(number)));
    add('heapsize', fn([], plain(number)));
    const a = s.fresh(),
        b = s.fresh(),
        replacement = s.fresh();
    add('fst', fn([flow(tuple(a, b), tuple(replacement, b))], flow(a, replacement)));
    add('dup', fn([flow(a, a)], plain(a)));
    add('charList', fn([plain(con('String'))], plain(con('List', con('String')))));
    // Remaining fixture builtins need a runtime calling-convention/resource audit.
    // Missing signatures are errors, never implicit `any`.
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
