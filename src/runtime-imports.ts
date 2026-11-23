import { BackendDiagnostic, type TargetConfig } from './backend/target.ts';
import { Solver, con, fn, plain, reads, flow, tuple, type FlowTy, type Ty } from './types.ts';

/** How a call boundary treats an argument or result: transferred data, or a lens capability. */
export type ImportConvention = 'owned' | 'lens';
/** Host services an import needs beyond the backend's own allocation and traps. */
export type HostCapability = 'stdout' | 'stdin';
export type ImportBackend = 'reference' | 'c' | 'go';

/**
 * One runtime import. The source signature is the only typing authority; the
 * conventions restate its plain/flow structure for backends and are checked against
 * it. Source arity is the signature's arity: no backend passes a hidden context.
 */
export type RuntimeImport = {
    name: string;
    signature: (s: Solver) => Ty;
    arguments: readonly ImportConvention[];
    result: ImportConvention;
    capability?: HostCapability;
    /** Backends with an implementation. Every claim is exercised by tests. */
    backends: readonly ImportBackend[];
    semantics: string;
};

const number = con('Number'),
    bool = con('Bool'),
    string = con('String');
const all = ['reference', 'c', 'go'] as const;
const numeric = (name: string, result: Ty, semantics: string): RuntimeImport => ({
    name,
    signature: () => fn([reads(number), reads(number)], plain(result)),
    arguments: ['owned', 'owned'],
    result: 'owned',
    backends: all,
    semantics,
});

export const runtimeImports: readonly RuntimeImport[] = [
    numeric('+', number, 'IEEE-754 double addition'),
    numeric('-', number, 'IEEE-754 double subtraction'),
    numeric('*', number, 'IEEE-754 double multiplication'),
    numeric('/', number, 'IEEE-754 double division'),
    numeric('==', bool, 'IEEE-754 equality (NaN is unequal to itself)'),
    numeric('>=', bool, 'IEEE-754 ordered comparison'),
    numeric('<=', bool, 'IEEE-754 ordered comparison'),
    {
        name: 'round',
        signature: () => fn([reads(number)], plain(number)),
        arguments: ['owned'],
        result: 'owned',
        backends: all,
        semantics:
            'ECMAScript Math.round: halves toward +Infinity, zero keeps the sign of its input',
    },
    {
        name: 'heapsize',
        signature: () => fn([], plain(number)),
        arguments: [],
        result: 'owned',
        backends: all,
        semantics: 'Size of the explicit source heap; the checked subset has none, so always 0',
    },
    {
        name: 'fst',
        signature: (s) => {
            const a = s.fresh(),
                b = s.fresh(),
                replacement = s.fresh();
            return fn([flow(tuple(a, b), tuple(replacement, b))], flow(a, replacement));
        },
        arguments: ['lens'],
        result: 'lens',
        backends: all,
        semantics: 'Projects the first component of a pair focus; the second is untouched',
    },
    {
        name: 'dup',
        signature: (s) => {
            const a = s.fresh();
            return fn([flow(a, a)], plain(a));
        },
        arguments: ['lens'],
        result: 'owned',
        backends: all,
        semantics: 'Deep copy of the focused data, which is restored unchanged',
    },
    {
        name: 'array',
        signature: (s) => {
            const a = s.fresh();
            return fn([reads(number), reads(a)], plain(con('Vector', a)));
        },
        arguments: ['owned', 'owned'],
        result: 'owned',
        backends: all,
        semantics:
            'A vector of the given length (a non-negative integer, else trap), each element a deep copy of the consumed value',
    },
    {
        name: 'size',
        signature: (s) => {
            const v = con('Vector', s.fresh());
            return fn([flow(v, v)], plain(number));
        },
        arguments: ['lens'],
        result: 'owned',
        backends: all,
        semantics: 'Number of elements of the focused vector, which is restored unchanged',
    },
    {
        name: '[]',
        signature: (s) => {
            const a = s.fresh(),
                v = con('Vector', a);
            return fn([reads(number), flow(v, v)], flow(a, a));
        },
        arguments: ['owned', 'lens'],
        result: 'lens',
        backends: all,
        semantics:
            'Source `v[i]`: focuses element i of the vector focus; traps unless i is an integer in [0, length)',
    },
    {
        name: '[::]',
        signature: (s) => fn([], plain(con('Vector', s.fresh()))),
        arguments: [],
        result: 'owned',
        backends: all,
        semantics: 'Source `[::]`: an empty vector',
    },
    {
        name: '[:push:]',
        signature: (s) => {
            const a = s.fresh(),
                v = con('Vector', a);
            return fn([reads(v), reads(a)], plain(v));
        },
        arguments: ['owned', 'owned'],
        result: 'owned',
        backends: all,
        semantics: 'Source `[:a, b:]` items: consumes a vector and appends one element',
    },
    {
        name: 'charList',
        signature: () => fn([reads(string)], plain(con('List', string))),
        arguments: ['owned'],
        result: 'owned',
        backends: all,
        semantics: 'Consumes a string and lists its Unicode code points as strings',
    },
    {
        name: 'getInput',
        signature: () => fn([reads(string)], plain(string)),
        arguments: ['owned'],
        result: 'owned',
        capability: 'stdin',
        backends: all,
        semantics:
            'Writes the consumed prompt to stdout, then reads one stdin line without its newline (end of input ends the line)',
    },
    {
        name: 'print',
        signature: () => fn([reads(string)], plain(tuple())),
        arguments: ['owned'],
        result: 'owned',
        capability: 'stdout',
        backends: all,
        semantics: 'Writes the consumed string and a newline to stdout',
    },
];

