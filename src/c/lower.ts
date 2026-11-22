import { Declaration, reachableNames, typeDependencies } from '../backend/reachable.ts';
import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import { Storage, type Cell, type Data, type View } from './storage.ts';
import { decodeNumber, type IRPattern, type SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { cSyntax, identifier, type Statement, type TranslationUnit } from './syntax.ts';
import { Locals } from '../backend/imperative/locals.ts';
import { isExpr, same, type Expr } from '../backend/imperative/code.ts';
import { isLocal, isScope, mapScope, visit } from '../backend/imperative/statements.ts';
import { appendPart, cBytes, stringRuntime, stringType } from './strings.ts';
import { requireImport, usesHost } from '../runtime-imports.ts';
import { functionNames } from '../backend/names.ts';
import { localNames, takesName } from '../backend/local-names.ts';
import { layoutNames, unionTagNames } from '../backend/type-names.ts';
import { CNames, cScalars } from './names.ts';

type Completion = (body: Statement[]) => void;
type Lens = { view: View; finish: Completion };
type Variable = { name: string; type: string };
const unsupported = (message: string): never => {
    throw new BackendDiagnostic('unsupported-c', message);
};
/** -Wall -Werror rejects unread locals and parameters; mark exactly those as used. */
function suppressUnused(
    locals: Locals,
    body: Statement[],
    parameters: readonly string[],
): Statement[] {
    const used = locals.reads(body);
    const walk = (array: Statement[]): Statement[] =>
        array.flatMap((s): Statement[] => {
            if (Array.isArray(s)) return [walk(s)];
            if (isLocal(s) && s.kind === 'local' && !used.has(s.name))
                return [s, locals.template`(void)${s.name};`];
            if (isScope(s)) return [mapScope(s, (e) => e, walk)];
            return [s];
        });
    return [
        ...parameters.filter((n) => !used.has(n)).map((n) => locals.template`(void)${n};`),
        ...walk(body),
    ];
}
/** A host export: the program entry at `entry` becomes the public C function `symbol`. */
export type CExport = { symbol: string; entry: number };

/**
 * Lower to C. Without exports, the translation unit is a test program whose `main`
 * prints each entry's result. With exports, it is a library: each export is a public
 * function with a host ABI, described by the returned header, and there is no `main`.
 */
export function lowerC(
    program: ConcreteProgram,
    options: { exports?: readonly CExport[]; optimize?: boolean } = {},
): TranslationUnit {
    verifyConcreteProgram(program);
    // Every import reaching C must be registered, implemented and available on the target.
    const imports = program.semantic.program.imports
        .map((i) => i.definition)
        .filter((d) => d.startsWith('native/'));
    imports.forEach((d) => requireImport(d, 'c', program.target));
    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    // Host export symbols are fixed by the caller; every other name avoids them.
    const packageNames = new CNames((options.exports ?? []).map((e) => e.symbol));
    const codes = functionNames(program, packageNames);
    const { names, abis: abiNames } = layoutNames(program, packageNames, cScalars);
    const tags = unionTagNames(program, names, packageNames);
    const tagValue = (id: string, n: number) => tags.get(id)![n]!;
    // Each body's parameter and local names avoid every package name it can call.
    const naming = new Map(
        program.code.map((c) => [c.id, localNames(program, c, new CNames(packageNames.taken))]),
    );
    const declarationTypes = typeDependencies(program, names, abiNames);
    const typeRoots = new Set<string>();
    let trackTypeUses = false;
    const type = (id: string) => {
        const name = names.get(id)!;
        if (trackTypeUses) typeRoots.add(name);
        return name;
    };
    const layout = (id: string) => layouts.get(id)!;
    // Unit captures carry no information or ownership. Keep the concrete ABI and
    // verifier contract intact; reconstruct these values at the C boundary.
    const erasedEnvironment = (captures: readonly { layout: string }[]) =>
        !!options.optimize && captures.every((c) => layout(c.layout).kind === 'unit');
    const unit = program.layouts.find((l) => l.kind === 'unit')!;
    // Function bodies assemble expressions as trees for the shared passes. Package
    // text (declarations, signatures, helper bodies) needs no structure.
    let activeLocals: Locals | undefined;
    const cText = (strings: TemplateStringsArray, ...parts: unknown[]): string =>
        strings.reduce((s, piece, i) => s + (i ? String(parts[i - 1]) : '') + piece, '');
    const cc = (strings: TemplateStringsArray, ...parts: unknown[]): Expr =>
        activeLocals ? activeLocals.template(strings, ...parts) : cText(strings, ...parts);
    const joinCode = (parts: readonly unknown[], separator: string): Expr =>
        activeLocals ? activeLocals.join(parts, separator) : parts.join(separator);
    // Member names are syntax, even when a source local has the same spelling.
    const member = (name: string): Expr =>
        activeLocals ? activeLocals.literal(identifier(name)) : identifier(name);
    const zero = (id: string): Expr => cc`(${type(id)}){0}`;
    const field = (expr: Expr, n: number): Expr => cc`(${expr}).item${n}`;
    /** Element layout of a vector layout. */
    const element = (id: string): string => {
        const f = layout(id).fields[0];
        return f?.kind === 'pointer' && f.layout
            ? f.layout
            : unsupported('Malformed vector layout');
    };
    const storage = new Storage((s) =>
        layout(s.layout).fields.map((f, i) => {
            if (f.kind !== 'value' || !f.name.startsWith('item'))
                return unsupported('Non-data projection');
            return {
                expression: field(s.expression, i),
                layout: f.layout,
                ...(s.address ? { address: cc`&(*${s.address}).item${i}` } : {}),
            };
        }),
    );
    const read = (data: Data, id: string): Expr => {
        if (layout(id).kind === 'unit') return zero(id);
        if (!Array.isArray(data) && data.layout === id) return data.expression;
        const parts = storage.parts(data),
            fields = layout(id).fields;
        if (!fields.length || parts.length !== fields.length)
            return unsupported('Mismatched storage read');
        return cc`(${type(id)}){${
            joinCode(
                parts.map((d, i) => read(d, (fields[i] as { layout: string }).layout)),
                ', ',
            ) || '0'
        }}`;
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
    const incoming = (expression: Expr, id: string): View => {
        const l = layout(id),
            f = l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout)
            return storage.own({
                expression: cc`*(${expression}).read`,
                layout: f.layout,
                address: cc`(${expression}).read`,
            });
        return l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) =>
                incoming(cc`(${expression}).${member(f.name)}`, (f as { layout: string }).layout),
            );
    };
    const flush = (expression: Expr, id: string, data: Data, body: Statement[]) => {
        const l = layout(id),
            f =
                l.fields.find((f) => f.name === 'replacement') ??
                l.fields.find((f) => f.name === 'read');
        if (f?.kind === 'pointer' && f.layout) {
            // An address denotes a live read of that exact storage, not a
            // snapshot. Restoring it to itself cannot change the owner.
            if (
                !Array.isArray(data) &&
                data.layout === f.layout &&
                same(data.address, cc`(${expression}).${member(f.name)}`)
            )
                return;
            body.push(cc`*(${expression}).${member(f.name)} = ${read(data, f.layout)};`);
            return;
        }
        const parts = storage.parts(data);
        l.fields
            .filter((f) => f.name.startsWith('item'))
            .forEach((f, i) =>
                flush(
                    cc`(${expression}).${member(f.name)}`,
                    (f as { layout: string }).layout,
                    parts[i]!,
                    body,
                ),
            );
    };
    const declarations: (string | Declaration)[] = [
        '#include <stdio.h>',
        '#include <stdlib.h>',
        '#include <math.h>',
        '#include <stdint.h>',
        '#include <stdbool.h>',
    ];
    const declareType = (name: string, text: string) =>
        declarations.push(new Declaration(name, text, declarationTypes.get(name)));
    const retainedDeclarations = (): string[] => {
        const live = reachableNames(declarationTypes, typeRoots);
        return declarations
            .filter((d) => !(d instanceof Declaration) || live.has(d.name))
            .map(String);
    };
    const strings = program.layouts.some((l) => l.kind === 'string');
    const runtime = strings ? stringRuntime() : undefined;
    if (runtime)
        declarations.push(
            '#include <string.h>',
            runtime.declarations[0]!,
            runtime.declarations[1]!,
        );
    for (const l of program.layouts)
        if (l.kind === 'string')
            declareType(type(l.id), cText`typedef ${stringType} *${type(l.id)};`);
        else if (l.kind !== 'f64' && l.kind !== 'bool')
            declareType(type(l.id), cText`typedef struct ${type(l.id)} ${type(l.id)};`);
    for (const a of program.abis)
        declareType(
            abiNames.get(a.id)!,
            cText`typedef ${type(a.result)} (*${abiNames.get(a.id)})(void *${a.arguments.map((id) => `, ${type(id)}`).join('')});`,
        );
    for (const l of program.layouts)
        if (l.kind === 'union') {
            declareType(
                type(l.id),
                cText`enum { ${l.fields.map((_, n) => `${tagValue(l.id, n)} = ${n}`).join(', ')} };`,
            );
            // Tagged union; boxed variants hold an owned heap payload.
            const variants = l.fields.map((f, n) =>
                f.kind === 'value'
                    ? cc`${type(f.layout)} v${n};`
                    : f.kind === 'pointer' && f.layout
                      ? cc`${type(f.layout)} *v${n};`
                      : unsupported('Union variant requires data storage'),
            );
            declareType(
                type(l.id),
                cText`struct ${type(l.id)} { uint32_t tag; union { ${variants.join(' ')} } as; };`,
            );
        } else if (l.kind === 'vector') {
            // Owned element buffer; the struct itself moves by value.
            declareType(
                type(l.id),
                cText`struct ${type(l.id)} { ${type(element(l.id))} *elements; size_t length; size_t capacity; };`,
            );
        } else if (!['f64', 'bool', 'string'].includes(l.kind)) {
            declareType(
                type(l.id),
                cText`struct ${type(l.id)} { ${l.fields.map((f) => (f.kind === 'value' ? cc`${type(f.layout)} ${member(f.name)};` : f.kind === 'pointer' ? cc`${f.layout ? type(f.layout) : 'void'} *${member(f.name)};` : cc`${abiNames.get(f.abi)} ${member(f.name)};`)).join(' ') || 'unsigned char inhabitant;'} };`,
            );
        }
    // Everything below is retained executable code or its auxiliary declarations.
    // Type uses are conservative roots, including declarations later simplified away.
    trackTypeUses = true;
    const signature = (c: ConcreteProgram['code'][number]) =>
        cText`${type(c.body.layout)} ${codes.get(c.id)}(void *environment${c.parameters.map((p, i) => `, ${type(p.layout)} ${naming.get(c.id)!.parameterNames[i]}`).join('')})`;
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
        program.wrappers.filter((w) => w.kind === 'dispose').map((w, i) => [w.id, cc`dispose${i}`]),
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
        const key = cText`${kind}:${id}`;
        const existing = unionHelpers.get(key);
        if (existing) return existing;
        const name = cText`${kind}_${type(id)}`;
        unionHelpers.set(key, name);
        const signature = cText`${result} ${name}(${parameter} value)`;
        declarations.push(signature + ';');
        const body: Statement[] = ['(void)value;'];
        generate(body);
        helpers.push({ signature, body });
        return name;
    };
    /** Vector operations are C functions generated once per vector layout on first use. */
    const vectorHelpers = new Map<string, string>();
    const vectorHelper = (
        kind: string,
        id: string,
        result: string,
        parameters: string,
        generate: (body: Statement[]) => void,
    ): string => {
        const key = cText`${kind}:${id}`;
        const existing = vectorHelpers.get(key);
        if (existing) return existing;
        const name = cText`vector_${kind}_${type(id)}`;
        vectorHelpers.set(key, name);
        const signature = cText`${result} ${name}(${parameters})`;
        declarations.push(signature + ';');
        const body: Statement[] = [];
        generate(body);
        helpers.push({ signature, body });
        return name;
    };
    /** `[:push:]` consumes the vector and appends, doubling the buffer when it is full. */
    const vectorPush = (id: string): string =>
        vectorHelper(
            'push',
            id,
            type(id),
            cText`${type(id)} value, ${type(element(id))} item`,
            (body) =>
                body.push(
                    {
                        head: 'if (value.length == value.capacity)',
                        body: [
                            'size_t capacity = value.capacity ? value.capacity * 2 : 4;',
                            cc`${type(element(id))} *elements = allocate_context(capacity * sizeof *elements);`,
                            {
                                head: 'for (size_t i = 0; i < value.length; i++)',
                                body: ['elements[i] = value.elements[i];'],
                            },
                            {
                                head: 'if (value.elements)',
                                body: ['release_context(value.elements);'],
                            },
                            'value.elements = elements;',
                            'value.capacity = capacity;',
                        ],
                    },
                    'value.elements[value.length++] = item;',
                    'return value;',
                ),
        );
    /** `array(n, init)`: n deep copies of init; the last element takes init itself. */
    const vectorArray = (id: string): string =>
        vectorHelper(
            'array',
            id,
            type(id),
            cText`double length, ${type(element(id))} init`,
            (body) => {
                const none: Statement[] = [];
                drop({ expression: 'init', layout: element(id) }, none);
                body.push(
                    {
                        head: 'if (!(length >= 0) || length != floor(length) || length > (double)(SIZE_MAX / sizeof init))',
                        body: ['abort();'],
                    },
                    cc`${type(id)} value = {0};`,
                    { head: 'if (length == 0)', body: [...none, 'return value;'] },
                    'value.length = value.capacity = (size_t)length;',
                    'value.elements = allocate_context(value.length * sizeof *value.elements);',
                    {
                        head: 'for (size_t i = 0; i + 1 < value.length; i++)',
                        body: [cc`value.elements[i] = ${duplicate('init', element(id))};`],
                    },
                    'value.elements[value.length - 1] = init;',
                    'return value;',
                );
            },
        );
    /** Address of element `index`, trapping unless it is an integer in range. */
    const vectorAt = (id: string): string =>
        vectorHelper(
            'at',
            id,
            cText`${type(element(id))} *`,
            cText`${type(id)} value, double index`,
            (body) =>
                body.push(
                    {
                        head: 'if (!(index >= 0) || index != floor(index) || index >= (double)value.length)',
                        body: ['abort();'],
                    },
                    'return &value.elements[(size_t)index];',
                ),
        );
    const variant = (id: string, n: number) => {
        const f = layout(id).fields[n]!;
        if (f.kind === 'code' || !f.layout)
            return unsupported('Union variant requires data storage');
        return { boxed: f.kind === 'pointer', layout: f.layout, name: f.name };
    };
    const tagOf = (id: string, name: string): number => {
        const n = layout(id).fields.findIndex((f) => f.name === name);
        return n < 0 ? unsupported(cText`Constructor ${name} is absent from its union layout`) : n;
    };
    /** Payload of variant `n`, read through its box when the variant is boxed. */
    const payload = (expr: Expr, id: string, n: number): Expr =>
        variant(id, n).boxed ? cc`(*(${expr}).as.v${n})` : cc`(${expr}).as.v${n}`;
    /** Deep copy for affine `dup`: each boxed payload gets its own allocation. */
    const duplicate = (expr: Expr, id: string): Expr => {
        const l = layout(id);
        if (l.kind === 'union')
            return cc`${unionHelper('dup', id, type(id), (body) => {
                body.push(cc`${type(id)} copy = value;`);
                l.fields.forEach((_, n) => {
                    const v = variant(id, n);
                    const copied = duplicate(payload('value', id, n), v.layout);
                    body.push({
                        head: cc`${n ? 'else if' : 'if'} (value.tag == ${tagValue(id, n)})`,
                        body: v.boxed
                            ? [
                                  cc`copy.as.v${n} = allocate_context(sizeof *copy.as.v${n});`,
                                  cc`*copy.as.v${n} = ${copied};`,
                              ]
                            : [cc`copy.as.v${n} = ${copied};`],
                    });
                });
                body.push('return copy;');
            })}(${expr})`;
        if (l.kind === 'string') return cc`string_dup(${expr})`;
        if (l.kind === 'vector')
            return cc`${vectorHelper('dup', id, type(id), cText`${type(id)} value`, (body) =>
                body.push(
                    cc`${type(id)} copy = {0};`,
                    { head: 'if (!value.length)', body: ['return copy;'] },
                    'copy.length = copy.capacity = value.length;',
                    'copy.elements = allocate_context(copy.length * sizeof *copy.elements);',
                    {
                        head: 'for (size_t i = 0; i < value.length; i++)',
                        body: [
                            cc`copy.elements[i] = ${duplicate('value.elements[i]', element(id))};`,
                        ],
                    },
                    'return copy;',
                ),
            )}(${expr})`;
        if (l.kind === 'record' && l.fields.every((f) => f.kind === 'value'))
            return cc`(${type(id)}){${joinCode(
                l.fields.map((f, n) => duplicate(field(expr, n), (f as { layout: string }).layout)),
                ', ',
            )}}`;
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
                    if (v.boxed) arm.push(cc`release_context(value.as.v${n});`);
                    if (arm.length)
                        body.push({
                            head: cc`${body.length > 1 ? 'else if' : 'if'} (value.tag == ${tagValue(id, n)})`,
                            body: arm,
                        });
                });
                body.push(cc`return ${zero(unit.id)};`);
            });
            body.push(cc`${name}(${data.expression});`);
        } else if (l.kind === 'string') {
            body.push(cc`string_drop(${data.expression});`);
        } else if (l.kind === 'vector') {
            const id = data.layout;
            const name = vectorHelper('drop', id, 'void', cText`${type(id)} value`, (body) => {
                const each: Statement[] = [];
                drop({ expression: 'value.elements[i]', layout: element(id) }, each);
                if (each.length)
                    body.push({ head: 'for (size_t i = 0; i < value.length; i++)', body: each });
                body.push({
                    head: 'if (value.elements)',
                    body: ['release_context(value.elements);'],
                });
            });
            body.push(cc`${name}(${data.expression});`);
        } else if (l.fields.some((f) => f.name === 'dispose')) {
            body.push({
                head: cc`if ((${data.expression}).dispose)`,
                body: [cc`(${data.expression}).dispose((${data.expression}).environment);`],
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
        return unionHelper(
            'char_list',
            result,
            type(result),
            (body) => {
                body.pop();
                body.push(
                    cc`${type(result)} out = (${type(result)}){.tag=${tagValue(result, nil)}, .as.v${nil}=${zero(variant(result, nil).layout)}};`,
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
                            cc`${type(cell.layout)} *cell = allocate_context(sizeof *cell);`,
                            cc`*cell = (${type(cell.layout)}){(${type(text)})string_new((const char *)value->bytes + start, end - start), out};`,
                            cc`out = (${type(result)}){.tag=${tagValue(result, cons)}, .as.v${cons}=cell};`,
                            'end = start;',
                        ],
                    },
                    'string_drop(value);',
                    'return out;',
                );
            },
            type(text),
        );
    };
    /** Natives that take and return plain data, by registered name. Lens natives are separate. */
    const simpleNative = (
        op: string,
        args: Expr[],
        result: string,
        parameters: readonly string[],
    ): Expr | undefined => {
        if (['+', '-', '*', '/', '==', '>=', '<='].includes(op))
            return activeLocals
                ? activeLocals.binary(op, args[0]!, args[1]!)
                : cc`(${args[0]} ${op} ${args[1]})`;
        if (op === 'charList') return cc`${charList(result)}(${args[0]})`;
        if (op === 'heapsize') return '0.0';
        if (op === '[::]') return zero(result);
        if (op === '[:push:]') return cc`${vectorPush(result)}(${args[0]}, ${args[1]})`;
        if (op === 'array') return cc`${vectorArray(result)}(${args[0]}, ${args[1]})`;
        if (op === 'round')
            return cc`${unionHelper('round', result, type(result), (body) =>
                body.push(
                    'double rounded = floor(value);',
                    { head: 'if (value - rounded >= 0.5)', body: ['rounded += 1;'] },
                    // Math.round keeps the sign of a zero result, e.g. round(-0.4) is -0.
                    { head: 'if (rounded == 0)', body: ['rounded = copysign(0.0, value);'] },
                    'return rounded;',
                ),
            )}(${args[0]})`;
        if (op === 'print')
            return cc`${unionHelper(
                'host_print',
                result,
                type(result),
                (body) =>
                    body.push(
                        {
                            head: 'if (value)',
                            body: ['fwrite(value->bytes, 1, value->length, stdout);'],
                        },
                        'putchar(10);',
                        'string_drop(value);',
                        cc`return ${zero(result)};`,
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        if (op === 'getInput')
            return cc`${unionHelper(
                'host_input',
                result,
                type(result),
                (body) =>
                    body.push(
                        {
                            head: 'if (value)',
                            body: ['fwrite(value->bytes, 1, value->length, stdout);'],
                        },
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
        const signature = cText`${type(unit.id)} ${disposers.get(w.id)}(void *environment)`;
        declarations.push(signature + ';');
        const body: Statement[] = [cc`${type(w.environment)} *captured = environment;`];
        w.captures.forEach((id, i) =>
            drop({ expression: cc`captured->capture${i}`, layout: id }, body),
        );
        body.push('release_context(captured);', cc`return ${zero(unit.id)};`);
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
        const name = cText`native${nativeCodes.size}`;
        nativeCodes.set(w.id, name);
        const signature = cText`${type(abi.result)} ${name}(void *environment${abi.arguments.map((id, i) => cText`, ${type(id)} arg${i}`).join('')})`;
        declarations.push(signature + ';');
        const body: Statement[] = [
            '(void)environment;',
            ...abi.arguments.map((_, i) => cc`(void)arg${i};`),
        ];
        let result: Expr;
        const op = requireImport(w.definition, 'c').name;
        const simple = simpleNative(
            op,
            abi.arguments.map((_, i) => `arg${i}`),
            abi.result,
            abi.arguments,
        );
        if (simple !== undefined) result = simple;
        else if (op === 'size') {
            const vector = endpoint(abi.arguments[0]!, 'read');
            result = cc`(double)(${read(storage.get(incoming('arg0', abi.arguments[0]!)), vector)}).length`;
        } else if (op === 'dup')
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
                            cc`arg0.replacement->${member(to.name)} = arg0.read->${member(from.name)};`,
                        );
                    }
                }
                result = cc`(${type(abi.result)}){.read=&arg0.read->item0${output.fields.some((f) => f.name === 'replacement') ? cc`, .replacement=&arg0.${replacement ? 'replacement' : 'read'}->item0` : ''}}`;
            } else result = 'arg0.item0';
        } else return unsupported(cText`Native import ${w.definition}`);
        body.push(cc`return ${result};`);
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
        const signature = cText`${type(abi.result)} ${resultAdapters.get(w.id)}(void *environment${abi.arguments.map((id, n) => cText`, ${type(id)} arg${n}`).join('')})`;
        declarations.push(signature + ';');
        const sourceCode =
            source.kind === 'invoke' ? codes.get(source.code)! : nativeCodes.get(source.id)!;
        if (w.kind === 'adapt-lens-result') {
            const context = cc`LensResult${resultAdapters.get(w.id)}`,
                restore = cc`restore_${resultAdapters.get(w.id)}`;
            const input = endpoint(abi.result, 'read'),
                replacement = endpoint(abi.result, 'replacement');
            const separate = layout(abi.result).fields.some((f) => f.name === 'replacement');
            declarations.push(
                cText`typedef struct { ${type(raw.result)} source; ${type(input)} read; ${separate ? cc`${type(replacement)} write;` : ''} } ${context};`,
            );
            const restoreSignature = cText`${type(unit.id)} ${restore}(void *environment, ${type(replacement)} replacement)`;
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
                    cc`${context} *ctx = environment;`,
                    {
                        head: 'if (ctx->source.restore)',
                        body: ['ctx->source.restore(ctx->source.context, replacement);'],
                    },
                    { head: 'else', body: fallback },
                    'release_context(ctx);',
                    cc`return ${zero(unit.id)};`,
                ],
            });
            helpers.push({
                signature,
                body: [
                    cc`${type(raw.result)} result = ${sourceCode}(environment${abi.arguments.map((_, n) => cc`, arg${n}`).join('')});`,
                    cc`${context} *ctx = allocate_context(sizeof *ctx);`,
                    'ctx->source = result;',
                    cc`ctx->read = ${read(storage.get(incoming('ctx->source', raw.result)), input)};`,
                    cc`return (${type(abi.result)}){.read=&ctx->read${separate ? ', .replacement=&ctx->write' : ''}, .restore=${restore}, .context=ctx};`,
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
        const values = new Map<string, Expr>(),
            lenses = new Map<string, Lens>(),
            places = new Map<string, View>();
        const locals = new Locals(cSyntax);
        activeLocals = locals;
        let counter = 0;
        const fresh = () => locals.reference(`v${counter++}`);
        const { parameterNames: sources, bindingName, versionName, hint } = naming.get(c.id)!;
        const parameterNames = ['environment', ...sources];
        parameterNames.forEach((n) => locals.reference(n));
        const variables: Variable[] = c.parameters.map((p, i) => ({
            name: sources[i]!,
            type: type(p.layout),
        }));
        const lensSlots = new Map<string, SlotRef>();
        const declare = (
            id: string,
            expression: Expr,
            body: Statement[],
            name = fresh(),
            options: { pure?: boolean; inline?: boolean } = {},
        ): string => {
            variables.push({ name, type: type(id) });
            body.push(
                locals.declaration(name, type(id), expression, {
                    ...options,
                    zeroInitial: same(expression, zero(id)),
                }),
            );
            return name;
        };
        /** A local that raw statements write through or address: never substituted or pruned. */
        const cell = (name: string, ctype: string, init: Expr | undefined, body: Statement[]) => {
            variables.push({ name, type: ctype });
            body.push(locals.declaration(name, ctype, init));
            locals.mutable(name);
            return name;
        };
        const setup: Statement[] = [];
        /** Boxes kept by borrowed matches, by reconstruction id, until a construct reuses them. */
        const retainedBoxes = new Map<string, string>();
        /** Reconstructions whose temporary lens is the retained box's payload. */
        const inPlaceIds = new Set<string>();
        /** Storage cells that are a retained box's payload. */
        const inPlaceCells = new Set<Cell>();
        /** The live leaf an in-place field had before a move emptied it, by cell and path. */
        const homes = new Map<Cell, Map<string, Data>>();
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
            return text.startsWith('&') ? text.slice(1) : cc`*${address}`;
        };
        /** Store each payload field that no longer reads its own live storage. */
        const writeBack = (before: Data, after: Data, id: string, body: Statement[]) => {
            if (Array.isArray(before) || !before.address) return;
            if (!Array.isArray(after) && same(after.address, before.address)) return;
            const items = layout(id).fields.filter((f) => f.name.startsWith('item'));
            if (layout(id).kind !== 'record' || !items.length) {
                body.push(cc`${through(before.address)} = ${read(after, id)};`);
                return;
            }
            const from = storage.parts(before),
                to = storage.parts(after);
            items.forEach((f, n) =>
                writeBack(from[n]!, to[n]!, (f as { layout: string }).layout, body),
            );
        };
        const bind = (p: IRPattern, data: Data, body: Statement[] = setup, retains?: string) => {
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
                if (v.boxed && retains !== undefined && inPlaceIds.has(retains)) {
                    // The fields stay in the box and are read and written through it.
                    const box = cell(
                        fresh(),
                        `${type(v.layout)} *`,
                        cc`(${data.expression}).as.v${n}`,
                        body,
                    );
                    retainedBoxes.set(retains, box);
                    contents = { expression: cc`(*${box})`, layout: v.layout, address: box };
                } else if (v.boxed) {
                    contents = {
                        expression: declare(v.layout, contents.expression, body),
                        layout: v.layout,
                    };
                    if (retains !== undefined) {
                        // The reconstruction writes its payload into this box.
                        retainedBoxes.set(
                            retains,
                            cell(
                                fresh(),
                                `${type(v.layout)} *`,
                                cc`(${data.expression}).as.v${n}`,
                                body,
                            ),
                        );
                    } else body.push(cc`release_context((${data.expression}).as.v${n});`);
                }
                if (p.items.length === 1) bind(p.items[0]!, contents, body);
                else p.items.forEach((item, k) => bind(item, storage.parts(contents)[k]!, body));
            } else if (p.kind === 'drop' || p.kind === 'literal') drop(data, body);
        };
        const parameters: { expression: string; layout: string; view: View }[] = [];
        c.parameters.forEach((p, i) => {
            if (p.lensPlace) {
                const view = incoming(sources[i]!, p.layout);
                places.set(p.lensPlace, view);
                parameters.push({ expression: sources[i]!, layout: p.layout, view });
            } else bind(p.pattern, { expression: sources[i]!, layout: p.layout });
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
            // A same-layout lens over live storage (a field of an in-place box, or an
            // incoming lens) is passed by address: nothing is copied or restored.
            const l = layout(id),
                input = l.fields.find((f) => f.name === 'read');
            if (
                !escapes &&
                input?.kind === 'pointer' &&
                input.layout &&
                !l.fields.some((f) => f.name === 'replacement')
            ) {
                const d = storage.get(lens.view);
                if (!Array.isArray(d) && d.address && d.layout === input.layout) {
                    const live = d;
                    return {
                        expression: declare(id, cc`(${type(id)}){.read=${live.address}}`, body),
                        finish: (body) => {
                            storage.put(lens.view, live);
                            lens.finish(body);
                        },
                    };
                }
            }
            const index = helperCounter++,
                name = locals.reference(`back${index}`),
                fields: string[] = [],
                init: Statement[] = [];
            const build = (id: string, path: string): Expr => {
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const output = l.fields.find((f) => f.name === 'replacement');
                    const n = fields.length,
                        r = `read${n}`,
                        w = output ? `write${n}` : r;
                    fields.push(cText`${type(input.layout)} ${r};`);
                    const d = storage.get(
                        storage.project(lens.view, path ? path.split('.').map(Number) : []),
                    );
                    init.push(cc`${name}${escapes ? '->' : '.'}${r} = ${read(d, input.layout)};`);
                    if (output?.kind === 'pointer' && output.layout) {
                        fields.push(cText`${type(output.layout)} ${w};`);
                        init.push(cc`${name}${escapes ? '->' : '.'}${w} = ${zero(output.layout)};`);
                    }
                    return cc`(${type(id)}){.read=&${name}${escapes ? '->' : '.'}${r}${output ? cc`, .replacement=&${name}${escapes ? '->' : '.'}${w}` : ''}}`;
                }
                return cc`(${type(id)}){${
                    joinCode(
                        l.fields
                            .filter((f) => f.name.startsWith('item'))
                            .map(
                                (f, i) =>
                                    cc`.${member(f.name)}=${build((f as { layout: string }).layout, path ? path + '.' + i : String(i))}`,
                            ),
                        ', ',
                    ) || '0'
                }}`;
            };
            const expression = build(id, '');
            const backingType = `Backing${index}`;
            declarations.push(
                cText`typedef struct { ${fields.join(' ') || 'unsigned char inhabitant;'} } ${backingType};`,
            );
            cell(
                name,
                backingType + (escapes ? ' *' : ''),
                escapes ? cc`allocate_context(sizeof *${name})` : undefined,
                body,
            );
            if (escapes)
                body.push({ kind: 'if', arms: [{ condition: cc`!${name}`, body: ['abort();'] }] });
            body.push(...init);
            const arg = declare(id, expression, body);
            const outputs = (expr: Expr, id: string): Data => {
                const l = layout(id),
                    f =
                        l.fields.find((f) => f.name === 'replacement') ??
                        l.fields.find((f) => f.name === 'read');
                if (f?.kind === 'pointer' && f.layout)
                    return { expression: cc`*(${expr}).${member(f.name)}`, layout: f.layout };
                return l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .map((f) =>
                        outputs(cc`(${expr}).${member(f.name)}`, (f as { layout: string }).layout),
                    );
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
                    if (escapes) body.push(cc`release_context(${name});`);
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
                            head: cc`if ((${name}).restore)`,
                            body: [cc`(${name}).restore((${name}).context, ${replacement});`],
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
        const literal = (v: unknown, id: string): Expr =>
            v === null
                ? zero(id)
                : typeof v === 'boolean'
                  ? String(+v)
                  : typeof v === 'number'
                    ? // Integral literals beyond the safe range exceed every C integer type.
                      Number.isSafeInteger(v) || /[.e]/.test(String(v))
                        ? String(v)
                        : cc`${v}.0`
                    : v && typeof v === 'object' && 'number' in v
                      ? {
                            NaN: 'NAN',
                            Infinity: 'INFINITY',
                            '-Infinity': '(-INFINITY)',
                            '-0': '(-0.0)',
                        }[String(v.number)]!
                      : unsupported('Literal');
        const matches = (p: IRPattern, expr: Expr, id: string): Expr => {
            if (p.kind === 'literal') {
                if (layout(id).kind !== 'string')
                    return cc`${expr} == ${literal(p.value, unit.id)}`;
                if (typeof p.value !== 'string') return unsupported('String literal pattern');
                const text = cBytes(p.value);
                return cc`string_equals(${expr}, ${text.literal}, ${text.length})`;
            }
            const fields = layout(id).fields as { layout: string }[];
            if (p.kind === 'tuple')
                return (
                    joinCode(
                        p.items.map((p, i) => matches(p, field(expr, i), fields[i]!.layout)),
                        ' && ',
                    ) || '1'
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
            return joinCode(
                [cc`(${expr}).tag == ${tagValue(id, n)}`, ...items.filter((m) => !same(m, '1'))],
                ' && ',
            );
        };
        const block = (b: ConcreteBlock, body: Statement[]): Expr => {
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
                const hinted = hint(i, (id) => lensSlots.get(id));
                const id = i.out.layout,
                    name = hinted && takesName(i) ? locals.reference(versionName(hinted)) : fresh();
                let expr!: Expr;
                // Only side-effect-free values that read no memory may be inlined or pruned.
                let pure = false;
                /** Unused results of these are dropped: they only read or aggregate. */
                let removable = false;
                switch (i.op) {
                    case 'aslens': {
                        const payload = outputLayouts.get(i.initial)!;
                        const box = i.inPlace ? retainedBoxes.get(i.inPlace) : undefined;
                        if (i.inPlace) {
                            const owner = retainedOwners.get(i.inPlace),
                                slot = i.reconstruction?.reconstructionOwner;
                            if (!box || !owner || !slot) return unsupported('Missing retained box');
                            // The temporary is the box payload: fields are live reads through
                            // it, written back only when changed. The owner's header is
                            // unchanged, so restoring it needs no reconstruction.
                            const view = storage.own({
                                expression: cc`(*${box})`,
                                layout: payload,
                                address: box,
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
                        const view = storage.own({
                            expression: value(i.initial),
                            layout: payload,
                        });
                        places.set(i.backing, view);
                        lenses.set(i.out.id, {
                            view,
                            finish: (output) => {
                                const result = block(i.cleanup, output);
                                drop({ expression: result, layout: i.cleanup.layout }, output);
                            },
                        });
                        continue;
                    }
                    case 'make-callable': {
                        const callable = program.callables.find((c) => c.id === i.callable)!;
                        const entries = callable.entries
                            .map((e) => {
                                const w = program.wrappers.find((w) => w.id === e.wrapper)!;
                                // Runtime joins reify native entries; ordinary intrinsics keep their storage lowering.
                                return w.kind === 'invoke'
                                    ? cc`, .${member(e.field)}=${codes.get(w.code)}`
                                    : w.kind === 'adapt-lens-result'
                                      ? cc`, .${member(e.field)}=${resultAdapters.get(w.id)}`
                                      : w.kind === 'native' && nativeCodes.has(w.id)
                                        ? cc`, .${member(e.field)}=${nativeCodes.get(w.id)}`
                                        : '';
                            })
                            .join('');
                        if (!i.captures.length && !entries) {
                            values.set(i.out.id, zero(id));
                            continue;
                        }
                        if (
                            !i.captures.length ||
                            (options.optimize &&
                                layout(callable.environment).fields.every(
                                    (f) => f.kind === 'value' && layout(f.layout).kind === 'unit',
                                ))
                        ) {
                            expr = cc`(${type(id)}){.environment=NULL${entries}}`;
                            break;
                        }
                        const environment = fresh();
                        cell(
                            environment,
                            `${type(callable.environment)} *`,
                            cc`allocate_context(sizeof *${environment})`,
                            body,
                        );
                        i.captures.forEach((capture, n) =>
                            body.push(cc`${environment}->capture${n} = ${value(capture.value)};`),
                        );
                        expr = cc`(${type(id)}){.environment=${environment}, .dispose=${disposers.get(callable.dispose)}${entries}}`;
                        break;
                    }
                    case 'constant':
                        expr = literal(i.value, id);
                        if (i.value !== null)
                            expr = locals.scalar(
                                String(expr),
                                typeof i.value === 'boolean' ? i.value : decodeNumber(i.value),
                            );
                        pure = true;
                        break;
                    case 'string': {
                        const head = cBytes(i.head);
                        if (!i.parts.length) {
                            expr = cc`string_new(${head.literal}, ${head.length})`;
                            break;
                        }
                        // Parts were evaluated in source order; appending consumes each one.
                        const builder = fresh();
                        cell(builder, 'string_builder', undefined, body);
                        body.push(cc`builder_bytes(&${builder}, ${head.literal}, ${head.length});`);
                        for (const part of i.parts) {
                            const tail = cBytes(part.tail);
                            const appended = value(part.value);
                            body.push(
                                locals.format(
                                    (builder, appended) =>
                                        appendPart(
                                            builder,
                                            layout(outputLayouts.get(part.value)!).kind,
                                            appended,
                                        ),
                                    builder,
                                    appended,
                                ),
                                cc`builder_bytes(&${builder}, ${tail.literal}, ${tail.length});`,
                            );
                        }
                        expr = cc`builder_finish(&${builder})`;
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
                                  : cc`(${type(v.layout)}){${joinCode(i.items.map(value), ', ')}}`;
                        if (v.boxed) {
                            let box = i.reuses ? retainedBoxes.get(i.reuses) : undefined;
                            if (i.reuses && !box) return unsupported('Missing retained box');
                            if (!box) {
                                box = fresh();
                                cell(
                                    box,
                                    `${type(v.layout)} *`,
                                    cc`allocate_context(sizeof *${box})`,
                                    body,
                                );
                            }
                            body.push(cc`*${box} = ${contents};`);
                            contents = box;
                        }
                        expr = cc`(${type(id)}){.tag=${tagValue(id, n)}, .as.v${n}=${contents}}`;
                        break;
                    }
                    case 'tuple':
                        expr = cc`(${type(id)}){${joinCode(i.items.map(value), ', ') || '0'}}`;
                        removable = true;
                        break;
                    case 'move':
                        removable = true;
                        movedFrom.set(i.out.id, storage.get(ref(i.slot)));
                        rememberHome(ref(i.slot));
                        expr = read(storage.get(ref(i.slot)), id);
                        storage.put(ref(i.slot), { expression: zero(unit.id), layout: unit.id });
                        break;
                    case 'acquire':
                        lensSlots.set(i.out.id, i.slot);
                        lenses.set(i.out.id, { view: ref(i.slot), finish: noFinish });
                        continue;
                    case 'lens-tuple':
                        lenses.set(i.out.id, {
                            view: i.items.map((v) => lenses.get(v)!.view),
                            finish: (body) => i.items.forEach((v) => lenses.get(v)!.finish(body)),
                        });
                        continue;
                    case 'swap': {
                        const lens = lenses.get(i.lens)!;
                        const contents = storage.get(lens.view);
                        expr = read(contents, id);
                        declare(id, expr, body, name);
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
                            // store happens here and the field goes back to reading the box.
                            body.push(cc`${through(live.address)} = ${value(i.value)};`);
                            storage.put(lens.view, live);
                        } else
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
                            body.push(locals.declaration(selected, 'int', '0'));
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
                                                locals.assign(phi, read(data[n]!, first.layout)),
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
                                    locals.assign(selected, String(n)),
                                    locals.assign(focus, read(storage.get(lens.view), input)),
                                );
                                // Setup storage used by deferred cleanup is declared in the arm;
                                // declaration placement lifts it out of the conditional.
                                return {
                                    nested,
                                    state: storage.snapshot(),
                                    lens,
                                    arm,
                                    index: n,
                                };
                            });
                            storage.reset(before);
                            merge(arms, body);
                            body.push({
                                kind: 'if',
                                arms: [
                                    ...i.cases.map((arm, n) => ({
                                        condition: matches(
                                            arm.pattern,
                                            value(i.value),
                                            outputLayouts.get(i.value)!,
                                        ),
                                        body: arms[n]!.nested,
                                    })),
                                    { body: ['abort();'] },
                                ],
                            });
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
                                                condition: cc`${selected} == ${n}`,
                                                body: arm.nested,
                                            })),
                                            { body: ['abort();'] },
                                        ],
                                    });
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
                                arm.retains,
                            );
                            if (arm.retains && movedFrom.has(i.value))
                                retainedOwners.set(arm.retains, movedFrom.get(i.value)!);
                            const result = block(arm.body, nested);
                            nested.push(locals.assign(name, result));
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
                                    arm.nested.push(
                                        locals.assign(phi, read(data[n]!, first.layout)),
                                    ),
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
                        body.push({
                            kind: 'if',
                            arms: [
                                ...i.cases.map((arm, n) => ({
                                    condition: matches(
                                        arm.pattern,
                                        value(i.value),
                                        outputLayouts.get(i.value)!,
                                    ),
                                    body: arms[n]!.nested,
                                })),
                                { body: ['abort();'] },
                            ],
                        });
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
                        let args: Expr[] = [];
                        if (w?.kind === 'native' && w.definition === 'native/dup') {
                            const lens = lenses.get(i.args[0]!)!;
                            expr = duplicate(read(storage.get(lens.view), id), id);
                            adapters.push({ finish: lens.finish });
                        } else if (w?.kind === 'native' && w.definition === 'native/size') {
                            const lens = lenses.get(i.args[0]!)!,
                                vector = endpoint(outputLayouts.get(i.args[0]!)!, 'read');
                            expr = cc`(double)(${read(storage.get(lens.view), vector)}).length`;
                            adapters.push({ finish: lens.finish });
                        } else if (w?.kind === 'native' && w.definition === 'native/[]') {
                            // The element lives in the heap buffer, so writing through its
                            // address updates the vector without changing the vector struct.
                            const parent = lenses.get(i.args[1]!)!,
                                vector = endpoint(outputLayouts.get(i.args[1]!)!, 'read'),
                                item = element(vector);
                            const at = fresh();
                            cell(
                                at,
                                `${type(item)} *`,
                                cc`${vectorAt(vector)}(${read(storage.get(parent.view), vector)}, ${value(i.args[0]!)})`,
                                body,
                            );
                            const view = storage.own({
                                expression: cc`(*${at})`,
                                layout: item,
                                address: at,
                            });
                            lenses.set(i.out.id, {
                                view,
                                finish: (body) => {
                                    // Restoring the element's own live contents changes nothing.
                                    const d = storage.get(view);
                                    if (Array.isArray(d) || !same(d.address, at))
                                        body.push(cc`*${at} = ${read(d, item)};`);
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
                            )
                                expr =
                                    i.field === undefined
                                        ? cc`${wrapperFunction(i.wrapper!)}((${value(i.callee)}).environment${joinCode(
                                              args.map((a) => cc`, ${a}`),
                                              '',
                                          )})`
                                        : cc`(${value(i.callee)}).${member(i.field)}((${value(i.callee)}).environment${joinCode(
                                              args.map((a) => cc`, ${a}`),
                                              '',
                                          )})`;
                            else if (w?.kind === 'native') {
                                const op = requireImport(w.definition, 'c').name;
                                pure = ['+', '-', '*', '/', '==', '>=', '<='].includes(op);
                                expr =
                                    simpleNative(op, args, id, abi.arguments) ??
                                    unsupported(cText`Native import ${w.definition}`);
                            } else return unsupported('Disposer invocation');
                        }
                        declare(id, expr, body, name, { pure: pure || removable, inline: pure });
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
                        return unsupported(cText`Unknown operation ${(i as { op: string }).op}`);
                }
                declare(id, expr, body, name, { pure: pure || removable });
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
                if (i.op === 'aslens') {
                    if (i.inPlace) inPlaceIds.add(i.inPlace);
                    index(i.cleanup);
                }
                if (i.op === 'case') i.cases.forEach((a) => index(a.body));
            });
        index(c.body);
        const body: Statement[] = [...setup];
        c.captures.forEach((capture, i) => {
            const base = bindingName({ place: capture.place, path: [] });
            const name = declare(
                capture.layout,
                erasedEnvironment(c.captures)
                    ? zero(capture.layout)
                    : cc`((${type(c.environment)} *)${'environment'})->capture${i}`,
                body,
                base ? locals.reference(versionName(base)) : fresh(),
            );
            places.set(capture.place, storage.own({ expression: name, layout: capture.layout }));
        });
        if (c.captures.length && !erasedEnvironment(c.captures))
            body.push('release_context(environment);');
        const result = block(c.body, body);
        if (lenses.has(c.body.result)) {
            const lens = lenses.get(c.body.result)!;
            const h = helperCounter++,
                context = `Restore${h}`,
                restore = `restore${h}`;
            const candidates = [...variables];
            const contextFields: string[] = [];
            const initial: Statement[] = [];
            const build = (view: View, id: string, path: string): Expr => {
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                if (input?.kind === 'pointer' && input.layout) {
                    const r = `focus${path}`,
                        output = l.fields.find((f) => f.name === 'replacement');
                    contextFields.push(cText`${type(input.layout)} ${r};`);
                    initial.push(cc`ctx->${r} = ${read(storage.get(view), input.layout)};`);
                    if (output?.kind === 'pointer' && output.layout)
                        contextFields.push(cText`${type(output.layout)} ${r}out;`);
                    return cc`(${type(id)}){.read=&ctx->${r}${output ? cc`, .replacement=&ctx->${r}out` : ''}}`;
                }
                return cc`(${type(id)}){${
                    joinCode(
                        l.fields
                            .filter((f) => f.name.startsWith('item'))
                            .map(
                                (f, i) =>
                                    cc`.${member(f.name)}=${build(storage.project(view, [i]), (f as { layout: string }).layout, path + '_' + i)}`,
                            ),
                        ', ',
                    ) || '0'
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
            // Only frame locals referenced by cleanup survive in the heap context.
            // Cleanup's own declarations were created after the candidate snapshot.
            const references = locals.reads(cleanup);
            visit(cleanup, (s) => {
                if (isLocal(s) && s.kind === 'set') references.add(s.name);
            });
            const captured = candidates.filter((v) => references.has(v.name));
            contextFields.unshift(...captured.map((v) => `${v.type} ${v.name};`));
            const replacements = new Map(
                captured.map((v) => [v.name, locals.literal(`ctx->${v.name}`)]),
            );
            const rewrite = (value: Expr) => locals.rewriteReferences(value, replacements);
            const rewriteBody = (body: Statement[]): Statement[] =>
                body.map((s): Statement => {
                    if (Array.isArray(s)) return rewriteBody(s);
                    if (isExpr(s)) return rewrite(s);
                    if (isLocal(s)) {
                        if (s.kind === 'set' && replacements.has(s.name))
                            return cc`${replacements.get(s.name)} = ${rewrite(s.value)};`;
                        return {
                            ...s,
                            ...(s.value === undefined ? {} : { value: rewrite(s.value) }),
                        };
                    }
                    return mapScope(s, rewrite, rewriteBody);
                });
            declarations.push(
                cText`typedef struct { ${contextFields.join(' ') || 'unsigned char inhabitant;'} } ${context};`,
            );
            declarations.push(
                cText`${type(unit.id)} ${restore}(void *opaque, ${type(replacement)} replacement);`,
            );
            helpers.push({
                signature: cText`${type(unit.id)} ${restore}(void *opaque, ${type(replacement)} replacement)`,
                body: [
                    cc`${context} *ctx = opaque;`,
                    '(void)replacement;',
                    ...rewriteBody(suppressUnused(locals, cleanup, [])),
                    'release_context(ctx);',
                    cc`return ${zero(unit.id)};`,
                ],
            });
            body.push(`${context} *ctx = allocate_context(sizeof *ctx);`, {
                kind: 'if',
                arms: [{ condition: '!ctx', body: ['abort();'] }],
            });
            captured.forEach((v) => body.push(cc`ctx->${locals.literal(v.name)} = ${v.name};`));
            body.push(...initial);
            const out = fresh();
            body.push(
                cc`${type(c.body.layout)} ${out} = ${resultExpression};`,
                cc`${out}.restore = ${restore};`,
                cc`${out}.context = ctx;`,
                cc`return ${out};`,
            );
        } else {
            flushParameters(body);
            body.push(locals.returnValue(result));
        }
        const placed = locals.place(body);
        activeLocals = undefined;
        return { signature: signature(c), body: suppressUnused(locals, placed, parameterNames) };
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
    let printLoops = 0;
    const print = (expr: Expr, id: string, body: Statement[]) => {
        const l = layout(id);
        if (l.kind === 'f64') body.push(`print_number(${expr});`);
        else if (l.kind === 'bool') body.push(`fputs(${expr} ? "true" : "false", stdout);`);
        else if (l.kind === 'unit') body.push('fputs("null", stdout);');
        else if (l.kind === 'string') body.push(`print_string(${expr});`);
        else if (l.kind === 'vector') {
            // Nested vectors nest loops; each needs its own index.
            const i = `i${printLoops++}`;
            const each: Statement[] = [{ head: `if (${i})`, body: ['putchar(44);'] }];
            print(`(${expr}).elements[${i}]`, element(id), each);
            body.push(
                'putchar(91);',
                { head: `for (size_t ${i} = 0; ${i} < (${expr}).length; ${i}++)`, body: each },
                'putchar(93);',
            );
        } else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
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
                    body.push(
                        { head: cText`while (value.tag == ${tagValue(id, 1)})`, body: loop },
                        'putchar(93);',
                    );
                    return;
                }
                l.fields.forEach((f, n) => {
                    const v = variant(id, n);
                    const arm: Statement[] = [
                        `fputs("{\\"kind\\":\\"variant\\",\\"name\\":\\"${member(f.name)}\\",\\"items\\":[", stdout);`,
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
                    body.push({
                        head: `${n ? 'else if' : 'if'} (value.tag == ${tagValue(id, n)})`,
                        body: arm,
                    });
                });
            });
            body.push(`${name}(${expr});`);
        } else unsupported('Entry result requires a host contract');
    };
    /**
     * Host ABI. Number and Bool pass by value; unit is omitted. A String argument is
     * a borrowed (bytes, length) pair that is copied; a String result is an owned
     * length-delimited `laminar_string *`, read with `laminar_string_data/length`
     * and freed with `laminar_string_free`. Any other value is an opaque owned
     * handle: passing it to an export transfers ownership, and `laminar_drop_<T>`
     * disposes of one the host keeps.
     */
    function libraryExports(exports: readonly CExport[]) {
        const header = [
            '#include <stddef.h>',
            '#include <stdbool.h>',
            '/* Live Laminar heap cells; zero once every result has been released. */',
            'size_t laminar_live_allocations(void);',
        ];
        const out: TranslationUnit['functions'] = [
            {
                signature: 'size_t laminar_live_allocations(void)',
                body: ['return live_contexts;'],
            },
        ];
        if (strings) {
            header.push(
                'typedef struct laminar_string laminar_string;',
                '/* The empty string is NULL; both accessors accept it. */',
                'const char *laminar_string_data(const laminar_string *s);',
                'size_t laminar_string_length(const laminar_string *s);',
                'void laminar_string_free(laminar_string *s);',
            );
            out.push(
                {
                    signature: `const char *laminar_string_data(const ${stringType} *s)`,
                    body: ['return s ? (const char *)s->bytes : "";'],
                },
                {
                    signature: `size_t laminar_string_length(const ${stringType} *s)`,
                    body: ['return s ? s->length : 0;'],
                },
                {
                    signature: `void laminar_string_free(${stringType} *s)`,
                    body: ['string_drop(s);'],
                },
            );
        }
        const symbols = new Set<string>(),
            handles = new Map<string, string>();
        const claim = (symbol: string) => {
            identifier(symbol);
            if (symbols.has(symbol)) unsupported(`Duplicate host symbol ${symbol}`);
            symbols.add(symbol);
            return symbol;
        };
        // Handle names come from the semantic type, so they are stable and readable.
        const handle = (id: string): string => {
            const existing = handles.get(id);
            if (existing) return existing;
            // A data layout key is ['physical-layout', target, 'data', typeKey, ...].
            const key = JSON.parse(layout(id).key) as unknown[];
            const describe = (k: string): string => {
                const [tag, ...rest] = JSON.parse(k) as [string, ...unknown[]];
                if (tag === 'con')
                    return [rest[0] as string, ...(rest[1] as string[]).map(describe)].join('_');
                if (tag === 'tuple')
                    return ['Tuple', ...(rest[0] as string[]).map(describe)].join('_');
                return type(id);
            };
            const readable =
                key[2] === 'data' && typeof key[3] === 'string' ? describe(key[3]) : type(id);
            const name = claim(`laminar_${readable}`);
            handles.set(id, name);
            const drop_ = claim(`laminar_drop_${readable}`);
            header.push(`typedef struct ${name} ${name};`, `void ${drop_}(${name} *handle);`);
            const body: Statement[] = [`${type(id)} *cell = (${type(id)} *)(void *)handle;`];
            drop({ expression: '*cell', layout: id }, body);
            body.push('release_context(cell);');
            declarations.push(`struct ${name};`);
            out.push({ signature: `void ${drop_}(struct ${name} *handle)`, body });
            return name;
        };
        const hostKind = (id: string) => {
            const l = layout(id);
            if (l.fields.some((f) => f.name === 'restore'))
                return unsupported('Lens values need a host borrow contract');
            return l.kind;
        };
        for (const e of exports) {
            const code = program.code.find((c) => c.id === program.entries[e.entry])!;
            const params: string[] = [],
                hostParams: string[] = [],
                body: Statement[] = [],
                args: string[] = [];
            code.parameters.forEach((p, n) => {
                if (p.lensPlace) unsupported('Lens parameters need a host borrow contract');
                const kind = hostKind(p.layout);
                if (kind === 'unit') return args.push(String(zero(p.layout)));
                if (kind === 'f64' || kind === 'bool') {
                    params.push(`${kind === 'f64' ? 'double' : '_Bool'} arg${n}`);
                    hostParams.push(`${kind === 'f64' ? 'double' : 'bool'} arg${n}`);
                    return args.push(`(${type(p.layout)})arg${n}`);
                }
                if (kind === 'string') {
                    params.push(`const char *arg${n}`, `size_t arg${n}_length`);
                    hostParams.push(`const char *arg${n}`, `size_t arg${n}_length`);
                    return args.push(`string_new(arg${n}, arg${n}_length)`);
                }
                const name = handle(p.layout);
                params.push(`struct ${name} *arg${n}`);
                hostParams.push(`${name} *arg${n}`);
                body.push(
                    `${type(p.layout)} *cell${n} = (${type(p.layout)} *)(void *)arg${n};`,
                    `${type(p.layout)} value${n} = *cell${n};`,
                    `release_context(cell${n});`,
                );
                args.push(`value${n}`);
            });
            const result = code.body.layout,
                kind = hostKind(result);
            const call = `${codes.get(code.id)}(NULL${args.map((a) => `, ${a}`).join('')})`;
            let returns: string, hostReturns: string;
            if (kind === 'unit') {
                returns = hostReturns = 'void';
                body.push(`(void)${call};`);
            } else if (kind === 'f64' || kind === 'bool') {
                returns = kind === 'f64' ? 'double' : '_Bool';
                hostReturns = kind === 'f64' ? 'double' : 'bool';
                body.push(`return ${call};`);
            } else if (kind === 'string') {
                returns = `${stringType} *`;
                hostReturns = 'laminar_string *';
                body.push(`return ${call};`);
            } else {
                const name = handle(result);
                returns = `struct ${name} *`;
                hostReturns = `${name} *`;
                body.push(
                    `${type(result)} *cell = allocate_context(sizeof *cell);`,
                    `*cell = ${call};`,
                    `return (struct ${name} *)(void *)cell;`,
                );
            }
            const symbol = claim(e.symbol);
            const list = (p: string[]) => p.join(', ') || 'void';
            const declare = (r: string, p: string[]) =>
                `${r}${r.endsWith('*') ? '' : ' '}${symbol}(${list(p)})`;
            header.push(`${declare(hostReturns, hostParams)};`);
            out.push({ signature: declare(returns, params), body });
        }
        return { header, functions: out };
    }
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
    if (options.exports) {
        const unit = libraryExports(options.exports);
        functions.push(...helpers.slice(emittedHelpers), ...unit.functions);
        return { declarations: retainedDeclarations(), functions, header: unit.header };
    }
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
    return { declarations: retainedDeclarations(), functions };
}
