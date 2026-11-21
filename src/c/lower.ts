import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import { Storage, type Data, type View } from './storage.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { identifier, type Statement, type TranslationUnit } from './syntax.ts';
import { appendPart, cBytes, stringRuntime, stringType } from './strings.ts';
import { requireImport, usesHost } from '../runtime-imports.ts';

// Replacement contents are already in the logical focus. Staging makes them
// visible through adapters and returns the cleanup/restoration still to perform.
type Completion = (body: Statement[]) => void;
type Lens = { view: View; finish: Completion; stage?: (body: Statement[]) => Completion };
const stage = (lens: Lens, body: Statement[]): Completion =>
    lens.stage ? lens.stage(body) : lens.finish;
type Variable = { name: string; type: string };
const unsupported = (message: string): never => {
    throw new BackendDiagnostic('unsupported-c', message);
};
/** Resolve logical places and homogeneous restoration before printing any C. */
export function lowerC(program: ConcreteProgram): TranslationUnit {
    verifyConcreteProgram(program);
    // Every import reaching C must be registered, implemented and available on the target.
    const imports = program.semantic.program.imports
        .map((i) => i.definition)
        .filter((d) => d.startsWith('native/'));
    imports.forEach((d) => requireImport(d, 'c', program.target));
    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const names = new Map(program.layouts.map((l, i) => [l.id, `L${i}`]));
    const codes = new Map(program.code.map((c, i) => [c.id, `fn${i}`]));
    const abiNames = new Map(program.abis.map((a, i) => [a.id, `A${i}`]));
    const type = (id: string) => names.get(id)!;
    const layout = (id: string) => layouts.get(id)!;
    const unit = program.layouts.find((l) => l.kind === 'unit')!;
    const zero = (id: string) => `(${type(id)}){0}`;
    const field = (expr: string, n: number) => `(${expr}).item${n}`;
    const storage = new Storage((s) =>
        layout(s.layout).fields.map((f, i) => {
            if (f.kind !== 'value' || !f.name.startsWith('item'))
                return unsupported('Non-data projection');
            return { expression: field(s.expression, i), layout: f.layout };
        }),
    );
    const read = (data: Data, id: string): string => {
        if (layout(id).kind === 'unit') return zero(id);
        if (!Array.isArray(data) && data.layout === id) return data.expression;
        const parts = storage.parts(data),
            fields = layout(id).fields;
        if (!fields.length || parts.length !== fields.length)
            return unsupported('Mismatched storage read');
        return `(${type(id)}){${parts.map((d, i) => read(d, (fields[i] as { layout: string }).layout)).join(', ') || '0'}}`;
    };
    const endpoint = (id: string, which: 'read' | 'replacement'): string => {
        const l = layout(id),
            f = l.fields.find((f) => f.name === which) ?? l.fields.find((f) => f.name === 'read');
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
    const noFinish = (_body: Statement[]) => {};
    const incoming = (expression: string, id: string): View => {
        const l = layout(id),
            f = l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout)
            return storage.own({ expression: `*(${expression}).read`, layout: f.layout });
        return l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) =>
                incoming(`(${expression}).${identifier(f.name)}`, (f as { layout: string }).layout),
            );
    };
    const flush = (expression: string, id: string, data: Data, body: Statement[]) => {
        const l = layout(id),
            f =
                l.fields.find((f) => f.name === 'replacement') ??
                l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout) {
            body.push(`*(${expression}).${f.name} = ${read(data, f.layout)};`);
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
    const declarations = [
        '#include <stdio.h>',
        '#include <stdlib.h>',
        '#include <math.h>',
        '#include <stdint.h>',
    ];
    const strings = program.layouts.some((l) => l.kind === 'string');
    const runtime = strings ? stringRuntime() : undefined;
    if (runtime) declarations.push('#include <string.h>', runtime.declarations[0]!, runtime.declarations[1]!);
    for (const l of program.layouts)
        declarations.push(
            l.kind === 'f64'
                ? `typedef double ${type(l.id)};`
                : l.kind === 'bool'
                  ? `typedef _Bool ${type(l.id)};`
                  : l.kind === 'string'
                    ? `typedef ${stringType} *${type(l.id)};`
                    : `typedef struct ${type(l.id)} ${type(l.id)};`,
        );
    for (const a of program.abis)
        declarations.push(
            `typedef ${type(a.result)} (*${abiNames.get(a.id)})(void *${a.arguments.map((id) => `, ${type(id)}`).join('')});`,
        );
    for (const l of program.layouts)
        if (l.kind === 'union') {
            // Tagged union; boxed variants hold an owned heap payload.
            const variants = l.fields.map((f, n) =>
                f.kind === 'value'
                    ? `${type(f.layout)} v${n};`
                    : f.kind === 'pointer' && f.layout
                      ? `${type(f.layout)} *v${n};`
                      : unsupported('Union variant requires data storage'),
            );
            declarations.push(
                `struct ${type(l.id)} { uint32_t tag; union { ${variants.join(' ')} } as; };`,
            );
        } else if (!['f64', 'bool', 'string'].includes(l.kind)) {
            declarations.push(
                `struct ${type(l.id)} { ${l.fields.map((f) => (f.kind === 'value' ? `${type(f.layout)} ${identifier(f.name)};` : f.kind === 'pointer' ? `${f.layout ? type(f.layout) : 'void'} *${identifier(f.name)};` : `${abiNames.get(f.abi)} ${identifier(f.name)};`)).join(' ') || 'unsigned char inhabitant;'} };`,
            );
        }
    const signature = (c: ConcreteProgram['code'][number]) =>
        `${type(c.body.layout)} ${codes.get(c.id)}(void *environment${c.parameters.map((p, i) => `, ${type(p.layout)} arg${i}`).join('')})`;
    declarations.push(
        'static size_t live_contexts = 0;',
        'void *allocate_context(size_t size);',
        'void release_context(void *context);',
        ...(runtime?.declarations.slice(2) ?? []),
    );
    program.code.forEach((c) => declarations.push(signature(c) + ';'));
    const helpers: TranslationUnit['functions'] = [];
    let helperCounter = 0;
    const disposers = new Map(
        program.wrappers.filter((w) => w.kind === 'dispose').map((w, i) => [w.id, `dispose${i}`]),
    );
    // Union operations are recursive C functions, generated once per layout on first use.
    const unionHelpers = new Map<string, string>();
    const unionHelper = (
        kind: 'drop' | 'dup' | 'print' | 'char_list' | 'round' | 'host_print' | 'host_input',
        id: string,
        result: string,
        generate: (body: Statement[]) => void,
        parameter = type(id),
    ): string => {
        const key = `${kind}:${id}`;
        const existing = unionHelpers.get(key);
        if (existing) return existing;
        const name = `${kind}_${type(id)}`;
        unionHelpers.set(key, name);
        const signature = `${result} ${name}(${parameter} value)`;
        declarations.push(signature + ';');
        const body: Statement[] = ['(void)value;'];
        generate(body);
        helpers.push({ signature, body });
        return name;
    };
    const variant = (id: string, n: number) => {
        const f = layout(id).fields[n]!;
        if (f.kind === 'code' || !f.layout)
            return unsupported('Union variant requires data storage');
        return { boxed: f.kind === 'pointer', layout: f.layout, name: f.name };
    };
    const tagOf = (id: string, name: string): number => {
        const n = layout(id).fields.findIndex((f) => f.name === name);
        return n < 0 ? unsupported(`Constructor ${name} is absent from its union layout`) : n;
    };
    /** Payload of variant `n`, read through its box when the variant is boxed. */
    const payload = (expr: string, id: string, n: number): string =>
        variant(id, n).boxed ? `(*(${expr}).as.v${n})` : `(${expr}).as.v${n}`;
    /** Deep copy for affine `dup`: each boxed payload gets its own allocation. */
    const duplicate = (expr: string, id: string): string => {
        const l = layout(id);
        if (l.kind === 'union')
            return `${unionHelper('dup', id, type(id), (body) => {
                body.push(`${type(id)} copy = value;`);
                l.fields.forEach((_, n) => {
                    const v = variant(id, n);
                    const copied = duplicate(payload('value', id, n), v.layout);
                    body.push({
                        head: `${n ? 'else if' : 'if'} (value.tag == ${n})`,
                        body: v.boxed
                            ? [
                                  `copy.as.v${n} = allocate_context(sizeof *copy.as.v${n});`,
                                  `*copy.as.v${n} = ${copied};`,
                              ]
                            : [`copy.as.v${n} = ${copied};`],
                    });
                });
                body.push('return copy;');
            })}(${expr})`;
        if (l.kind === 'string') return `string_dup(${expr})`;
        if (l.kind === 'record' && l.fields.every((f) => f.kind === 'value'))
            return `(${type(id)}){${l.fields.map((f, n) => duplicate(field(expr, n), (f as { layout: string }).layout)).join(', ')}}`;
        return expr;
    };
    const drop = (data: Data, body: Statement[]): void => {
        if (Array.isArray(data)) return data.forEach((d) => drop(d, body));
        const l = layout(data.layout);
        if (l.kind === 'union') {
            const id = data.layout;
            const name = unionHelper('drop', id, type(unit.id), (body) => {
                l.fields.forEach((_, n) => {
                    const v = variant(id, n);
                    const arm: Statement[] = [];
                    drop({ expression: payload('value', id, n), layout: v.layout }, arm);
                    if (v.boxed) arm.push(`release_context(value.as.v${n});`);
                    if (arm.length)
                        body.push({
                            head: `${body.length > 1 ? 'else if' : 'if'} (value.tag == ${n})`,
                            body: arm,
                        });
                });
                body.push(`return ${zero(unit.id)};`);
            });
            body.push(`${name}(${data.expression});`);
        } else if (l.kind === 'string') {
            body.push(`string_drop(${data.expression});`);
        } else if (l.fields.some((f) => f.name === 'dispose')) {
            body.push({
                head: `if ((${data.expression}).dispose)`,
                body: [`(${data.expression}).dispose((${data.expression}).environment);`],
            });
        } else if (l.kind === 'record') {
            l.fields.forEach((f, i) => {
                if (f.kind === 'value')
                    drop({ expression: field(data.expression, i), layout: f.layout }, body);
            });
        }
    };
    /** `charList` consumes a string and builds its code points as a list, last first. */
    const charList = (result: string): string => {
        const nil = tagOf(result, 'nil'),
            cons = tagOf(result, 'cons'),
            cell = variant(result, cons);
        if (!cell.boxed) return unsupported('List cells must be boxed');
        const text = (layout(cell.layout).fields[0] as { layout: string }).layout;
        return unionHelper('char_list', result, type(result), (body) => {
            body.pop();
            body.push(
                `${type(result)} out = (${type(result)}){.tag=${nil}, .as.v${nil}=${zero(variant(result, nil).layout)}};`,
                'size_t end = value ? value->length : 0;',
                {
                    head: 'while (end > 0)',
                    body: [
                        'size_t start = end - 1;',
                        {
                            // Step back over UTF-8 continuation bytes to the code point's lead byte.
                            head: 'while (start > 0 && (value->bytes[start] & 0xC0) == 0x80)',
                            body: ['start--;'],
                        },
                        `${type(cell.layout)} *cell = allocate_context(sizeof *cell);`,
                        `*cell = (${type(cell.layout)}){(${type(text)})string_new((const char *)value->bytes + start, end - start), out};`,
                        `out = (${type(result)}){.tag=${cons}, .as.v${cons}=cell};`,
                        'end = start;',
                    ],
                },
                'string_drop(value);',
                'return out;',
            );
        }, type(text));
    };
    /** Natives that take and return plain data, by registered name. Lens natives are separate. */
    const simpleNative = (
        op: string,
        args: string[],
        result: string,
        parameters: readonly string[],
    ): string | undefined => {
        if (['+', '-', '*', '/', '==', '>=', '<='].includes(op))
            return `(${args[0]} ${op} ${args[1]})`;
        if (op === 'charList') return `${charList(result)}(${args[0]})`;
        if (op === 'heapsize') return '0.0';
        if (op === 'round')
            return `${unionHelper('round', result, type(result), (body) =>
                body.push(
                    'double rounded = floor(value);',
                    { head: 'if (value - rounded >= 0.5)', body: ['rounded += 1;'] },
                    // Math.round keeps the sign of a zero result, e.g. round(-0.4) is -0.
                    { head: 'if (rounded == 0)', body: ['rounded = copysign(0.0, value);'] },
                    'return rounded;',
                ),
            )}(${args[0]})`;
        if (op === 'print')
            return `${unionHelper(
                'host_print',
                result,
                type(result),
                (body) =>
                    body.push(
                        { head: 'if (value)', body: ['fwrite(value->bytes, 1, value->length, stdout);'] },
                        'putchar(10);',
                        'string_drop(value);',
                        `return ${zero(result)};`,
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        if (op === 'getInput')
            return `${unionHelper(
                'host_input',
                result,
                type(result),
                (body) =>
                    body.push(
                        { head: 'if (value)', body: ['fwrite(value->bytes, 1, value->length, stdout);'] },
                        'fflush(stdout);',
                        'string_drop(value);',
                        'string_builder line = {0};',
                        'int c;',
                        {
                            head: 'while ((c = getchar()) != EOF && c != 10)',
                            body: ['char byte = (char)c;', 'builder_bytes(&line, &byte, 1);'],
                        },
                        'return builder_finish(&line);',
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        return undefined;
    };
    for (const w of program.wrappers) {
        if (w.kind !== 'dispose' || !w.captures.length) continue;
        const signature = `${type(unit.id)} ${disposers.get(w.id)}(void *environment)`;
        declarations.push(signature + ';');
        const body: Statement[] = [`${type(w.environment)} *captured = environment;`];
        w.captures.forEach((id, i) =>
            drop({ expression: `captured->capture${i}`, layout: id }, body),
        );
        body.push('release_context(captured);', `return ${zero(unit.id)};`);
        helpers.push({ signature, body });
    }
    // Native values fill their type's ABI entries; direct intrinsics retain the
    // explicit storage lowering below.
    const nativeEntries = new Set([
        ...program.callables
            .filter((c) => c.descriptor.kind === 'native')
            .flatMap((c) => c.entries.map((e) => e.wrapper)),
        // Result normalization calls its native source directly.
        ...program.wrappers.flatMap((w) =>
            'source' in w && program.wrappers.some((x) => x.id === w.source && x.kind === 'native')
                ? [w.source]
                : [],
        ),
    ]);
    const nativeCodes = new Map<string, string>();
    for (const w of program.wrappers) {
        if (w.kind !== 'native' || !nativeEntries.has(w.id)) continue;
        const abi = program.abis.find((a) => a.id === w.abi)!;
        const name = `native${nativeCodes.size}`;
        nativeCodes.set(w.id, name);
        const signature = `${type(abi.result)} ${name}(void *environment${abi.arguments.map((id, i) => `, ${type(id)} arg${i}`).join('')})`;
        declarations.push(signature + ';');
        const body: Statement[] = [
            '(void)environment;',
            ...abi.arguments.map((_, i) => `(void)arg${i};`),
        ];
        let result: string;
        const op = requireImport(w.definition, 'c').name;
        const simple = simpleNative(
            op,
            abi.arguments.map((_, i) => `arg${i}`),
            abi.result,
            abi.arguments,
        );
        if (simple !== undefined) result = simple;
        else if (op === 'dup')
            result = duplicate(
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
                    // Distinct replacement backing must preserve every untouched field.
                    const reads = layout(pointer.layout).fields,
                        writes = layout(replacement.layout).fields;
                    for (let n = 1; n < writes.length; n++) {
                        const from = reads[n]!,
                            to = writes[n]!;
                        if (
                            from.kind !== 'value' ||
                            to.kind !== 'value' ||
                            from.layout !== to.layout
                        )
                            return unsupported('Native fst changed an untouched field');
                        body.push(
                            `arg0.replacement->${identifier(to.name)} = arg0.read->${identifier(from.name)};`,
                        );
                    }
                }
                result = `(${type(abi.result)}){.read=&arg0.read->item0${output.fields.some((f) => f.name === 'replacement') ? `, .replacement=&arg0.${replacement ? 'replacement' : 'read'}->item0` : ''}}`;
            } else result = 'arg0.item0';
        } else return unsupported(`Native import ${w.definition}`);
        body.push(`return ${result};`);
        helpers.push({ signature, body });
    }
    const resultAdapters = new Map(
        program.wrappers
            .filter((w) => w.kind === 'adapt-lens-result')
            .map((w, n) => [w.id, `result_adapter${n}`]),
    );
    for (const w of program.wrappers) {
        if (w.kind !== 'adapt-lens-result') continue;
        const abi = program.abis.find((a) => a.id === w.abi)!;
        const source = program.wrappers.find((source) => source.id === w.source)!;
        if (source.kind !== 'invoke' && source.kind !== 'native')
            return unsupported('Result adapter requires a concrete body or native import');
        const raw = program.abis.find((a) => a.id === source.abi)!;
        const signature = `${type(abi.result)} ${resultAdapters.get(w.id)}(void *environment${abi.arguments.map((id, n) => `, ${type(id)} arg${n}`).join('')})`;
        declarations.push(signature + ';');
        const sourceCode =
            source.kind === 'invoke' ? codes.get(source.code)! : nativeCodes.get(source.id)!;
        if (w.kind === 'adapt-lens-result') {
            const context = `LensResult${resultAdapters.get(w.id)}`,
                restore = `restore_${resultAdapters.get(w.id)}`;
            const input = endpoint(abi.result, 'read'),
                replacement = endpoint(abi.result, 'replacement');
            const separate = layout(abi.result).fields.some((f) => f.name === 'replacement');
            declarations.push(
                `typedef struct { ${type(raw.result)} source; ${type(input)} read; ${separate ? `${type(replacement)} write;` : ''} } ${context};`,
            );
            const restoreSignature = `${type(unit.id)} ${restore}(void *environment, ${type(replacement)} replacement)`;
            declarations.push(restoreSignature + ';');
            const fallback: Statement[] = [];
            flush(
                'ctx->source',
                raw.result,
                { expression: 'replacement', layout: replacement },
                fallback,
            );
            helpers.push({
                signature: restoreSignature,
                body: [
                    `${context} *ctx = environment;`,
                    {
                        head: 'if (ctx->source.restore)',
                        body: ['ctx->source.restore(ctx->source.context, replacement);'],
                    },
                    { head: 'else', body: fallback },
                    'release_context(ctx);',
                    `return ${zero(unit.id)};`,
                ],
            });
            helpers.push({
                signature,
                body: [
                    `${type(raw.result)} result = ${sourceCode}(environment${abi.arguments.map((_, n) => `, arg${n}`).join('')});`,
                    `${context} *ctx = allocate_context(sizeof *ctx);`,
                    'ctx->source = result;',
                    `ctx->read = ${read(storage.get(incoming('ctx->source', raw.result)), input)};`,
                    `return (${type(abi.result)}){.read=&ctx->read${separate ? ', .replacement=&ctx->write' : ''}, .restore=${restore}, .context=ctx};`,
                ],
            });
            continue;
        }
    }
    const wrapperFunction = (id: string): string => {
        const w = program.wrappers.find((w) => w.id === id)!;
        return (
            (w.kind === 'invoke' ? codes.get(w.code) : undefined) ??
            resultAdapters.get(id) ??
            nativeCodes.get(id) ??
            unsupported('Wrapper has no callable function')
        );
    };
    const functions = program.code.map((c) => {
        const values = new Map<string, string>(),
            lenses = new Map<string, Lens>(),
            places = new Map<string, View>();
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
            body.push(`${type(id)} ${name} = ${expression};`, `(void)${name};`);
            return name;
        };
        const setup: Statement[] = [];
        const bind = (p: IRPattern, data: Data, body: Statement[] = setup) => {
            if (p.kind === 'bind') places.set(p.slot.place, storage.own(data));
            else if (p.kind === 'tuple')
                p.items.forEach((p, i) => bind(p, storage.parts(data)[i]!, body));
            else if (p.kind === 'constructor') {
                // Borrowed matches moved their owner out first; reconstruction is explicit IR.
                if (Array.isArray(data)) return unsupported('Constructor pattern over a tuple');
                const n = tagOf(data.layout, p.name),
                    v = variant(data.layout, n);
                // The case already selected this variant; take its payload and free the box.
                let contents: Data = {
                    expression: payload(data.expression, data.layout, n),
                    layout: v.layout,
                };
                if (v.boxed) {
                    contents = {
                        expression: declare(v.layout, contents.expression, body),
                        layout: v.layout,
                    };
                    body.push(`release_context((${data.expression}).as.v${n});`);
                }
                if (p.items.length === 1) bind(p.items[0]!, contents, body);
                else p.items.forEach((item, k) => bind(item, storage.parts(contents)[k]!, body));
            } else if (p.kind === 'drop' || p.kind === 'literal') drop(data, body);
        };
        const parameters: { expression: string; layout: string; view: View }[] = [];
        c.parameters.forEach((p, i) => {
            if (p.lensPlace) {
                const view = incoming(`arg${i}`, p.layout);
                places.set(p.lensPlace, view);
                parameters.push({ expression: `arg${i}`, layout: p.layout, view });
            } else bind(p.pattern, { expression: `arg${i}`, layout: p.layout });
        });
        const flushParameters = (body: Statement[]) =>
            parameters.forEach((p) => flush(p.expression, p.layout, storage.get(p.view), body));
        const ref = (s: SlotRef) =>
            storage.project(places.get(s.place) ?? unsupported('Unavailable C place'), s.path);
        const value = (id: string) =>
            values.get(id) ?? unsupported('Indirect/function value requires phase 6');
        // Adapt input/output backing at calls. Escaping calls use heap backing, so
        // a returned continuation never retains a pointer into the caller frame.
        const adapt = (
            lens: Lens,
            id: string,
            escapes: boolean,
            body: Statement[],
        ): { expression: string; finish: (body: Statement[]) => void } => {
            const index = helperCounter++,
                name = `back${index}`,
                fields: string[] = [],
                init: Statement[] = [];
            const build = (id: string, path: string): string => {
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const output = l.fields.find((f) => f.name === 'replacement');
                    const n = fields.length,
                        r = `read${n}`,
                        w = output ? `write${n}` : r;
                    fields.push(`${type(input.layout)} ${r};`);
                    const d = storage.get(
                        storage.project(lens.view, path ? path.split('.').map(Number) : []),
                    );
                    init.push(`${name}${escapes ? '->' : '.'}${r} = ${read(d, input.layout)};`);
                    if (output?.kind === 'pointer' && output.layout) {
                        fields.push(`${type(output.layout)} ${w};`);
                        init.push(`${name}${escapes ? '->' : '.'}${w} = ${zero(output.layout)};`);
                    }
                    return `(${type(id)}){.read=&${name}${escapes ? '->' : '.'}${r}${output ? `, .replacement=&${name}${escapes ? '->' : '.'}${w}` : ''}}`;
                }
                return `(${type(id)}){${
                    l.fields
                        .filter((f) => f.name.startsWith('item'))
                        .map(
                            (f, i) =>
                                `.${f.name}=${build((f as { layout: string }).layout, path ? path + '.' + i : String(i))}`,
                        )
                        .join(', ') || '0'
                }}`;
            };
            const expression = build(id, '');
            const backingType = `Backing${index}`;
            declarations.push(
                `typedef struct { ${fields.join(' ') || 'unsigned char inhabitant;'} } ${backingType};`,
            );
            variables.push({ name, type: backingType + (escapes ? ' *' : '') });
            body.push(
                escapes
                    ? `${backingType} *${name} = allocate_context(sizeof *${name});`
                    : `${backingType} ${name} = {0};`,
            );
            body.push(`(void)${name};`);
            if (escapes) body.push({ head: `if (!${name})`, body: ['abort();'] });
            body.push(...init);
            const arg = declare(id, expression, body);
            const outputs = (expr: string, id: string): Data => {
                const l = layout(id),
                    f =
                        l.fields.find((f) => f.name === 'replacement') ??
                        l.fields.find((f) => f.name === 'read');
                if (f?.kind === 'pointer' && f.layout)
                    return { expression: `*(${expr}).${f.name}`, layout: f.layout };
                return l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map((f) => outputs(`(${expr}).${f.name}`, (f as { layout: string }).layout));
            };
            return {
                expression: arg,
                finish: (body) => {
                    // Copy before freeing backing; subsequent versions never reference freed memory.
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
                    body.push(`(void)${name};`);
                    if (escapes) body.push(`release_context(${name});`);
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
                            head: `if ((${name}).restore)`,
                            body: [`(${name}).restore((${name}).context, ${replacement});`],
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
        const loans = new Map<string, Lens>();
        const literal = (v: unknown, id: string): string =>
            v === null
                ? zero(id)
                : typeof v === 'boolean'
                  ? String(+v)
                  : typeof v === 'number'
                    ? // Integral literals beyond the safe range exceed every C integer type.
                      Number.isSafeInteger(v) || /[.e]/.test(String(v))
                        ? String(v)
                        : `${v}.0`
                    : v && typeof v === 'object' && 'number' in v
                      ? {
                            NaN: 'NAN',
                            Infinity: 'INFINITY',
                            '-Infinity': '(-INFINITY)',
                            '-0': '(-0.0)',
                        }[String(v.number)]!
                      : unsupported('Literal');
        const matches = (p: IRPattern, expr: string, id: string): string => {
            if (p.kind === 'literal') {
                if (layout(id).kind !== 'string')
                    return `${expr} == ${literal(p.value, unit.id)}`;
                if (typeof p.value !== 'string') return unsupported('String literal pattern');
                const text = cBytes(p.value);
                return `string_equals(${expr}, ${text.literal}, ${text.length})`;
            }
            const fields = layout(id).fields as { layout: string }[];
            if (p.kind === 'tuple')
                return (
                    p.items
                        .map((p, i) => matches(p, field(expr, i), fields[i]!.layout))
                        .join(' && ') || '1'
                );
            if (p.kind !== 'constructor') return '1';
            const n = tagOf(id, p.name),
                v = variant(id, n),
                contents = payload(expr, id, n);
            const items =
                p.items.length === 1
                    ? [matches(p.items[0]!, contents, v.layout)]
                    : p.items.map((item, k) =>
                          matches(
                              item,
                              field(contents, k),
                              (layout(v.layout).fields[k] as { layout: string }).layout,
                          ),
                      );
            return [`(${expr}).tag == ${n}`, ...items.filter((m) => m !== '1')].join(' && ');
        };
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
                    // Direct subloans retain absolute paths into the original owner.
                    // Only computed lenses introduce a new backing place.
                    if (loan!.owners) places.set(loan!.place, lens.view);
                    loans.set(i.loan, lens);
                    continue;
                }
                const id = i.out.layout,
                    name = fresh();
                let expr!: string;
                switch (i.op) {
                    case 'manual': {
                        const frontend = lenses.get(i.lens)!;
                        const manual: Lens = {
                            view: frontend.view,
                            stage: (output) => {
                                const complete = stage(frontend, output);
                                return (output) => {
                                    const result = block(i.cleanup, output);
                                    drop({ expression: result, layout: i.cleanup.layout }, output);
                                    complete(output);
                                };
                            },
                            finish: (output) => stage(manual, output)(output),
                        };
                        lenses.set(i.out.id, manual);
                        continue;
                    }
                    case 'make-callable': {
                        const callable = program.callables.find((c) => c.id === i.callable)!;
                        const entries = callable.entries
                            .map((e) => {
                                const w = program.wrappers.find((w) => w.id === e.wrapper)!;
                                // Runtime joins reify native entries; ordinary intrinsics keep their storage lowering.
                                return w.kind === 'invoke'
                                    ? `, .${e.field}=${codes.get(w.code)}`
                                    : w.kind === 'adapt-lens-result'
                                      ? `, .${e.field}=${resultAdapters.get(w.id)}`
                                      : w.kind === 'native' && nativeCodes.has(w.id)
                                        ? `, .${e.field}=${nativeCodes.get(w.id)}`
                                        : '';
                            })
                            .join('');
                        if (!i.captures.length && !entries) {
                            values.set(i.out.id, zero(id));
                            continue;
                        }
                        if (!i.captures.length) {
                            expr = `(${type(id)}){.environment=NULL${entries}}`;
                            break;
                        }
                        const environment = fresh();
                        variables.push({
                            name: environment,
                            type: `${type(callable.environment)} *`,
                        });
                        body.push(
                            `${type(callable.environment)} *${environment} = allocate_context(sizeof *${environment});`,
                        );
                        i.captures.forEach((capture, n) =>
                            body.push(`${environment}->capture${n} = ${value(capture.value)};`),
                        );
                        expr = `(${type(id)}){.environment=${environment}, .dispose=${disposers.get(callable.dispose)}${entries}}`;
                        break;
                    }
                    case 'constant':
                        expr = literal(i.value, id);
                        break;
                    case 'string': {
                        const head = cBytes(i.head);
                        if (!i.parts.length) {
                            expr = `string_new(${head.literal}, ${head.length})`;
                            break;
                        }
                        // Parts were evaluated in source order; appending consumes each one.
                        const builder = fresh();
                        body.push(
                            `string_builder ${builder} = {0};`,
                            `builder_bytes(&${builder}, ${head.literal}, ${head.length});`,
                        );
                        for (const part of i.parts) {
                            const tail = cBytes(part.tail);
                            body.push(
                                appendPart(
                                    builder,
                                    layout(outputLayouts.get(part.value)!).kind,
                                    value(part.value),
                                ),
                                `builder_bytes(&${builder}, ${tail.literal}, ${tail.length});`,
                            );
                        }
                        expr = `builder_finish(&${builder})`;
                        break;
                    }
                    case 'construct': {
                        const n = tagOf(id, i.name),
                            v = variant(id, n);
                        let contents =
                            i.items.length === 0
                                ? zero(v.layout)
                                : i.items.length === 1
                                  ? value(i.items[0]!)
                                  : `(${type(v.layout)}){${i.items.map(value).join(', ')}}`;
                        if (v.boxed) {
                            const box = fresh();
                            variables.push({ name: box, type: `${type(v.layout)} *` });
                            body.push(
                                `${type(v.layout)} *${box} = allocate_context(sizeof *${box});`,
                                `*${box} = ${contents};`,
                            );
                            contents = box;
                        }
                        expr = `(${type(id)}){.tag=${n}, .as.v${n}=${contents}}`;
                        break;
                    }
                    case 'tuple':
                        expr = `(${type(id)}){${i.items.map(value).join(', ') || '0'}}`;
                        break;
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
                    case 'case': {
                        if (i.lensJoin) {
                            const before = storage.snapshot();
                            const selected = fresh();
                            variables.push({ name: selected, type: 'int' });
                            body.push(`int ${selected} = 0;`, `(void)${selected};`);
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
                                    drop(storage.get(ref(a.slot)), output);
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
                                const start = variables.length;
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
                                // Lift setup storage out of the conditional so deferred cleanup can
                                // retain it. Only the selected arm assigns or allocates its backing.
                                const locals = variables.slice(start);
                                locals.forEach((v) =>
                                    body.push(`${v.type} ${v.name} = {0};`, `(void)${v.name};`),
                                );
                                const lift = (statements: Statement[]): Statement[] =>
                                    statements.map((s) => {
                                        if (typeof s !== 'string')
                                            return { ...s, body: lift(s.body) };
                                        for (const v of locals) {
                                            const match = s.match(
                                                new RegExp(`^(.+?)\\b${v.name}\\s*=\\s*(.*);$`),
                                            );
                                            if (
                                                match &&
                                                match[1]!.replace(/\s/g, '') ===
                                                    v.type.replace(/\s/g, '')
                                            ) {
                                                const rhs = match[2]!.startsWith('{')
                                                    ? `(${v.type})${match[2]}`
                                                    : match[2];
                                                return `${v.name} = ${rhs};`;
                                            }
                                        }
                                        return s;
                                    });
                                return {
                                    nested: lift(nested),
                                    state: storage.snapshot(),
                                    lens,
                                    arm,
                                    index: n,
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
                            body.push({ head: 'else', body: ['abort();'] });
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
                                    output.push({ head: 'else', body: ['abort();'] });
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
                                        output.push({ head: 'else', body: ['abort();'] });
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
                                    output.push({ head: 'else', body: ['abort();'] });
                                },
                            });
                            continue;
                        }
                        declare(id, zero(id), body, name);
                        const before = storage.snapshot(),
                            outerVariables = variables.length;
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
                            nested.push(`${name} = ${result};`);
                            const state = storage.snapshot();
                            variables.length = outerVariables;
                            return { nested, state };
                        });
                        storage.reset(before);
                        // A single arm can also produce branch-local storage versions.
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
                                const phi = declare(first.layout, zero(first.layout), body);
                                arms.forEach((arm, n) =>
                                    arm.nested.push(`${phi} = ${read(data[n]!, first.layout)};`),
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
                                head: `${n ? 'else if' : 'if'} (${matches(arm.pattern, value(i.value), outputLayouts.get(i.value)!)})`,
                                body: arms[n]!.nested,
                            }),
                        );
                        body.push({ head: 'else', body: ['abort();'] });
                        values.set(i.out.id, name);
                        continue;
                    }
                    case 'invoke': {
                        // An indirect call goes through the callee record's entry; a
                        // direct call invokes its known member's wrapper itself.
                        if (
                            i.field !== undefined &&
                            !program.callables.some(
                                (x) =>
                                    x.layout === outputLayouts.get(i.callee) &&
                                    x.entries.some((e) => e.field === i.field && e.abi === i.abi),
                            )
                        )
                            unsupported('Missing callable storage contract');
                        const w = program.wrappers.find((w) => w.id === i.wrapper)!;
                        const abi = program.abis.find((a) => a.id === i.abi)!;
                        const isLens = layout(id).fields.some((f) => f.name === 'restore');
                        const adapters: { finish: (body: Statement[]) => void }[] = [];
                        let args: string[] = [];
                        if (w?.kind === 'native' && w.definition === 'native/dup') {
                            const lens = lenses.get(i.args[0]!)!;
                            expr = duplicate(read(storage.get(lens.view), id), id);
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
                            )
                                expr =
                                    i.field === undefined
                                        ? `${wrapperFunction(i.wrapper!)}((${value(i.callee)}).environment${args.map((a) => `, ${a}`).join('')})`
                                        : `(${value(i.callee)}).${identifier(i.field)}((${value(i.callee)}).environment${args.map((a) => `, ${a}`).join('')})`;
                            else if (w?.kind === 'native') {
                                expr =
                                    simpleNative(
                                        requireImport(w.definition, 'c').name,
                                        args,
                                        id,
                                        abi.arguments,
                                    ) ?? unsupported(`Native import ${w.definition}`);
                            } else return unsupported('Disposer invocation');
                        }
                        declare(id, expr, body, name);
                        values.set(i.out.id, name);
                        if (isLens)
                            lenses.set(
                                i.out.id,
                                runtimeLens(name, id, (body) =>
                                    adapters.forEach((a) => a.finish(body)),
                                ),
                            );
                        else adapters.forEach((a) => a.finish(body));
                        continue;
                    }
                    default:
                        return unsupported(`Unknown operation ${(i as { op: string }).op}`);
                }
                declare(id, expr, body, name);
                values.set(i.out.id, name);
            }
            const finish = (body: Statement[]) =>
                b.cleanup.forEach((c) => {
                    if (c.kind === 'release') {
                        const lens = loans.get(c.loan);
                        if (lens) lens.finish(body);
                    } else if (c.kind === 'drop-place') {
                        drop(storage.get(ref(c.slot)), body);
                        storage.put(ref(c.slot), { expression: zero(unit.id), layout: unit.id });
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
        const outputLayouts = new Map<string, string>();
        const index = (b: ConcreteBlock) =>
            b.instructions.forEach((i) => {
                if ('out' in i) outputLayouts.set(i.out.id, i.out.layout);
                if (i.op === 'scope') index(i.body);
                if (i.op === 'manual') index(i.cleanup);
                if (i.op === 'case') i.cases.forEach((a) => index(a.body));
            });
        index(c.body);
        const body: Statement[] = [
            '(void)environment;',
            ...c.parameters.map((_, i) => `(void)arg${i};`),
            ...setup,
        ];
        c.captures.forEach((capture, i) => {
            const name = declare(
                capture.layout,
                `((${type(c.environment)} *)environment)->capture${i}`,
                body,
            );
            places.set(capture.place, storage.own({ expression: name, layout: capture.layout }));
        });
        if (c.captures.length) body.push('release_context(environment);');
        const result = block(c.body, body);
        if (lenses.has(c.body.result)) {
            const lens = lenses.get(c.body.result)!;
            const h = helperCounter++,
                context = `Restore${h}`,
                restore = `restore${h}`;
            const candidates = [...variables];
            const contextFields: string[] = [];
            const initial: Statement[] = [];
            const build = (view: View, id: string, path: string): string => {
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const r = `focus${path}`,
                        output = l.fields.find((f) => f.name === 'replacement');
                    contextFields.push(`${type(input.layout)} ${r};`);
                    initial.push(`ctx->${r} = ${read(storage.get(view), input.layout)};`);
                    if (output?.kind === 'pointer' && output.layout)
                        contextFields.push(`${type(output.layout)} ${r}out;`);
                    return `(${type(id)}){.read=&ctx->${r}${output ? `, .replacement=&ctx->${r}out` : ''}}`;
                }
                return `(${type(id)}){${
                    l.fields
                        .filter((f) => f.name.startsWith('item'))
                        .map(
                            (f, i) =>
                                `.${f.name}=${build(storage.project(view, [i]), (f as { layout: string }).layout, path + '_' + i)}`,
                        )
                        .join(', ') || '0'
                }}`;
            };
            const resultExpression = build(lens.view, c.body.layout, '');
            const replacement = endpoint(c.body.layout, 'replacement');
            const saved = storage.snapshot();
            storage.put(lens.view, { expression: 'replacement', layout: replacement });
            const cleanup: Statement[] = [];
            lens.finish(cleanup);
            flushParameters(cleanup);
            storage.reset(saved);
            const references = new Set<string>();
            const inspect = (body: Statement[]) =>
                body.forEach((s) => {
                    if (typeof s === 'string')
                        for (const name of s.matchAll(/\b[A-Za-z_][A-Za-z_0-9]*\b/g))
                            references.add(name[0]);
                    else {
                        for (const name of s.head.matchAll(/\b[A-Za-z_][A-Za-z_0-9]*\b/g))
                            references.add(name[0]);
                        inspect(s.body);
                    }
                });
            inspect(cleanup);
            const captured = candidates.filter((v) => references.has(v.name));
            contextFields.unshift(...captured.map((v) => `${v.type} ${v.name};`));
            const names = new Set(captured.map((v) => v.name));
            const rewrite = (s: string) =>
                s.replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g, (n) => (names.has(n) ? `ctx->${n}` : n));
            const translate = (b: Statement[]): Statement[] =>
                b.map((s) =>
                    typeof s === 'string'
                        ? rewrite(s)
                        : { head: rewrite(s.head), body: translate(s.body) },
                );
            declarations.push(
                `typedef struct { ${contextFields.join(' ') || 'unsigned char inhabitant;'} } ${context};`,
            );
            declarations.push(
                `${type(unit.id)} ${restore}(void *opaque, ${type(replacement)} replacement);`,
            );
            helpers.push({
                signature: `${type(unit.id)} ${restore}(void *opaque, ${type(replacement)} replacement)`,
                body: [
                    `${context} *ctx = opaque;`,
                    '(void)replacement;',
                    ...translate(cleanup),
                    'release_context(ctx);',
                    `return ${zero(unit.id)};`,
                ],
            });
            body.push(`${context} *ctx = allocate_context(sizeof *ctx);`, {
                head: 'if (!ctx)',
                body: ['abort();'],
            });
            captured.forEach((v) => body.push(`ctx->${v.name} = ${v.name};`));
            body.push(...initial);
            const out = fresh();
            body.push(
                `${type(c.body.layout)} ${out} = ${resultExpression};`,
                `${out}.restore = ${restore};`,
                `${out}.context = ctx;`,
                `return ${out};`,
            );
        } else {
            flushParameters(body);
            body.push(`return ${result};`);
        }
        return { signature: signature(c), body };
    });
    // Helpers generated while emitting the entry adapter (result printing and drops) follow.
    const emittedHelpers = helpers.length;
    functions.push(
        ...helpers,
        ...(runtime?.functions ?? []),
        {
            signature: 'void *allocate_context(size_t size)',
            body: [
                'void *context = malloc(size);',
                { head: 'if (!context)', body: ['abort();'] },
                '++live_contexts;',
                'return context;',
            ],
        },
        {
            signature: 'void release_context(void *context)',
            body: [
                { head: 'if (!context || live_contexts == 0)', body: ['abort();'] },
                '--live_contexts;',
                'free(context);',
            ],
        },
    );
    // Test-only structured result adapter; never exports borrowed storage.
    const print = (expr: string, id: string, body: Statement[]) => {
        const l = layout(id);
        if (l.kind === 'f64') body.push(`print_number(${expr});`);
        else if (l.kind === 'bool') body.push(`fputs(${expr} ? "true" : "false", stdout);`);
        else if (l.kind === 'unit') body.push('fputs("null", stdout);');
        else if (l.kind === 'string') body.push(`print_string(${expr});`);
        else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
            body.push('putchar(91);');
            l.fields.forEach((f, i) => {
                if (i) body.push('putchar(44);');
                print(field(expr, i), (f as { layout: string }).layout, body);
            });
            body.push('putchar(93);');
        } else if (l.kind === 'union') {
            const names = l.fields.map((f) => f.name);
            const list = names.length === 2 && names[0] === 'nil' && names[1] === 'cons';
            const name = unionHelper('print', id, 'void', (body) => {
                if (list) {
                    // The reference protocol prints cons cells as one JSON array.
                    const cell = variant(id, 1);
                    const tail = layout(cell.layout).fields[1] as { layout: string };
                    if (tail.layout !== id) return unsupported('List tail changed its layout');
                    body.push('int first = 1;', 'putchar(91);');
                    const loop: Statement[] = [
                        { head: 'if (!first)', body: ['putchar(44);'] },
                        'first = 0;',
                    ];
                    print(
                        field(payload('value', id, 1), 0),
                        (layout(cell.layout).fields[0] as { layout: string }).layout,
                        loop,
                    );
                    loop.push(`value = ${field(payload('value', id, 1), 1)};`);
                    body.push({ head: 'while (value.tag == 1)', body: loop }, 'putchar(93);');
                    return;
                }
                l.fields.forEach((f, n) => {
                    const v = variant(id, n);
                    const arm: Statement[] = [
                        `fputs("{\\"kind\\":\\"variant\\",\\"name\\":\\"${identifier(f.name)}\\",\\"items\\":[", stdout);`,
                    ];
                    const contents = payload('value', id, n);
                    const arity = (
                        program.semantic.generic.imports.find(
                            (s) => s.definition === `constructor/${f.name}`,
                        )?.type as { args?: unknown[] } | undefined
                    )?.args?.length;
                    if (arity === undefined) return unsupported(`Unknown constructor ${f.name}`);
                    if (arity === 1) print(contents, v.layout, arm);
                    else
                        for (let k = 0; k < arity; k++) {
                            if (k) arm.push('putchar(44);');
                            print(
                                field(contents, k),
                                (layout(v.layout).fields[k] as { layout: string }).layout,
                                arm,
                            );
                        }
                    arm.push('fputs("]}", stdout);');
                    body.push({ head: `${n ? 'else if' : 'if'} (value.tag == ${n})`, body: arm });
                });
            });
            body.push(`${name}(${expr});`);
        } else unsupported('Entry result requires a host contract');
    };
    declarations.push('void print_number(double x);');
    functions.push({
        signature: 'void print_number(double x)',
        body: [
            { head: 'if (isnan(x))', body: ['fputs("{\\"number\\":\\"NaN\\"}", stdout);'] },
            {
                head: 'else if (isinf(x))',
                body: [
                    'fputs(x < 0 ? "{\\"number\\":\\"-Infinity\\"}" : "{\\"number\\":\\"Infinity\\"}", stdout);',
                ],
            },
            {
                head: 'else if (x == 0 && signbit(x))',
                body: ['fputs("{\\"number\\":\\"-0\\"}", stdout);'],
            },
            { head: 'else', body: ['printf("%.17g", x);'] },
        ],
    });
    const main: Statement[] = [];
    const host = usesHost(imports);
    for (const entry of program.entries) {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) unsupported('Function entry requires an explicit host adapter');
        const v = `result${main.length}`;
        main.push(`${type(c.body.layout)} ${v} = ${codes.get(entry)}(NULL);`, `(void)${v};`);
        // With host output on stdout, a record separator (U+001E) introduces each result.
        if (host) main.push('putchar(30);');
        print(v, c.body.layout, main);
        main.push('putchar(10);');
        drop({ expression: v, layout: c.body.layout }, main);
    }
    main.push({ head: 'if (live_contexts != 0)', body: ['abort();'] }, 'return 0;');
    functions.push({ signature: 'int main(void)', body: main });
    functions.push(...helpers.slice(emittedHelpers));
    return { declarations, functions };
}
