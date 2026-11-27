import { displayValue } from './display.ts';
import type { SemanticType, Step } from './elaborated.ts';
import { freezeTree } from './elaborated.ts';
import { decodeNumber, subpatterns } from './typed-ir.ts';
import { BackendDiagnostic } from './backend/target.ts';
import type {
    TypedProgram,
    IRUnit,
    IRFunction,
    IRBlock,
    IRPattern,
    SlotRef,
    Cleanup,
    Instruction,
} from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import { channel, enter, schedule, type Channel, type Run } from './eval-tasks.ts';
import createPrompt from 'prompt-sync';
import { readSync, writeFileSync } from 'node:fs';
import { requireImport } from './runtime-imports.ts';

const EMPTY = Symbol('empty-place');
type Variant = { kind: 'variant'; name: string; items: Data[] };
type FunctionValue = {
    kind: 'function';
    unit: IRUnit;
    fn: IRFunction;
    captures: Map<string, Data>;
    /** Captured owned lenses: only a call can end them, so the closure cannot be dropped. */
    lenses: Map<string, Lens>;
    reusable: boolean;
    used: boolean;
    /** Dependencies supplied where it was injected; otherwise its caller's. */
    supplied?: ReadonlyMap<string, Data>;
};
type NativeValue = { kind: 'native'; name: string };
/** Elements are always initialized: index lenses keep every element full. */
type VectorValue = { kind: 'vector'; items: Data[] };
export type ReferenceValue =
    | number
    | boolean
    | string
    | null
    | ReferenceValue[]
    | Variant
    | FunctionValue
    | NativeValue;
type Data =
    | number
    | boolean
    | string
    | null
    | Data[]
    | Variant
    | FunctionValue
    | NativeValue
    | VectorValue
    | typeof EMPTY;
type Lens = {
    kind: 'lens';
    peek(): Data;
    replace(value: Data): Data;
    /** Ending a lens runs its producer's cleanup, which may block. */
    finish(): Run<void>;
    project(path: Step[]): Lens;
};
type Argument = Data | Lens;
type Frame = {
    places: Map<string, Lens>;
    values: Map<string, Argument>;
    loans: Map<string, Lens>;
    /** Owned lenses this call was handed, by place, until it ends or moves them. */
    held: Map<string, Lens>;
    /** The dependencies the code running here can read. */
    needs: ReadonlyMap<string, Data>;
};
const frame = (): Frame => ({
    places: new Map(),
    values: new Map(),
    loans: new Map(),
    held: new Map(),
    needs: new Map(),
});
export type ReferenceOptions = {
    /** Execution trace is useful for checking sequencing and diagnosing reference failures. */
    onStep?: (origin: string, operation: Instruction['op']) => void;
    /** An unused affine environment is disposed; invocation transfers its captures instead. */
    onDisposeClosure?: () => void;
    /** Deterministic test guard, not a semantic recursion restriction. */
    maxSteps?: number;
    /** Host stdout for `print` and `getInput` prompts; defaults to the process stdout. */
    stdout?: (text: string) => void;
    /** Host line input for `getInput`, without its newline; defaults to an interactive prompt. */
    stdin?: () => string;
    /** Host key input for `waitKey`: one byte as a string, or "" at a timeout or end of input. */
    key?: (milliseconds: number) => string;
    /** Seed for `random` (read as an unsigned integer); defaults to LAMINAR_SEED, else the clock. */
    seed?: number;
};

const nothing = function* (): Run<void> {};

/**
 * A record is the array of its fields in name order, the shape a result is reported in. The
 * generic IR names fields, so the names travel beside the array.
 */
const fieldNames = new WeakMap<Data[], readonly string[]>();
const named = (items: Data[], names: readonly string[]): Data[] => {
    fieldNames.set(items, names);
    return items;
};
/** `map` that keeps a record a record. */
const mapItems = (items: Data[], f: (v: Data, i: number) => Data): Data[] => {
    const names = fieldNames.get(items);
    const result = items.map(f);
    return names ? named(result, names) : result;
};
const position = (v: Data[], step: Step): number =>
    typeof step === 'string' ? (fieldNames.get(v)?.indexOf(step) ?? -1) : step;

/** One byte of stdin as a string, "" at end of input. Blocks: the timeout is ignored. */
const readKey = (): string => {
    const byte = Buffer.alloc(1);
    try {
        return readSync(0, byte, 0, 1, null) === 1 ? String.fromCharCode(byte[0]!) : '';
    } catch {
        return '';
    }
};

