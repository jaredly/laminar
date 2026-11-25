import { BackendDiagnostic, type TargetConfig } from './backend/target.ts';
import {
    Solver,
    SHARED,
    con,
    fn,
    plain,
    reads,
    flow,
    tuple,
    type FlowTy,
    type Ty,
} from './types.ts';

/** How a call boundary treats an argument or result: transferred data, or a lens capability. */
export type ImportConvention = 'owned' | 'lens';
/** Host services an import needs beyond the backend's own allocation and traps. */
export type HostCapability = 'stdout' | 'stdin' | 'files' | 'threads' | 'network';
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

/** `==` and `!=` compare any two values of one type that holds no callable. */
const equality = (name: string, semantics: string): RuntimeImport => ({
    name,
    signature: (s) => {
        const a = s.fresh();
        return fn([reads(a), reads(a)], plain(bool));
    },
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
    numeric(
        '%',
        number,
        'ECMAScript remainder: truncated division, the result has the dividend sign',
    ),
    equality(
        '==',
        'Structural equality; numbers compare as IEEE-754 doubles (NaN is unequal to itself)',
    ),
    equality('!=', 'Structural inequality, the negation of `==`'),
    numeric('<', bool, 'IEEE-754 ordered comparison'),
    numeric('>', bool, 'IEEE-754 ordered comparison'),
    numeric('>=', bool, 'IEEE-754 ordered comparison'),
    numeric('<=', bool, 'IEEE-754 ordered comparison'),
    {
        name: 'not',
        signature: () => fn([reads(bool)], plain(bool)),
        arguments: ['owned'],
        result: 'owned',
        backends: all,
        semantics: 'Boolean negation',
    },
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
            return fn([reads(number), plain(a)], plain(con('Vector', a)));
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
            return fn([plain(v), plain(a)], plain(v));
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
    {
        name: 'write',
        signature: () => fn([reads(string)], plain(tuple())),
        arguments: ['owned'],
        result: 'owned',
        capability: 'stdout',
        backends: all,
        semantics: 'Writes the consumed string to stdout with no newline, then flushes stdout',
    },
    {
        name: 'writeFile',
        signature: () =>
            fn([reads(string), plain(con('Vector', number))], plain(tuple())),
        arguments: ['owned', 'owned'],
        result: 'owned',
        capability: 'files',
        backends: all,
        semantics:
            'Consumes a path and a vector of byte values and writes the bytes to that file, replacing it. Every element must be an integer in [0, 255] and the file must be writable, else trap',
    },
    {
        name: 'spawn',
        signature: () => fn([plain(fn([], plain(tuple())))], plain(tuple())),
        arguments: ['owned'],
        result: 'owned',
        capability: 'threads',
        backends: ['go'],
        semantics:
            'Consumes a task and runs it concurrently, returning at once. The task owns everything it captured: a closure may move or share values but never borrow, so no two tasks reach the same mutable data',
    },
    {
        name: 'sleep',
        signature: () => fn([reads(number)], plain(tuple())),
        arguments: ['owned'],
        result: 'owned',
        capability: 'threads',
        backends: ['go'],
        semantics: 'Blocks the calling task for the given milliseconds; other tasks keep running',
    },
    {
        name: 'chanNew',
        signature: () => fn([], plain(number)),
        arguments: [],
        result: 'owned',
        capability: 'threads',
        backends: ['go'],
        semantics:
            'A new unbuffered channel of numbers, named by a handle. Sending and receiving block until the other side arrives',
    },
    {
        name: 'chanSend',
        signature: () => fn([reads(number), reads(number)], plain(tuple())),
        arguments: ['owned', 'owned'],
        result: 'owned',
        capability: 'threads',
        backends: ['go'],
        semantics: 'Sends a number on a channel, blocking until a task receives it',
    },
    {
        name: 'chanRecv',
        signature: () => fn([reads(number)], plain(number)),
        arguments: ['owned'],
        result: 'owned',
        capability: 'threads',
        backends: ['go'],
        semantics: 'Receives a number from a channel, blocking until a task sends one',
    },
    {
        name: 'listen',
        signature: () => fn([reads(number)], plain(number)),
        arguments: ['owned'],
        result: 'owned',
        capability: 'network',
        backends: ['go'],
        semantics:
            'Listens for TCP connections on the port and returns a handle; traps if the port cannot be bound',
    },
    {
        name: 'accept',
        signature: () => fn([reads(number)], plain(number)),
        arguments: ['owned'],
        result: 'owned',
        capability: 'network',
        backends: ['go'],
        semantics: 'Waits for a connection on a listener handle and returns a handle for it',
    },
    {
        name: 'recv',
        signature: () => fn([reads(number)], plain(string)),
        arguments: ['owned'],
        result: 'owned',
        capability: 'network',
        backends: ['go'],
        semantics:
            'Reads what one read of the connection returns, up to 8192 bytes, as text; "" at end of input or on an error',
    },
    {
        name: 'send',
        signature: () => fn([reads(number), reads(string)], plain(tuple())),
        arguments: ['owned', 'owned'],
        result: 'owned',
        capability: 'network',
        backends: ['go'],
        semantics: 'Writes the text to the connection; errors are ignored',
    },
    {
        name: 'closeHandle',
        signature: () => fn([reads(number)], plain(tuple())),
        arguments: ['owned'],
        result: 'owned',
        capability: 'network',
        backends: ['go'],
        semantics: 'Closes a listener or connection handle; closing twice is harmless',
    },
    {
        name: 'waitKey',
        signature: () => fn([reads(number)], plain(string)),
        arguments: ['owned'],
        result: 'owned',
        capability: 'stdin',
        backends: all,
        semantics:
            'Flushes stdout, then waits up to the given milliseconds for one byte of stdin and returns it as a string; returns "" on timeout or end of input. On a terminal, input is unbuffered and unechoed during the wait only. The reference evaluator ignores the timeout',
    },
    {
        name: 'random',
        signature: () => fn([reads(number)], plain(number)),
        arguments: ['owned'],
        result: 'owned',
        backends: all,
        semantics:
            'A pseudo-random integer in [0, n) for an integer n in [1, 2^32), else trap. xorshift32 (13, 17, 5) over a seed taken from LAMINAR_SEED when set (read as an unsigned integer; 0 becomes 2463534242), else from the clock, so a fixed seed gives the same sequence on every backend',
    },
];

/** Natives a backend may spell as an infix operator: scalar operands, no effects, no traps. */
export const infixImports: readonly string[] = [
    '+',
    '-',
    '*',
    '/',
    '==',
    '!=',
    '<',
    '>',
    '>=',
    '<=',
];

const byName = new Map(runtimeImports.map((i) => [i.name, i]));

/** Host capabilities each runtime profile provides. */
export const runtimeCapabilities: Record<TargetConfig['runtime'], readonly HostCapability[]> = {
    native: ['stdout', 'stdin', 'files'],
    go: ['stdout', 'stdin', 'files', 'threads', 'network'],
    'emscripten-node': ['stdout', 'stdin', 'files'],
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

const variables = (t: Ty | FlowTy, into = new Set<number>()): Set<number> => {
    switch (t.tag) {
        case 'meta':
        case 'rigid':
            into.add(t.id);
            break;
        case 'con':
            t.args.forEach((a) => variables(a, into));
            break;
        case 'tuple':
            t.items.forEach((a) => variables(a, into));
            break;
        case 'record':
            t.fields.forEach((f) => variables(f.type, into));
            break;
        case 'fn':
            t.args.forEach((a) => variables(a, into));
            variables(t.result, into);
            break;
        case 'plain':
            variables(t.value, into);
            break;
        case 'flow':
            variables(t.read, into);
            variables(t.write, into);
            break;
    }
    return into;
};

/**
 * A `reads` parameter promises the native does not keep its argument. A native can only keep a
 * value of a generic type by putting it in its result or another owned argument, so a type
 * variable of a `reads` parameter may not appear in either; use an owned parameter instead.
 */
export function checkReads(entry: RuntimeImport, type: Ty): void {
    if (type.tag !== 'fn') return;
    const kept = new Set<number>();
    variables(type.result, kept);
    type.args.forEach((a) => a.tag === 'plain' && a.mode !== SHARED && variables(a, kept));
    type.args.forEach((a) => {
        if (a.tag === 'plain' && a.mode === SHARED && [...variables(a)].some((v) => kept.has(v)))
            throw new BackendDiagnostic(
                'invalid-import',
                `Runtime import ${entry.name} reads a generic argument it may keep; make that parameter owned`,
            );
    });
}

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
