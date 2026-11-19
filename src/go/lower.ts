import type { ConcreteProgram, ConcreteBlock, ConcreteValueAdapter } from '../concrete-ir.ts';
import { Storage, type Data, type View } from './storage.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { identifier, type Statement, type GoFile, type GoFunction } from './syntax.ts';

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

    const adaptValue = (a: ConcreteValueAdapter, expression: string): string => {
        if (a.kind === 'move') return expression;
        if (a.kind === 'aggregate') {
            const targetFields = layout(a.to).fields;
            const sourceFields = layout(a.from).fields;
            return `${type(a.to)}{\n${a.items
                .map(
                    (child, n) =>
                        `\t${identifier(targetFields[n]!.name)}: ${adaptValue(
                            child,
                            `(${expression}).${identifier(sourceFields[n]!.name)}`,
                        )},`,
                )
                .join('\n')}\n}`;
        }
        const entries = a.entries
            .map((e) => `\t${identifier(e.target)}: (${expression}).${identifier(e.source)},\n`)
            .join('');
        return `${type(a.to)}{\n\tenvironment: (${expression}).environment,\n\tdispose: (${expression}).dispose,\n${entries}}`;
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
                if (f.kind === 'pointer') return `\t${identifier(f.name)} *${f.layout ? type(f.layout) : 'any'}`;
                return `\t${identifier(f.name)} ${abiNames.get(f.abi)}`;
            });
            declarations.push(`type ${type(l.id)} struct {\n${fields.join('\n')}\n}`);
        } else if (l.kind === 'union') {
            unsupported('Union layout requires Phase 7');
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
    const nativeMembers = new Set(
        program.wrappers.flatMap((w) =>
            w.kind === 'dispatch' ? w.targets.map((t) => t.callable) : [],
        ),
    );
    const nativeEntries = new Set(
        program.callables
            .filter((c) => nativeMembers.has(c.id) && c.descriptor.kind === 'native')
            .flatMap((c) => c.entries.map((e) => e.wrapper)),
    );
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
        } else {
            return unsupported(`Native import ${w.definition}`);
        }
        body.push(`return ${result}`);
        helpers.push({ signature, body });
    }

    const resultAdapters = new Map(
        program.wrappers
            .filter(
                (w) =>
                    w.kind === 'adapt-result' ||
                    w.kind === 'adapt-lens-result' ||
                    w.kind === 'adapt-aggregate-result',
            )
            .map((w, n) => [w.id, `result_adapter${n}`]),
    );

    for (const w of program.wrappers) {
        if (
            w.kind !== 'adapt-result' &&
            w.kind !== 'adapt-lens-result' &&
            w.kind !== 'adapt-aggregate-result'
        ) {
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

        if (w.kind === 'adapt-aggregate-result') {
            helpers.push({
                signature,
                body: [
                    `result := ${sourceCode}(environment${abi.arguments.map((_, n) => `, arg${n}`).join('')})`,
                    `return ${adaptValue(w.adapter, 'result')}`,
                ],
            });
        } else if (w.kind === 'adapt-result') {
            const entries = w.entries
                .map((e) => `\t${identifier(e.target)}: result.${identifier(e.source)},\n`)
                .join('');
            helpers.push({
                signature,
                body: [
                    `result := ${sourceCode}(environment${abi.arguments.map((_, n) => `, arg${n}`).join('')})`,
                    `return ${type(abi.result)}{\n\tenvironment: result.environment,\n\tdispose: result.dispose,\n${entries}}`,
                ],
            });
        } else {
            return unsupported('Lens result adapters require Phase 4');
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
            body.push(`var ${name} ${type(id)} = ${expression}`);
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
                unsupported('Constructor pattern requires Phase 7');
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

        const adaptStorage = (a: ConcreteValueAdapter, data: Data, output: Statement[]): Data => {
            if (!Array.isArray(data) && data.layout === unit.id) return data;
            if (a.kind === 'move') return data;
            if (a.kind === 'aggregate')
                return storage.parts(data).map((child, n) => adaptStorage(a.items[n]!, child, output));
            const name = fresh();
            declare(a.to, adaptValue(a, read(data, a.from)), output, name);
            return { expression: name, layout: a.to };
        };

        const matches = (p: IRPattern, expr: string): string =>
            p.kind === 'literal'
                ? `${expr} == ${literal(p.value, unit.id)}`
                : p.kind === 'tuple'
                  ? p.items.map((p, i) => matches(p, `(${expr}).item${i}`)).join(' && ') || 'true'
                  : p.kind === 'constructor'
                    ? unsupported('Constructor match requires Phase 7')
                    : 'true';

        const ref = (s: SlotRef) =>
            storage.project(places.get(s.place) ?? unsupported('Unavailable Go place'), s.path);

        const value = (id: string) =>
            values.get(id) ?? unsupported('Missing value in Go lowering');

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
                return `${type(id)}{${
                    l.fields
                        .filter((f) => f.name.startsWith('item'))
                        .map(
                            (f, i) =>
                                `${identifier(f.name)}: ${build((f as { layout: string }).layout, path ? path + '.' + i : String(i))}`,
                        )
                        .join(', ')
                }}`;
            };

            const expression = build(id, '');
            const backingType = `Backing${index}`;
            declarations.push(
                `type ${backingType} struct {\n${fields.map((f) => `\t${f}`).join('\n')}\n}`,
            );
            variables.push({ name, type: backingType + (escapes ? ' *' : '') });
            if (escapes) {
                body.push(`var ${name} *${backingType} = new(${backingType})`);
            } else {
                body.push(`var ${name} ${backingType}`);
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
                    .map((f) => outputs(`(${expr}).${identifier(f.name)}`, (f as { layout: string }).layout));
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
                                if (
                                    w.kind === 'adapt-result' ||
                                    w.kind === 'adapt-aggregate-result'
                                ) {
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
                        return unsupported('Closures with captures require Phase 4');
                    }
                    case 'invoke': {
                        const w = program.wrappers.find((w) => w.id === i.wrapper)!;
                        const abi = program.abis.find((a) => a.id === i.abi)!;
                        const isLens = layout(id).fields.some((f) => f.name === 'restore');
                        const adapters: { finish: (body: Statement[]) => void }[] = [];
                        let args: string[] = [];
                        if (w.kind === 'native' && w.definition === 'native/dup') {
                            const lens = lenses.get(i.args[0]!)!;
                            expr = read(storage.get(lens.view), id);
                            adapters.push({ finish: lens.finish });
                        } else if (w.kind === 'native' && w.definition === 'native/fst') {
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
                                w.kind === 'invoke' ||
                                w.kind === 'dispatch' ||
                                w.kind === 'adapt-result' ||
                                w.kind === 'adapt-aggregate-result'
                            ) {
                                expr = `(${value(i.callee)}).${identifier(i.field)}((${value(i.callee)}).environment${args.map((a) => `, ${a}`).join('')})`;
                            } else if (w.kind === 'native') {
                                const op = w.definition.slice(7);
                                if (['+', '-', '*', '/', '==', '>=', '<='].includes(op)) {
                                    expr = `(${args[0]} ${op} ${args[1]})`;
                                } else {
                                    return unsupported(`Native import ${w.definition}`);
                                }
                            } else {
                                return unsupported(`Wrapper kind ${w.kind}`);
                            }
                        }
                        declare(id, expr, body, name);
                        values.set(i.out.id, name);
                        if (isLens) {
                            lenses.set(
                                i.out.id,
                                runtimeLens(name, id, (body) => adapters.forEach((a) => a.finish(body))),
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
                        if (i.lensJoin) return unsupported('Lens case join requires Phase 5');
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
                            if (i.aggregateJoin)
                                nested.push(`${name} = ${adaptValue(i.aggregateJoin.arms[armIndex]!, result)}`);
                            else if (i.callableJoin) {
                                const adapter = i.callableJoin.arms[armIndex]!;
                                const entries = adapter.entries
                                    .map((e) => `, ${identifier(e.target)}: (${result}).${identifier(e.source)}`)
                                    .join('');
                                nested.push(`${name} = ${type(id)}{environment: (${result}).environment, dispose: (${result}).dispose${entries}}`);
                            } else nested.push(`${name} = ${result}`);
                            i.storageJoins?.forEach((join) => {
                                const view =
                                    places.get(join.place) ??
                                    unsupported('Missing branch storage owner');
                                storage.put(view, adaptStorage(join.arms[armIndex]!, storage.get(view), nested));
                            });
                            return { nested, state: storage.snapshot() };
                        });
                        storage.reset(before);
                        // phi-join: for each cell, merge the per-arm states
                        const merge = (data: Data[], previous?: Data): Data => {
                            if (
                                data.every((d) => JSON.stringify(d) === JSON.stringify(data[0])) &&
                                (arms.length > 1 || JSON.stringify(data[0]) === JSON.stringify(previous))
                            )
                                return data[0]!;
                            const first = data[0]!;
                            if (!Array.isArray(first) && data.every((d) => !Array.isArray(d) && d.layout === first.layout)) {
                                const phi = fresh();
                                declare(first.layout, zero(first.layout), body, phi);
                                arms.forEach((arm, n) => arm.nested.push(`${phi} = ${read(data[n]!, first.layout)}`));
                                return { expression: phi, layout: first.layout };
                            }
                            const parts = data.map((d) => storage.parts(d));
                            if (!parts[0]?.length || parts.some((p) => p.length !== parts[0]!.length))
                                return unsupported('Storage version join requires an adapter');
                            return parts[0].map((_, n) =>
                                merge(parts.map((p) => p[n]!), previous && storage.parts(previous)[n]),
                            );
                        };
                        before.forEach((previous, cell) => (cell.data = merge(arms.map((a) => a.state.get(cell)!), previous)));
                        i.cases.forEach((arm, n) =>
                            body.push({
                                head: `${n ? 'else if' : 'if'} ${matches(arm.pattern, value(i.value))}`,
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

        const result = block(c.body, body);
        if (lenses.has(c.body.result)) {
            return unsupported('Returned lenses require Phase 4');
        }
        flushParameters(body);
        body.push(`return ${result}`);

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
                body: ['fmt.Print(strconv.FormatFloat(x, \'g\', -1, 64))'],
            },
        ],
    });

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