/** Executes only typed IR. It does not call source inference, AST lowering, or the old evaluator. */
export function executeTypedProgram(
    program: TypedProgram,
    options: ReferenceOptions = {},
): ReferenceValue {
    let rng = 0;
    program = freezeTree(structuredClone(program));
    // Validate the entire compilation unit before executing any effects.
    verifyTypedProgram(program);
    const definitions = new Map<string, FunctionValue>();
    const valueTypes = new Map<IRUnit, Map<string, import('./elaborated.ts').SemanticFlow>>();
    for (const unit of program.units) {
        const types = new Map<string, import('./elaborated.ts').SemanticFlow>();
        const index = (b: IRBlock): void =>
            b.instructions.forEach((i) => {
                if ('out' in i) types.set(i.out.id, i.out.type);
                if (i.op === 'scope' || i.op === 'inject') index(i.body);
                else if (i.op === 'aslens') index(i.cleanup);
                else if (i.op === 'case') i.cases.forEach((c) => index(c.body));
            });
        index(unit.entry);
        unit.functions.forEach((f) => index(f.body));
        valueTypes.set(unit, types);
    }
    let steps = 0;
    const error = (message: string, origin?: string): never => {
        throw new BackendDiagnostic('reference-runtime', message, origin);
    };
    const isLens = (v: Argument): v is Lens =>
        !!v && typeof v === 'object' && !Array.isArray(v) && 'kind' in v && v.kind === 'lens';
    const data = (v: Argument): Data => (isLens(v) ? error('Expected an owned value') : v);
    const lens = (v: Argument): Lens => (isLens(v) ? v : error('Expected a lens'));
    const full = (v: Data): boolean =>
        v !== EMPTY &&
        (!Array.isArray(v) || v.every(full)) &&
        (!(v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'variant') ||
            v.items.every(full));
    const owned = (v: Data): Data => (full(v) ? v : error('Read from an empty place'));
    const logical = (v: Data): Data =>
        v === EMPTY
            ? null
            : Array.isArray(v)
              ? mapItems(v, logical)
              : v && typeof v === 'object' && v.kind === 'variant'
                ? { ...v, items: v.items.map(logical) }
                : v;
    const take = (f: Frame, id: string): Argument => {
        if (!f.values.has(id)) return error(`Temporary ${id} is unavailable`);
        const v = f.values.get(id)!;
        f.values.delete(id);
        return v;
    };
    const getPath = (v: Data, path: Step[]): Data => {
        if (!path.length) return v;
        const at = Array.isArray(v) ? position(v, path[0]!) : -1;
        if (!Array.isArray(v) || at < 0 || at >= v.length)
            return error('Projection into missing tuple storage');
        return getPath(v[at]!, path.slice(1));
    };
    const setPath = (v: Data, path: Step[], replacement: Data): Data => {
        if (!path.length) return replacement;
        const at = Array.isArray(v) ? position(v, path[0]!) : -1;
        if (!Array.isArray(v) || at < 0 || at >= v.length)
            return error('Update of missing tuple storage');
        return mapItems(v, (item, i) =>
            i === at ? setPath(item, path.slice(1), replacement) : item,
        );
    };
    const view = (
        peek: () => Data,
        replace: (v: Data) => Data,
        finish: () => Run<void> = nothing,
    ): Lens => {
        const result: Lens = {
            kind: 'lens',
            peek,
            replace,
            finish,
            project(path) {
                if (!path.length) return result;
                return view(
                    () => getPath(peek(), path),
                    (value) => {
                        const previous = peek(),
                            old = getPath(previous, path);
                        replace(setPath(previous, path, value));
                        return old;
                    },
                    finish,
                );
            },
        };
        return result;
    };
    const cell = (initial: Data): Lens => {
        let value = initial;
        return view(
            () => value,
            (next) => {
                const old = value;
                value = next;
                return old;
            },
        );
    };
    const scoped = (inner: Lens, close: () => Run<void>): Lens => {
        let finished = false;
        return view(
            () => inner.peek(),
            (v) => inner.replace(v),
            function* () {
                if (finished) return error('Restoration executed twice');
                finished = true;
                yield* enter(inner.finish());
                yield* enter(close());
            },
        );
    };
    const reference = (f: Frame, r: SlotRef): Lens => {
        const base = f.places.get(r.place) ?? error(`Unknown or retired place ${r.place}`);
        // References into a borrowed parameter do not own the caller's cleanup continuation.
        return view(
            () => base.peek(),
            (v) => base.replace(v),
        ).project(r.path);
    };
    const move = (v: Lens): Data => {
        const old = owned(v.peek());
        v.replace(EMPTY);
        return old;
    };
    const tupleLens = (items: Lens[]): Lens =>
        view(
            () => (items.length ? items.map((v) => v.peek()) : null),
            (value) => {
                if (!items.length) {
                    if (value !== EMPTY && value !== null) error('Invalid unit lens replacement');
                    return null;
                }
                if (value !== EMPTY && (!Array.isArray(value) || value.length !== items.length))
                    error('Tuple lens arity mismatch');
                return items.map((v, i) =>
                    v.replace(value === EMPTY ? EMPTY : (value as Data[])[i]),
                );
            },
            function* () {
                for (const item of items) yield* enter(item.finish());
            },
        );
    const construct = (name: string, args: Data[]): Data =>
        name === 'nil'
            ? []
            : name === 'cons' && Array.isArray(args[1])
              ? [args[0], ...args[1]]
              : { kind: 'variant', name, items: args };
    const constructorParts = (name: string, v: Data): Data[] => {
        if (name === 'nil' && Array.isArray(v) && !v.length) return [];
        if (name === 'cons' && Array.isArray(v) && v.length) return [v[0], v.slice(1)];
        if (
            v &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            v.kind === 'variant' &&
            v.name === name
        )
            return v.items;
        return error('Constructor lens tag mismatch');
    };
    /** A tag plus one lens per field. It has no storage of its own: reading builds the value
     * from the fields, and replacing routes each field of a value with the same tag back. */
    const constructorLens = (name: string, items: Lens[]): Lens =>
        view(
            () =>
                construct(
                    name,
                    items.map((v) => v.peek()),
                ),
            (value) => {
                if (value === EMPTY)
                    return construct(
                        name,
                        items.map((v) => v.replace(EMPTY)),
                    );
                const parts = constructorParts(name, value);
                if (parts.length !== items.length) error('Constructor lens arity mismatch');
                return construct(
                    name,
                    items.map((v, i) => v.replace(parts[i])),
                );
            },
            function* () {
                for (const item of items) yield* enter(item.finish());
            },
        );
    const dispose = (v: Data): void => {
        if (Array.isArray(v)) v.forEach(dispose);
        else if (v && typeof v === 'object') {
            if (v.kind === 'variant' || v.kind === 'vector') v.items.forEach(dispose);
            else if (v.kind === 'function' && !v.reusable) {
                if (v.used) return error('Closure disposed or invoked twice');
                if (v.lenses.size) return error('Dropped a closure that holds an owned lens');
                v.used = true;
                v.captures.forEach(dispose);
                v.captures.clear();
                options.onDisposeClosure?.();
            }
        }
    };
    const patternParts = (p: IRPattern, v: Data): Data[] => {
        if (p.kind === 'tuple')
            return p.items.length === 0 && v === null
                ? []
                : Array.isArray(v)
                  ? v
                  : error('Tuple pattern shape mismatch');
        if (p.kind === 'record') {
            if (!Array.isArray(v)) return error('Record pattern shape mismatch');
            const at = (name: string) => {
                const i = position(v, name);
                return i < 0 ? error('Record pattern names a missing field') : i;
            };
            const taken = new Set(p.fields.map((f) => at(f.name)));
            const names = fieldNames.get(v)!;
            const others = names.map((_, i) => i).filter((i) => !taken.has(i));
            // Without `rest`, the other fields are dropped one at a time.
            const unnamed = p.rest
                ? [
                      named(
                          others.map((i) => v[i]!),
                          others.map((i) => names[i]!),
                      ),
                  ]
                : others.map((i) => v[i]!);
            return [...p.fields.map((f) => v[at(f.name)]!), ...unnamed];
        }
        if (p.kind === 'constructor') {
            if (p.name === 'nil') return [];
            if (p.name === 'cons' && Array.isArray(v) && v.length) return [v[0], v.slice(1)];
            if (
                v &&
                typeof v === 'object' &&
                !Array.isArray(v) &&
                v.kind === 'variant' &&
                v.name === p.name
            )
                return v.items;
        }
        return error('Constructor pattern shape mismatch');
    };
    const matches = (p: IRPattern, v: Data): boolean => {
        switch (p.kind) {
            case 'bind':
            case 'drop':
                return true;
            case 'literal':
                return (typeof p.value === 'object' ? decodeNumber(p.value) : p.value) === v;
            case 'tuple':
                return (
                    (p.items.length === 0 && v === null) ||
                    (Array.isArray(v) &&
                        v.length === p.items.length &&
                        p.items.every((q, i) => matches(q, v[i])))
                );
            case 'record':
                return (
                    Array.isArray(v) &&
                    p.fields.every((f) => matches(f.pattern, v[position(v, f.name)]!))
                );
            case 'constructor': {
                if (p.name === 'nil') return Array.isArray(v) && !v.length;
                if (p.name === 'cons')
                    return (
                        Array.isArray(v) &&
                        !!v.length &&
                        matches(p.items[0], v[0]) &&
                        matches(p.items[1], v.slice(1))
                    );
                return (
                    !!v &&
                    typeof v === 'object' &&
                    !Array.isArray(v) &&
                    v.kind === 'variant' &&
                    v.name === p.name &&
                    v.items.length === p.items.length &&
                    p.items.every((q, i) => matches(q, v.items[i]))
                );
            }
        }
    };
    const bind = (f: Frame, p: IRPattern, v: Data): void => {
        switch (p.kind) {
            case 'bind':
                f.places.set(p.slot.place, cell(v));
                return;
            case 'drop':
            case 'literal':
                dispose(v);
                return;
            case 'tuple':
            case 'constructor': {
                if (!p.items.length) {
                    dispose(v);
                    return;
                }
                const parts = patternParts(p, v);
                p.items.forEach((q, i) => bind(f, q, parts[i]));
                return;
            }
            case 'record': {
                const parts = patternParts(p, v),
                    items = subpatterns(p);
                items.forEach((q, i) => bind(f, q, parts[i]!));
                parts.slice(items.length).forEach(dispose);
                return;
            }
        }
    };
    /** Only ending a lens runs program code; everything else a cleanup does is immediate. */
    const ends = (action: Cleanup) => action.kind === 'release' || action.kind === 'end';
    /** Run `actions`, through the scheduler when one of them ends a lens. */
    const cleanup = (f: Frame, actions: Cleanup[]): Run<void> | undefined => {
        if (actions.some(ends)) return cleanupLenses(f, actions);
        actions.forEach((action) => discard(f, action));
        return undefined;
    };
    const discard = (f: Frame, action: Cleanup): void => {
        if (action.kind !== 'restored' && action.kind !== 'drop-place')
            return error('A lens can only end on the scheduler');
        const v = reference(f, action.slot);
        if (action.kind === 'restored') owned(v.peek());
        else dispose(v.replace(EMPTY));
    };
    const cleanupLenses = function* (f: Frame, actions: Cleanup[]): Run<void> {
        for (const action of actions) {
            if (action.kind === 'release') {
                const borrowed = f.loans.get(action.loan) ?? error('Missing lexical loan');
                owned(borrowed.peek());
                yield* enter(borrowed.finish());
                f.loans.delete(action.loan);
            } else if (action.kind === 'end') {
                const owner = f.held.get(action.slot.place) ?? error('No owned lens to end');
                owned(owner.peek());
                f.held.delete(action.slot.place);
                yield* enter(owner.finish());
            } else discard(f, action);
        }
    };
    const materialize = (v: Data, t: SemanticType): Data => {
        if (v === EMPTY)
            return t.tag === 'tuple' && t.items.length === 0
                ? null
                : error('Non-unit empty input to a call');
        if (t.tag === 'tuple' && t.items.length && Array.isArray(v))
            return mapItems(v, (x, i) => materialize(x, t.items[i]!));
        // Records are stored as the tuple of their name-sorted fields.
        // An open record's type does not list every field the value holds.
        if (t.tag === 'record' && Array.isArray(v))
            return mapItems(v, (x, i) => {
                const field = t.fields.find((f) => f.name === fieldNames.get(v)?.[i]);
                return field ? materialize(x, field.type) : x;
            });
        return v;
    };
    const copy = (v: Data): Data => {
        if (Array.isArray(v)) return mapItems(v, copy);
        if (v && typeof v === 'object') {
            if (v.kind === 'variant' || v.kind === 'vector')
                return { ...v, items: v.items.map(copy) };
            // An import holds nothing.
            if (v.kind === 'native') return v;
            // A closure is consumed by its call, so each copy owns its own captures. A reusable
            // definition has none to consume.
            if (v.kind === 'function' && !v.lenses.size)
                return v.reusable
                    ? v
                    : {
                          ...v,
                          captures: new Map([...v.captures].map(([k, c]) => [k, copy(c)])),
                          used: false,
                      };
            throw new BackendDiagnostic(
                'unsupported-reference-dup',
                'Duplication of this value is not supported',
            );
        }
        return v;
    };
    /** Structural equality; numbers compare as IEEE doubles, so NaN is unequal to itself. */
    const equal = (a: Data, b: Data): boolean => {
        if (Array.isArray(a))
            return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]!));
        if (a && typeof a === 'object') {
            if (!b || typeof b !== 'object' || Array.isArray(b) || a.kind !== b.kind) return false;
            if (a.kind === 'variant' && b.kind === 'variant')
                return (
                    a.name === b.name &&
                    a.items.length === b.items.length &&
                    a.items.every((x, i) => equal(x, b.items[i]!))
                );
            if (a.kind === 'vector' && b.kind === 'vector')
                return (
                    a.items.length === b.items.length &&
                    a.items.every((x, i) => equal(x, b.items[i]!))
                );
            throw new BackendDiagnostic(
                'unsupported-reference-equality',
                'Callable values cannot be compared',
            );
        }
        return a === b;
    };
    /** Channels by handle, numbered from 1 as the Go runtime numbers them. */
    const channels = new Map<number, Channel>();
    const channelAt = (handle: Data): Channel =>
        channels.get(handle as number) ?? error('not a channel handle');
    const vector = (v: Data): VectorValue =>
        v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'vector'
            ? v
            : error('Expected a vector');
    /** The natives that may have to wait for another task. */
    const waits = new Set(['chanSend', 'chanRecv', 'sleep']);
    const wait = function* (name: string, args: Argument[]): Run<Argument> {
        const number = (n: number) => data(args[n]) as number;
        switch (name) {
            case 'chanSend':
                yield { op: 'send', channel: channelAt(number(0)), value: owned(data(args[1]!)) };
                return null;
            case 'chanRecv':
                return (yield { op: 'receive', channel: channelAt(number(0)) }) as Data;
            default:
                yield { op: 'sleep', milliseconds: number(0) };
                return null;
        }
    };
    /**
     * Call a function value. A closure, or a native that waits, gives code to run on the
     * scheduler; any other native has run by the time this returns.
     */
    const invoke = (
        callee: Data,
        args: Argument[],
        needs: ReadonlyMap<string, Data>,
    ): { run: Run<Argument> } | { value: Argument } => {
        if (
            !callee ||
            typeof callee !== 'object' ||
            Array.isArray(callee) ||
            (callee.kind !== 'function' && callee.kind !== 'native')
        )
            return error('Calling a non-function');
        if (callee.kind === 'function')
            return { run: call(callee, args, callee.supplied ?? needs) };
        if (waits.has(callee.name)) return { run: wait(callee.name, args) };
        return { value: native(callee.name, args) };
    };
    const native = (name: string, args: Argument[]): Argument => {
        const number = (n: number): number => {
            const v = data(args[n]);
            return typeof v === 'number' ? v : error('Numeric import received a non-number');
        };
        switch (name) {
            case '+':
                return number(0) + number(1);
            case '-':
                return number(0) - number(1);
            case '*':
                return number(0) * number(1);
            case '/':
                return number(0) / number(1);
            case '%':
                return number(0) % number(1);
            case '==':
                return equal(data(args[0]), data(args[1]));
            case '!=':
                return !equal(data(args[0]), data(args[1]));
            case '<':
                return number(0) < number(1);
            case '>':
                return number(0) > number(1);
            case '>=':
                return number(0) >= number(1);
            case '<=':
                return number(0) <= number(1);
            case 'not':
                return !data(args[0]);
            case 'round':
                return Math.round(number(0));
            case 'dup':
                return copy(owned(lens(args[0]).peek()));
            case 'chanNew': {
                const handle = channels.size + 1;
                channels.set(handle, channel());
                return handle;
            }
            case 'getInput': {
                const prompt = data(args[0]) as string;
                if (!options.stdin) return createPrompt()(prompt) ?? '';
                (options.stdout ?? ((text) => process.stdout.write(text)))(prompt);
                return options.stdin();
            }
            case 'write': {
                (options.stdout ?? ((text) => process.stdout.write(text)))(data(args[0]) as string);
                return null;
            }
            case 'writeFile': {
                const bytes = vector(owned(data(args[1]))).items.map((item) => {
                    const b = item;
                    return typeof b === 'number' && Number.isInteger(b) && b >= 0 && b < 256
                        ? b
                        : error('writeFile bytes must be integers in [0, 255]');
                });
                writeFileSync(data(args[0]) as string, Uint8Array.from(bytes));
                return null;
            }
            case 'waitKey':
                return (options.key ?? readKey)(number(0));
            case 'random': {
                const bound = number(0);
                if (!Number.isInteger(bound) || bound < 1 || bound >= 2 ** 32)
                    return error('random bound must be an integer in [1, 2^32)');
                if (rng === 0) {
                    const seed = options.seed ?? process.env.LAMINAR_SEED;
                    rng = (seed === undefined ? Date.now() : Number(seed)) >>> 0 || 2463534242;
                }
                rng = (rng ^ (rng << 13)) >>> 0;
                rng = (rng ^ (rng >>> 17)) >>> 0;
                rng = (rng ^ (rng << 5)) >>> 0;
                return rng % bound;
            }
            case 'print': {
                (options.stdout ?? ((text) => process.stdout.write(text)))(
                    `${data(args[0]) as string}\n`,
                );
                return null;
            }
            case 'fst': {
                const parent = lens(args[0]);
                // The call boundary owns argument completion. A native
                // projection must not also retain that same continuation.
                return view(
                    () => parent.peek(),
                    (value) => parent.replace(value),
                ).project([0]);
            }
            case 'array': {
                const length = number(0),
                    init = owned(data(args[1]));
                if (!Number.isInteger(length) || length < 0)
                    return error('array length must be a non-negative integer');
                const items = Array.from({ length }, () => copy(init));
                dispose(init);
                return { kind: 'vector', items };
            }
            case 'size':
                return vector(lens(args[0]).peek()).items.length;
            case '[::]':
                return { kind: 'vector', items: [] };
            case '[:push:]': {
                const v = vector(owned(data(args[0])));
                return { kind: 'vector', items: [...v.items, owned(data(args[1]))] };
            }
            case '[]': {
                const at = number(0),
                    parent = lens(args[1]);
                const items = () => vector(parent.peek()).items;
                if (!Number.isInteger(at) || at < 0 || at >= items().length)
                    return error('Vector index out of bounds');
                // As with fst, argument completion belongs to the call boundary.
                return view(
                    () => items()[at]!,
                    (value) => {
                        const old = items()[at]!;
                        parent.replace({
                            kind: 'vector',
                            items: items().map((v, i) => (i === at ? value : v)),
                        });
                        return old;
                    },
                );
            }
            case 'charList': {
                const s = data(args[0]);
                return typeof s === 'string' ? [...s] : error('charList requires a string');
            }
            // Reference frames are ordinary JS storage; no heap allocation primitive is supported here.
            case 'heapsize':
                return 0;
            default:
                throw new BackendDiagnostic(
                    'unsupported-reference-import',
                    `No typed IR implementation for ${name}`,
                );
        }
    };
    const call = function* (
        callee: FunctionValue,
        args: Argument[],
        needs: ReadonlyMap<string, Data>,
    ): Run<Argument> {
        if (!callee.reusable && callee.used) return error('Closure invoked twice');
        if (!callee.reusable) callee.used = true;
        const f = frame();
        f.needs = needs;
        const hold = (place: string, owner: Lens) => {
            f.places.set(place, owner);
            f.held.set(place, owner);
        };
        callee.captures.forEach((value, place) => f.places.set(place, cell(value)));
        callee.lenses.forEach((owner, place) => hold(place, owner));
        if (!callee.reusable) {
            callee.captures.clear();
            callee.lenses.clear();
        }
        callee.fn.parameters.forEach((p, i) => {
            const type = callee.fn.type.args[i]!;
            if (p.lensPlace && type.tag === 'flow' && type.owned) hold(p.lensPlace, lens(args[i]));
            else if (p.lensPlace) f.places.set(p.lensPlace, lens(args[i]));
            else bind(f, p.pattern, owned(data(args[i])));
        });
        const result = yield* enter(executeBlock(callee.unit, callee.fn.body, f));
        const settled = () => {
            if (f.held.size) error('A function kept an owned lens without ending it');
        };
        // A returned lens may still rest on one, until its own restoration ends it.
        if (isLens(result))
            return scoped(result, function* () {
                settled();
            });
        settled();
        return result;
    };
    const executeBlock = function* (u: IRUnit, b: IRBlock, f: Frame): Run<Argument> {
        const oldPlaces = new Set(f.places.keys());
        for (const i of b.instructions) {
            if (++steps > (options.maxSteps ?? 1_000_000))
                throw new BackendDiagnostic(
                    'reference-step-limit',
                    'Reference execution step limit exceeded',
                    i.origin,
                );
            options.onStep?.(i.origin, i.op);
            if (i.op === 'bind') {
                bind(f, i.pattern, owned(data(take(f, i.value))));
                continue;
            }
            if (i.op === 'borrow') {
                const borrowed = lens(take(f, i.lens));
                f.loans.set(i.loan, borrowed);
                const loan = u.loans.find((l) => l.id === i.loan)!;
                if (loan.owners) f.places.set(loan.place, borrowed);
                continue;
            }
            let result: Argument;
            switch (i.op) {
                case 'constant':
                    result =
                        i.value && typeof i.value === 'object' ? decodeNumber(i.value) : i.value;
                    break;
                case 'string':
                    result =
                        i.head +
                        i.parts.map((p) => displayValue(data(take(f, p.value))) + p.tail).join('');
                    break;
                case 'tuple': {
                    const items = i.items.map((id) => owned(data(take(f, id))));
                    result =
                        i.out.type.tag === 'plain' && i.out.type.value.tag === 'record'
                            ? named(
                                  items,
                                  i.out.type.value.fields.map((field) => field.name),
                              )
                            : items;
                    break;
                }
                case 'record': {
                    const fields = new Map<string, Data>();
                    for (const part of i.parts) {
                        if (part.kind === 'field') {
                            const value = part.value ? owned(data(take(f, part.value))) : undefined;
                            if (part.op !== 'extend' && fields.has(part.name))
                                dispose(fields.get(part.name)!);
                            if (part.op === 'remove') fields.delete(part.name);
                            else fields.set(part.name, value!);
                            continue;
                        }
                        let source: Data;
                        if ('slot' in part.source) {
                            // Emptied fields are removed or replaced by a later part.
                            source = reference(f, part.source.slot).replace(EMPTY);
                        } else source = owned(data(take(f, part.source.value)));
                        if (!Array.isArray(source)) return error('Spread of a non-record');
                        const names = source.length ? fieldNames.get(source) : [];
                        if (!names) return error('Spread of a non-record', i.origin);
                        names.forEach((name, n) => fields.set(name, (source as Data[])[n]!));
                    }
                    const names = [...fields.keys()].sort();
                    result = named(
                        names.map((name) => fields.get(name)!),
                        names,
                    );
                    break;
                }
                case 'construct':
                    result = construct(
                        i.name,
                        i.items.map((id) => owned(data(take(f, id)))),
                    );
                    break;
                case 'global':
                    if (
                        i.instance.definition.startsWith('native/') &&
                        (i.out.type.tag !== 'plain' || i.out.type.value.tag !== 'fn')
                    )
                        throw new BackendDiagnostic(
                            'unsupported-reference-import',
                            'Native constants require an explicit runtime value provider',
                            i.origin,
                        );
                    result = i.instance.definition.startsWith('native/')
                        ? {
                              kind: 'native',
                              name: requireImport(i.instance.definition, 'reference').name,
                          }
                        : (definitions.get(i.instance.definition) ??
                          error('Unavailable definition', i.origin));
                    break;
                case 'move':
                    result = move(reference(f, i.slot));
                    break;
                case 'acquire':
                    result = reference(f, i.slot);
                    break;
                case 'lens-tuple':
                    result = tupleLens(i.items.map((id) => lens(take(f, id))));
                    break;
                case 'lens-construct':
                    result = constructorLens(
                        i.name,
                        i.items.map((id) => lens(take(f, id))),
                    );
                    break;
                case 'give': {
                    // The lens leaves with its pending restoration; nothing runs here.
                    const [holders, key] =
                        'loan' in i.from ? [f.loans, i.from.loan] : [f.held, i.from.place];
                    result = holders.get(key) ?? error('No owned lens to move', i.origin);
                    holders.delete(key);
                    break;
                }
                case 'swap': {
                    const target = lens(take(f, i.lens)),
                        replacement = owned(data(take(f, i.value)));
                    result = logical(target.replace(replacement));
                    yield* enter(target.finish());
                    break;
                }
                case 'closure': {
                    const fn =
                        u.functions.find((v) => v.id === i.function) ??
                        error('Missing closure code');
                    const captures = new Map<string, Data>(),
                        lenses = new Map<string, Lens>();
                    for (const c of i.captures) {
                        const value = take(f, c.value);
                        if (isLens(value)) lenses.set(c.place, value);
                        else captures.set(c.place, owned(value));
                    }
                    result = {
                        kind: 'function',
                        unit: u,
                        fn,
                        captures,
                        lenses,
                        reusable: false,
                        used: false,
                    };
                    break;
                }
                case 'call': {
                    const fn = data(take(f, i.callee)),
                        args = i.args.map((id) => take(f, id));
                    // Reify an empty unit focus as a unit value at the call boundary.
                    // The callee's input contract describes initialized values, not caller availability.
                    const sourceCallType = valueTypes.get(u)!.get(i.callee)!;
                    if (sourceCallType.tag !== 'plain' || sourceCallType.value.tag !== 'fn')
                        return error('Missing concrete call contract');
                    const signature = sourceCallType.value;
                    args.forEach((arg, n) => {
                        if (isLens(arg)) {
                            const t = signature.args[n];
                            if (t.tag !== 'flow') error('Call mode mismatch');
                            arg.replace(
                                materialize(arg.peek(), (t as typeof t & { tag: 'flow' }).read),
                            );
                        }
                    });
                    if (i.detached) {
                        // A task that never returns leaves its type open, as a loop does.
                        const returns = signature.result;
                        if (
                            returns.tag !== 'plain' ||
                            (returns.value.tag !== 'variable' &&
                                !(returns.value.tag === 'tuple' && !returns.value.items.length))
                        )
                            return error('A spawned task must return ()', i.origin);
                        const origin = i.origin;
                        // The task is read here, on the spawning task; its call runs on its own.
                        // The task gets its own copy of what it can read.
                        const supplied = new Map<string, Data>(
                            [...f.needs].map(([name, v]) => [name, copy(v)]),
                        );
                        yield {
                            op: 'spawn',
                            task: (function* (): Run<void> {
                                const called = invoke(fn, args, supplied);
                                const returned =
                                    'run' in called ? yield* enter(called.run) : called.value;
                                // Generic code only shows what it returns here.
                                if (returned !== null)
                                    error('A spawned task must return ()', origin);
                            })(),
                        };
                        result = null;
                        break;
                    }
                    const called = invoke(fn, args, f.needs);
                    result = 'run' in called ? yield* enter(called.run) : called.value;
                    // An owned argument is the callee's to end.
                    const borrowed = args.filter((arg, n): arg is Lens => {
                        const t = signature.args[n]!;
                        return isLens(arg) && !(t.tag === 'flow' && t.owned);
                    });
                    if (!borrowed.length) break;
                    const finish = function* (): Run<void> {
                        // Lenses end like nested scopes, the last argument first.
                        for (const arg of [...borrowed].reverse()) {
                            owned(arg.peek());
                            if (arg.finish !== nothing) yield* enter(arg.finish());
                        }
                    };
                    if (isLens(result)) result = scoped(result, finish);
                    else yield* enter(finish());
                    break;
                }
                case 'aslens': {
                    const backing = cell(owned(data(take(f, i.initial))));
                    f.places.set(i.backing, backing);
                    result = scoped(backing, function* () {
                        dispose(owned(data(yield* enter(executeBlock(u, i.cleanup, f)))));
                        f.places.delete(i.backing);
                    });
                    break;
                }
                case 'scope':
                    result = yield* enter(executeBlock(u, i.body, f));
                    break;
                case 'need': {
                    const held = f.needs.get(i.name);
                    if (held === undefined) return error(`No dependency ${i.name}`, i.origin);
                    result = copy(held);
                    break;
                }
                case 'supply': {
                    const value = owned(data(take(f, i.value)));
                    result =
                        value &&
                        typeof value === 'object' &&
                        !Array.isArray(value) &&
                        value.kind === 'function'
                            ? { ...value, supplied: new Map(f.needs) }
                            : value;
                    break;
                }
                case 'widen':
                    result = take(f, i.value);
                    break;
                case 'inject': {
                    const value = owned(data(take(f, i.value)));
                    const surrounding = f.needs;
                    f.needs = new Map(surrounding).set(i.name, value);
                    result = yield* enter(executeBlock(u, i.body, f));
                    f.needs = surrounding;
                    dispose(value);
                    break;
                }
                case 'case': {
                    const value = owned(data(take(f, i.value))),
                        arm = i.cases.find((c) => matches(c.pattern, value));
                    if (!arm)
                        throw new BackendDiagnostic(
                            'unmatched-case',
                            'No case arm matched',
                            i.origin,
                        );
                    const before = new Set(f.places.keys());
                    bind(f, arm.pattern, value);
                    result = yield* enter(executeBlock(u, arm.body, f));
                    const setup = cleanup(f, arm.setup ?? []);
                    if (setup) yield* enter(setup);
                    const close = function* (): Run<void> {
                        const restored = cleanup(f, arm.restored ?? []);
                        if (restored) yield* enter(restored);
                        for (const key of f.places.keys())
                            if (!before.has(key)) f.places.delete(key);
                    };
                    if (isLens(result)) result = scoped(result, close);
                    else yield* enter(close());
                    break;
                }
            }
            f.values.set(i.out.id, result);
        }
        const result = take(f, b.result);
        const retire = () => {
            for (const key of f.places.keys()) if (!oldPlaces.has(key)) f.places.delete(key);
        };
        if (isLens(result))
            return scoped(result, function* () {
                const pending = cleanup(f, b.cleanup);
                if (pending) yield* enter(pending);
                retire();
            });
        const pending = cleanup(f, b.cleanup);
        if (pending) yield* enter(pending);
        retire();
        return result;
    };
    /** The program's units run in order on the main task. */
    const main = function* (): Run<Argument> {
        let result: Argument = null;
        for (const u of program.units) {
            // Earlier expression roots are affine results discarded by this last-result test runner.
            // Reusable definitions own no captures and are not disposed here.
            dispose(data(result));
            result = yield* enter(executeBlock(u, u.entry, frame()));
            if (u.definition) {
                const value = data(result);
                if (
                    !value ||
                    typeof value !== 'object' ||
                    Array.isArray(value) ||
                    value.kind !== 'function' ||
                    value.captures.size
                )
                    return error('A reusable definition must be a closed function');
                value.reusable = true;
                definitions.set(u.definition, value);
            }
        }
        return result;
    };
    const result = schedule(main(), () => {
        throw new BackendDiagnostic(
            'reference-deadlock',
            'Every task is blocked, so none can ever continue',
        );
    });
    return report(owned(data(result)));
}

/** Result values: vectors are reported as arrays, as the result protocol prints them. */
function report(v: Data): ReferenceValue {
    if (Array.isArray(v)) return v.map(report);
    if (v && typeof v === 'object') {
        if (v.kind === 'vector') return v.items.map(report);
        if (v.kind === 'variant') return { ...v, items: v.items.map(report) as Data[] };
    }
    return v as ReferenceValue;
}
