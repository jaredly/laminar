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
import { GoNames, functionNames, patternSlots, sourceBinding } from './names.ts';
import { GoLocals } from './locals.ts';

type Completion = (body: Statement[]) => void;
type Lens = { view: View; finish: Completion; stage?: (body: Statement[]) => Completion };
const stage = (lens: Lens, body: Statement[]): Completion =>
    lens.stage ? lens.stage(body) : lens.finish;
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
    const go = (strings: TemplateStringsArray, ...parts: unknown[]) =>
        activeLocals
            ? activeLocals.template(strings, ...parts)
            : strings.reduce((s, piece, i) => s + (i ? String(parts[i - 1]) : '') + piece, '');
    const joinCode = (parts: readonly unknown[], separator = ',') =>
        activeLocals ? activeLocals.join(parts, separator) : parts.join(separator);
    const stringPart = (kind: string, value: string) => {
        const text = goPart(kind, value);
        return activeLocals ? activeLocals.format((v) => goPart(kind, v), value) : text;
    };
    const field = (name: string) =>
        activeLocals ? activeLocals.literal(identifier(name)) : identifier(name);
    verifyConcreteProgram(program);
    // Every import reaching Go must be registered, implemented and available on the target.
    const imports = program.semantic.program.imports
        .map((i) => i.definition)
        .filter((d) => d.startsWith('native/'));
    imports.forEach((d) => requireImport(d, 'go', program.target));
    const hostImports = new Set<string>();

    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const names = new Map(program.layouts.map((l, i) => [l.id, go`L${i}`]));
    const codes = functionNames(program);
    const abiNames = new Map(program.abis.map((a, i) => [a.id, go`A${i}`]));

    const type = (id: string) => names.get(id)!;
    const layout = (id: string) => layouts.get(id)!;
    const unit = program.layouts.find((l) => l.kind === 'unit')!;

    const zero = (id: string): string => {
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
                expression: () => go`(${code(s.expression)}).${field(f.name)}`,
                key: go`${s.key ?? s.expression}.${f.name}`,
                layout: f.layout,
                ...(s.address ? { address: go`&(*${s.address}).${field(f.name)}` } : {}),
            };
        }),
    );

    const read = (data: Data, id: string): string => {
        if (layout(id).kind === 'unit') return zero(id);
        if (!Array.isArray(data) && data.layout === id) return code(data.expression);
        const parts = storage.parts(data);
        const fields = layout(id).fields;
        if (!fields.length || parts.length !== fields.length) {
            return unsupported('Mismatched storage read');
        }
        return go`${type(id)}{${joinCode(
            parts.map(
                (d, i) =>
                    go`${field(fields[i]!.name)}: ${read(
                        d,
                        (fields[i] as { layout: string }).layout,
                    )}`,
            ),
            ', ',
        )}}`;
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

    const incoming = (expression: string, id: string): View => {
        const l = layout(id);
        const f = l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout)
            return storage.own({
                expression: go`*(${expression}).read`,
                layout: f.layout,
                address: go`(${expression}).read`,
            });
        return l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) =>
                incoming(go`(${expression}).${field(f.name)}`, (f as { layout: string }).layout),
            );
    };

    const flush = (expression: string, id: string, data: Data, body: Statement[]) => {
        const l = layout(id);
        const f =
            l.fields.find((f) => f.name === 'replacement') ??
            l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout) {
            body.push(go`*(${expression}).${field(f.name)} = ${read(data, f.layout)}`);
            return;
        }
        const parts = storage.parts(data);
        l.fields
            .filter((f) => f.name.startsWith('item'))
            .forEach((f, i) =>
                flush(
                    go`(${expression}).${field(f.name)}`,
                    (f as { layout: string }).layout,
                    parts[i]!,
                    body,
                ),
            );
    };

    const declarations: string[] = [];
    let helperCounter = 0;

    // Layout type definitions
    for (const l of program.layouts) {
        if (l.kind === 'f64') {
            declarations.push(go`type ${type(l.id)} = float64`);
        } else if (l.kind === 'bool') {
            declarations.push(go`type ${type(l.id)} = bool`);
        } else if (l.kind === 'string') {
            declarations.push(go`type ${type(l.id)} = string`);
        } else if (l.kind === 'unit') {
            declarations.push(go`type ${type(l.id)} struct{}`);
        } else if (l.kind === 'record') {
            const fields = l.fields.map((f) => {
                if (f.kind === 'value') return go`\t${field(f.name)} ${type(f.layout)}`;
                if (f.kind === 'pointer')
                    return go`\t${field(f.name)} ${f.layout ? '*' + type(f.layout) : 'any'}`;
                return go`\t${field(f.name)} ${abiNames.get(f.abi)}`;
            });
            declarations.push(go`type ${type(l.id)} struct {\n${joinCode(fields, '\n')}\n}`);
        } else if (l.kind === 'union') {
            // Tagged union; boxed variants share immutable payloads under Go's GC.
            const variants = l.fields.map((f, n) =>
                f.kind === 'value'
                    ? go`\tv${n} ${type(f.layout)}`
                    : f.kind === 'pointer' && f.layout
                      ? go`\tv${n} *${type(f.layout)}`
                      : unsupported('Union variant requires data storage'),
            );
            declarations.push(
                go`type ${type(l.id)} struct {\n\ttag uint32\n${joinCode(variants, '\n')}\n}`,
            );
        }
    }

    // ABI function types
    for (const a of program.abis) {
        const args = joinCode(
            a.arguments.map((id, i) => go`arg${i} ${type(id)}`),
            ', ',
        );
        declarations.push(
            go`type ${abiNames.get(a.id)} func(environment any${args ? go`, ${args}` : ''}) ${type(a.result)}`,
        );
    }

    const helpers: GoFunction[] = [];
    const variant = (id: string, n: number) => {
        const f = layout(id).fields[n]!;
        if (f.kind === 'code' || !f.layout)
            return unsupported('Union variant requires data storage');
        return { boxed: f.kind === 'pointer', layout: f.layout };
    };
    const tagOf = (id: string, name: string): number => {
        const n = layout(id).fields.findIndex((f) => f.name === name);
        return n < 0 ? unsupported(go`Constructor ${name} is absent from its union layout`) : n;
    };
    // Boxed payloads are never written in place (binding copies them out and
    // construction allocates), so `dup` and moves may share them.
    const payload = (expr: string, id: string, n: number): string =>
        variant(id, n).boxed ? go`(*(${expr}).v${n})` : go`(${expr}).v${n}`;
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
        const name = go`char_list_${type(result)}`;
        charLists.set(result, name);
        const nil = tagOf(result, 'nil'),
            cons = tagOf(result, 'cons'),
            cell = variant(result, cons);
        if (!cell.boxed) return unsupported('List cells must be boxed');
        const text = (layout(cell.layout).fields[0] as { layout: string }).layout;
        helpers.push({
            signature: go`func ${name}(value ${type(text)}) ${type(result)}`,
            body: [
                'starts := []int{}',
                { head: 'for i := range value', body: ['starts = append(starts, i)'] },
                go`out := ${type(result)}{tag: ${nil}}`,
                'end := len(value)',
                {
                    head: 'for n := len(starts) - 1; n >= 0; n--',
                    body: [
                        go`cell := new(${type(cell.layout)})`,
                        go`*cell = ${type(cell.layout)}{item0: value[starts[n]:end], item1: out}`,
                        go`out = ${type(result)}{tag: ${cons}, v${cons}: cell}`,
                        'end = starts[n]',
                    ],
                },
                'return out',
            ],
        });
        return name;
    };

    const hostHelpers = new Set<string>();
    /** Natives that take and return plain data, by registered name. Lens natives are separate. */
    const simpleNative = (op: string, args: string[], result: string): string | undefined => {
        if (['+', '-', '*', '/', '==', '>=', '<='].includes(op))
            return activeLocals
                ? activeLocals.binary(op, args[0]!, args[1]!)
                : go`(${args[0]} ${op} ${args[1]})`;
        if (op === 'charList') return go`${charList(result)}(${args[0]})`;
        if (op === 'heapsize') return activeLocals ? activeLocals.scalar('0.0', 0) : '0.0';
        const helper = (name: string, fn: GoFunction, declaration?: string) => {
            if (!hostHelpers.has(name)) {
                hostHelpers.add(name);
                helpers.push(fn);
                if (declaration) declarations.push(declaration);
            }
            return go`${name}(${args[0]})`;
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
            return helper(go`hostPrint_${type(result)}`, {
                signature: go`func hostPrint_${type(result)}(value string) ${type(result)}`,
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
        const name = go`native${nativeCodes.size}`;
        nativeCodes.set(w.id, name);
        const args = joinCode(
            abi.arguments.map((id, i) => go`, arg${i} ${type(id)}`),
            '',
        );
        const signature = go`func ${name}(environment any${args}) ${type(abi.result)}`;
        const body: Statement[] = [];
        let result: string;
        const op = requireImport(w.definition, 'go').name;
        const simple = simpleNative(
            op,
            abi.arguments.map((_, i) => go`arg${i}`),
            abi.result,
        );
        if (simple !== undefined) result = simple;
        else if (op === 'dup')
            result = read(storage.get(incoming('arg0', abi.arguments[0]!)), abi.result);
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
        } else return unsupported(go`Native import ${w.definition}`);
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
        const signature = go`func ${resultAdapters.get(w.id)}(environment any${args}) ${type(abi.result)}`;

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
                    go`result := ${sourceCode}(environment${joinCode(
                        abi.arguments.map((_, n) => go`, arg${n}`),
                        '',
                    )})`,
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
        const irUnit = program.semantic.program.units.find((u) => u.id === c.unit)!;
        const localNames = new GoNames([
            ...codes.values(),
            'environment',
            'replacement',
            'focus',
            'write',
            'result',
        ]);
        const bindingNames = new Map<string, string>();
        const bindingName = (slot: SlotRef): string | undefined => {
            const binding = sourceBinding(irUnit.bindings, slot);
            if (!binding) return undefined;
            if (!bindingNames.has(binding.id))
                bindingNames.set(binding.id, localNames.source(binding.name));
            return bindingNames.get(binding.id)!;
        };
        const parameterNames = c.parameters.map((p, n) => {
            const slots = patternSlots(p.pattern);
            if (slots.length === 1 && !slots[0]!.path.length) {
                const name = bindingName(slots[0]!);
                if (name) return name;
            }
            const parts = slots
                .map((slot) => sourceBinding(irUnit.bindings, slot)?.name)
                .filter((n): n is string => !!n);
            return localNames.source(parts.length ? joinCode(parts, '_') : go`argument${n}`);
        });
        parameterNames.forEach((name) => locals.reference(name));
        const sourceSlots = c.parameters.flatMap((p) => patternSlots(p.pattern));
        sourceSlots.push(...c.captures.map((p) => ({ place: p.place, path: [] })));
        const producers = new Map<string, ConcreteBlock['instructions'][number]>();
        const localBindings: Extract<ConcreteBlock['instructions'][number], { op: 'bind' }>[] = [];
        const scanNames = (b: ConcreteBlock) => {
            for (const i of b.instructions) {
                if ('out' in i) producers.set(i.out.id, i);
                if (i.op === 'bind') {
                    localBindings.push(i);
                    sourceSlots.push(...patternSlots(i.pattern));
                }
                if (i.op === 'move' || i.op === 'acquire') sourceSlots.push(i.slot);
                if (i.op === 'scope') scanNames(i.body);
                if (i.op === 'manual') scanNames(i.cleanup);
                if (i.op === 'case') i.cases.forEach((a) => scanNames(a.body));
            }
        };
        scanNames(c.body);
        const referencedBindings = new Set(
            sourceSlots.map((slot) => sourceBinding(irUnit.bindings, slot)?.id),
        );
        // Give source declarations their names before allocating any versions or
        // temporaries, including destructured parameters and captured bindings.
        for (const binding of irUnit.bindings)
            if (referencedBindings.has(binding.id) && !bindingNames.has(binding.id))
                bindingNames.set(binding.id, localNames.source(binding.name));
        const preferred = new Map<string, string>();
        const prefer = (id: string, name: string) => {
            const i = producers.get(id);
            if (i?.op === 'scope') prefer(i.body.result, name);
            else if (!preferred.has(id)) preferred.set(id, name);
        };
        for (const i of localBindings) {
            for (const slot of patternSlots(i.pattern)) bindingName(slot);
            if (i.pattern.kind === 'bind') {
                const name = bindingName(i.pattern.slot);
                if (name) prefer(i.value, name);
            }
        }
        const namedVersions = new Set(parameterNames);
        const versionName = (base: string) => {
            if (!namedVersions.has(base)) {
                namedVersions.add(base);
                return base;
            }
            return localNames.unique(base);
        };
        const values = new Map<string, Expression>();
        const constants = new Set<string>();
        const lenses = new Map<string, Lens>();
        const places = new Map<string, View>();
        const loans = new Map<string, Lens>();
        let counter = 0;
        const fresh = () => locals.reference(go`v${counter++}`);

        const declare = (
            id: string,
            expression: string,
            body: Statement[],
            name = fresh(),
        ): string => {
            body.push(locals.declaration(name, type(id), expression));
            return name;
        };

        // Reserve the original sequencing point before a value is demanded. A
        // delayed load still precedes the calls/restoration that followed it in IR.
        const defer = (
            id: string,
            compute: (into: Statement[]) => string,
            body: Statement[],
            name = fresh(),
            pure = false,
            inline = false,
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
                        at.push(locals.declaration(name, type(id), expr, { pure, inline }));
                    }
                    return name;
                },
            };
        };
        const phi = (
            id: string,
            inputs: { data: Data; body: Statement[] }[],
            body: Statement[],
        ): Exclude<Data, Data[]> => {
            const name = fresh();
            return defer(
                id,
                () => {
                    inputs.forEach((input) =>
                        input.body.push(locals.assign(name, read(input.data, id))),
                    );
                    return zero(id);
                },
                body,
                name,
            );
        };

        const parameters: { expression: string; layout: string; view: View }[] = [];
        const setup: Statement[] = [];
        const bind = (p: IRPattern, data: Data, body: Statement[] = setup) => {
            if (p.kind === 'bind') {
                places.set(p.slot.place, storage.own(data));
            } else if (p.kind === 'tuple') {
                p.items.forEach((item, i) => bind(item, storage.parts(data)[i]!, body));
            } else if (p.kind === 'constructor') {
                // Borrowed matches moved their owner out first; reconstruction is explicit IR.
                if (Array.isArray(data)) return unsupported('Constructor pattern over a tuple');
                const n = tagOf(data.layout, p.name),
                    v = variant(data.layout, n);
                const contents: Data = {
                    ...defer(v.layout, () => payload(code(data.expression), data.layout, n), body),
                    layout: v.layout,
                };
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
            } else {
                bind(p.pattern, { expression: parameterNames[i]!, layout: p.layout });
            }
        });

        const flushParameters = (body: Statement[]) =>
            parameters.forEach((p) => flush(p.expression, p.layout, storage.get(p.view), body));

        const matches = (p: IRPattern, expr: Expression, id: string): string => {
            if (p.kind === 'literal')
                return go`${code(expr)} == ${layout(id).kind === 'string' && typeof p.value === 'string' ? goBytes(p.value) : literal(p.value, unit.id)}`;
            const fields = layout(id).fields as { layout: string }[];
            if (p.kind === 'tuple')
                return (
                    joinCode(
                        p.items.map((p, i) =>
                            matches(p, () => go`(${code(expr)}).item${i}`, fields[i]!.layout),
                        ),
                        ' && ',
                    ) || 'true'
                );
            if (p.kind !== 'constructor') return 'true';
            const n = tagOf(id, p.name),
                v = variant(id, n),
                contents = payload(code(expr), id, n);
            const items =
                p.items.length === 1
                    ? [matches(p.items[0]!, contents, v.layout)]
                    : p.items.map((item, k) =>
                          matches(
                              item,
                              go`(${contents}).item${k}`,
                              (layout(v.layout).fields[k] as { layout: string }).layout,
                          ),
                      );
            return joinCode(
                [go`(${code(expr)}).tag == ${n}`, ...items.filter((m) => m !== 'true')],
                ' && ',
            );
        };

        const ref = (s: SlotRef) =>
            storage.project(places.get(s.place) ?? unsupported('Unavailable Go place'), s.path);

        // Adapt input/output backing at calls.
        const adapt = (
            lens: Lens,
            id: string,
            escapes: boolean,
            body: Statement[],
        ): { expression: string; finish: (body: Statement[]) => void } => {
            const index = helperCounter++;
            const name = locals.reference(go`back${index}`);
            locals.mutable(name);
            const fields: string[] = [];
            const init: Statement[] = [];

            const build = (id: string, path: string): string => {
                const l = layout(id);
                const input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const output = l.fields.find((f) => f.name === 'replacement');
                    const d = storage.get(
                        storage.project(lens.view, path ? path.split('.').map(Number) : []),
                    );
                    if (
                        !escapes &&
                        lens.finish === noFinish &&
                        !lens.stage &&
                        !output &&
                        !Array.isArray(d) &&
                        d.layout === input.layout &&
                        d.address
                    )
                        return go`${type(id)}{read: ${d.address}}`;
                    const n = fields.length;
                    const r = go`read${n}`;
                    const w = output ? go`write${n}` : r;
                    fields.push(go`${field(r)} ${type(input.layout)}`);
                    init.push(go`${name}.${field(r)} = ${read(d, input.layout)}`);
                    if (output?.kind === 'pointer' && output.layout) {
                        fields.push(go`${field(w)} ${type(output.layout)}`);
                        init.push(go`${name}.${field(w)} = ${zero(output.layout)}`);
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
            const backingType = go`Backing${index}`;
            declarations.push(
                go`type ${backingType} struct {\n${joinCode(
                    fields.map((f) => go`\t${f}`),
                    '\n',
                )}\n}`,
            );
            body.push(
                locals.declaration(
                    name,
                    (escapes ? '*' : '') + backingType,
                    escapes ? go`new(${backingType})` : go`${backingType}{}`,
                ),
            );
            body.push(...init);

            const arg = declare(id, expression, body);
            const outputs = (expr: string, id: string): Data => {
                const l = layout(id);
                const f =
                    l.fields.find((f) => f.name === 'replacement') ??
                    l.fields.find((f) => f.name === 'read');
                if (f?.kind === 'pointer' && f.layout)
                    return { expression: go`*(${expr}).${field(f.name)}`, layout: f.layout };
                return l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map((f) =>
                        outputs(go`(${expr}).${field(f.name)}`, (f as { layout: string }).layout),
                    );
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
                    body.push(
                        {
                            head: go`if (${name}).restore != nil`,
                            body: [go`(${name}).restore((${name}).context, ${replacement})`],
                        },
                        {
                            head: 'else',
                            body: (() => {
                                const b: Statement[] = [];
                                flush(name, id, storage.get(view), b);
                                return b;
                            })(),
                        },
                    );
                    after(body);
                },
            };
        };

        const literal = (v: unknown, id: string): string => {
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
                if (i.op === 'manual') index(i.cleanup);
                if (i.op === 'case') i.cases.forEach((a) => index(a.body));
            });
        index(c.body);
        const lensSlots = new Map<string, SlotRef>();

        const block = (b: ConcreteBlock, output: Statement[]): Expression => {
            for (const i of b.instructions) {
                const body: Statement[] = [];
                output.push(body);
                // Deferred restoration can lower the same IR block on several
                // edges. Capture operand expressions now, before later edges
                // install another physical version under the same IR value ID.
                const operandIds =
                    i.op === 'bind' || i.op === 'swap' || i.op === 'case'
                        ? [i.value]
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
                if (i.op === 'bind') {
                    bind(
                        i.pattern,
                        {
                            expression: operands.get(i.value)!,
                            key: fresh(),
                            layout: outputLayouts.get(i.value)!,
                        },
                        body,
                    );
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
                const hinted =
                    preferred.get(i.out.id) ??
                    (i.op === 'move'
                        ? bindingName(i.slot)
                        : i.op === 'invoke' &&
                            program.wrappers.find((w) => w.id === i.wrapper)?.kind === 'native'
                          ? (() => {
                                const slot = lensSlots.get(i.args[0]!);
                                return slot && bindingName(slot);
                            })()
                          : undefined);
                const name =
                    hinted &&
                    i.op !== 'constant' &&
                    !(i.op === 'make-callable' && !i.captures.length)
                        ? versionName(hinted)
                        : fresh();
                let expr!: Expression;

                switch (i.op) {
                    case 'constant':
                        expr = literal(i.value, id);
                        constants.add(expr);
                        if (i.value !== null)
                            locals.scalar(
                                expr,
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
                                ].filter((piece) => piece !== '""'),
                                ' + ',
                            ) || '""';
                        break;
                    case 'construct': {
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
                                const box = fresh();
                                construction.push(
                                    locals.declaration(
                                        box,
                                        go`*${type(v.layout)}`,
                                        go`new(${type(v.layout)})`,
                                    ),
                                );
                                construction.push(go`*${box} = ${contents}`);
                                contents = box;
                            }
                            return go`${type(id)}{tag: ${n}, v${n}: ${contents}}`;
                        };
                        break;
                    }
                    case 'tuple': {
                        expr = () => {
                            const l = layout(id);
                            if (!l.fields.length) {
                                return go`${type(id)}{}`;
                            } else {
                                const fieldInits = i.items.map(
                                    (it, idx) => go`${field(l.fields[idx]!.name)}: ${value(it)}`,
                                );
                                return go`${type(id)}{${joinCode(fieldInits, ', ')}}`;
                            }
                        };
                        break;
                    }
                    case 'move': {
                        const contents = storage.get(ref(i.slot));
                        expr = () => read(contents, id);
                        storage.put(ref(i.slot), { expression: zero(unit.id), layout: unit.id });
                        break;
                    }
                    case 'acquire':
                        lensSlots.set(i.out.id, i.slot);
                        lenses.set(i.out.id, { view: ref(i.slot), finish: noFinish });
                        continue;
                    case 'lens-tuple':
                        if (
                            i.items.every(
                                (v) => lenses.get(v)!.finish === noFinish && !lenses.get(v)!.stage,
                            )
                        ) {
                            lenses.set(i.out.id, {
                                view: i.items.map((v) => lenses.get(v)!.view),
                                finish: noFinish,
                            });
                            continue;
                        }
                        lenses.set(i.out.id, {
                            view: i.items.map((v) => lenses.get(v)!.view),
                            stage: (body) => {
                                const completions = i.items.map((v) => stage(lenses.get(v)!, body));
                                return (body) => completions.forEach((complete) => complete(body));
                            },
                            finish: (body) => i.items.forEach((v) => lenses.get(v)!.finish(body)),
                        });
                        continue;
                    case 'swap': {
                        const lens = lenses.get(i.lens)!;
                        const contents = storage.get(lens.view);
                        const old = defer(id, () => read(contents, id), body, name);
                        storage.put(lens.view, {
                            expression: operands.get(i.value)!,
                            key: fresh(),
                            layout: outputLayouts.get(i.value)!,
                        });
                        lens.finish(body);
                        values.set(i.out.id, old.expression);
                        continue;
                    }
                    case 'scope': {
                        const result = block(i.body, body);
                        if (lenses.has(i.body.result)) {
                            lenses.set(i.out.id, lenses.get(i.body.result)!);
                            continue;
                        }
                        values.set(i.out.id, result);
                        continue;
                    }
                    case 'make-callable': {
                        const callable = program.callables.find((cb) => cb.id === i.callable)!;
                        const entries = joinCode(
                            callable.entries.map((e) => {
                                const w = program.wrappers.find((w) => w.id === e.wrapper)!;
                                if (w.kind === 'invoke') {
                                    return go`, ${field(e.field)}: ${codes.get(w.code)}`;
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
                        if (!i.captures.length && !entries) {
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
                            ].includes(requireImport(w.definition, 'go').name)
                        ) {
                            values.set(
                                i.out.id,
                                defer(
                                    id,
                                    (at) => {
                                        const args = i.args.map((v) => {
                                            const expr = value(v);
                                            return constants.has(expr)
                                                ? declare(outputLayouts.get(v)!, expr, at)
                                                : expr;
                                        });
                                        return (
                                            simpleNative(
                                                requireImport(w.definition, 'go').name,
                                                args,
                                                id,
                                            ) ?? unsupported(go`Native import ${w.definition}`)
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
                        let args: string[] = [];
                        if (w?.kind === 'native' && w.definition === 'native/dup') {
                            const lens = lenses.get(i.args[0]!)!;
                            const contents = storage.get(lens.view);
                            expr = () => read(contents, id);
                            adapters.push({ finish: lens.finish });
                        } else if (w?.kind === 'native' && w.definition === 'native/fst') {
                            const parent = lenses.get(i.args[0]!)!;
                            lenses.set(i.out.id, {
                                view: storage.project(parent.view, [0]),
                                finish: parent.finish,
                                stage: parent.stage,
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
                                            unsupported(go`Direct ${w.kind} call`));
                                expr = direct
                                    ? go`${direct}(${w.kind === 'invoke' && !program.code.find((c) => c.id === w.code)!.captures.length ? 'nil' : go`(${value(i.callee)}).environment`}${joinCode(
                                          args.map((a) => go`, ${a}`),
                                          '',
                                      )})`
                                    : go`(${value(i.callee)}).${field(i.field!)}((${value(i.callee)}).environment${joinCode(
                                          args.map((a) => go`, ${a}`),
                                          '',
                                      )})`;
                            } else if (w?.kind === 'native') {
                                expr =
                                    simpleNative(
                                        requireImport(w.definition, 'go').name,
                                        args,
                                        id,
                                    ) ?? unsupported(go`Native import ${w.definition}`);
                            } else {
                                return unsupported(go`Wrapper kind ${w?.kind}`);
                            }
                        }
                        if (w?.kind === 'native' && w.definition === 'native/dup') {
                            values.set(
                                i.out.id,
                                layout(id).kind === 'unit'
                                    ? zero(id)
                                    : defer(id, () => code(expr), body, name).expression,
                            );
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
                            lenses.set(
                                i.out.id,
                                runtimeLens(name, id, (body) =>
                                    adapters.forEach((a) => a.finish(body)),
                                ),
                            );
                        } else {
                            adapters.forEach((a) => a.finish(body));
                        }
                        continue;
                    }
                    case 'manual': {
                        const frontend = lenses.get(i.lens)!;
                        const manual: Lens = {
                            view: frontend.view,
                            stage: (output) => {
                                const complete = stage(frontend, output);
                                return (output) => {
                                    block(i.cleanup, output);
                                    complete(output);
                                };
                            },
                            finish: (output) => stage(manual, output)(output),
                        };
                        lenses.set(i.out.id, manual);
                        continue;
                    }
                    case 'case': {
                        if (i.lensJoin) {
                            const before = storage.snapshot();
                            const selected = fresh();
                            body.push(locals.declaration(selected, 'int', '0'));
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
                                bind(
                                    arm.pattern,
                                    {
                                        expression: operands.get(i.value)!,
                                        key: fresh(),
                                        layout: outputLayouts.get(i.value)!,
                                    },
                                    nested,
                                );
                                block(arm.body, nested);
                                normalize(arm.setup, nested);
                                const lens = lenses.get(arm.body.result)!;
                                nested.push(locals.assign(selected, String(n)));
                                focusInputs.push({ data: storage.get(lens.view), body: nested });
                                return {
                                    nested,
                                    state: storage.snapshot(),
                                    lens,
                                    arm,
                                };
                            });
                            storage.reset(before);
                            merge(arms, body);
                            i.cases.forEach((arm, n) =>
                                body.push({
                                    head: go`${n ? 'else if' : 'if'} (${matches(arm.pattern, operands.get(i.value)!, outputLayouts.get(i.value)!)})`,
                                    body: arms[n]!.nested,
                                }),
                            );
                            body.push({ head: 'else', body: ['panic("unmatched case")'] });
                            lenses.set(i.out.id, {
                                view: joined,
                                stage: (output) => {
                                    // Commit only the selected frontend and merge its visible owner
                                    // versions before manual cleanup reads lexical dependencies.
                                    const current = storage.snapshot();
                                    const replacement = storage.get(joined);
                                    const staged = arms.map((arm) => {
                                        storage.reset(arm.state);
                                        before.forEach(
                                            (_, cell) => (cell.data = current.get(cell)!),
                                        );
                                        storage.put(arm.lens.view, replacement);
                                        const nested: Statement[] = [];
                                        const complete = stage(arm.lens, nested);
                                        return {
                                            nested,
                                            complete,
                                            state: storage.snapshot(),
                                            arm,
                                        };
                                    });
                                    storage.reset(current);
                                    merge(staged, output);
                                    staged.forEach((arm, n) =>
                                        output.push({
                                            head: go`${n ? 'else if' : 'if'} (${selected} == ${n})`,
                                            body: arm.nested,
                                        }),
                                    );
                                    output.push({
                                        head: 'else',
                                        body: ['panic("unmatched case")'],
                                    });
                                    return (output) => {
                                        // Cleanup may have changed those owners again. Preserve its
                                        // versions while completing the original selected restoration.
                                        const cleaned = storage.snapshot();
                                        const restored = staged.map((entry) => {
                                            storage.reset(entry.state);
                                            before.forEach(
                                                (_, cell) => (cell.data = cleaned.get(cell)!),
                                            );
                                            const nested: Statement[] = [];
                                            entry.complete(nested);
                                            normalize(entry.arm.arm.restored, nested);
                                            return { nested, state: storage.snapshot() };
                                        });
                                        storage.reset(cleaned);
                                        merge(restored, output);
                                        restored.forEach((arm, n) =>
                                            output.push({
                                                head: go`${n ? 'else if' : 'if'} (${selected} == ${n})`,
                                                body: arm.nested,
                                            }),
                                        );
                                        output.push({
                                            head: 'else',
                                            body: ['panic("unmatched case")'],
                                        });
                                    };
                                },
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
                                    restored.forEach((arm, n) =>
                                        output.push({
                                            head: go`${n ? 'else if' : 'if'} (${selected} == ${n})`,
                                            body: arm.nested,
                                        }),
                                    );
                                    output.push({
                                        head: 'else',
                                        body: ['panic("unmatched case")'],
                                    });
                                },
                            });
                            continue;
                        }
                        const resultInputs: { data: Data; body: Statement[] }[] = [];
                        const resultData = phi(id, resultInputs, body);
                        const before = storage.snapshot();
                        const arms = i.cases.map((arm, armIndex) => {
                            storage.reset(before);
                            const nested: Statement[] = [];
                            bind(
                                arm.pattern,
                                {
                                    expression: operands.get(i.value)!,
                                    key: fresh(),
                                    layout: outputLayouts.get(i.value)!,
                                },
                                nested,
                            );
                            const result = block(arm.body, nested);
                            resultInputs.push({
                                data: { expression: result, layout: id, key: arm.body.result },
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
                        i.cases.forEach((arm, n) =>
                            body.push({
                                head: go`${n ? 'else if' : 'if'} ${matches(arm.pattern, operands.get(i.value)!, outputLayouts.get(i.value)!)}`,
                                body: arms[n]!.nested,
                            }),
                        );
                        body.push({ head: 'else', body: ['panic("unmatched case")'] });
                        values.set(i.out.id, resultData.expression);
                        continue;
                    }
                    default:
                        return unsupported(go`Unknown operation ${(i as { op: string }).op}`);
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
            }

            const body = output;
            const finish = (body: Statement[]) =>
                b.cleanup.forEach((cl) => {
                    if (cl.kind === 'release') {
                        const lens = loans.get(cl.loan);
                        if (lens) lens.finish(body);
                    } else if (cl.kind === 'drop-place') {
                        storage.put(ref(cl.slot), { expression: zero(unit.id), layout: unit.id });
                    }
                });

            if (lenses.has(b.result)) {
                const lens = lenses.get(b.result)!;
                lenses.set(b.result, {
                    view: lens.view,
                    stage: (body) => {
                        const complete = stage(lens, body);
                        return (body) => {
                            complete(body);
                            finish(body);
                        };
                    },
                    finish: (body) => {
                        lens.finish(body);
                        finish(body);
                    },
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
        if (lenses.has(c.body.result)) {
            const lens = lenses.get(c.body.result)!;
            const build = (view: View, id: string): string => {
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
            const out = declare(c.body.layout, build(lens.view, c.body.layout), body);
            locals.mutable(out);
            const replacement = endpoint(c.body.layout, 'replacement');
            storage.put(lens.view, { expression: 'replacement', layout: replacement });
            const cleanup: Statement[] = [];
            lens.finish(cleanup);
            flushParameters(cleanup);
            body.push(
                {
                    head: go`${out}.restore = func(_ any, replacement ${type(replacement)}) ${type(unit.id)}`,
                    body: [...cleanup, go`return ${zero(unit.id)}`],
                },
                locals.returnValue(out),
            );
        } else {
            flushParameters(body);
            body.push(locals.returnValue(code(result)));
        }

        const sig = go`func ${codes.get(c.id)}(environment any${joinCode(
            c.parameters.map((p, i) => go`, ${parameterNames[i]} ${type(p.layout)}`),
            '',
        )}) ${type(c.body.layout)}`;
        const placed = locals.place(body);
        activeLocals = undefined;
        return { signature: sig, body: placed };
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
    const print = (expr: string, id: string, body: Statement[]) => {
        const l = layout(id);
        if (l.kind === 'f64') {
            body.push(go`printNumber(${expr})`);
        } else if (l.kind === 'bool') {
            body.push(go`if ${expr} { fmt.Print("true") } else { fmt.Print("false") }`);
        } else if (l.kind === 'unit') {
            body.push('fmt.Print("null")');
        } else if (l.kind === 'string') {
            body.push(go`printString(${expr})`);
        } else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
            body.push('fmt.Print("[")');
            l.fields.forEach((f, i) => {
                if (i) body.push('fmt.Print(",")');
                print(go`(${expr}).${field(f.name)}`, (f as { layout: string }).layout, body);
            });
            body.push('fmt.Print("]")');
        } else if (l.kind === 'union') {
            const name = go`print_${type(id)}`;
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
                        { head: 'for value.tag == 1', body: loop },
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
                                (s) => s.definition === go`constructor/${f.name}`,
                            )?.type as { args?: unknown[] } | undefined
                        )?.args?.length;
                        if (arity === undefined)
                            return unsupported(go`Unknown constructor ${f.name}`);
                        const contents = payload('value', id, n);
                        if (arity === 1) print(contents, v.layout, arm);
                        else
                            for (let k = 0; k < arity; k++) {
                                if (k) arm.push('fmt.Print(",")');
                                print(
                                    go`(${contents}).item${k}`,
                                    (layout(v.layout).fields[k] as { layout: string }).layout,
                                    arm,
                                );
                            }
                        arm.push('fmt.Print("]}")');
                        body.push({
                            head: go`${n ? 'else if' : 'if'} value.tag == ${n}`,
                            body: arm,
                        });
                    });
                helpers.push({ signature: go`func ${name}(value ${type(id)})`, body });
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
                ? go`${codes.get(entry)}(nil)`
                : go`${v} := ${codes.get(entry)}(nil)`,
        );
        // With host output on stdout, a record separator (U+001E) introduces each result.
        if (usesHost(imports)) mainBody.push('fmt.Print("\\x1e")');
        print(v, c.body.layout, mainBody);
        mainBody.push('fmt.Println()');
    }

    if (program.layouts.some((l) => l.kind === 'string')) helpers.push(...goStringRuntime());
    functions.push(...helpers, { signature: 'func main()', body: mainBody });

    return {
        packageName: 'main',
        imports: ['fmt', 'math', 'strconv', ...hostImports],
        declarations,
        functions,
    };
}
