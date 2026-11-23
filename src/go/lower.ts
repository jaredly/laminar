import { Declaration, typeDependencies } from '../backend/reachable.ts';
import { unionTagNames } from '../backend/type-names.ts';
import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import { Storage, expression as code, type Expression, type Data, type View } from './storage.ts';
import { decodeNumber, type IRPattern, type SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import {
    printGoStatements,
    identifier,
    type Statement,
    type GoFile,
    type GoFunction,
} from './syntax.ts';
import { goBytes, goPart, goStringRuntime } from './strings.ts';
import { requireImport, usesHost } from '../runtime-imports.ts';
import { GoNames, functionNames } from './names.ts';
import { localNames, takesName } from '../backend/local-names.ts';
import { GoLocals } from './locals.ts';
import { derefText, memberText, same, type Expr } from '../backend/imperative/code.ts';
import { goTypes, fingerprint } from './types.ts';
import { reachableGo } from './reachable.ts';
import {
    lowerWritebacks,
    type JoinGroup,
    type PendingJoin,
    type Writeback,
    type WriteDestination,
} from './writeback.ts';

type Completion = (body: Statement[]) => void;
/**
 * `forwarded`: the lens is an existing runtime lens whose restoration is entirely its own
 * callback or direct write. `rest` is what must still run after it (argument backing, block
 * cleanup); a function may return it as is when `rest` emits nothing.
 */
type Lens = {
    view: View;
    finish: Completion;
    forwarded?: { expression: Expr; rest: Completion };
};
const noFinish = (_body: Statement[]) => {};

const unsupported = (message: string): never => {
    throw new BackendDiagnostic('unsupported-go', message);
};

/** Lower ConcreteProgram to Go syntax tree. */
export function lowerGo(program: ConcreteProgram): GoFile {
    // Keep references attached to emitted expressions as they are assembled.
    // Local-bearing templates/joins use these helpers; external formatters must
    // supply their input references with format/derive; field names are literals.
    let activeLocals: GoLocals | undefined;
    // Package text (declarations, signatures, generated names, diagnostics) is
    // never optimized; it needs no expression structure.
    const goText = (strings: TemplateStringsArray, ...parts: unknown[]): string =>
        strings.reduce((s, piece, i) => s + (i ? String(parts[i - 1]) : '') + piece, '');
    const go = (strings: TemplateStringsArray, ...parts: unknown[]): Expr =>
        activeLocals ? activeLocals.template(strings, ...parts) : goText(strings, ...parts);
    const joinCode = (parts: readonly unknown[], separator = ','): Expr =>
        activeLocals ? activeLocals.join(parts, separator) : parts.join(separator);
    const stringPart = (kind: string, value: Expr) => {
        const text = goPart(kind, String(value));
        return activeLocals ? activeLocals.format((v) => goPart(kind, v), value) : text;
    };
    const field = (name: string) =>
        activeLocals ? activeLocals.literal(identifier(name)) : identifier(name);
    /** `base.name` and `*operand`, parenthesizing only where binding requires it. */
    const dot = (base: Expr, name: string): Expr =>
        activeLocals
            ? activeLocals.access(base, '.', field(name))
            : memberText(base, '.', identifier(name));
    const star = (operand: Expr): Expr =>
        activeLocals ? activeLocals.deref(operand) : derefText(operand);
    verifyConcreteProgram(program);
    // Every import reaching Go must be registered, implemented and available on the target.
    const imports = program.semantic.program.imports
        .map((i) => i.definition)
        .filter((d) => d.startsWith('native/'));
    imports.forEach((d) => requireImport(d, 'go', program.target));
    const hostImports = new Set<string>();

    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const codes = functionNames(program);
    const { names, abis: abiNames, allocator: packageNames } = goTypes(program, codes.values());
    const tags = unionTagNames(program, names, packageNames);
    const tagValue = (id: string, n: number) => tags.get(id)![n]!;

    const type = (id: string) => names.get(id)!;
    const codeById = new Map(program.code.map((c) => [c.id, c]));
    const usesEnvironment = (id: string) => !!codeById.get(id)!.captures.length;
    const callCode = (id: string, environment: () => Expr, args: Expr[]) =>
        go`${codes.get(id)}(${joinCode([...(usesEnvironment(id) ? [environment()] : []), ...args], ', ')})`;
    const wrapperUsesEnvironment = (id: string): boolean => {
        const w = program.wrappers.find((w) => w.id === id)!;
        return w.kind === 'invoke'
            ? usesEnvironment(w.code)
            : w.kind === 'adapt-lens-result'
              ? wrapperUsesEnvironment(w.source)
              : false;
    };
    const layout = (id: string) => layouts.get(id)!;
    const unit = program.layouts.find((l) => l.kind === 'unit')!;
    /** Element layout of a vector layout. */
    const element = (id: string): string => {
        const f = layout(id).fields[0];
        return f?.kind === 'pointer' && f.layout
            ? f.layout
            : unsupported('Malformed vector layout');
    };

    const zero = (id: string): Expr => {
        const l = layout(id);
        if (l.kind === 'f64') return '0.0';
        if (l.kind === 'bool') return 'false';
        if (l.kind === 'string') return '""';
        return go`${type(id)}{}`;
    };

    const storage = new Storage((s) =>
        layout(s.layout).fields.map((f, i) => {
            if (f.kind !== 'value' || !f.name.startsWith('item')) {
                return unsupported('Non-data projection');
            }
            return {
                expression: () => dot(code(s.expression), f.name),
                key: goText`${s.key ?? s.expression}.${f.name}`,
                layout: f.layout,
                ...(s.address
                    ? {
                          address: go`&(*${s.address}).${field(f.name)}`,
                          ...(s.heap ? { heap: true } : {}),
                      }
                    : {}),
            };
        }),
    );

    const read = (data: Data, id: string): Expr => {
        if (layout(id).kind === 'unit') return zero(id);
        if (!Array.isArray(data) && data.layout === id) return code(data.expression);
        const parts = storage.parts(data);
        const fields = layout(id).fields;
        if (!fields.length || parts.length !== fields.length) {
            return unsupported('Mismatched storage read');
        }
        const items = parts.map((d, i) => read(d, (fields[i] as { layout: string }).layout));
        const value = go`${type(id)}{${joinCode(
            items.map((item, i) => go`${field(fields[i]!.name)}: ${item}`),
            ', ',
        )}}`;
        return activeLocals ? activeLocals.aggregate(value, items) : value;
    };

    const endpoint = (id: string, which: 'read' | 'replacement'): string => {
        const l = layout(id);
        const f = l.fields.find((f) => f.name === which) ?? l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout) return f.layout;
        const abi = l.fields.find((f) => f.name === 'restore');
        if (abi?.kind !== 'code') return unsupported('Missing restoration ABI');
        if (which === 'replacement')
            return program.abis.find((a) => a.id === abi.abi)!.arguments[0]!;
        const children = l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) => endpoint((f as { layout: string }).layout, which));
        return (
            program.layouts.find(
                (l) =>
                    l.kind === 'record' &&
                    l.fields.length === children.length &&
                    l.fields.every((f, i) => f.kind === 'value' && f.layout === children[i]),
            )?.id ?? unsupported('Missing lens read aggregate')
        );
    };

    const incoming = (expression: Expr, id: string): View => {
        const l = layout(id);
        const f = l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout)
            return storage.own({
                expression: star(dot(expression, 'read')),
                layout: f.layout,
                address: dot(expression, 'read'),
                heap: true,
            });
        return l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) => incoming(dot(expression, f.name), (f as { layout: string }).layout));
    };

    const flush = (expression: Expr, id: string, data: Data, body: Statement[]) => {
        const l = layout(id);
        const f =
            l.fields.find((f) => f.name === 'replacement') ??
            l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout) {
            // An address denotes a live read of that exact storage, not a
            // snapshot. Restoring it to itself cannot change the owner.
            if (
                !Array.isArray(data) &&
                data.layout === f.layout &&
                same(data.address, dot(expression, f.name))
            )
                return;
            body.push(go`${star(dot(expression, f.name))} = ${read(data, f.layout)}`);
            return;
        }
        const parts = storage.parts(data);
        l.fields
            .filter((f) => f.name.startsWith('item'))
            .forEach((f, i) =>
                flush(dot(expression, f.name), (f as { layout: string }).layout, parts[i]!, body),
            );
    };

    const declarationTypes = typeDependencies(program, names, abiNames);
    const declarations: Declaration[] = [];
    const declarePackage = (
        name: string,
        text: string,
        dependencies = declarationTypes.get(name) ?? [],
    ) => declarations.push(new Declaration(name, text, dependencies));
    const backingTypes = new Map<string, string>();
    let helperCounter = 0;

    // Layout type definitions
    for (const l of program.layouts) {
        if (l.kind === 'unit') {
            declarePackage(type(l.id), goText`type ${type(l.id)} struct{}`);
        } else if (l.kind === 'record') {
            const fields = l.fields.map((f) => {
                if (f.kind === 'value') return go`\t${field(f.name)} ${type(f.layout)}`;
                if (f.kind === 'pointer')
                    return go`\t${field(f.name)} ${f.layout ? '*' + type(f.layout) : 'any'}`;
                return go`\t${field(f.name)} ${abiNames.get(f.abi)}`;
            });
            declarePackage(
                type(l.id),
                goText`type ${type(l.id)} struct {\n${joinCode(fields, '\n')}\n}`,
            );
        } else if (l.kind === 'vector') {
            declarePackage(type(l.id), goText`type ${type(l.id)} []${type(element(l.id))}`);
        } else if (l.kind === 'union') {
            l.fields.forEach((_, n) =>
                declarePackage(
                    tagValue(l.id, n),
                    goText`const ${tagValue(l.id, n)} uint32 = ${n}`,
                    [],
                ),
            );
            // Tagged union; boxed variants share immutable payloads under Go's GC.
            const variants = l.fields.map((f, n) =>
                f.kind === 'value'
                    ? go`\tv${n} ${type(f.layout)}`
                    : f.kind === 'pointer' && f.layout
                      ? go`\tv${n} *${type(f.layout)}`
                      : unsupported('Union variant requires data storage'),
            );
            declarePackage(
                type(l.id),
                goText`type ${type(l.id)} struct {\n\ttag uint32\n${joinCode(variants, '\n')}\n}`,
            );
        }
    }

    // ABI function types
    for (const a of program.abis) {
        const args = joinCode(
            a.arguments.map((id, i) => go`arg${i} ${type(id)}`),
            ', ',
        );
        declarePackage(
            abiNames.get(a.id)!,
            goText`type ${abiNames.get(a.id)} func(environment any${String(args) ? goText`, ${args}` : ''}) ${type(a.result)}`,
        );
    }

    const helpers: GoFunction[] = [];
    // Callable records retain their exact environment-first ABI. Ordinary
    // capture-free bodies need that convention only at first-class entry points.
    const callableEntries = new Map<string, string>();
    for (const w of program.wrappers) {
        if (w.kind !== 'invoke' || usesEnvironment(w.code)) continue;
        const name = packageNames.unique(`${codes.get(w.code)}_callable`);
        callableEntries.set(w.id, name);
        const abi = program.abis.find((a) => a.id === w.abi)!;
        const args = abi.arguments.map((id, n) => go`arg${n} ${type(id)}`);
        helpers.push({
            signature: goText`func ${name}(_ any${args.length ? goText`, ${joinCode(args, ', ')}` : ''}) ${type(abi.result)}`,
            body: [
                go`return ${callCode(
                    w.code,
                    () => 'nil',
                    abi.arguments.map((_, n) => go`arg${n}`),
                )}`,
            ],
        });
    }
    const variant = (id: string, n: number) => {
        const f = layout(id).fields[n]!;
        if (f.kind === 'code' || !f.layout)
            return unsupported('Union variant requires data storage');
        return { boxed: f.kind === 'pointer', layout: f.layout };
    };
    const tagOf = (id: string, name: string): number => {
        const n = layout(id).fields.findIndex((f) => f.name === name);
        return n < 0 ? unsupported(goText`Constructor ${name} is absent from its union layout`) : n;
    };
    // A boxed payload has exactly one owner: `dup` copies it (`copyValue`) and a move
    // leaves its source dead, so the owner may write it in place.
    const payload = (expr: Expr, id: string, n: number): Expr =>
        variant(id, n).boxed ? star(dot(expr, `v${n}`)) : dot(expr, `v${n}`);
    const nativeEntries = new Set([
        ...program.callables
            .filter((c) => c.descriptor.kind === 'native')
            .flatMap((c) => c.entries.map((e) => e.wrapper)),
        ...program.wrappers.flatMap((w) => ('source' in w ? [w.source] : [])),
    ]);
    const nativeCodes = new Map<string, string>();
    /** `charList` splits a string at code point boundaries into a list, built last first. */
    const charLists = new Map<string, string>();
    const charList = (result: string): string => {
        const existing = charLists.get(result);
        if (existing) return existing;
        const name = packageNames.unique(`char_list_${type(result)}`);
        charLists.set(result, name);
        const nil = tagOf(result, 'nil'),
            cons = tagOf(result, 'cons'),
            cell = variant(result, cons);
        if (!cell.boxed) return unsupported('List cells must be boxed');
        const text = (layout(cell.layout).fields[0] as { layout: string }).layout;
        helpers.push({
            signature: goText`func ${name}(value ${type(text)}) ${type(result)}`,
            body: [
                'starts := []int{}',
                { head: 'for i := range value', body: ['starts = append(starts, i)'] },
                go`out := ${type(result)}{tag: ${tagValue(result, nil)}}`,
                'end := len(value)',
                {
                    head: 'for n := len(starts) - 1; n >= 0; n--',
                    body: [
                        go`cell := new(${type(cell.layout)})`,
                        go`*cell = ${type(cell.layout)}{item0: value[starts[n]:end], item1: out}`,
                        go`out = ${type(result)}{tag: ${tagValue(result, cons)}, v${cons}: cell}`,
                        'end = starts[n]',
                    ],
                },
                'return out',
            ],
        });
        return name;
    };

    /** Vector operations are Go functions generated once per vector layout on first use. */
    const vectorHelpers = new Map<string, string>();
    const vectorHelper = (kind: string, id: string, make: (name: string) => GoFunction): string => {
        const key = `${kind}:${id}`;
        const existing = vectorHelpers.get(key);
        if (existing) return existing;
        const name = packageNames.unique(`vector_${kind}_${type(id)}`);
        vectorHelpers.set(key, name);
        helpers.push(make(name));
        return name;
    };
    /**
     * Whether values of a layout can reach heap data that is written in place: a
     * vector buffer or a boxed union payload. Every live value owns its allocations.
     */
    const heapReach = new Map<string, boolean>();
    const reachesHeap = (id: string): boolean => {
        const known = heapReach.get(id);
        if (known !== undefined) return known;
        heapReach.set(id, false);
        const l = layout(id);
        const result =
            l.kind === 'vector' ||
            (l.kind === 'union' && l.fields.some((f) => f.kind === 'pointer')) ||
            l.fields.some((f) => f.kind !== 'code' && !!f.layout && reachesHeap(f.layout));
        heapReach.set(id, result);
        return result;
    };
    /**
     * Copy for affine `dup`. Vector buffers and boxed payloads are written in place by
     * their owner, so every allocation reached is copied.
     */
    const copyValue = (expr: Expr, id: string): Expr => {
        if (!reachesHeap(id)) return expr;
        const l = layout(id);
        if (l.kind === 'vector')
            return go`${vectorHelper('dup', id, (name) => ({
                signature: goText`func ${name}(value ${type(id)}) ${type(id)}`,
                body: [
                    go`out := make(${type(id)}, len(value))`,
                    {
                        head: 'for i := range value',
                        body: [go`out[i] = ${copyValue('value[i]', element(id))}`],
                    },
                    'return out',
                ],
            }))}(${expr})`;
        if (l.kind === 'union')
            return go`${vectorHelper('dup', id, (name) => ({
                signature: goText`func ${name}(value ${type(id)}) ${type(id)}`,
                body: [
                    ...l.fields.flatMap((_, n): Statement[] => {
                        const v = variant(id, n);
                        if (!v.boxed && !reachesHeap(v.layout)) return [];
                        return [
                            {
                                head: go`if value.tag == ${tagValue(id, n)}`,
                                body: v.boxed
                                    ? [
                                          go`box := new(${type(v.layout)})`,
                                          go`*box = ${copyValue(go`(*value.v${n})`, v.layout)}`,
                                          go`value.v${n} = box`,
                                      ]
                                    : [go`value.v${n} = ${copyValue(go`value.v${n}`, v.layout)}`],
                            },
                        ];
                    }),
                    'return value',
                ],
            }))}(${expr})`;
        if (l.kind === 'record')
            return go`${type(id)}{${joinCode(
                l.fields.map((f) =>
                    f.kind === 'value'
                        ? go`${field(f.name)}: ${copyValue(dot(expr, f.name), f.layout)}`
                        : go`${field(f.name)}: ${dot(expr, f.name)}`,
                ),
                ', ',
            )}}`;
        return expr;
    };
    const vectorArray = (id: string): string =>
        vectorHelper('array', id, (name) => ({
            signature: goText`func ${name}(length float64, init ${type(element(id))}) ${type(id)}`,
            body: [
                {
                    head: 'if !(length >= 0) || length != math.Floor(length) || length > float64(math.MaxInt32)',
                    body: ['panic("array length must be a non-negative integer")'],
                },
                go`out := make(${type(id)}, int(length))`,
                {
                    head: 'for i := range out',
                    body: [
                        {
                            head: 'if i+1 == len(out)',
                            body: ['out[i] = init'],
                        },
                        { head: 'else', body: [go`out[i] = ${copyValue('init', element(id))}`] },
                    ],
                },
                'return out',
            ],
        }));
    /** Address of element `index`, trapping unless it is an integer in range. */
    const vectorAt = (id: string): string =>
        vectorHelper('at', id, (name) => ({
            signature: goText`func ${name}(value ${type(id)}, index float64) *${type(element(id))}`,
            body: [
                {
                    head: 'if !(index >= 0) || index != math.Floor(index) || index >= float64(len(value))',
                    body: ['panic("vector index out of bounds")'],
                },
                'return &value[int(index)]',
            ],
        }));
    const hostHelpers = new Map<string, string>();
    /** Natives that take and return plain data, by registered name. Lens natives are separate. */
    const simpleNative = (op: string, args: Expr[], result: string): Expr | undefined => {
        if (['+', '-', '*', '/', '==', '>=', '<='].includes(op))
            return activeLocals
                ? activeLocals.binary(op, args[0]!, args[1]!)
                : go`(${args[0]} ${op} ${args[1]})`;
        if (op === 'charList') return go`${charList(result)}(${args[0]})`;
        if (op === 'heapsize') return activeLocals ? activeLocals.scalar('0.0', 0) : '0.0';
        if (op === '[::]') return zero(result);
        if (op === '[:push:]') return go`append(${args[0]}, ${args[1]})`;
        if (op === 'array') return go`${vectorArray(result)}(${args[0]}, ${args[1]})`;
        const helper = (name: string, fn: GoFunction, declaration?: string) => {
            if (!hostHelpers.has(name)) {
                const actual = name.startsWith('hostPrint_') ? packageNames.unique(name) : name;
                hostHelpers.set(name, actual);
                helpers.push({
                    ...fn,
                    signature: fn.signature.replace(/^func [A-Za-z_]\w*/, `func ${actual}`),
                });
                if (declaration) declarePackage('stdin', declaration, ['bufio']);
            }
            return go`${hostHelpers.get(name)!}(${args[0]})`;
        };
        if (op === 'round')
            return helper('laminarRound', {
                signature: 'func laminarRound(x float64) float64',
                body: [
                    'rounded := math.Floor(x)',
                    { head: 'if x-rounded >= 0.5', body: ['rounded++'] },
                    // Math.round keeps the sign of a zero result, e.g. round(-0.4) is -0.
                    { head: 'if rounded == 0', body: ['rounded = math.Copysign(0, x)'] },
                    'return rounded',
                ],
            });
        if (op === 'print')
            return helper(goText`hostPrint_${type(result)}`, {
                signature: goText`func hostPrint_${type(result)}(value string) ${type(result)}`,
                body: ['fmt.Print(value + "\\n")', go`return ${zero(result)}`],
            });
        if (op === 'getInput') {
            hostImports.add('bufio').add('os');
            return helper(
                'hostInput',
                {
                    signature: 'func hostInput(prompt string) string',
                    body: [
                        'fmt.Print(prompt)',
                        { head: 'if stdin == nil', body: ['stdin = bufio.NewReader(os.Stdin)'] },
                        "line, _ := stdin.ReadString('\\n')",
                        {
                            head: "if len(line) > 0 && line[len(line)-1] == '\\n'",
                            body: ['line = line[:len(line)-1]'],
                        },
                        'return line',
                    ],
                },
                'var stdin *bufio.Reader',
            );
        }
        return undefined;
    };

    for (const w of program.wrappers) {
        if (w.kind !== 'native' || !nativeEntries.has(w.id)) continue;
        const abi = program.abis.find((a) => a.id === w.abi)!;
        const name = goText`native${nativeCodes.size}`;
        nativeCodes.set(w.id, name);
        const args = joinCode(
            abi.arguments.map((id, i) => go`, arg${i} ${type(id)}`),
            '',
        );
        const signature = goText`func ${name}(environment any${args}) ${type(abi.result)}`;
        const body: Statement[] = [];
        let result: Expr;
        const op = requireImport(w.definition, 'go').name;
        const simple = simpleNative(
            op,
            abi.arguments.map((_, i) => go`arg${i}`),
            abi.result,
        );
        if (simple !== undefined) result = simple;
        else if (op === 'size') {
            const vector = endpoint(abi.arguments[0]!, 'read');
            result = go`float64(len(${read(storage.get(incoming('arg0', abi.arguments[0]!)), vector)}))`;
        } else if (op === 'dup')
            result = copyValue(
                read(storage.get(incoming('arg0', abi.arguments[0]!)), abi.result),
                abi.result,
            );
        else if (op === 'fst') {
            const input = layout(abi.arguments[0]!),
                output = layout(abi.result);
            const pointer = input.fields.find((f) => f.name === 'read');
            if (pointer?.kind === 'pointer' && pointer.layout) {
                const replacement = input.fields.find((f) => f.name === 'replacement');
                if (replacement?.kind === 'pointer' && replacement.layout) {
                    layout(replacement.layout)
                        .fields.slice(1)
                        .forEach((f) =>
                            body.push(
                                go`arg0.replacement.${field(f.name)} = arg0.read.${field(f.name)}`,
                            ),
                        );
                }
                result = go`${type(abi.result)}{read: &arg0.read.item0${output.fields.some((f) => f.name === 'replacement') ? go`, replacement: &arg0.${replacement ? 'replacement' : 'read'}.item0` : ''}}`;
            } else result = 'arg0.item0';
        } else return unsupported(goText`Native import ${w.definition}`);
        body.push(go`return ${result}`);
        helpers.push({ signature, body });
    }

    const resultAdapters = new Map(
        program.wrappers
            .filter((w) => w.kind === 'adapt-lens-result')
            .map((w, n) => [w.id, go`result_adapter${n}`]),
    );

    for (const w of program.wrappers) {
        if (w.kind !== 'adapt-lens-result') {
            continue;
        }
        const abi = program.abis.find((a) => a.id === w.abi)!;
        const source = program.wrappers.find((s) => s.id === w.source)!;
        if (source.kind !== 'invoke' && source.kind !== 'native') {
            return unsupported('Result adapter requires a concrete body or native import');
        }
        const sourceCode =
            source.kind === 'invoke' ? codes.get(source.code)! : nativeCodes.get(source.id)!;
        const args = joinCode(
            abi.arguments.map((id, n) => go`, arg${n} ${type(id)}`),
            '',
        );
        const signature = goText`func ${resultAdapters.get(w.id)}(environment any${args}) ${type(abi.result)}`;

        {
            const raw = program.abis.find((a) => a.id === source.abi)!;
            const input = endpoint(abi.result, 'read'),
                replacement = endpoint(abi.result, 'replacement');
            const separate = layout(abi.result).fields.some((f) => f.name === 'replacement');
            const fallback: Statement[] = [];
            flush(
                'result',
                raw.result,
                { expression: 'replacement', layout: replacement },
                fallback,
            );
            helpers.push({
                signature,
                body: [
                    go`result := ${
                        source.kind === 'invoke'
                            ? callCode(
                                  source.code,
                                  () => 'environment',
                                  abi.arguments.map((_, n) => go`arg${n}`),
                              )
                            : go`${sourceCode}(environment${joinCode(
                                  abi.arguments.map((_, n) => go`, arg${n}`),
                                  '',
                              )})`
                    }`,
                    go`focus := ${read(storage.get(incoming('result', raw.result)), input)}`,
                    ...(separate ? [go`var write ${type(replacement)}`] : []),
                    go`return ${type(abi.result)}{read: &focus${separate ? ', replacement: &write' : ''}, restore: func(_ any, replacement ${type(replacement)}) ${type(unit.id)} {\n${joinCode(printGoStatements([{ head: 'if result.restore != nil', body: ['result.restore(result.context, replacement)'] }, { head: 'else', body: fallback }, go`return ${zero(unit.id)}`], 1), '\n')}\n}}`,
                ],
            });
        }
    }

    const functions: GoFunction[] = program.code.map((c) => {
        const locals = new GoLocals();
        activeLocals = locals;
        const { parameterNames, bindingName, versionName, hint } = localNames(
            program,
            c,
            new GoNames([
                ...codes.values(),
                ...callableEntries.values(),
                ...names.values(),
                ...abiNames.values(),
                ...[...tags.values()].flat(),
                'environment',
                'replacement',
                'focus',
                'write',
                'result',
            ]),
        );
        parameterNames.forEach((name) => locals.reference(name));
        const values = new Map<string, Expression>();
        const pendingJoins = new WeakMap<object, PendingJoin>();
        const writebacks: Writeback[] = [];
        // Known tuple components remain logical data until a consumer needs
        // their representation. A projection need not build discarded siblings.
        const dataValues = new Map<string, Data>();
        const constants = new Set<string>(); // spellings of literal constants
        const lenses = new Map<string, Lens>();
        const places = new Map<string, View>();
        const loans = new Map<string, Lens>();
        let counter = 0;
        const fresh = () => locals.reference(`v${counter++}`);

        const declare = (
            id: string,
            expression: Expr,
            body: Statement[],
            name = fresh(),
        ): string => {
            body.push(
                locals.declaration(name, type(id), expression, {
                    zeroInitial: same(expression, zero(id)),
                }),
            );
            return name;
        };

        // Reserve the original sequencing point before a value is demanded. A
        // delayed load still precedes the calls/restoration that followed it in IR.
        const defer = (
            id: string,
            compute: (into: Statement[]) => Expr,
            body: Statement[],
            name = fresh(),
            pure = false,
            inline = false,
            load = false,
        ): Exclude<Data, Data[]> => {
            locals.reference(name);
            const at: Statement[] = [];
            body.push(at);
            let materialized = false;
            return {
                layout: id,
                key: name,
                expression: () => {
                    if (!materialized) {
                        materialized = true;
                        const expr = compute(at);
                        at.push(
                            locals.declaration(name, type(id), expr, {
                                pure,
                                inline,
                                load,
                                zeroInitial: same(expr, zero(id)),
                            }),
                        );
                    }
                    return name;
                },
            };
        };
        const phi = (
            id: string,
            inputs:
                | { data: Data; body: Statement[] }[]
                | (() => { data: Data; body: Statement[] }[]),
            body: Statement[],
            group?: JoinGroup,
        ): Data => {
            const items = () => (typeof inputs === 'function' ? inputs() : inputs);
            const l = layout(id);
            if (
                l.kind === 'record' &&
                l.fields.length &&
                l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))
            )
                return l.fields.map((f, n) =>
                    phi(
                        (f as { layout: string }).layout,
                        () =>
                            items().map((input) => ({
                                data: storage.parts(input.data)[n]!,
                                body: input.body,
                            })),
                        body,
                        group,
                    ),
                );
            const name = fresh();
            const pending = { group, inputs: items, materialized: false };
            const result = defer(
                id,
                () => {
                    pending.materialized = true;
                    items().forEach((input) =>
                        input.body.push(locals.assign(name, read(input.data, id))),
                    );
                    return zero(id);
                },
                body,
                name,
            );
            if (group) pendingJoins.set(result, pending as PendingJoin);
            return result;
        };

        const snapshot = (data: Data, id: string, body: Statement[], name = fresh()): Data => {
            if (layout(id).kind === 'unit') return { expression: zero(id), layout: id };
            if (Array.isArray(data))
                return data.map((d, n) =>
                    snapshot(d, (layout(id).fields[n] as { layout: string }).layout, body),
                );
            const result = defer(
                id,
                () => read(data, id),
                body,
                name,
                false,
                false,
                !!data.address,
            );
            if (data.constructed) {
                const variantLayout = variant(id, tagOf(id, data.constructed.name)).layout;
                return {
                    ...result,
                    constructed: {
                        name: data.constructed.name,
                        payload: snapshot(data.constructed.payload, variantLayout, body),
                    },
                };
            }
            return result;
        };

        const parameters: { expression: Expr; layout: string; view: View }[] = [];
        const physicalLenses: { expression: Expr; layout: string; data: Data }[] = [];
        const setup: Statement[] = [];
        /** Boxes kept by borrowed matches, by reconstruction id, until a construct reuses them. */
        const retainedBoxes = new Map<string, string>();
        /** Reconstructions whose temporary lens is the retained box's payload. */
        const inPlaceIds = new Set<string>();
        /** Storage cells that are a retained box's payload. */
        const inPlaceCells = new Set<import('./storage.ts').Cell>();
        /** The live leaf an in-place field had before a move emptied it, by cell and path. */
        const homes = new Map<import('./storage.ts').Cell, Map<string, Data>>();
        const rememberHome = (view: View) => {
            if (Array.isArray(view) || !inPlaceCells.has(view.cell)) return;
            const leaf = storage.get(view);
            if (Array.isArray(leaf) || !leaf.address) return;
            const at = homes.get(view.cell) ?? new Map<string, Data>();
            at.set(JSON.stringify(view.path), leaf);
            homes.set(view.cell, at);
        };
        const home = (view: View): Data | undefined =>
            Array.isArray(view) ? undefined : homes.get(view.cell)?.get(JSON.stringify(view.path));
        /** What a retained arm's owner held before the match moved it out, by reconstruction id. */
        const retainedOwners = new Map<string, Data>();
        /** The storage each moved value came from. */
        const movedFrom = new Map<string, Data>();
        /** An lvalue for the storage behind an address. */
        const through = (address: Expr): Expr => {
            const text = String(address);
            return text.startsWith('&') ? text.slice(1) : go`*${address}`;
        };
        /** Store each payload field that no longer reads its own live storage. */
        const writeBack = (before: Data, after: Data, id: string, body: Statement[]) => {
            if (Array.isArray(before) || !before.address) return;
            if (!Array.isArray(after) && same(after.address, before.address)) return;
            const items = layout(id).fields.filter((f) => f.name.startsWith('item'));
            if (layout(id).kind !== 'record' || !items.length) {
                body.push(go`${through(before.address)} = ${read(after, id)}`);
                return;
            }
            const from = storage.parts(before),
                to = storage.parts(after);
            items.forEach((f, n) =>
                writeBack(from[n]!, to[n]!, (f as { layout: string }).layout, body),
            );
        };
        const bind = (p: IRPattern, data: Data, body: Statement[] = setup, retains?: string) => {
            if (p.kind === 'bind') {
                places.set(p.slot.place, storage.own(data));
            } else if (p.kind === 'tuple') {
                p.items.forEach((item, i) => bind(item, storage.parts(data)[i]!, body));
            } else if (p.kind === 'constructor') {
                // Borrowed matches moved their owner out first; reconstruction is explicit IR.
                if (Array.isArray(data)) return unsupported('Constructor pattern over a tuple');
                const n = tagOf(data.layout, p.name),
                    v = variant(data.layout, n);
                // Keep the owner's box so the reconstruction can write into it. A value
                // constructed in place has no box, so its reconstruction allocates.
                if (retains !== undefined && v.boxed && !data.constructed) {
                    const box = fresh();
                    body.push(
                        locals.declaration(
                            box,
                            goText`*${type(v.layout)}`,
                            dot(code(data.expression), `v${n}`),
                            { pure: true },
                        ),
                    );
                    retainedBoxes.set(retains, box);
                    // The fields stay in the box and are read and written through it.
                    if (inPlaceIds.has(retains) && retainedOwners.has(retains)) {
                        const live: Data = {
                            expression: go`(*${box})`,
                            layout: v.layout,
                            address: box,
                            heap: true,
                        };
                        if (p.items.length === 1) bind(p.items[0]!, live, body);
                        else
                            p.items.forEach((item, k) => bind(item, storage.parts(live)[k]!, body));
                        return;
                    }
                }
                const contents: Data = data.constructed
                    ? data.constructed.name === p.name
                        ? data.constructed.payload
                        : { expression: zero(v.layout), layout: v.layout }
                    : defer(v.layout, () => payload(code(data.expression), data.layout, n), body);
                if (p.items.length === 1) bind(p.items[0]!, contents, body);
                else p.items.forEach((item, k) => bind(item, storage.parts(contents)[k]!, body));
            } else if (p.kind === 'drop') {
                // Drop in Go is automatic via GC for plain data
            }
        };

        c.parameters.forEach((p, i) => {
            if (p.lensPlace) {
                const view = incoming(parameterNames[i]!, p.layout);
                places.set(p.lensPlace, view);
                parameters.push({ expression: parameterNames[i]!, layout: p.layout, view });
                physicalLenses.push({
                    expression: parameterNames[i]!,
                    layout: p.layout,
                    data: storage.get(view),
                });
            } else {
                bind(p.pattern, { expression: parameterNames[i]!, layout: p.layout });
            }
        });

        const flushParameters = (body: Statement[]) => {
            const requests = parameters.map((p) => ({ ...p, data: storage.get(p.view) }));
            const at: Statement[] = [];
            body.push(at);
            writebacks.push({
                body: at,
                fallback: () => requests.forEach((p) => flush(p.expression, p.layout, p.data, at)),
                destinations: () => {
                    const writes: WriteDestination[] = [];
                    const value = (pointer: Expr, id: string, data: Data) => {
                        if (Array.isArray(data))
                            layout(id).fields.forEach((f, n) =>
                                value(
                                    go`&(*${pointer}).${field(f.name)}`,
                                    (f as { layout: string }).layout,
                                    data[n]!,
                                ),
                            );
                        else writes.push({ pointer, layout: id, data });
                    };
                    const lens = (expression: Expr, id: string, data: Data) => {
                        const l = layout(id);
                        const f =
                            l.fields.find((f) => f.name === 'replacement') ??
                            l.fields.find((f) => f.name === 'read');
                        if (f?.kind === 'pointer' && f.layout)
                            value(dot(expression, f.name), f.layout, data);
                        else
                            l.fields
                                .filter((f) => f.name.startsWith('item'))
                                .forEach((f, n) =>
                                    lens(
                                        dot(expression, f.name),
                                        (f as { layout: string }).layout,
                                        storage.parts(data)[n]!,
                                    ),
                                );
                    };
                    requests.forEach((p) => lens(p.expression, p.layout, p.data));
                    return writes;
                },
            });
        };

        const matches = (p: IRPattern, data: Data, id: string): Expr => {
            if (p.kind === 'literal')
                return go`${read(data, id)} == ${layout(id).kind === 'string' && typeof p.value === 'string' ? goBytes(p.value) : literal(p.value, unit.id)}`;
            const fields = layout(id).fields as { layout: string }[];
            if (p.kind === 'tuple')
                return (
                    joinCode(
                        p.items.map((p, i) =>
                            matches(p, storage.parts(data)[i]!, fields[i]!.layout),
                        ),
                        ' && ',
                    ) || 'true'
                );
            if (p.kind !== 'constructor') return 'true';
            const n = tagOf(id, p.name),
                v = variant(id, n);
            if (!Array.isArray(data) && data.constructed) {
                if (data.constructed.name !== p.name) return 'false';
                const contents = data.constructed.payload;
                const checks =
                    p.items.length === 1
                        ? [matches(p.items[0]!, contents, v.layout)]
                        : p.items.map((item, k) =>
                              matches(
                                  item,
                                  storage.parts(contents)[k]!,
                                  (layout(v.layout).fields[k] as { layout: string }).layout,
                              ),
                          );
                return (
                    joinCode(
                        checks.filter((c) => !same(c, 'true')),
                        ' && ',
                    ) || 'true'
                );
            }
            const contents = payload(read(data, id), id, n);
            const items =
                p.items.length === 1
                    ? [matches(p.items[0]!, { expression: contents, layout: v.layout }, v.layout)]
                    : p.items.map((item, k) =>
                          matches(
                              item,
                              {
                                  expression: dot(contents, `item${k}`),
                                  layout: (layout(v.layout).fields[k] as { layout: string }).layout,
                              },
                              (layout(v.layout).fields[k] as { layout: string }).layout,
                          ),
                      );
            return joinCode(
                [
                    go`${dot(read(data, id), 'tag')} == ${tagValue(id, n)}`,
                    ...items.filter((m) => !same(m, 'true')),
                ],
                ' && ',
            );
        };

        const irrefutable = (p: IRPattern): boolean =>
            p.kind === 'bind' ||
            p.kind === 'drop' ||
            (p.kind === 'tuple' && p.items.every(irrefutable));
        const emitMatch = (
            patterns: IRPattern[],
            data: Data,
            id: string,
            arms: { nested: Statement[] }[],
            body: Statement[],
        ) => {
            // A catch-all ends ordered matching. Later arms cannot run.
            const wildcard = patterns.findIndex(irrefutable);
            const count = wildcard < 0 ? patterns.length : wildcard + 1;
            patterns = patterns.slice(0, count);
            const tests = patterns.slice(0, wildcard < 0 ? count : count - 1);
            if (
                layout(id).kind === 'bool' &&
                tests.length === 2 &&
                tests.every((p) => p.kind === 'literal' && typeof p.value === 'boolean') &&
                (tests[0] as { value: boolean }).value !== (tests[1] as { value: boolean }).value
            ) {
                const condition = read(data, id);
                body.push({
                    kind: 'if',
                    arms: [
                        {
                            condition: (tests[0] as { value: boolean }).value
                                ? condition
                                : go`!(${condition})`,
                            body: arms[0]!.nested,
                        },
                        { body: arms[1]!.nested },
                    ],
                });
                return;
            }
            const strings =
                layout(id).kind === 'string' &&
                tests.every((p) => p.kind === 'literal' && typeof p.value === 'string');
            const tags =
                layout(id).kind === 'union' &&
                (Array.isArray(data) || !data.constructed) &&
                tests.every((p) => p.kind === 'constructor' && p.items.every(irrefutable));
            const labels = tests.map((p) =>
                strings && p.kind === 'literal'
                    ? goBytes(p.value as string)
                    : tags && p.kind === 'constructor'
                      ? tagValue(id, tagOf(id, p.name))
                      : '',
            );
            // Duplicate labels need ordered matching, which Go switches reject.
            if (tests.length && (strings || tags) && new Set(labels).size === labels.length) {
                const selector = read(data, id);
                const cases: { label?: Expr; body: Statement[] }[] = labels.map((label, n) => ({
                    label,
                    body: arms[n]!.nested,
                }));
                if (wildcard >= 0) cases.push({ body: arms[count - 1]!.nested });
                else if (!tags || labels.length !== layout(id).fields.length)
                    cases.push({ body: ['panic("unmatched case")'] });
                body.push({
                    kind: 'switch',
                    subject: tags ? dot(selector, 'tag') : selector,
                    cases,
                });
                return;
            }
            // A leading catch-all needs no test at all.
            if (irrefutable(patterns[0]!)) {
                body.push(arms[0]!.nested);
                return;
            }
            const chain: { condition?: Expr; body: Statement[] }[] = patterns.map((p, n) => {
                if (irrefutable(p)) return { body: arms[n]!.nested };
                if (
                    layout(id).kind === 'bool' &&
                    p.kind === 'literal' &&
                    typeof p.value === 'boolean'
                ) {
                    const condition = read(data, id);
                    return {
                        condition: p.value ? condition : go`!(${condition})`,
                        body: arms[n]!.nested,
                    };
                }
                return { condition: matches(p, data, id), body: arms[n]!.nested };
            });
            if (wildcard < 0) chain.push({ body: ['panic("unmatched case")'] });
            body.push({ kind: 'if', arms: chain });
        };

        const ref = (s: SlotRef) =>
            storage.project(places.get(s.place) ?? unsupported('Unavailable Go place'), s.path);

        // Adapt input/output backing at calls.
        const homogeneous = (id: string): boolean => {
            const l = layout(id);
            // restore/context are ABI capacity; finish establishes whether
            // this logical lens actually has an active restoration frontend.
            if (l.fields.some((f) => f.name === 'replacement')) return false;
            if (l.fields.some((f) => f.name === 'read')) return true;
            return l.fields
                .filter((f) => f.name.startsWith('item'))
                .every(
                    (f) => f.kind === 'value' && f.name.startsWith('item') && homogeneous(f.layout),
                );
        };
        const sameStorage = (a: Data, b: Data): boolean => {
            if (
                !Array.isArray(a) &&
                !Array.isArray(b) &&
                a.layout === b.layout &&
                a.address &&
                same(a.address, b.address)
            )
                return true;
            if (!Array.isArray(a) && !Array.isArray(b)) return false;
            const left = storage.parts(a),
                right = storage.parts(b);
            return left.length === right.length && left.every((d, n) => sameStorage(d, right[n]!));
        };
        const adapt = (
            lens: Lens,
            id: string,
            escapes: boolean,
            body: Statement[],
        ): { expression: Expr; finish: (body: Statement[]) => void } => {
            const reusable = !escapes && lens.finish === noFinish && homogeneous(id);
            if (reusable) {
                const data = storage.get(lens.view);
                const existing = physicalLenses.find(
                    (p) => p.layout === id && sameStorage(data, p.data),
                );
                if (existing) return { expression: existing.expression, finish: noFinish };
            }
            const index = helperCounter++;
            const name = locals.reference(goText`back${index}`);
            locals.mutable(name);
            const fields: string[] = [];
            const fieldTypes: string[] = [];
            const init: Statement[] = [];
            const live = new Map<string, Data>();

            const build = (id: string, path: string): Expr => {
                const l = layout(id);
                const input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const output = l.fields.find((f) => f.name === 'replacement');
                    const d = storage.get(
                        storage.project(lens.view, path ? path.split('.').map(Number) : []),
                    );
                    if (
                        lens.finish === noFinish &&
                        !output &&
                        !Array.isArray(d) &&
                        d.layout === input.layout &&
                        d.address &&
                        // An escaping call may keep the pointer, so only a heap box's storage qualifies.
                        (!escapes || d.heap)
                    ) {
                        live.set(path, d);
                        return go`${type(id)}{read: ${d.address}}`;
                    }
                    const n = fields.length;
                    const r = `read${n}`;
                    const w = output ? `write${n}` : r;
                    live.set(path, {
                        expression: go`${name}.${field(w)}`,
                        address: go`&${name}.${field(w)}`,
                        layout:
                            output?.kind === 'pointer' && output.layout
                                ? output.layout
                                : input.layout,
                    });
                    fieldTypes.push(type(input.layout));
                    fields.push(goText`${field(r)} ${type(input.layout)}`);
                    const initial = read(d, input.layout);
                    if (!same(initial, zero(input.layout)))
                        init.push(go`${name}.${field(r)} = ${initial}`);
                    if (output?.kind === 'pointer' && output.layout) {
                        fieldTypes.push(type(output.layout));
                        fields.push(goText`${field(w)} ${type(output.layout)}`);
                        // Every adapter creates (or resets) its backing before
                        // filling the read fields. Replacement fields start zero.
                    }
                    return go`${type(id)}{read: &${name}.${field(r)}${output ? go`, replacement: &${name}.${field(w)}` : ''}}`;
                }
                return go`${type(id)}{${joinCode(
                    l.fields
                        .filter((f) => f.name.startsWith('item'))
                        .map(
                            (f, i) =>
                                go`${field(f.name)}: ${build((f as { layout: string }).layout, path ? path + '.' + i : String(i))}`,
                        ),
                    ', ',
                )}}`;
            };

            const expression = build(id, '');
            if (!fields.length) return { expression, finish: lens.finish };
            const backingKey = fields.join(';');
            let backingType = backingTypes.get(backingKey);
            if (!backingType) {
                const label = fields
                    .map((f) => f.split(' ').at(-1))
                    .join('_')
                    .replace(/[^A-Za-z_0-9]/g, '_')
                    .slice(0, 50);
                backingType = packageNames.unique(`Backing_${label}_${fingerprint(backingKey)}`);
                backingTypes.set(backingKey, backingType);
                declarePackage(
                    backingType,
                    goText`type ${backingType} struct {\n${joinCode(
                        fields.map((f) => go`\t${f}`),
                        '\n',
                    )}\n}`,
                    fieldTypes,
                );
            }
            body.push(
                locals.declaration(
                    name,
                    (escapes ? '*' : '') + backingType,
                    escapes ? go`new(${backingType})` : go`${backingType}{}`,
                    { zeroInitial: !escapes },
                ),
            );
            body.push(...init);

            if (reusable) {
                const output = (id: string, path = ''): Data => {
                    const data = live.get(path);
                    if (data) return data;
                    return layout(id)
                        .fields.filter((f) => f.name.startsWith('item'))
                        .map((f, n) =>
                            output(
                                (f as { layout: string }).layout,
                                path ? path + '.' + n : String(n),
                            ),
                        );
                };
                const data = output(id);
                return {
                    expression,
                    finish: () => storage.put(lens.view, data),
                };
            }

            const arg = declare(id, expression, body);
            const outputs = (expr: Expr, id: string): Data => {
                const l = layout(id);
                const f =
                    l.fields.find((f) => f.name === 'replacement') ??
                    l.fields.find((f) => f.name === 'read');
                if (f?.kind === 'pointer' && f.layout)
                    return { expression: star(dot(expr, f.name)), layout: f.layout };
                return l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map((f) => outputs(dot(expr, f.name), (f as { layout: string }).layout));
            };

            return {
                expression: arg,
                finish: (body) => {
                    const result = defer(
                        endpoint(id, 'replacement'),
                        () => read(outputs(arg, id), endpoint(id, 'replacement')),
                        body,
                    );
                    storage.put(lens.view, result);
                    lens.finish(body);
                },
            };
        };

        const runtimeLens = (
            name: string,
            id: string,
            after: (body: Statement[]) => void,
        ): Lens => {
            const view = incoming(name, id);
            return {
                view,
                finish: (body) => {
                    const replacement = declare(
                        endpoint(id, 'replacement'),
                        read(storage.get(view), endpoint(id, 'replacement')),
                        body,
                    );
                    const fallback: Statement[] = [];
                    flush(name, id, storage.get(view), fallback);
                    body.push({
                        kind: 'if',
                        arms: [
                            {
                                condition: go`${dot(name, 'restore')} != nil`,
                                body: [
                                    go`${dot(name, 'restore')}(${dot(name, 'context')}, ${replacement})`,
                                ],
                            },
                            { body: fallback },
                        ],
                    });
                    after(body);
                },
            };
        };

        const literal = (v: unknown, id: string): Expr => {
            if (v === null) return zero(id);
            if (typeof v === 'boolean') return v ? 'true' : 'false';
            if (typeof v === 'number') {
                const s = String(v);
                return s.includes('.') || s.includes('e') || s.includes('E') ? s : go`${s}.0`;
            }
            if (v && typeof v === 'object' && 'number' in v) {
                return {
                    NaN: 'math.NaN()',
                    Infinity: 'math.Inf(1)',
                    '-Infinity': 'math.Inf(-1)',
                    '-0': 'math.Copysign(0, -1)',
                }[String((v as { number: string }).number)]!;
            }
            return unsupported('Literal');
        };

        const outputLayouts = new Map<string, string>();
        const index = (b: ConcreteBlock) =>
            b.instructions.forEach((i) => {
                if ('out' in i) outputLayouts.set(i.out.id, i.out.layout);
                if (i.op === 'scope') index(i.body);
                if (i.op === 'aslens') {
                    if (i.inPlace) inPlaceIds.add(i.inPlace);
                    index(i.cleanup);
                }
                if (i.op === 'case') i.cases.forEach((a) => index(a.body));
            });
        index(c.body);
        const lensSlots = new Map<string, SlotRef>();

        /** Lens-valued instructions whose result is the function's returned lens. */
        const returned = new Set<string>();
        const markReturned = (b: ConcreteBlock, id: string): void => {
            returned.add(id);
            const found = b.instructions.find((s) => 'out' in s && s.out.id === id);
            if (found?.op === 'scope') markReturned(found.body, found.body.result);
            else if (found?.op === 'case')
                found.cases.forEach((a) => markReturned(a.body, a.body.result));
        };
        markReturned(c.body, c.body.result);
        /** Cleanup of the blocks being lowered whose result is the function's returned lens. */
        const enclosingFinishes: Completion[] = [];
        /** Enclosing cleanup a forwarding join already ran inside each arm's restoration. */
        const consumed = new Set<Completion>();
        const count = (s: Statement[]): number =>
            s.reduce<number>((n, x) => n + (Array.isArray(x) ? count(x) : 1), 0);
        /**
         * A lens as a runtime lens: its restoration becomes the `restore` function of a
         * struct built here (for the function's own result, with the incoming lenses'
         * write-back).
         */
        const closureLens = (
            lens: Lens,
            layoutId: string,
            body: Statement[],
            flushIncoming: boolean,
        ): string => {
            const build = (view: View, id: string): Expr => {
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const name = declare(input.layout, read(storage.get(view), input.layout), body);
                    const output = l.fields.find((f) => f.name === 'replacement');
                    const write =
                        output?.kind === 'pointer' && output.layout
                            ? declare(output.layout, zero(output.layout), body)
                            : undefined;
                    return go`${type(id)}{read: ${locals.address(name)}${write ? go`, replacement: ${locals.address(write)}` : ''}}`;
                }
                return go`${type(id)}{${joinCode(
                    l.fields
                        .filter((f) => f.name.startsWith('item'))
                        .map(
                            (f, n) =>
                                go`${field(f.name)}: ${build(storage.project(view, [n]), (f as { layout: string }).layout)}`,
                        ),
                    ', ',
                )}}`;
            };
            const out = declare(layoutId, build(lens.view, layoutId), body);
            locals.mutable(out);
            const replacement = endpoint(layoutId, 'replacement');
            const saved = storage.snapshot();
            storage.put(lens.view, { expression: 'replacement', layout: replacement });
            const cleanup: Statement[] = [];
            lens.finish(cleanup);
            if (flushIncoming) flushParameters(cleanup);
            storage.reset(saved);
            body.push({
                head: go`${out}.restore = func(_ any, replacement ${type(replacement)}) ${type(unit.id)}`,
                body: [...cleanup, go`return ${zero(unit.id)}`],
            });
            return out;
        };
        /**
         * How a lens-valued case can return its arm's lens as a runtime lens, so the function
         * returns whichever arm ran with no selector and no copied contents: `struct` when the
         * arm already is one (a call result, or a pointer into storage that outlives the frame)
         * and nothing else has to run, or `closure` when the arm's own restoration, the
         * enclosing cleanup and the incoming lenses' write-back become its callback. `after` is
         * the storage state once the arm's restoration has run.
         */
        type ForwardPlan = {
            kind: 'struct' | 'closure';
            expression?: Expr;
            after: Map<import('./storage.ts').Cell, Data>;
        };
        const forwardable = (
            lens: Lens,
            arm: { restored?: unknown[] },
            id: string,
        ): ForwardPlan | undefined => {
            if (arm.restored?.length) return undefined;
            // An incoming lens that changes type has no live form to restore it to.
            if (parameters.some((p) => layout(p.layout).fields.some((f) => f.name === 'replacement')))
                return undefined;
            const saved = storage.snapshot();
            const l = layout(id),
                input = l.fields.find((f) => f.name === 'read');
            let quiet: boolean,
                afterEnclosing: Map<import('./storage.ts').Cell, Data>,
                afterFlush: Map<import('./storage.ts').Cell, Data>;
            try {
                const trial: Statement[] = [];
                (lens.forwarded ? lens.forwarded.rest : lens.finish)(trial);
                const enclosing: Statement[] = [];
                for (let k = enclosingFinishes.length - 1; k >= 0; k--)
                    enclosingFinishes[k]!(enclosing);
                afterEnclosing = storage.snapshot();
                const flushed: Statement[] = [];
                parameters.forEach((p) =>
                    flush(p.expression, p.layout, storage.get(p.view), flushed),
                );
                quiet = count(trial) === 0 && count(enclosing) === 0 && count(flushed) === 0;
                // The write-back is part of the arm's own restoration when it runs from a
                // callback; the model then sees the incoming lenses as live again.
                parameters.forEach((p) =>
                    storage.put(p.view, storage.get(incoming(p.expression, p.layout))),
                );
                afterFlush = storage.snapshot();
            } catch (error) {
                // Storage this early in the function may not be restorable yet.
                if (error instanceof BackendDiagnostic) return undefined;
                throw error;
            } finally {
                storage.reset(saved);
            }
            const d = lens.forwarded ? undefined : storage.get(lens.view);
            if (quiet) {
                if (lens.forwarded)
                    return {
                        kind: 'struct',
                        expression: lens.forwarded.expression,
                        after: afterEnclosing,
                    };
                if (
                    !l.fields.some((f) => f.name === 'replacement') &&
                    input?.kind === 'pointer' &&
                    input.layout &&
                    d &&
                    !Array.isArray(d) &&
                    d.address &&
                    d.heap &&
                    d.layout === input.layout
                )
                    return {
                        kind: 'struct',
                        expression: go`${type(id)}{read: ${d.address}}`,
                        after: afterEnclosing,
                    };
            }
            return { kind: 'closure', after: afterFlush };
        };

        const block = (b: ConcreteBlock, output: Statement[]): Expression => {
            const finish = (body: Statement[]) =>
                b.cleanup.forEach((cl) => {
                    if (cl.kind === 'release') {
                        const lens = loans.get(cl.loan);
                        if (lens) lens.finish(body);
                    } else if (cl.kind === 'drop-place') {
                        storage.put(ref(cl.slot), { expression: zero(unit.id), layout: unit.id });
                    }
                });
            const tracked = returned.has(b.result);
            if (tracked) enclosingFinishes.push(finish);
            for (const i of b.instructions) {
                const body: Statement[] = [];
                output.push(body);
                // Deferred restoration can lower the same IR block on several
                // edges. Capture operand expressions now, before later edges
                // install another physical version under the same IR value ID.
                const operandIds =
                    i.op === 'bind' || i.op === 'swap' || i.op === 'case'
                        ? [i.value]
                        : i.op === 'aslens'
                          ? [i.initial]
                          : i.op === 'invoke'
                            ? [i.callee, ...i.args]
                            : i.op === 'make-callable'
                              ? i.captures.map((c) => c.value)
                              : i.op === 'string'
                                ? i.parts.map((p) => p.value)
                                : i.op === 'tuple' || i.op === 'construct'
                                  ? i.items
                                  : [];
                const operands = new Map(operandIds.map((id) => [id, values.get(id)!]));
                const value = (id: string) =>
                    code(operands.get(id) ?? unsupported('Missing Go operand'));
                const operandData = new Map(
                    operandIds.map((id) => [
                        id,
                        dataValues.get(id) ?? {
                            expression: operands.get(id)!,
                            layout: outputLayouts.get(id)!,
                            key: fresh(),
                        },
                    ]),
                );
                const datum = (id: string): Data =>
                    operandData.get(id) ?? unsupported('Missing Go data operand');
                if ('out' in i) dataValues.delete(i.out.id);

                if (i.op === 'bind') {
                    bind(i.pattern, datum(i.value), body);
                    continue;
                }
                if (i.op === 'borrow') {
                    const loan = program.semantic.program.units
                        .find((u) => u.id === c.unit)
                        ?.loans.find((l) => l.id === i.loan);
                    if (!loan) unsupported('Missing loan');
                    const lens = lenses.get(i.lens)!;
                    if (loan!.owners) places.set(loan!.place, lens.view);
                    loans.set(i.loan, lens);
                    continue;
                }

                const id = i.out.layout;
                const hinted = hint(i, (id) => lensSlots.get(id));
                const name = hinted && takesName(i) ? versionName(hinted) : fresh();
                let expr!: Expression;
                let constructed: { name: string; payload: Data } | undefined;

                switch (i.op) {
                    case 'constant':
                        expr = literal(i.value, id);
                        constants.add(String(expr));
                        if (i.value !== null)
                            expr = locals.scalar(
                                String(expr),
                                typeof i.value === 'boolean' ? i.value : decodeNumber(i.value),
                            );
                        break;
                    case 'string':
                        // Parts were evaluated in source order; concatenation consumes them.
                        expr = () =>
                            joinCode(
                                [
                                    goBytes(i.head),
                                    ...i.parts.flatMap((part) => [
                                        stringPart(
                                            layout(outputLayouts.get(part.value)!).kind,
                                            value(part.value),
                                        ),
                                        goBytes(part.tail),
                                    ]),
                                ].filter((piece) => !same(piece, '""')),
                                ' + ',
                            ) || '""';
                        break;
                    case 'construct': {
                        const variantLayout = variant(id, tagOf(id, i.name)).layout;
                        constructed = {
                            name: i.name,
                            payload:
                                i.items.length === 0
                                    ? { expression: zero(variantLayout), layout: variantLayout }
                                    : i.items.length === 1
                                      ? datum(i.items[0]!)
                                      : i.items.map(datum),
                        };
                        const construction: Statement[] = [];
                        body.push(construction);
                        expr = () => {
                            const n = tagOf(id, i.name),
                                v = variant(id, n),
                                l = layout(v.layout);
                            let contents =
                                i.items.length === 0
                                    ? zero(v.layout)
                                    : i.items.length === 1
                                      ? value(i.items[0]!)
                                      : go`${type(v.layout)}{${joinCode(
                                            i.items.map(
                                                (it, k) =>
                                                    go`${field(l.fields[k]!.name)}: ${value(it)}`,
                                            ),
                                            ', ',
                                        )}}`;
                            if (v.boxed) {
                                const kept = i.reuses ? retainedBoxes.get(i.reuses) : undefined;
                                const box = kept ?? fresh();
                                if (!kept)
                                    construction.push(
                                        locals.declaration(
                                            box,
                                            goText`*${type(v.layout)}`,
                                            go`new(${type(v.layout)})`,
                                        ),
                                    );
                                construction.push(go`*${box} = ${contents}`);
                                contents = box;
                            }
                            return go`${type(id)}{tag: ${tagValue(id, n)}, v${n}: ${contents}}`;
                        };
                        break;
                    }
                    case 'tuple': {
                        dataValues.set(i.out.id, i.items.map(datum));
                        expr = () => {
                            const l = layout(id);
                            if (!l.fields.length) {
                                return go`${type(id)}{}`;
                            } else {
                                const items = i.items.map(value);
                                const fieldInits = items.map(
                                    (item, idx) => go`${field(l.fields[idx]!.name)}: ${item}`,
                                );
                                return locals.aggregate(
                                    go`${type(id)}{${joinCode(fieldInits, ', ')}}`,
                                    items,
                                );
                            }
                        };
                        break;
                    }
                    case 'move': {
                        const contents = storage.get(ref(i.slot));
                        movedFrom.set(i.out.id, contents);
                        rememberHome(ref(i.slot));
                        const moved = snapshot(contents, id, body, name);
                        storage.put(ref(i.slot), { expression: zero(unit.id), layout: unit.id });
                        dataValues.set(i.out.id, moved);
                        values.set(i.out.id, () => read(moved, id));
                        continue;
                    }
                    case 'acquire':
                        lensSlots.set(i.out.id, i.slot);
                        lenses.set(i.out.id, { view: ref(i.slot), finish: noFinish });
                        continue;
                    case 'lens-tuple':
                        if (i.items.every((v) => lenses.get(v)!.finish === noFinish)) {
                            lenses.set(i.out.id, {
                                view: i.items.map((v) => lenses.get(v)!.view),
                                finish: noFinish,
                            });
                            continue;
                        }
                        lenses.set(i.out.id, {
                            view: i.items.map((v) => lenses.get(v)!.view),
                            finish: (body) => i.items.forEach((v) => lenses.get(v)!.finish(body)),
                        });
                        continue;
                    case 'lens-construct': {
                        // The temporary holds the value built from the field lenses' current
                        // contents (a read: ownership stays explicit in the IR); restoration
                        // checks the tag and writes each payload field back.
                        const union = endpoint(id, 'read');
                        const n = tagOf(union, i.name),
                            v = variant(union, n);
                        if (v.boxed) return unsupported('Constructor lens over a boxed variant');
                        const fields = i.items.map((item) => lenses.get(item)!);
                        const l = layout(v.layout);
                        const items = fields.map((f) => storage.get(f.view));
                        const contents: Expr =
                            items.length === 0
                                ? zero(v.layout)
                                : items.length === 1
                                  ? read(items[0]!, v.layout)
                                  : go`${type(v.layout)}{${joinCode(
                                        items.map(
                                            (d, k) =>
                                                go`${field(l.fields[k]!.name)}: ${read(d, (l.fields[k] as { layout: string }).layout)}`,
                                        ),
                                        ', ',
                                    )}}`;
                        const view = storage.own({
                            expression: go`${type(union)}{tag: ${tagValue(union, n)}, v${n}: ${contents}}`,
                            layout: union,
                        });
                        lenses.set(i.out.id, {
                            view,
                            finish: (output) => {
                                const replacement = storage.get(view);
                                if (Array.isArray(replacement))
                                    return unsupported('Constructor lens replacement shape');
                                const target = code(replacement.expression);
                                output.push({
                                    kind: 'if',
                                    arms: [
                                        {
                                            condition: go`${dot(target, 'tag')} != ${tagValue(union, n)}`,
                                            body: ['panic("constructor lens tag mismatch")'],
                                        },
                                    ],
                                });
                                const inner: Data = {
                                    expression: payload(target, union, n),
                                    layout: v.layout,
                                };
                                const parts = fields.length === 1 ? [inner] : storage.parts(inner);
                                fields.forEach((f, k) => storage.put(f.view, parts[k]!));
                                fields.forEach((f) => f.finish(output));
                            },
                        });
                        continue;
                    }
                    case 'swap': {
                        const lens = lenses.get(i.lens)!;
                        const contents = storage.get(lens.view);
                        const old = snapshot(contents, id, body, name);
                        const live =
                            Array.isArray(lens.view) || !inPlaceCells.has(lens.view.cell)
                                ? undefined
                                : !Array.isArray(contents) && contents.address
                                  ? contents
                                  : home(lens.view);
                        if (
                            live &&
                            !Array.isArray(live) &&
                            live.address &&
                            live.layout === outputLayouts.get(i.value)
                        ) {
                            // The box is the storage and nothing else can observe it, so the
                            // store happens here (after the old value's reserved read) and the
                            // field goes back to reading the box.
                            body.push(go`${through(live.address)} = ${value(i.value)}`);
                            storage.put(lens.view, live);
                        } else storage.put(lens.view, datum(i.value));
                        lens.finish(body);
                        dataValues.set(i.out.id, old);
                        values.set(i.out.id, () => read(old, id));
                        continue;
                    }
                    case 'scope': {
                        const result = block(i.body, body);
                        if (lenses.has(i.body.result)) {
                            lenses.set(i.out.id, lenses.get(i.body.result)!);
                            continue;
                        }
                        values.set(i.out.id, result);
                        const data = dataValues.get(i.body.result);
                        if (data) dataValues.set(i.out.id, data);
                        continue;
                    }
                    case 'make-callable': {
                        const callable = program.callables.find((cb) => cb.id === i.callable)!;
                        const entries = joinCode(
                            callable.entries.map((e) => {
                                const w = program.wrappers.find((w) => w.id === e.wrapper)!;
                                if (w.kind === 'invoke') {
                                    return go`, ${field(e.field)}: ${callableEntries.get(w.id) ?? codes.get(w.code)}`;
                                }
                                if (w.kind === 'adapt-lens-result') {
                                    return go`, ${field(e.field)}: ${resultAdapters.get(w.id)}`;
                                }
                                if (w.kind === 'native' && nativeCodes.has(w.id)) {
                                    return go`, ${field(e.field)}: ${nativeCodes.get(w.id)}`;
                                }
                                return '';
                            }),
                            '',
                        );
                        if (!i.captures.length && !String(entries)) {
                            values.set(i.out.id, zero(id));
                            continue;
                        }
                        if (!i.captures.length) {
                            expr = go`${type(id)}{environment: nil${entries}}`;
                            break;
                        }
                        expr = () =>
                            go`${type(id)}{environment: &${type(callable.environment)}{${joinCode(
                                i.captures.map((c, n) => go`capture${n}: ${value(c.value)}`),
                                ', ',
                            )} }${entries}}`;
                        break;
                    }
                    case 'invoke': {
                        const w = program.wrappers.find((w) => w.id === i.wrapper)!;
                        const abi = program.abis.find((a) => a.id === i.abi)!;
                        const isLens = layout(id).fields.some((f) => f.name === 'restore');
                        const adapters: { finish: (body: Statement[]) => void }[] = [];
                        // These registered natives have no observable effect in Go.
                        // User functions and indirect calls remain effectful, including
                        // traps, even when their returned value has no consumer.
                        if (
                            w?.kind === 'native' &&
                            [
                                '+',
                                '-',
                                '*',
                                '/',
                                '==',
                                '>=',
                                '<=',
                                'round',
                                'heapsize',
                                'charList',
                                '[::]',
                                '[:push:]',
                            ].includes(requireImport(w.definition, 'go').name)
                        ) {
                            values.set(
                                i.out.id,
                                defer(
                                    id,
                                    (at) => {
                                        const args = i.args.map((v) => {
                                            const expr = value(v);
                                            return constants.has(String(expr))
                                                ? declare(outputLayouts.get(v)!, expr, at)
                                                : expr;
                                        });
                                        return (
                                            simpleNative(
                                                requireImport(w.definition, 'go').name,
                                                args,
                                                id,
                                            ) ?? unsupported(goText`Native import ${w.definition}`)
                                        );
                                    },
                                    body,
                                    name,
                                    true,
                                    !hinted,
                                ).expression,
                            );
                            continue;
                        }
                        let args: Expr[] = [];
                        let duplicate: Data | undefined;
                        if (
                            w?.kind === 'native' &&
                            w.definition === 'native/dup' &&
                            reachesHeap(id)
                        ) {
                            // Each leaf that reaches heap data is copied lazily, so a field the
                            // program never reads is never copied. Copying is allocation only.
                            const lens = lenses.get(i.args[0]!)!;
                            const copy = (data: Data, layoutId: string): Data =>
                                Array.isArray(data)
                                    ? data.map((d, n) =>
                                          copy(
                                              d,
                                              (layout(layoutId).fields[n] as { layout: string })
                                                  .layout,
                                          ),
                                      )
                                    : reachesHeap(layoutId)
                                      ? defer(
                                            layoutId,
                                            () => copyValue(read(data, layoutId), layoutId),
                                            body,
                                            fresh(),
                                            true,
                                        )
                                      : data;
                            duplicate = copy(snapshot(storage.get(lens.view), id, body, name), id);
                            expr = () => read(duplicate!, id);
                            adapters.push({ finish: lens.finish });
                        } else if (w?.kind === 'native' && w.definition === 'native/dup') {
                            const lens = lenses.get(i.args[0]!)!;
                            duplicate = snapshot(storage.get(lens.view), id, body, name);
                            expr = () => read(duplicate!, id);
                            adapters.push({ finish: lens.finish });
                        } else if (w?.kind === 'native' && w.definition === 'native/size') {
                            const lens = lenses.get(i.args[0]!)!,
                                vector = endpoint(outputLayouts.get(i.args[0]!)!, 'read');
                            declare(
                                id,
                                go`float64(len(${read(storage.get(lens.view), vector)}))`,
                                body,
                                name,
                            );
                            values.set(i.out.id, name);
                            lens.finish(body);
                            continue;
                        } else if (w?.kind === 'native' && w.definition === 'native/[]') {
                            // The element lives in the slice's backing array, so writing
                            // through its address updates the vector in place.
                            const parent = lenses.get(i.args[1]!)!,
                                vector = endpoint(outputLayouts.get(i.args[1]!)!, 'read'),
                                item = element(vector);
                            const at = fresh();
                            body.push(
                                locals.declaration(
                                    at,
                                    goText`*${type(item)}`,
                                    go`${vectorAt(vector)}(${read(storage.get(parent.view), vector)}, ${value(i.args[0]!)})`,
                                ),
                            );
                            const view = storage.own({
                                expression: go`*${at}`,
                                layout: item,
                                address: at,
                            });
                            lenses.set(i.out.id, {
                                view,
                                finish: (body) => {
                                    const d = storage.get(view);
                                    // Restoring the element's own live contents changes nothing.
                                    if (Array.isArray(d) || !same(d.address, at))
                                        body.push(go`*${at} = ${read(d, item)}`);
                                    parent.finish(body);
                                },
                            });
                            continue;
                        } else if (w?.kind === 'native' && w.definition === 'native/fst') {
                            const parent = lenses.get(i.args[0]!)!;
                            lenses.set(i.out.id, {
                                view: storage.project(parent.view, [0]),
                                finish: parent.finish,
                            });
                            continue;
                        } else {
                            args = i.args.map((v, n) => {
                                if (!lenses.has(v)) return value(v);
                                const a = adapt(lenses.get(v)!, abi.arguments[n]!, isLens, body);
                                adapters.push(a);
                                return a.expression;
                            });
                            if (
                                i.field !== undefined ||
                                w?.kind === 'invoke' ||
                                w?.kind === 'adapt-lens-result'
                            ) {
                                // A direct call invokes its known member's wrapper itself.
                                const direct =
                                    i.field !== undefined
                                        ? undefined
                                        : w.kind === 'invoke'
                                          ? codes.get(w.code)
                                          : (resultAdapters.get(w.id) ??
                                            unsupported(goText`Direct ${w.kind} call`));
                                expr =
                                    direct && w.kind === 'invoke'
                                        ? callCode(
                                              w.code,
                                              () => dot(value(i.callee), 'environment'),
                                              args,
                                          )
                                        : direct
                                          ? go`${direct}(${wrapperUsesEnvironment(w.id) ? dot(value(i.callee), 'environment') : 'nil'}${joinCode(
                                                args.map((a) => go`, ${a}`),
                                                '',
                                            )})`
                                          : go`${dot(value(i.callee), i.field!)}(${dot(value(i.callee), 'environment')}${joinCode(
                                                args.map((a) => go`, ${a}`),
                                                '',
                                            )})`;
                            } else if (w?.kind === 'native') {
                                expr =
                                    simpleNative(
                                        requireImport(w.definition, 'go').name,
                                        args,
                                        id,
                                    ) ?? unsupported(goText`Native import ${w.definition}`);
                            } else {
                                return unsupported(goText`Wrapper kind ${w?.kind}`);
                            }
                        }
                        if (duplicate) {
                            dataValues.set(i.out.id, duplicate);
                            values.set(i.out.id, () => read(duplicate!, id));
                        } else if (isLens) {
                            declare(id, code(expr), body, name);
                            values.set(i.out.id, name);
                        } else {
                            // Calls execute even when their result is discarded. Only
                            // introduce a result local if a later IR consumer asks for it.
                            const call = code(expr);
                            const at: Statement[] = [call];
                            body.push(at);
                            let materialized = false;
                            values.set(
                                i.out.id,
                                layout(id).kind === 'unit'
                                    ? zero(id)
                                    : () => {
                                          if (!materialized) {
                                              at[0] = locals.declaration(name, type(id), call);
                                              materialized = true;
                                          }
                                          return name;
                                      },
                            );
                        }
                        if (isLens) {
                            const rest = (body: Statement[]) =>
                                adapters.forEach((a) => a.finish(body));
                            lenses.set(i.out.id, {
                                ...runtimeLens(name, id, rest),
                                forwarded: { expression: name, rest },
                            });
                        } else {
                            adapters.forEach((a) => a.finish(body));
                        }
                        continue;
                    }
                    case 'aslens': {
                        const box = i.inPlace ? retainedBoxes.get(i.inPlace) : undefined;
                        const owner = i.inPlace ? retainedOwners.get(i.inPlace) : undefined;
                        const slot = i.reconstruction?.reconstructionOwner;
                        if (box && owner && slot && inPlaceIds.has(i.inPlace!)) {
                            // The temporary is the box payload: fields are live reads through
                            // it, written back only when changed. The owner's header is
                            // unchanged, so restoring it needs no reconstruction.
                            const payload = outputLayouts.get(i.initial)!;
                            const view = storage.own({
                                expression: go`(*${box})`,
                                layout: payload,
                                address: box,
                                heap: true,
                            });
                            const live = storage.get(view);
                            if (!Array.isArray(view)) inPlaceCells.add(view.cell);
                            places.set(i.backing, view);
                            lenses.set(i.out.id, {
                                view,
                                finish: (output) => {
                                    writeBack(live, storage.get(view), payload, output);
                                    storage.put(ref(slot), owner);
                                },
                            });
                            continue;
                        }
                        const view = storage.own(datum(i.initial));
                        places.set(i.backing, view);
                        lenses.set(i.out.id, {
                            view,
                            finish: (output) => {
                                block(i.cleanup, output);
                            },
                        });
                        continue;
                    }
                    case 'case': {
                        if (i.lensJoin) {
                            const before = storage.snapshot();
                            const selected = fresh();
                            const input = endpoint(id, 'read');
                            const focusInputs: { data: Data; body: Statement[] }[] = [];
                            const joined = storage.own(phi(input, focusInputs, body));
                            const normalize = (
                                actions: (typeof i.cases)[number]['setup'],
                                output: Statement[],
                            ) =>
                                actions?.forEach((a) => {
                                    if (a.kind !== 'drop-place')
                                        return unsupported('Invalid branch normalization');

                                    storage.put(ref(a.slot), {
                                        expression: zero(unit.id),
                                        layout: unit.id,
                                    });
                                });
                            const merge = (
                                arms: {
                                    nested: Statement[];
                                    state: Map<import('./storage.ts').Cell, Data>;
                                }[],
                                into: Statement[],
                            ) => {
                                // Even one selected arm is a C scope: changed versions must
                                // be materialized outside it before later restoration uses them.
                                const join = (data: Data[], previous?: Data): Data => {
                                    if (
                                        data.every(
                                            (d) => JSON.stringify(d) === JSON.stringify(data[0]),
                                        ) &&
                                        (arms.length > 1 ||
                                            JSON.stringify(data[0]) === JSON.stringify(previous))
                                    )
                                        return data[0]!;
                                    const first = data[0]!;
                                    if (
                                        !Array.isArray(first) &&
                                        data.every(
                                            (d) => !Array.isArray(d) && d.layout === first.layout,
                                        )
                                    ) {
                                        return phi(
                                            first.layout,
                                            arms.map((arm, n) => ({
                                                data: data[n]!,
                                                body: arm.nested,
                                            })),
                                            into,
                                        );
                                    }
                                    const parts = data.map((d) => storage.parts(d));
                                    if (
                                        !parts[0]?.length ||
                                        parts.some((p) => p.length !== parts[0]!.length)
                                    )
                                        return unsupported(
                                            'Branch owner storage requires an adapter',
                                        );
                                    return parts[0].map((_, n) =>
                                        join(
                                            parts.map((p) => p[n]!),
                                            previous && storage.parts(previous)[n],
                                        ),
                                    );
                                };
                                before.forEach(
                                    (previous, cell) =>
                                        (cell.data = join(
                                            arms.map((a) => a.state.get(cell)!),
                                            previous,
                                        )),
                                );
                            };
                            const arms = i.cases.map((arm, n) => {
                                storage.reset(before);
                                const nested: Statement[] = [];
                                bind(arm.pattern, datum(i.value), nested, arm.retains);
                                if (arm.retains && movedFrom.has(i.value))
                                    retainedOwners.set(arm.retains, movedFrom.get(i.value)!);
                                block(arm.body, nested);
                                normalize(arm.setup, nested);
                                const lens = lenses.get(arm.body.result)!;
                                const forward = returned.has(i.out.id)
                                    ? forwardable(lens, arm, outputLayouts.get(arm.body.result)!)
                                    : undefined;
                                return {
                                    nested,
                                    state: storage.snapshot(),
                                    lens,
                                    arm,
                                    index: n,
                                    forward,
                                };
                            });
                            let forwardedJoin: string | undefined;
                            if (arms.every((a) => a.forward !== undefined)) {
                                // Every arm is a runtime lens that restores itself: the result is
                                // whichever one ran, with no selector and no copied contents.
                                forwardedJoin = fresh();
                                body.push(locals.declaration(forwardedJoin, type(id), zero(id)));
                                locals.mutable(forwardedJoin);
                                const enclosing = [...enclosingFinishes];
                                arms.forEach((a) => {
                                    const plan = a.forward!;
                                    let struct: Expr;
                                    if (plan.kind === 'struct') struct = plan.expression!;
                                    else {
                                        storage.reset(a.state);
                                        const whole: Lens = {
                                            view: a.lens.view,
                                            finish: (output) => {
                                                a.lens.finish(output);
                                                for (let k = enclosing.length - 1; k >= 0; k--)
                                                    enclosing[k]!(output);
                                            },
                                        };
                                        struct = closureLens(whole, id, a.nested, true);
                                    }
                                    a.state = plan.after;
                                    a.nested.push(locals.assign(forwardedJoin!, struct));
                                });
                                enclosing.forEach((f) => consumed.add(f));
                            } else {
                                body.push(locals.declaration(selected, 'int', '0'));
                                arms.forEach((a) => {
                                    a.nested.push(locals.assign(selected, String(a.index)));
                                    storage.reset(a.state);
                                    focusInputs.push({
                                        data: storage.get(a.lens.view),
                                        body: a.nested,
                                    });
                                });
                            }
                            storage.reset(before);
                            merge(arms, body);
                            emitMatch(
                                i.cases.map((arm) => arm.pattern),
                                datum(i.value),
                                outputLayouts.get(i.value)!,
                                arms,
                                body,
                            );
                            if (forwardedJoin) {
                                lenses.set(i.out.id, {
                                    ...runtimeLens(forwardedJoin, id, noFinish),
                                    forwarded: { expression: forwardedJoin, rest: noFinish },
                                });
                                continue;
                            }
                            lenses.set(i.out.id, {
                                view: joined,
                                finish: (output) => {
                                    const current = storage.snapshot();
                                    const replacement = storage.get(joined);
                                    const restored = arms.map((arm) => {
                                        storage.reset(arm.state);
                                        before.forEach(
                                            (_, cell) => (cell.data = current.get(cell)!),
                                        );
                                        storage.put(arm.lens.view, replacement);
                                        const nested: Statement[] = [];
                                        arm.lens.finish(nested);
                                        normalize(arm.arm.restored, nested);
                                        return { nested, state: storage.snapshot() };
                                    });
                                    storage.reset(current);
                                    merge(restored, output);
                                    output.push({
                                        kind: 'if',
                                        arms: [
                                            ...restored.map((arm, n) => ({
                                                condition: go`(${selected} == ${n})`,
                                                body: arm.nested,
                                            })),
                                            { body: ['panic("unmatched case")'] },
                                        ],
                                    });
                                },
                            });
                            continue;
                        }
                        const resultInputs: { data: Data; body: Statement[] }[] = [];
                        const group: JoinGroup = { boundary: [] };
                        const resultData = phi(id, resultInputs, body);
                        const before = storage.snapshot();
                        const arms = i.cases.map((arm, armIndex) => {
                            storage.reset(before);
                            const nested: Statement[] = [];
                            if (arm.retains && movedFrom.has(i.value))
                                retainedOwners.set(arm.retains, movedFrom.get(i.value)!);
                            bind(arm.pattern, datum(i.value), nested, arm.retains);
                            const result = block(arm.body, nested);
                            resultInputs.push({
                                data: dataValues.get(arm.body.result) ?? {
                                    expression: result,
                                    layout: id,
                                    key: fresh(),
                                },
                                body: nested,
                            });
                            return { nested, state: storage.snapshot() };
                        });
                        storage.reset(before);
                        // phi-join: for each cell, merge the per-arm states
                        const merge = (data: Data[], previous?: Data): Data => {
                            if (
                                data.every((d) => JSON.stringify(d) === JSON.stringify(data[0])) &&
                                (arms.length > 1 ||
                                    JSON.stringify(data[0]) === JSON.stringify(previous))
                            )
                                return data[0]!;
                            const first = data[0]!;
                            if (
                                !Array.isArray(first) &&
                                data.every((d) => !Array.isArray(d) && d.layout === first.layout)
                            ) {
                                return phi(
                                    first.layout,
                                    arms.map((arm, n) => ({ data: data[n]!, body: arm.nested })),
                                    body,
                                    group,
                                );
                            }
                            const parts = data.map((d) => storage.parts(d));
                            if (
                                !parts[0]?.length ||
                                parts.some((p) => p.length !== parts[0]!.length)
                            )
                                return unsupported('Storage version join requires an adapter');
                            return parts[0].map((_, n) =>
                                merge(
                                    parts.map((p) => p[n]!),
                                    previous && storage.parts(previous)[n],
                                ),
                            );
                        };
                        before.forEach(
                            (previous, cell) =>
                                (cell.data = merge(
                                    arms.map((a) => a.state.get(cell)!),
                                    previous,
                                )),
                        );
                        body.push(group.boundary);
                        emitMatch(
                            i.cases.map((arm) => arm.pattern),
                            datum(i.value),
                            outputLayouts.get(i.value)!,
                            arms,
                            group.boundary,
                        );
                        dataValues.set(i.out.id, resultData);
                        values.set(i.out.id, () => read(resultData, id));
                        continue;
                    }
                    default:
                        return unsupported(goText`Unknown operation ${(i as { op: string }).op}`);
                }

                values.set(
                    i.out.id,
                    layout(id).kind === 'unit'
                        ? zero(id)
                        : i.op === 'constant' || (i.op === 'make-callable' && !i.captures.length)
                          ? expr
                          : defer(
                                id,
                                () => code(expr),
                                body,
                                name,
                                i.op === 'string' || i.op === 'tuple',
                                !hinted,
                            ).expression,
                );
                if (constructed)
                    dataValues.set(i.out.id, {
                        expression: values.get(i.out.id)!,
                        key: name,
                        layout: id,
                        constructed,
                    });
            }

            const body = output;
            if (tracked) enclosingFinishes.pop();

            if (lenses.has(b.result)) {
                const lens = lenses.get(b.result)!;
                // A forwarding join inside already ran this block's cleanup in its arms.
                const cleanup = (body: Statement[]) => {
                    if (!consumed.has(finish)) finish(body);
                };
                lenses.set(b.result, {
                    view: lens.view,
                    finish: (body) => {
                        lens.finish(body);
                        cleanup(body);
                    },
                    ...(lens.forwarded
                        ? {
                              forwarded: {
                                  expression: lens.forwarded.expression,
                                  rest: (body: Statement[]) => {
                                      lens.forwarded!.rest(body);
                                      cleanup(body);
                                  },
                              },
                          }
                        : {}),
                });
                return '';
            }

            finish(body);
            return values.get(b.result) ?? unsupported('Missing Go block result');
        };

        const body: Statement[] = [...setup];

        c.captures.forEach((capture, n) => {
            const base = bindingName({ place: capture.place, path: [] });
            places.set(
                capture.place,
                storage.own(
                    defer(
                        capture.layout,
                        () => go`environment.(*${type(c.environment)}).capture${n}`,
                        body,
                        base ? versionName(base) : fresh(),
                    ),
                ),
            );
        });
        const result = block(c.body, body);
        const forwardedResult = lenses.get(c.body.result)?.forwarded;
        const returnsForwarded =
            forwardedResult &&
            (() => {
                // Nothing is left to restore: the lens already restores itself.
                const saved = storage.snapshot();
                const trial: Statement[] = [];
                try {
                    forwardedResult.rest(trial);
                    parameters.forEach((p) =>
                        flush(p.expression, p.layout, storage.get(p.view), trial),
                    );
                } catch (error) {
                    if (error instanceof BackendDiagnostic) return false;
                    throw error;
                } finally {
                    storage.reset(saved);
                }
                return count(trial) === 0;
            })();
        if (returnsForwarded) {
            body.push(locals.returnValue(code(forwardedResult!.expression)));
        } else if (lenses.has(c.body.result)) {
            const out = closureLens(lenses.get(c.body.result)!, c.body.layout, body, true);
            body.push(locals.returnValue(out));
        } else {
            flushParameters(body);
            body.push(locals.returnValue(code(result)));
        }

        const sig = go`func ${codes.get(c.id)}(${joinCode(
            [
                ...(usesEnvironment(c.id) ? ['environment any'] : []),
                ...c.parameters.map((p, i) => go`${parameterNames[i]} ${type(p.layout)}`),
            ],
            ', ',
        )}) ${type(c.body.layout)}`;
        lowerWritebacks(
            body,
            writebacks,
            pendingJoins,
            read,
            (pointers, values) =>
                go`${joinCode(
                    pointers.map((p) => go`*${p}`),
                    ', ',
                )} = ${joinCode(values, ', ')}`,
        );
        const placed = locals.place(body);
        activeLocals = undefined;
        return { signature: String(sig), body: placed };
    });

    // Helper functions
    helpers.push({
        signature: 'func printNumber(x float64)',
        body: [
            {
                head: 'if math.IsNaN(x)',
                body: ['fmt.Print("{\\"number\\":\\"NaN\\"}")'],
            },
            {
                head: 'else if math.IsInf(x, 1)',
                body: ['fmt.Print("{\\"number\\":\\"Infinity\\"}")'],
            },
            {
                head: 'else if math.IsInf(x, -1)',
                body: ['fmt.Print("{\\"number\\":\\"-Infinity\\"}")'],
            },
            {
                head: 'else if x == 0 && math.Signbit(x)',
                body: ['fmt.Print("{\\"number\\":\\"-0\\"}")'],
            },
            {
                head: 'else',
                body: ["fmt.Print(strconv.FormatFloat(x, 'g', -1, 64))"],
            },
        ],
    });

    const printers = new Set<string>();
    const printerNames = new Map<string, string>();
    let printLoops = 0;
    const print = (expr: Expr, id: string, body: Statement[]) => {
        const l = layout(id);
        if (l.kind === 'f64') {
            body.push(go`printNumber(${expr})`);
        } else if (l.kind === 'bool') {
            body.push(go`if ${expr} { fmt.Print("true") } else { fmt.Print("false") }`);
        } else if (l.kind === 'unit') {
            body.push('fmt.Print("null")');
        } else if (l.kind === 'string') {
            body.push(go`printString(${expr})`);
        } else if (l.kind === 'vector') {
            // Nested vectors nest loops; each needs its own index.
            const i = `i${printLoops++}`;
            const each: Statement[] = [{ head: go`if ${i} > 0`, body: ['fmt.Print(",")'] }];
            print(go`(${expr})[${i}]`, element(id), each);
            body.push(
                'fmt.Print("[")',
                { head: go`for ${i} := range ${expr}`, body: each },
                'fmt.Print("]")',
            );
        } else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
            body.push('fmt.Print("[")');
            l.fields.forEach((f, i) => {
                if (i) body.push('fmt.Print(",")');
                print(dot(expr, f.name), (f as { layout: string }).layout, body);
            });
            body.push('fmt.Print("]")');
        } else if (l.kind === 'union') {
            if (!printerNames.has(id))
                printerNames.set(id, packageNames.unique(`print_${type(id)}`));
            const name = printerNames.get(id)!;
            if (!printers.has(id)) {
                printers.add(id);
                const body: Statement[] = [];
                const names = l.fields.map((f) => f.name);
                if (names.length === 2 && names[0] === 'nil' && names[1] === 'cons') {
                    // The reference protocol prints cons cells as one JSON array.
                    const cell = variant(id, 1);
                    const head = (layout(cell.layout).fields[0] as { layout: string }).layout;
                    const loop: Statement[] = [
                        { head: 'if !first', body: ['fmt.Print(",")'] },
                        'first = false',
                    ];
                    print(go`(*value.v1).item0`, head, loop);
                    loop.push('value = (*value.v1).item1');
                    body.push(
                        'first := true',
                        'fmt.Print("[")',
                        { head: go`for value.tag == ${tagValue(id, 1)}`, body: loop },
                        'fmt.Print("]")',
                    );
                } else
                    l.fields.forEach((f, n) => {
                        const v = variant(id, n);
                        const arm: Statement[] = [
                            go`fmt.Print("{\\"kind\\":\\"variant\\",\\"name\\":\\"${field(f.name)}\\",\\"items\\":[")`,
                        ];
                        const arity = (
                            program.semantic.generic.imports.find(
                                (s) => s.definition === `constructor/${f.name}`,
                            )?.type as { args?: unknown[] } | undefined
                        )?.args?.length;
                        if (arity === undefined)
                            return unsupported(goText`Unknown constructor ${f.name}`);
                        const contents = payload('value', id, n);
                        if (arity === 1) print(contents, v.layout, arm);
                        else
                            for (let k = 0; k < arity; k++) {
                                if (k) arm.push('fmt.Print(",")');
                                print(
                                    dot(contents, `item${k}`),
                                    (layout(v.layout).fields[k] as { layout: string }).layout,
                                    arm,
                                );
                            }
                        arm.push('fmt.Print("]}")');
                        body.push({
                            head: go`${n ? 'else if' : 'if'} value.tag == ${tagValue(id, n)}`,
                            body: arm,
                        });
                    });
                helpers.push({ signature: goText`func ${name}(value ${type(id)})`, body });
            }
            body.push(go`${name}(${expr})`);
        } else {
            unsupported('Entry result requires a supported test layout');
        }
    };

    // Printing unit (including tuples made only of units) observes no result
    // storage. Execute the entry for its effects without introducing a local.
    const printedValue = (id: string): boolean => {
        const l = layout(id);
        return l.kind === 'unit'
            ? false
            : l.kind === 'record'
              ? l.fields.some((f) => f.kind === 'value' && printedValue(f.layout))
              : true;
    };
    const mainBody: Statement[] = [];
    for (const entry of program.entries) {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) {
            unsupported('Function entry requires an explicit host adapter');
        }
        const v = go`result${mainBody.length}`;
        mainBody.push(
            !printedValue(c.body.layout)
                ? callCode(entry, () => 'nil', [])
                : go`${v} := ${callCode(entry, () => 'nil', [])}`,
        );
        // With host output on stdout, a record separator (U+001E) introduces each result.
        if (usesHost(imports)) mainBody.push('fmt.Print("\\x1e")');
        print(v, c.body.layout, mainBody);
        mainBody.push('fmt.Println()');
    }

    if (program.layouts.some((l) => l.kind === 'string')) helpers.push(...goStringRuntime());
    functions.push(...helpers, { signature: 'func main()', body: mainBody });

    return reachableGo({
        packageName: 'main',
        imports: ['fmt', 'math', 'strconv', ...hostImports],
        declarations,
        functions,
    });
}
