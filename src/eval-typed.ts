import type { SemanticType } from './elaborated.ts';
import { freezeTree } from './elaborated.ts';
import { decodeNumber } from './typed-ir.ts';
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
import createPrompt from 'prompt-sync';
import { requireImport } from './runtime-imports.ts';

const EMPTY = Symbol('empty-place');
type Variant = { kind: 'variant'; name: string; items: Data[] };
type FunctionValue = {
    kind: 'function';
    unit: IRUnit;
    fn: IRFunction;
    captures: Map<string, Data>;
    reusable: boolean;
    used: boolean;
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
    finish(): void;
    project(path: number[]): Lens;
};
type Argument = Data | Lens;
type Frame = { places: Map<string, Lens>; values: Map<string, Argument>; loans: Map<string, Lens> };
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
};

/** Executes only typed IR. It does not call source inference, AST lowering, or the old evaluator. */
export function executeTypedProgram(
    program: TypedProgram,
    options: ReferenceOptions = {},
): ReferenceValue {
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
                if (i.op === 'scope') index(i.body);
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
              ? v.map(logical)
              : v && typeof v === 'object' && v.kind === 'variant'
                ? { ...v, items: v.items.map(logical) }
                : v;
    const take = (f: Frame, id: string): Argument => {
        if (!f.values.has(id)) return error(`Temporary ${id} is unavailable`);
        const v = f.values.get(id)!;
        f.values.delete(id);
        return v;
    };
    const getPath = (v: Data, path: number[]): Data => {
        if (!path.length) return v;
        if (!Array.isArray(v) || path[0] >= v.length)
            return error('Projection into missing tuple storage');
        return getPath(v[path[0]], path.slice(1));
    };
    const setPath = (v: Data, path: number[], replacement: Data): Data => {
        if (!path.length) return replacement;
        if (!Array.isArray(v) || path[0] >= v.length)
            return error('Update of missing tuple storage');
        return v.map((item, i) =>
            i === path[0] ? setPath(item, path.slice(1), replacement) : item,
        );
    };
    const view = (
        peek: () => Data,
        replace: (v: Data) => Data,
        finish: () => void = () => {},
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
    const scoped = (inner: Lens, close: () => void): Lens => {
        let finished = false;
        return view(
            () => inner.peek(),
            (v) => inner.replace(v),
            () => {
                if (finished) return error('Restoration executed twice');
                finished = true;
                inner.finish();
                close();
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
            () => items.forEach((v) => v.finish()),
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
        if (v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'variant' && v.name === name)
            return v.items;
        return error('Constructor lens tag mismatch');
    };
    /** A tag plus one lens per field. It has no storage of its own: reading builds the value
     * from the fields, and replacing routes each field of a value with the same tag back. */
    const constructorLens = (name: string, items: Lens[]): Lens =>
        view(
            () => construct(name, items.map((v) => v.peek())),
            (value) => {
                if (value === EMPTY) return construct(name, items.map((v) => v.replace(EMPTY)));
                const parts = constructorParts(name, value);
                if (parts.length !== items.length) error('Constructor lens arity mismatch');
                return construct(name, items.map((v, i) => v.replace(parts[i])));
            },
            () => items.forEach((v) => v.finish()),
        );
    const dispose = (v: Data): void => {
        if (Array.isArray(v)) v.forEach(dispose);
        else if (v && typeof v === 'object') {
            if (v.kind === 'variant' || v.kind === 'vector') v.items.forEach(dispose);
            else if (v.kind === 'function' && !v.reusable) {
                if (v.used) return error('Closure disposed or invoked twice');
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
        }
    };
    const cleanup = (f: Frame, actions: Cleanup[]): void => {
        for (const action of actions) {
            if (action.kind === 'release') {
                const borrowed = f.loans.get(action.loan) ?? error('Missing lexical loan');
                owned(borrowed.peek());
                borrowed.finish();
                f.loans.delete(action.loan);
            } else {
                const v = reference(f, action.slot);
                if (action.kind === 'restored') owned(v.peek());
                else dispose(v.replace(EMPTY));
            }
        }
    };
    const materialize = (v: Data, t: SemanticType): Data => {
        if (v === EMPTY)
            return t.tag === 'tuple' && t.items.length === 0
                ? null
                : error('Non-unit empty input to a call');
        if (t.tag === 'tuple' && t.items.length && Array.isArray(v))
            return v.map((x, i) => materialize(x, t.items[i]));
        // Records are stored as the tuple of their name-sorted fields.
        if (t.tag === 'record' && Array.isArray(v))
            return v.map((x, i) => materialize(x, t.fields[i].type));
        return v;
    };
    const copy = (v: Data): Data => {
        if (Array.isArray(v)) return v.map(copy);
        if (v && typeof v === 'object') {
            if (v.kind === 'variant' || v.kind === 'vector')
                return { ...v, items: v.items.map(copy) };
            throw new BackendDiagnostic(
                'unsupported-reference-dup',
                'Duplication of callable values requires a separate language feature',
            );
        }
        return v;
    };
    const vector = (v: Data): VectorValue =>
        v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'vector'
            ? v
            : error('Expected a vector');
    const invoke = (callee: Data, args: Argument[]): Argument => {
        if (
            !callee ||
            typeof callee !== 'object' ||
            Array.isArray(callee) ||
            (callee.kind !== 'function' && callee.kind !== 'native')
        )
            return error('Calling a non-function');
        if (callee.kind === 'native') {
            const number = (n: number): number => {
                const v = data(args[n]);
                return typeof v === 'number' ? v : error('Numeric import received a non-number');
            };
            switch (callee.name) {
                case '+':
                    return number(0) + number(1);
                case '-':
                    return number(0) - number(1);
                case '*':
                    return number(0) * number(1);
                case '/':
                    return number(0) / number(1);
                case '==':
                    return number(0) === number(1);
                case '>=':
                    return number(0) >= number(1);
                case '<=':
                    return number(0) <= number(1);
                case 'round':
                    return Math.round(number(0));
                case 'dup':
                    return copy(owned(lens(args[0]).peek()));
                case 'getInput': {
                    const prompt = data(args[0]) as string;
                    if (!options.stdin) return createPrompt()(prompt) ?? '';
                    (options.stdout ?? ((text) => process.stdout.write(text)))(prompt);
                    return options.stdin();
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
                        `No typed IR implementation for ${callee.name}`,
                    );
            }
        }
        if (!callee.reusable && callee.used) return error('Closure invoked twice');
        if (!callee.reusable) callee.used = true;
        const frame: Frame = { places: new Map(), values: new Map(), loans: new Map() };
        callee.captures.forEach((value, place) => frame.places.set(place, cell(value)));
        if (!callee.reusable) callee.captures.clear();
        callee.fn.parameters.forEach((p, i) => {
            if (p.lensPlace) frame.places.set(p.lensPlace, lens(args[i]));
            else bind(frame, p.pattern, owned(data(args[i])));
        });
        return executeBlock(callee.unit, callee.fn.body, frame);
    };
    const executeBlock = (u: IRUnit, b: IRBlock, f: Frame): Argument => {
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
                        i.parts.map((p) => String(data(take(f, p.value))) + p.tail).join('');
                    break;
                case 'tuple':
                    result = i.items.map((id) => owned(data(take(f, id))));
                    break;
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
                case 'swap': {
                    const target = lens(take(f, i.lens)),
                        replacement = owned(data(take(f, i.value)));
                    result = logical(target.replace(replacement));
                    target.finish();
                    break;
                }
                case 'closure': {
                    const fn =
                        u.functions.find((v) => v.id === i.function) ??
                        error('Missing closure code');
                    result = {
                        kind: 'function',
                        unit: u,
                        fn,
                        captures: new Map(
                            i.captures.map((c) => [c.place, owned(data(take(f, c.value)))]),
                        ),
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
                    result = invoke(fn, args);
                    const finish = () =>
                        args.forEach((arg) => {
                            if (isLens(arg)) {
                                owned(arg.peek());
                                arg.finish();
                            }
                        });
                    if (isLens(result)) result = scoped(result, finish);
                    else finish();
                    break;
                }
                case 'aslens': {
                    const backing = cell(owned(data(take(f, i.initial))));
                    f.places.set(i.backing, backing);
                    result = scoped(backing, () => {
                        dispose(owned(data(executeBlock(u, i.cleanup, f))));
                        f.places.delete(i.backing);
                    });
                    break;
                }
                case 'scope':
                    result = executeBlock(u, i.body, f);
                    break;
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
                    result = executeBlock(u, arm.body, f);
                    cleanup(f, arm.setup ?? []);
                    const close = () => {
                        cleanup(f, arm.restored ?? []);
                        for (const key of f.places.keys())
                            if (!before.has(key)) f.places.delete(key);
                    };
                    if (isLens(result)) result = scoped(result, close);
                    else close();
                    break;
                }
            }
            f.values.set(i.out.id, result);
        }
        const result = take(f, b.result);
        const close = () => {
            cleanup(f, b.cleanup);
            for (const key of f.places.keys()) if (!oldPlaces.has(key)) f.places.delete(key);
        };
        if (isLens(result)) return scoped(result, close);
        close();
        return result;
    };
    let result: Argument = null;
    for (const u of program.units) {
        // Earlier expression roots are affine results discarded by this last-result test runner.
        // Reusable definitions own no captures and are not disposed here.
        dispose(data(result));
        result = executeBlock(u, u.entry, {
            places: new Map(),
            values: new Map(),
            loans: new Map(),
        });
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
