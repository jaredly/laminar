import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import { Storage, type Data, type View } from './storage.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import {
    printGoStatements,
    identifier,
    type Statement,
    type GoFile,
    type GoFunction,
} from './syntax.ts';

type Completion = (body: Statement[]) => void;
type Lens = { view: View; finish: Completion; stage?: (body: Statement[]) => Completion };
const stage = (lens: Lens, body: Statement[]): Completion =>
    lens.stage ? lens.stage(body) : lens.finish;
const noFinish = (_body: Statement[]) => {};

type Variable = { name: string; type: string };

const unsupported = (message: string): never => {
    throw new BackendDiagnostic('unsupported-go', message);
};

/** Lower ConcreteProgram to Go syntax tree. */
export function lowerGo(program: ConcreteProgram): GoFile {
    verifyConcreteProgram(program);

    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const names = new Map(program.layouts.map((l, i) => [l.id, `L${i}`]));
    const codes = new Map(program.code.map((c, i) => [c.id, `fn${i}`]));
    const abiNames = new Map(program.abis.map((a, i) => [a.id, `A${i}`]));

    const type = (id: string) => names.get(id)!;
    const layout = (id: string) => layouts.get(id)!;
    const unit = program.layouts.find((l) => l.kind === 'unit')!;

    const zero = (id: string): string => {
        const l = layout(id);
        if (l.kind === 'f64') return '0.0';
        if (l.kind === 'bool') return 'false';
        return `${type(id)}{}`;
    };

    const storage = new Storage((s) =>
        layout(s.layout).fields.map((f, i) => {
            if (f.kind !== 'value' || !f.name.startsWith('item')) {
                return unsupported('Non-data projection');
            }
            return { expression: `(${s.expression}).${identifier(f.name)}`, layout: f.layout };
        }),
    );

    const read = (data: Data, id: string): string => {
        if (layout(id).kind === 'unit') return zero(id);
        if (!Array.isArray(data) && data.layout === id) return data.expression;
        const parts = storage.parts(data);
        const fields = layout(id).fields;
        if (!fields.length || parts.length !== fields.length) {
            return unsupported('Mismatched storage read');
        }
        return `${type(id)}{${parts
            .map(
                (d, i) =>
                    `${identifier(fields[i]!.name)}: ${read(
                        d,
                        (fields[i] as { layout: string }).layout,
                    )}`,
            )
            .join(', ')}}`;
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
            return storage.own({ expression: `*(${expression}).read`, layout: f.layout });
        return l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) =>
                incoming(`(${expression}).${identifier(f.name)}`, (f as { layout: string }).layout),
            );
    };

    const flush = (expression: string, id: string, data: Data, body: Statement[]) => {
        const l = layout(id);
        const f =
            l.fields.find((f) => f.name === 'replacement') ??
            l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout) {
            body.push(`*(${expression}).${identifier(f.name)} = ${read(data, f.layout)}`);
            return;
        }
        const parts = storage.parts(data);
        l.fields
            .filter((f) => f.name.startsWith('item'))
            .forEach((f, i) =>
                flush(
                    `(${expression}).${identifier(f.name)}`,
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
            declarations.push(`type ${type(l.id)} = float64`);
        } else if (l.kind === 'bool') {
            declarations.push(`type ${type(l.id)} = bool`);
        } else if (l.kind === 'unit') {
            declarations.push(`type ${type(l.id)} struct{}`);
        } else if (l.kind === 'record') {
            const fields = l.fields.map((f) => {
                if (f.kind === 'value') return `\t${identifier(f.name)} ${type(f.layout)}`;
                if (f.kind === 'pointer')
                    return `\t${identifier(f.name)} ${f.layout ? '*' + type(f.layout) : 'any'}`;
                return `\t${identifier(f.name)} ${abiNames.get(f.abi)}`;
            });
            declarations.push(`type ${type(l.id)} struct {\n${fields.join('\n')}\n}`);
        } else if (l.kind === 'union') {
            // Tagged union; boxed variants share immutable payloads under Go's GC.
            const variants = l.fields.map((f, n) =>
                f.kind === 'value'
                    ? `\tv${n} ${type(f.layout)}`
                    : f.kind === 'pointer' && f.layout
                      ? `\tv${n} *${type(f.layout)}`
                      : unsupported('Union variant requires data storage'),
            );
            declarations.push(
                `type ${type(l.id)} struct {\n\ttag uint32\n${variants.join('\n')}\n}`,
            );
        }
    }

    // ABI function types
    for (const a of program.abis) {
        const args = a.arguments.map((id, i) => `arg${i} ${type(id)}`).join(', ');
        declarations.push(
            `type ${abiNames.get(a.id)} func(environment any${args ? `, ${args}` : ''}) ${type(a.result)}`,
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
        return n < 0 ? unsupported(`Constructor ${name} is absent from its union layout`) : n;
    };
    // Boxed payloads are never written in place (binding copies them out and
    // construction allocates), so `dup` and moves may share them.
    const payload = (expr: string, id: string, n: number): string =>
        variant(id, n).boxed ? `(*(${expr}).v${n})` : `(${expr}).v${n}`;
    const nativeEntries = new Set([
        ...program.callables
            .filter((c) => c.descriptor.kind === 'native')
            .flatMap((c) => c.entries.map((e) => e.wrapper)),
        ...program.wrappers.flatMap((w) => ('source' in w ? [w.source] : [])),
    ]);
    const nativeCodes = new Map<string, string>();

    for (const w of program.wrappers) {
        if (w.kind !== 'native' || !nativeEntries.has(w.id)) continue;
        const abi = program.abis.find((a) => a.id === w.abi)!;
        const name = `native${nativeCodes.size}`;
        nativeCodes.set(w.id, name);
        const args = abi.arguments.map((id, i) => `, arg${i} ${type(id)}`).join('');
        const signature = `func ${name}(environment any${args}) ${type(abi.result)}`;
        const body: Statement[] = [
            '_ = environment',
            ...abi.arguments.map((_, i) => `_ = arg${i}`),
        ];
        let result: string;
        const op = w.definition.slice(7);
        if (['+', '-', '*', '/', '==', '>=', '<='].includes(op)) {
            result = `(arg0 ${op} arg1)`;
        } else if (op === 'dup')
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
                            body.push(`arg0.replacement.${f.name} = arg0.read.${f.name}`),
                        );
                }
                result = `${type(abi.result)}{read: &arg0.read.item0${output.fields.some((f) => f.name === 'replacement') ? `, replacement: &arg0.${replacement ? 'replacement' : 'read'}.item0` : ''}}`;
            } else result = 'arg0.item0';
        } else return unsupported(`Native import ${w.definition}`);
        body.push(`return ${result}`);
        helpers.push({ signature, body });
    }

    const resultAdapters = new Map(
        program.wrappers
            .filter((w) => w.kind === 'adapt-lens-result')
            .map((w, n) => [w.id, `result_adapter${n}`]),
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
        const args = abi.arguments.map((id, n) => `, arg${n} ${type(id)}`).join('');
        const signature = `func ${resultAdapters.get(w.id)}(environment any${args}) ${type(abi.result)}`;

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
                    `result := ${sourceCode}(environment${abi.arguments.map((_, n) => `, arg${n}`).join('')})`,
                    `focus := ${read(storage.get(incoming('result', raw.result)), input)}`,
                    ...(separate ? [`var write ${type(replacement)}`] : []),
                    `return ${type(abi.result)}{read: &focus${separate ? ', replacement: &write' : ''}, restore: func(_ any, replacement ${type(replacement)}) ${type(unit.id)} {\n${printGoStatements([{ head: 'if result.restore != nil', body: ['result.restore(result.context, replacement)'] }, { head: 'else', body: fallback }, `return ${zero(unit.id)}`], 1).join('\n')}\n}}`,
                ],
            });
        }
    }

    const functions: GoFunction[] = program.code.map((c) => {
        const values = new Map<string, string>();
        const lenses = new Map<string, Lens>();
        const places = new Map<string, View>();
        const loans = new Map<string, Lens>();
        let counter = 0;
        const fresh = () => `v${counter++}`;
        const variables: Variable[] = c.parameters.map((p, i) => ({
            name: `arg${i}`,
            type: type(p.layout),
        }));

        const declare = (
            id: string,
            expression: string,
            body: Statement[],
            name = fresh(),
        ): string => {
            variables.push({ name, type: type(id) });
            body.push(`${name} = ${expression}`);
            body.push(`_ = ${name}`);
            return name;
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
                    expression: declare(v.layout, payload(data.expression, data.layout, n), body),
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
                const view = incoming(`arg${i}`, p.layout);
                places.set(p.lensPlace, view);
                parameters.push({ expression: `arg${i}`, layout: p.layout, view });
            } else {
                bind(p.pattern, { expression: `arg${i}`, layout: p.layout });
            }
        });

        const flushParameters = (body: Statement[]) =>
            parameters.forEach((p) => flush(p.expression, p.layout, storage.get(p.view), body));

        const matches = (p: IRPattern, expr: string, id: string): string => {
            if (p.kind === 'literal') return `${expr} == ${literal(p.value, unit.id)}`;
            const fields = layout(id).fields as { layout: string }[];
            if (p.kind === 'tuple')
                return (
                    p.items
                        .map((p, i) => matches(p, `(${expr}).item${i}`, fields[i]!.layout))
                        .join(' && ') || 'true'
                );
            if (p.kind !== 'constructor') return 'true';
            const n = tagOf(id, p.name),
                v = variant(id, n),
                contents = payload(expr, id, n);
            const items =
                p.items.length === 1
                    ? [matches(p.items[0]!, contents, v.layout)]
                    : p.items.map((item, k) =>
                          matches(
                              item,
                              `(${contents}).item${k}`,
                              (layout(v.layout).fields[k] as { layout: string }).layout,
                          ),
                      );
            return [`(${expr}).tag == ${n}`, ...items.filter((m) => m !== 'true')].join(' && ');
        };

        const ref = (s: SlotRef) =>
            storage.project(places.get(s.place) ?? unsupported('Unavailable Go place'), s.path);

        const value = (id: string) => values.get(id) ?? unsupported('Missing value in Go lowering');

        // Adapt input/output backing at calls.
        const adapt = (
            lens: Lens,
            id: string,
            escapes: boolean,
            body: Statement[],
        ): { expression: string; finish: (body: Statement[]) => void } => {
            const index = helperCounter++;
            const name = `back${index}`;
            const fields: string[] = [];
            const init: Statement[] = [];

            const build = (id: string, path: string): string => {
                const l = layout(id);
                const input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const output = l.fields.find((f) => f.name === 'replacement');
                    const n = fields.length;
                    const r = `read${n}`;
                    const w = output ? `write${n}` : r;
                    fields.push(`${r} ${type(input.layout)}`);
                    const d = storage.get(
                        storage.project(lens.view, path ? path.split('.').map(Number) : []),
                    );
                    init.push(`${name}.${r} = ${read(d, input.layout)}`);
                    if (output?.kind === 'pointer' && output.layout) {
                        fields.push(`${w} ${type(output.layout)}`);
                        init.push(`${name}.${w} = ${zero(output.layout)}`);
                    }
                    return `${type(id)}{read: &${name}.${r}${output ? `, replacement: &${name}.${w}` : ''}}`;
                }
                return `${type(id)}{${l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map(
                        (f, i) =>
                            `${identifier(f.name)}: ${build((f as { layout: string }).layout, path ? path + '.' + i : String(i))}`,
                    )
                    .join(', ')}}`;
            };

            const expression = build(id, '');
            const backingType = `Backing${index}`;
            declarations.push(
                `type ${backingType} struct {\n${fields.map((f) => `\t${f}`).join('\n')}\n}`,
            );
            variables.push({ name, type: (escapes ? '*' : '') + backingType });
            if (escapes) {
                body.push(`${name} = new(${backingType})`);
            } else {
                body.push(`${name} = ${backingType}{}`);
            }
            body.push(`_ = ${name}`);
            body.push(...init);

            const arg = declare(id, expression, body);
            const outputs = (expr: string, id: string): Data => {
                const l = layout(id);
                const f =
                    l.fields.find((f) => f.name === 'replacement') ??
                    l.fields.find((f) => f.name === 'read');
                if (f?.kind === 'pointer' && f.layout)
                    return { expression: `*(${expr}).${identifier(f.name)}`, layout: f.layout };
                return l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map((f) =>
                        outputs(
                            `(${expr}).${identifier(f.name)}`,
                            (f as { layout: string }).layout,
                        ),
                    );
            };

            return {
                expression: arg,
                finish: (body) => {
                    const result = declare(
                        endpoint(id, 'replacement'),
                        read(outputs(arg, id), endpoint(id, 'replacement')),
                        body,
                    );
                    storage.put(lens.view, {
                        expression: result,
                        layout: endpoint(id, 'replacement'),
                    });
                    lens.finish(body);
                    body.push(`_ = ${name}`);
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
                            head: `if (${name}).restore != nil`,
                            body: [`(${name}).restore((${name}).context, ${replacement})`],
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
                return s.includes('.') || s.includes('e') || s.includes('E') ? s : `${s}.0`;
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

        const block = (b: ConcreteBlock, body: Statement[]): string => {
            for (const i of b.instructions) {
                if (i.op === 'bind') {
                    bind(
                        i.pattern,
                        {
                            expression: value(i.value),
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
                const name = fresh();
                let expr!: string;

                switch (i.op) {
                    case 'constant':
                        expr = literal(i.value, id);
                        break;
                    case 'construct': {
                        const n = tagOf(id, i.name),
                            v = variant(id, n),
                            l = layout(v.layout);
                        let contents =
                            i.items.length === 0
                                ? zero(v.layout)
                                : i.items.length === 1
                                  ? value(i.items[0]!)
                                  : `${type(v.layout)}{${i.items.map((it, k) => `${identifier(l.fields[k]!.name)}: ${value(it)}`).join(', ')}}`;
                        if (v.boxed) {
                            const box = fresh();
                            variables.push({ name: box, type: `*${type(v.layout)}` });
                            body.push(`${box} = new(${type(v.layout)})`, `*${box} = ${contents}`);
                            contents = box;
                        }
                        expr = `${type(id)}{tag: ${n}, v${n}: ${contents}}`;
                        break;
                    }
                    case 'tuple': {
                        const l = layout(id);
                        if (!l.fields.length) {
                            expr = `${type(id)}{}`;
                        } else {
                            const fieldInits = i.items.map(
                                (it, idx) => `${identifier(l.fields[idx]!.name)}: ${value(it)}`,
                            );
                            expr = `${type(id)}{${fieldInits.join(', ')}}`;
                        }
                        break;
                    }
                    case 'move':
                        expr = read(storage.get(ref(i.slot)), id);
                        storage.put(ref(i.slot), { expression: zero(unit.id), layout: unit.id });
                        break;
                    case 'acquire':
                        lenses.set(i.out.id, { view: ref(i.slot), finish: noFinish });
                        continue;
                    case 'lens-tuple':
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
                        expr = read(storage.get(lens.view), id);
                        declare(id, expr, body, name);
                        storage.put(lens.view, {
                            expression: value(i.value),
                            layout: outputLayouts.get(i.value)!,
                        });
                        lens.finish(body);
                        values.set(i.out.id, name);
                        continue;
                    }
                    case 'scope': {
                        const result = block(i.body, body);
                        if (lenses.has(i.body.result)) {
                            lenses.set(i.out.id, lenses.get(i.body.result)!);
                            continue;
                        }
                        expr = result;
                        break;
                    }
                    case 'make-callable': {
                        const callable = program.callables.find((cb) => cb.id === i.callable)!;
                        const entries = callable.entries
                            .map((e) => {
                                const w = program.wrappers.find((w) => w.id === e.wrapper)!;
                                if (w.kind === 'invoke') {
                                    return `, ${identifier(e.field)}: ${codes.get(w.code)}`;
                                }
                                if (w.kind === 'adapt-lens-result') {
                                    return `, ${identifier(e.field)}: ${resultAdapters.get(w.id)}`;
                                }
                                if (w.kind === 'native' && nativeCodes.has(w.id)) {
                                    return `, ${identifier(e.field)}: ${nativeCodes.get(w.id)}`;
                                }
                                return '';
                            })
                            .join('');
                        if (!i.captures.length && !entries) {
                            values.set(i.out.id, zero(id));
                            continue;
                        }
                        if (!i.captures.length) {
                            expr = `${type(id)}{environment: nil${entries}}`;
                            break;
                        }
                        expr = `${type(id)}{environment: &${type(callable.environment)}{${i.captures.map((c, n) => `capture${n}: ${value(c.value)}`).join(', ')} }${entries}}`;
                        break;
                    }
                    case 'invoke': {
                        const w = program.wrappers.find((w) => w.id === i.wrapper)!;
                        const abi = program.abis.find((a) => a.id === i.abi)!;
                        const isLens = layout(id).fields.some((f) => f.name === 'restore');
                        const adapters: { finish: (body: Statement[]) => void }[] = [];
                        let args: string[] = [];
                        if (w?.kind === 'native' && w.definition === 'native/dup') {
                            const lens = lenses.get(i.args[0]!)!;
                            expr = read(storage.get(lens.view), id);
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
                                            unsupported(`Direct ${w.kind} call`));
                                expr = direct
                                    ? `${direct}((${value(i.callee)}).environment${args.map((a) => `, ${a}`).join('')})`
                                    : `(${value(i.callee)}).${identifier(i.field!)}((${value(i.callee)}).environment${args.map((a) => `, ${a}`).join('')})`;
                            } else if (w?.kind === 'native') {
                                const op = w.definition.slice(7);
                                if (['+', '-', '*', '/', '==', '>=', '<='].includes(op)) {
                                    expr = `(${args[0]} ${op} ${args[1]})`;
                                } else {
                                    return unsupported(`Native import ${w.definition}`);
                                }
                            } else {
                                return unsupported(`Wrapper kind ${w?.kind}`);
                            }
                        }
                        declare(id, expr, body, name);
                        values.set(i.out.id, name);
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
                            variables.push({ name: selected, type: 'int' });
                            body.push(`${selected} = 0`);
                            const input = endpoint(id, 'read');
                            const focus = declare(input, zero(input), body);
                            const joined = storage.own({ expression: focus, layout: input });
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
                                        const phi = declare(first.layout, zero(first.layout), into);
                                        arms.forEach((arm, n) =>
                                            arm.nested.push(
                                                `${phi} = ${read(data[n]!, first.layout)};`,
                                            ),
                                        );
                                        return { expression: phi, layout: first.layout };
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
                                        expression: value(i.value),
                                        layout: outputLayouts.get(i.value)!,
                                    },
                                    nested,
                                );
                                block(arm.body, nested);
                                normalize(arm.setup, nested);
                                const lens = lenses.get(arm.body.result)!;
                                nested.push(
                                    `${selected} = ${n};`,
                                    `${focus} = ${read(storage.get(lens.view), input)};`,
                                );
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
                                    head: `${n ? 'else if' : 'if'} (${matches(arm.pattern, value(i.value), outputLayouts.get(i.value)!)})`,
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
                                            head: `${n ? 'else if' : 'if'} (${selected} == ${n})`,
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
                                                head: `${n ? 'else if' : 'if'} (${selected} == ${n})`,
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
                                            head: `${n ? 'else if' : 'if'} (${selected} == ${n})`,
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
                        declare(id, zero(id), body, name);
                        const before = storage.snapshot();
                        const arms = i.cases.map((arm, armIndex) => {
                            storage.reset(before);
                            const nested: Statement[] = [];
                            bind(
                                arm.pattern,
                                {
                                    expression: value(i.value),
                                    layout: outputLayouts.get(i.value)!,
                                },
                                nested,
                            );
                            const result = block(arm.body, nested);
                            nested.push(`${name} = ${result}`);
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
                                const phi = fresh();
                                declare(first.layout, zero(first.layout), body, phi);
                                arms.forEach((arm, n) =>
                                    arm.nested.push(`${phi} = ${read(data[n]!, first.layout)}`),
                                );
                                return { expression: phi, layout: first.layout };
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
                                head: `${n ? 'else if' : 'if'} ${matches(arm.pattern, value(i.value), outputLayouts.get(i.value)!)}`,
                                body: arms[n]!.nested,
                            }),
                        );
                        body.push({ head: 'else', body: ['panic("unmatched case")'] });
                        values.set(i.out.id, name);
                        continue;
                    }
                    default:
                        return unsupported(`Operation ${i.op} requires a later backend phase`);
                }

                declare(id, expr, body, name);
                values.set(i.out.id, name);
            }

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
            return value(b.result);
        };

        const body: Statement[] = [
            '_ = environment',
            ...c.parameters.map((_, i) => `_ = arg${i}`),
            ...setup,
        ];

        c.captures.forEach((capture, n) => {
            const name = declare(
                capture.layout,
                `environment.(*${type(c.environment)}).capture${n}`,
                body,
            );
            places.set(capture.place, storage.own({ expression: name, layout: capture.layout }));
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
                    return `${type(id)}{read: &${name}${write ? `, replacement: &${write}` : ''}}`;
                }
                return `${type(id)}{${l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map(
                        (f, n) =>
                            `${f.name}: ${build(storage.project(view, [n]), (f as { layout: string }).layout)}`,
                    )
                    .join(', ')}}`;
            };
            const out = declare(c.body.layout, build(lens.view, c.body.layout), body);
            const replacement = endpoint(c.body.layout, 'replacement');
            storage.put(lens.view, { expression: 'replacement', layout: replacement });
            const cleanup: Statement[] = [];
            lens.finish(cleanup);
            flushParameters(cleanup);
            body.push(
                `${out}.restore = func(_ any, replacement ${type(replacement)}) ${type(unit.id)} {\n${printGoStatements([...cleanup, `return ${zero(unit.id)}`], 1).join('\n')}\n}`,
                `return ${out}`,
            );
        } else {
            flushParameters(body);
            body.push(`return ${result}`);
        }
        // Residual restoration closures retain setup cells, including locals
        // initialized only by a selected branch. Go keeps those cells alive.
        body.unshift(
            ...variables
                .filter((v) => !c.parameters.some((_, n) => v.name === `arg${n}`))
                .flatMap((v) => [`var ${v.name} ${v.type}`, `_ = ${v.name}`]),
        );

        const sig = `func ${codes.get(c.id)}(environment any${c.parameters.map((p, i) => `, arg${i} ${type(p.layout)}`).join('')}) ${type(c.body.layout)}`;
        return { signature: sig, body };
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
            body.push(`printNumber(${expr})`);
        } else if (l.kind === 'bool') {
            body.push(`if ${expr} { fmt.Print("true") } else { fmt.Print("false") }`);
        } else if (l.kind === 'unit') {
            body.push('fmt.Print("null")');
        } else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
            body.push('fmt.Print("[")');
            l.fields.forEach((f, i) => {
                if (i) body.push('fmt.Print(",")');
                print(`(${expr}).${identifier(f.name)}`, (f as { layout: string }).layout, body);
            });
            body.push('fmt.Print("]")');
        } else if (l.kind === 'union') {
            const name = `print_${type(id)}`;
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
                    print(`(*value.v1).item0`, head, loop);
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
                            `fmt.Print("{\\"kind\\":\\"variant\\",\\"name\\":\\"${identifier(f.name)}\\",\\"items\\":[")`,
                        ];
                        const arity = (
                            program.semantic.generic.imports.find(
                                (s) => s.definition === `constructor/${f.name}`,
                            )?.type as { args?: unknown[] } | undefined
                        )?.args?.length;
                        if (arity === undefined)
                            return unsupported(`Unknown constructor ${f.name}`);
                        const contents = payload('value', id, n);
                        if (arity === 1) print(contents, v.layout, arm);
                        else
                            for (let k = 0; k < arity; k++) {
                                if (k) arm.push('fmt.Print(",")');
                                print(
                                    `(${contents}).item${k}`,
                                    (layout(v.layout).fields[k] as { layout: string }).layout,
                                    arm,
                                );
                            }
                        arm.push('fmt.Print("]}")');
                        body.push({ head: `${n ? 'else if' : 'if'} value.tag == ${n}`, body: arm });
                    });
                helpers.push({ signature: `func ${name}(value ${type(id)})`, body });
            }
            body.push(`${name}(${expr})`);
        } else {
            unsupported('Entry result requires a supported test layout');
        }
    };

    const mainBody: Statement[] = [];
    for (const entry of program.entries) {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) {
            unsupported('Function entry requires an explicit host adapter');
        }
        const v = `result${mainBody.length}`;
        mainBody.push(`var ${v} ${type(c.body.layout)} = ${codes.get(entry)}(nil)`);
        mainBody.push(`_ = ${v}`);
        print(v, c.body.layout, mainBody);
        mainBody.push('fmt.Println()');
    }

    functions.push(...helpers, { signature: 'func main()', body: mainBody });

    return {
        packageName: 'main',
        imports: ['fmt', 'math', 'strconv'],
        declarations,
        functions,
    };
}