const byName = new Map(runtimeImports.map((i) => [i.name, i]));

/** Host capabilities each runtime profile provides. */
export const runtimeCapabilities: Record<TargetConfig['runtime'], readonly HostCapability[]> = {
    native: ['stdout', 'stdin'],
    go: ['stdout', 'stdin'],
    'emscripten-node': ['stdout', 'stdin'],
    // Browser builds have console output but no synchronous line input.
    'emscripten-browser': ['stdout'],
};

/** Strip the `native/` definition prefix used in typed IR. */
export function importName(definition: string): string {
    return definition.startsWith('native/') ? definition.slice(7) : definition;
}

/**
 * The single availability check: the import exists, the backend implements it,
 * and (given a target) the target's runtime provides its host capability.
 */
export function requireImport(
    definition: string,
    backend: ImportBackend,
    target?: TargetConfig,
): RuntimeImport {
    const name = importName(definition);
    const entry = byName.get(name);
    if (!entry)
        throw new BackendDiagnostic('unknown-import', `No runtime import registered for ${name}`);
    if (!entry.backends.includes(backend))
        throw new BackendDiagnostic(
            'unsupported-import',
            `Runtime import ${name} has no ${backend} implementation`,
        );
    if (
        target &&
        entry.capability &&
        !runtimeCapabilities[target.runtime].includes(entry.capability)
    )
        throw new BackendDiagnostic(
            'unavailable-capability',
            `Runtime import ${name} needs ${entry.capability}, which the ${target.runtime} runtime does not provide`,
        );
    return entry;
}

/** Whether any of the given import definitions performs host I/O. */
export const usesHost = (definitions: Iterable<string>): boolean =>
    [...definitions].some((d) => !!byName.get(importName(d))?.capability);

/** Conventions must restate the signature: plain is owned, flow is lens. */
export function checkConventions(entry: RuntimeImport, type: Ty): void {
    const convention = (f: FlowTy): ImportConvention => (f.tag === 'plain' ? 'owned' : 'lens');
    if (
        type.tag !== 'fn' ||
        type.args.length !== entry.arguments.length ||
        type.args.some((a, i) => convention(a) !== entry.arguments[i]) ||
        convention(type.result) !== entry.result
    )
        throw new BackendDiagnostic(
            'invalid-import',
            `Runtime import ${entry.name} conventions disagree with its signature`,
        );
}
