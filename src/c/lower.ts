import { Declaration, References, reachableNames, typeDependencies } from '../backend/reachable.ts';
import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import { Storage, type Cell, type Data, type Leaf, type View } from './storage.ts';
import { decodeNumber, type IRPattern, type SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { cSyntax, identifier, type Statement, type TranslationUnit } from './syntax.ts';
import { Locals } from '../backend/imperative/locals.ts';
import { derefText, isExpr, memberText, same, type Expr } from '../backend/imperative/code.ts';
import { isLocal, isScope, mapScope, visit } from '../backend/imperative/statements.ts';
import { appendFunction, appendPart, cBytes, stringRuntime, stringType } from './strings.ts';
import { importName, infixImports, requireImport, usesHost } from '../runtime-imports.ts';
import { functionNames } from '../backend/names.ts';
import { localNames, takesName } from '../backend/local-names.ts';
import { layoutNames, unionTagNames } from '../backend/type-names.ts';
import { CNames, importReserved, cScalars } from './names.ts';

type Completion = (body: Statement[]) => void;
/**
 * `forwarded`: the lens is an existing runtime lens struct whose restoration is entirely its
 * own callback or direct write. `rest` is what must still run after it (argument backing,
 * block cleanup); a function may return the struct as is when `rest` emits nothing.
 */
type Lens = {
    view: View;
    finish: Completion;
    forwarded?: { expression: string; rest: Completion };
};
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
    const packageNames = new CNames([
        ...(options.exports ?? []).map((e) => e.symbol),
        ...imports.flatMap((d) => importReserved[importName(d)] ?? []),
    ]);
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
    // Which functions each generated function calls or points to, recorded as lowering
    // mentions them (see References). Types stay conservative roots, as before.
    const refs = new References();
    const use = <T extends string>(name: T): T => refs.use(name);
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
    /** `base.name` and `*operand`, parenthesizing only where binding requires it. */
    const dot = (base: Expr, name: string): Expr =>
        activeLocals
            ? activeLocals.access(base, '.', member(name))
            : memberText(base, '.', identifier(name));
    const star = (operand: Expr): Expr =>
        activeLocals ? activeLocals.deref(operand) : derefText(operand);
    const zero = (id: string): Expr => cc`(${type(id)}){0}`;
    const field = (expr: Expr, n: number): Expr => dot(expr, `item${n}`);
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
                ...(s.address
                    ? {
                          address: cc`&(*${s.address}).item${i}`,
                          lvalue: field(star(s.address), i),
                          ...(s.heap ? { heap: true } : {}),
                      }
                    : {}),
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
    /** A scattered constructor lens: a tag plus a pointer to each payload field. */
    const sumParts = (
        id: string,
    ):
        | {
              union: string;
              pointers: { name: string; variant: number; index: number; layout: string }[];
          }
        | undefined => {
        const l = layout(id);
        const tag = l.fields.find((f) => f.kind === 'tag');
        if (tag?.kind !== 'tag') return undefined;
        return {
            union: tag.layout,
            pointers: l.fields.flatMap((f) => {
                const m = /^v(\d+)(?:_(\d+))?$/.exec(f.name);
                return f.kind === 'pointer' && f.layout && m
                    ? [
                          {
                              name: f.name,
                              variant: Number(m[1]),
                              index: m[2] === undefined ? 0 : Number(m[2]),
                              layout: f.layout,
                          },
                      ]
                    : [];
            }),
        };
    };
    const endpoint = (id: string, which: 'read' | 'replacement'): string => {
        const scattered = sumParts(id);
        if (scattered) return scattered.union;
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
    /** The union value a scattered lens currently denotes, read through its field pointers. */
    const sumValue = (expression: Expr, id: string): Expr => {
        const parts = sumParts(id)!;
        const arms = layout(parts.union).fields.map((_, k) => {
            const v = variant(parts.union, k);
            const pointers = parts.pointers
                .filter((p) => p.variant === k)
                .sort((a, b) => a.index - b.index);
            const contents: Expr =
                pointers.length === 0
                    ? zero(v.layout)
                    : pointers[0]!.name.includes('_')
                      ? cc`(${type(v.layout)}){${joinCode(
                            pointers.map((p) => star(dot(expression, p.name))),
                            ', ',
                        )}}`
                      : star(dot(expression, pointers[0]!.name));
            return cc`(${type(parts.union)}){.tag=${tagValue(parts.union, k)}, .as.v${k}=${contents}}`;
        });
        return arms.reduceRight((rest, arm, k) =>
            k === arms.length - 1
                ? arm
                : cc`(${dot(expression, 'tag')} == ${tagValue(parts.union, k)} ? ${arm} : ${rest})`,
        );
    };
    /** Write a replacement union back through a scattered lens's field pointers. */
    const sumWriteBack = (expression: Expr, id: string, replacement: Expr, body: Statement[]) => {
        const parts = sumParts(id)!;
        body.push({
            head: cc`if (${dot(replacement, 'tag')} != ${dot(expression, 'tag')})`,
            body: ['abort();'],
        });
        layout(parts.union).fields.forEach((_, k) => {
            const pointers = parts.pointers
                .filter((p) => p.variant === k)
                .sort((a, b) => a.index - b.index);
            if (!pointers.length) return;
            const payloadOf = payload(replacement, parts.union, k);
            body.push({
                head: cc`if (${dot(replacement, 'tag')} == ${tagValue(parts.union, k)})`,
                body: pointers.map((p) =>
                    pointers[0]!.name.includes('_')
                        ? cc`*${dot(expression, p.name)} = ${dot(payloadOf, `item${p.index}`)};`
                        : cc`*${dot(expression, p.name)} = ${payloadOf};`,
                ),
            });
        });
    };
    const incoming = (expression: Expr, id: string): View => {
        if (sumParts(id))
            return storage.own({
                expression: sumValue(expression, id),
                layout: sumParts(id)!.union,
                scattered: { lens: expression, layout: id },
            });
        const l = layout(id),
            f = l.fields.find((f) => f.name === 'read');
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
                same(data.address, dot(expression, f.name))
            )
                return;
            body.push(cc`${star(dot(expression, f.name))} = ${read(data, f.layout)};`);
            return;
        }
        const parts = storage.parts(data);
        l.fields
            .filter((f) => f.name.startsWith('item'))
            .forEach((f, i) =>
                flush(dot(expression, f.name), (f as { layout: string }).layout, parts[i]!, body),
            );
    };
    // waitKey and random need POSIX headers, which -std=c11 hides unless asked for.
    const usesImport = (name: string) => imports.some((d) => importName(d) === name);
    const declarations: (string | Declaration)[] = [
        ...(usesImport('waitKey') || usesImport('random')
            ? ['#define _POSIX_C_SOURCE 200809L']
            : []),
        '#include <stdio.h>',
        '#include <stdlib.h>',
        '#include <math.h>',
        '#include <stdint.h>',
        '#include <stdbool.h>',
        ...(usesImport('waitKey')
            ? ['#include <poll.h>', '#include <termios.h>', '#include <unistd.h>']
            : []),
        ...(usesImport('random') ? ['#include <time.h>'] : []),
    ];
    const declareType = (name: string, text: string) =>
        declarations.push(new Declaration(name, text, declarationTypes.get(name)));
    const retained = () => ({
        types: reachableNames(declarationTypes, typeRoots),
        functions: reachableNames(refs.graph(), refs.roots),
    });
    /** Struct types generated while lowering bodies (lens backing, restoration contexts). They
     * are printed with the other types, not among the prototypes. */
    const auxTypes: Declaration[] = [];
    let executableStart = 0;
    const retainedDeclarations = (): string[] => {
        const live = retained();
        return [
            ...declarations.slice(0, executableStart),
            ...auxTypes,
            ...declarations.slice(executableStart),
        ]
            .filter(
                (d) =>
                    !(d instanceof Declaration) ||
                    live.types.has(d.name) ||
                    live.functions.has(d.name),
            )
            .map(String);
    };
    /** Functions that nothing reachable from `main` or a host export mentions are dropped. */
    const retainedFunctions = (all: TranslationUnit['functions']) => {
        const live = retained().functions;
        // The library's exported functions are unnamed: they are the roots themselves.
        return all.filter((f) => f.name === undefined || live.has(f.name));
    };
    const strings = program.layouts.some((l) => l.kind === 'string');
    const runtime = strings ? stringRuntime() : undefined;
    if (runtime) declarations.push('#include <string.h>', ...runtime.types);
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
                cText`struct ${type(l.id)} { ${l.fields.map((f) => (f.kind === 'value' ? cc`${type(f.layout)} ${member(f.name)};` : f.kind === 'pointer' ? cc`${f.layout ? type(f.layout) : 'void'} *${member(f.name)};` : f.kind === 'tag' ? cc`uint32_t ${member(f.name)};` : cc`${abiNames.get(f.abi)} ${member(f.name)};`)).join(' ') || 'unsigned char inhabitant;'} };`,
            );
        }
    // Everything below is retained executable code or its auxiliary declarations.
    // Type uses are conservative roots, including declarations later simplified away.
    trackTypeUses = true;
    executableStart = declarations.length;
    const signature = (c: ConcreteProgram['code'][number]) =>
        cText`${type(c.body.layout)} ${codes.get(c.id)}(void *environment${c.parameters.map((p, i) => `, ${type(p.layout)} ${naming.get(c.id)!.parameterNames[i]}`).join('')})`;
    // The allocation counter is a package symbol: only code that mentions it keeps it.
    declarations.push(
        new Declaration('live_contexts', 'static size_t live_contexts = 0;'),
        new Declaration('allocate_context', 'void *allocate_context(size_t size);'),
        new Declaration('release_context', 'void release_context(void *context);'),
        new Declaration('retain_context', 'void retain_context(void *context);'),
        new Declaration('unique_context', '_Bool unique_context(void *context);'),
        ...(runtime?.functions.map((f) => new Declaration(f.name, f.signature + ';')) ?? []),
    );
    program.code.forEach((c) =>
        declarations.push(new Declaration(codes.get(c.id)!, signature(c) + ';')),
    );
    const helpers: TranslationUnit['functions'] = [];
    let helperCounter = 0;
    const backingTypes = new Map<string, string>();
    const disposers = new Map(
        program.wrappers.filter((w) => w.kind === 'dispose').map((w, i) => [w.id, `dispose${i}`]),
    );
    // Union operations are recursive C functions, generated once per layout on first use.
    const unionHelpers = new Map<string, string>();
    const unionHelper = (
        kind:
            | 'drop'
            | 'dup'
            | 'share'
            | 'print'
            | 'char_list'
            | 'round'
            | 'host_print'
            | 'host_write'
            | 'host_key'
            | 'host_random'
            | 'host_input',
        id: string,
        result: string,
        generate: (body: Statement[]) => void,
        parameter = type(id),
    ): string => {
        const key = cText`${kind}:${id}`;
        const existing = unionHelpers.get(key);
        if (existing) return use(existing);
        const name = cText`${kind}_${type(id)}`;
        unionHelpers.set(key, name);
        use(name);
        refs.within(name, () => {
            const signature = cText`${result}${result.endsWith('*') ? '' : ' '}${name}(${parameter} value)`;
            declarations.push(new Declaration(name, signature + ';'));
            const body: Statement[] = ['(void)value;'];
            generate(body);
            helpers.push({ name, signature, body });
        });
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
        if (existing) return use(existing);
        const name = cText`vector_${kind}_${type(id)}`;
        vectorHelpers.set(key, name);
        use(name);
        refs.within(name, () => {
            const signature = cText`${result}${result.endsWith('*') ? '' : ' '}${name}(${parameters})`;
            declarations.push(new Declaration(name, signature + ';'));
            const body: Statement[] = [];
            generate(body);
            helpers.push({ name, signature, body });
        });
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
                            cc`${type(element(id))} *elements = ${use('allocate_context')}(capacity * sizeof *elements);`,
                            {
                                head: 'for (size_t i = 0; i < value.length; i++)',
                                body: ['elements[i] = value.elements[i];'],
                            },
                            {
                                head: 'if (value.elements)',
                                body: [cc`${use('release_context')}(value.elements);`],
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
                    cc`value.elements = ${use('allocate_context')}(value.length * sizeof *value.elements);`,
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
    const variantField = (expr: Expr, n: number): Expr => dot(dot(expr, 'as'), `v${n}`);
    const payload = (expr: Expr, id: string, n: number): Expr =>
        variant(id, n).boxed ? star(variantField(expr, n)) : variantField(expr, n);
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
                                  cc`copy.as.v${n} = ${use('allocate_context')}(sizeof *copy.as.v${n});`,
                                  cc`*copy.as.v${n} = ${copied};`,
                              ]
                            : [cc`copy.as.v${n} = ${copied};`],
                    });
                });
                body.push('return copy;');
            })}(${expr})`;
        if (l.kind === 'string') return cc`${use('string_dup')}(${expr})`;
        if (l.kind === 'vector')
            return cc`${vectorHelper('dup', id, type(id), cText`${type(id)} value`, (body) =>
                body.push(
                    cc`${type(id)} copy = {0};`,
                    { head: 'if (!value.length)', body: ['return copy;'] },
                    'copy.length = copy.capacity = value.length;',
                    cc`copy.elements = ${use('allocate_context')}(copy.length * sizeof *copy.elements);`,
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
    /**
     * A shared read: one more reference to the same allocations, which nothing writes. A boxed
     * payload, vector buffer or string is retained, not copied; the holders' drops balance it.
     */
    const reaches = (id: string): boolean => {
        const l = layout(id);
        if (l.kind === 'union' || l.kind === 'string' || l.kind === 'vector') return true;
        return (
            l.kind === 'record' &&
            !l.fields.some((f) => f.name === 'dispose') &&
            l.fields.some((f) => f.kind === 'value' && reaches(f.layout))
        );
    };
    const shareValue = (expr: Expr, id: string): Expr => {
        const l = layout(id);
        if (!reaches(id)) return expr;
        if (l.kind === 'union')
            return cc`${unionHelper('share', id, type(id), (body) => {
                l.fields.forEach((_, n) => {
                    const v = variant(id, n);
                    const arm: Statement[] = v.boxed
                        ? [cc`${use('retain_context')}(value.as.v${n});`]
                        : reaches(v.layout)
                          ? [cc`value.as.v${n} = ${shareValue(payload('value', id, n), v.layout)};`]
                          : [];
                    if (arm.length)
                        body.push({
                            head: cc`${body.length > 1 ? 'else if' : 'if'} (value.tag == ${tagValue(id, n)})`,
                            body: arm,
                        });
                });
                body.push('return value;');
            })}(${expr})`;
        if (l.kind === 'string') return cc`${use('string_share')}(${expr})`;
        if (l.kind === 'vector')
            return cc`${vectorHelper('share', id, type(id), cText`${type(id)} value`, (body) =>
                body.push(
                    {
                        head: 'if (value.elements)',
                        body: [cc`${use('retain_context')}(value.elements);`],
                    },
                    'return value;',
                ),
            )}(${expr})`;
        return cc`(${type(id)}){${joinCode(
            l.fields.map((f, n) => shareValue(field(expr, n), (f as { layout: string }).layout)),
            ', ',
        )}}`;
    };
    /** Two-argument helpers (structural equality), generated once per layout on first use. */
    const pairHelpers = new Map<string, string>();
    const pairHelper = (
        kind: string,
        id: string,
        generate: (body: Statement[]) => void,
    ): string => {
        const key = cText`${kind}:${id}`;
        const existing = pairHelpers.get(key);
        if (existing) return use(existing);
        const name = cText`${kind}_${type(id)}`;
        pairHelpers.set(key, name);
        use(name);
        refs.within(name, () => {
            const signature = cText`_Bool ${name}(${type(id)} left, ${type(id)} right)`;
            declarations.push(new Declaration(name, signature + ';'));
            const body: Statement[] = ['(void)left;', '(void)right;'];
            generate(body);
            helpers.push({ name, signature, body });
        });
        return name;
    };
    /** Structural equality of two values of one layout, as a C boolean. */
    const equalValues = (left: Expr, right: Expr, id: string): Expr => {
        const l = layout(id);
        if (l.kind === 'f64' || l.kind === 'bool') return cc`(${left} == ${right})`;
        if (l.kind === 'unit') return '1';
        if (l.kind === 'string') return cc`${use('string_same')}(${left}, ${right})`;
        if (l.kind === 'union')
            return cc`${pairHelper('equal', id, (body) => {
                body.push({
                    head: 'if (left.tag != right.tag)',
                    body: ['return 0;'],
                });
                l.fields.forEach((_, n) => {
                    const v = variant(id, n);
                    body.push({
                        head: cc`if (left.tag == ${tagValue(id, n)})`,
                        body: [
                            cc`return ${equalValues(payload('left', id, n), payload('right', id, n), v.layout)};`,
                        ],
                    });
                });
                body.push('return 1;');
            })}(${left}, ${right})`;
        if (l.kind === 'vector')
            return cc`${pairHelper('equal', id, (body) => {
                body.push(
                    { head: 'if (left.length != right.length)', body: ['return 0;'] },
                    {
                        head: 'for (size_t i = 0; i < left.length; i++)',
                        body: [
                            {
                                head: cc`if (!${equalValues('left.elements[i]', 'right.elements[i]', element(id))})`,
                                body: ['return 0;'],
                            },
                        ],
                    },
                    'return 1;',
                );
            })}(${left}, ${right})`;
        if (l.fields.some((f) => f.kind !== 'value'))
            return unsupported('Equality of a value holding code');
        return cc`${pairHelper('equal', id, (body) =>
            body.push(
                cc`return ${joinCode(
                    l.fields.length
                        ? l.fields.map((f, n) =>
                              equalValues(
                                  field('left', n),
                                  field('right', n),
                                  (f as { layout: string }).layout,
                              ),
                          )
                        : ['1'],
                    ' && ',
                )};`,
            ),
        )}(${left}, ${right})`;
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
                    const inner: Statement[] = [];
                    drop({ expression: payload('value', id, n), layout: v.layout }, inner);
                    // A box that other holders still reference is only released, not emptied.
                    if (v.boxed && inner.length)
                        arm.push({
                            head: cc`if (${use('unique_context')}(value.as.v${n}))`,
                            body: inner,
                        });
                    else arm.push(...inner);
                    if (v.boxed) arm.push(cc`${use('release_context')}(value.as.v${n});`);
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
            body.push(cc`${use('string_drop')}(${data.expression});`);
        } else if (l.kind === 'vector') {
            const id = data.layout;
            const name = vectorHelper('drop', id, 'void', cText`${type(id)} value`, (body) => {
                const each: Statement[] = [];
                drop({ expression: 'value.elements[i]', layout: element(id) }, each);
                if (each.length)
                    body.push({
                        head: cc`if (value.elements && ${use('unique_context')}(value.elements))`,
                        body: [{ head: 'for (size_t i = 0; i < value.length; i++)', body: each }],
                    });
                body.push({
                    head: 'if (value.elements)',
                    body: [cc`${use('release_context')}(value.elements);`],
                });
            });
            body.push(cc`${name}(${data.expression});`);
        } else if (l.fields.some((f) => f.name === 'dispose')) {
            body.push({
                head: cc`if (${dot(data.expression, 'dispose')})`,
                body: [
                    cc`${dot(data.expression, 'dispose')}(${dot(data.expression, 'environment')});`,
                ],
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
                            cc`${type(cell.layout)} *cell = ${use('allocate_context')}(sizeof *cell);`,
                            cc`*cell = (${type(cell.layout)}){(${type(text)})${use('string_new')}((const char *)value->bytes + start, end - start), out};`,
                            cc`out = (${type(result)}){.tag=${tagValue(result, cons)}, .as.v${cons}=cell};`,
                            'end = start;',
                        ],
                    },
                    cc`${use('string_drop')}(value);`,
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
        if (
            (op === '==' || op === '!=') &&
            !['f64', 'bool'].includes(layout(parameters[0]!).kind)
        ) {
            // The native consumes both operands, so the wrapper drops them after comparing.
            const id = parameters[0]!;
            const consuming = pairHelper('equals', id, (body) => {
                body.push(cc`_Bool same = ${equalValues('left', 'right', id)};`);
                drop({ expression: 'left', layout: id }, body);
                drop({ expression: 'right', layout: id }, body);
                body.push('return same;');
            });
            const same = cc`${consuming}(${args[0]}, ${args[1]})`;
            return op === '==' ? same : cc`(!${same})`;
        }
        if (infixImports.includes(op))
            return activeLocals
                ? activeLocals.binary(op, args[0]!, args[1]!)
                : cc`(${args[0]} ${op} ${args[1]})`;
        if (op === 'not') return cc`(!${args[0]})`;
        if (op === '%') return cc`fmod(${args[0]}, ${args[1]})`;
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
                        "putchar('\\n');",
                        cc`${use('string_drop')}(value);`,
                        cc`return ${zero(result)};`,
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        if (op === 'write')
            return cc`${unionHelper(
                'host_write',
                result,
                type(result),
                (body) =>
                    body.push(
                        {
                            head: 'if (value)',
                            body: ['fwrite(value->bytes, 1, value->length, stdout);'],
                        },
                        'fflush(stdout);',
                        cc`${use('string_drop')}(value);`,
                        cc`return ${zero(result)};`,
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        if (op === 'random')
            return cc`${unionHelper(
                'host_random',
                result,
                type(result),
                (body) =>
                    body.push(
                        'static uint32_t state = 0;',
                        {
                            head: 'if (!(value >= 1 && value < 4294967296.0 && value == floor(value)))',
                            body: ['abort();'],
                        },
                        {
                            head: 'if (state == 0)',
                            body: [
                                'const char *seed = getenv("LAMINAR_SEED");',
                                'state = seed ? (uint32_t)strtoul(seed, NULL, 10) : (uint32_t)time(NULL);',
                                { head: 'if (state == 0)', body: ['state = 2463534242u;'] },
                            ],
                        },
                        'state ^= state << 13;',
                        'state ^= state >> 17;',
                        'state ^= state << 5;',
                        'return (double)(state % (uint32_t)value);',
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        if (op === 'waitKey')
            return cc`${unionHelper(
                'host_key',
                result,
                type(result),
                (body) =>
                    body.push(
                        'fflush(stdout);',
                        'struct termios saved;',
                        'int raw = 0;',
                        {
                            head: 'if (isatty(0) && tcgetattr(0, &saved) == 0)',
                            body: [
                                'struct termios unbuffered = saved;',
                                'unbuffered.c_lflag &= (tcflag_t)~(ICANON | ECHO);',
                                'unbuffered.c_cc[VMIN] = 1;',
                                'unbuffered.c_cc[VTIME] = 0;',
                                'tcsetattr(0, TCSANOW, &unbuffered);',
                                'raw = 1;',
                            ],
                        },
                        'int timeout = value < 0 ? 0 : value > 2147483647.0 ? 2147483647 : (int)value;',
                        'struct pollfd ready = {0, POLLIN, 0};',
                        'string_builder key = {0};',
                        {
                            head: 'if (poll(&ready, 1, timeout) > 0)',
                            body: [
                                'char byte;',
                                {
                                    head: 'if (read(0, &byte, 1) == 1)',
                                    body: [cc`${use('builder_bytes')}(&key, &byte, 1);`],
                                },
                            ],
                        },
                        { head: 'if (raw)', body: ['tcsetattr(0, TCSANOW, &saved);'] },
                        cc`return ${use('builder_finish')}(&key);`,
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
                        cc`${use('string_drop')}(value);`,
                        'string_builder line = {0};',
                        'int c;',
                        {
                            head: 'while ((c = getchar()) != EOF && c != 10)',
                            body: [
                                'char byte = (char)c;',
                                cc`${use('builder_bytes')}(&line, &byte, 1);`,
                            ],
                        },
                        cc`return ${use('builder_finish')}(&line);`,
                    ),
                type(parameters[0]!),
            )}(${args[0]})`;
        return undefined;
    };
    for (const w of program.wrappers) {
        if (w.kind !== 'dispose' || !w.captures.length) continue;
        const name = disposers.get(w.id)!;
        refs.within(name, () => {
            const signature = cText`${type(unit.id)} ${name}(void *environment)`;
            declarations.push(new Declaration(name, signature + ';'));
            const body: Statement[] = [cc`${type(w.environment)} *captured = environment;`];
            w.captures.forEach((id, i) =>
                drop({ expression: cc`captured->capture${i}`, layout: id }, body),
            );
            body.push(cc`${use('release_context')}(captured);`, cc`return ${zero(unit.id)};`);
            helpers.push({ name, signature, body });
        });
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
        refs.within(name, () => {
            const signature = cText`${type(abi.result)} ${name}(void *environment${abi.arguments.map((id, i) => cText`, ${type(id)} arg${i}`).join('')})`;
            declarations.push(new Declaration(name, signature + ';'));
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
                result = cc`(double)${dot(read(storage.get(incoming('arg0', abi.arguments[0]!)), vector), 'length')}`;
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
            helpers.push({ name, signature, body });
        });
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
        const adapter = resultAdapters.get(w.id)!;
        const signature = cText`${type(abi.result)} ${adapter}(void *environment${abi.arguments.map((id, n) => cText`, ${type(id)} arg${n}`).join('')})`;
        declarations.push(new Declaration(adapter, signature + ';'));
        if (w.kind === 'adapt-lens-result') {
            const context = `LensResult${adapter}`,
                restore = `restore_${adapter}`;
            const input = endpoint(abi.result, 'read'),
                replacement = endpoint(abi.result, 'replacement');
            const separate = layout(abi.result).fields.some((f) => f.name === 'replacement');
            auxTypes.push(
                new Declaration(
                    context,
                    cText`typedef struct { ${type(raw.result)} source; ${type(input)} read; ${separate ? cc`${type(replacement)} write;` : ''} } ${context};`,
                ),
            );
            // The restoration function runs when the lens ends; it and its context
            // exist only because the adapter hands them out.
            refs.within(restore, () => {
                use(context);
                const restoreSignature = cText`${type(unit.id)} ${restore}(void *environment, ${type(replacement)} replacement)`;
                declarations.push(new Declaration(restore, restoreSignature + ';'));
                const fallback: Statement[] = [];
                flush(
                    'ctx->source',
                    raw.result,
                    { expression: 'replacement', layout: replacement },
                    fallback,
                );
                helpers.push({
                    name: restore,
                    signature: restoreSignature,
                    body: [
                        cc`${context} *ctx = environment;`,
                        {
                            head: 'if (ctx->source.restore)',
                            body: ['ctx->source.restore(ctx->source.context, replacement);'],
                        },
                        { head: 'else', body: fallback },
                        cc`${use('release_context')}(ctx);`,
                        cc`return ${zero(unit.id)};`,
                    ],
                });
            });
            refs.within(adapter, () => {
                use(context);
                use(restore);
                const sourceCode = use(
                    source.kind === 'invoke'
                        ? codes.get(source.code)!
                        : nativeCodes.get(source.id)!,
                );
                helpers.push({
                    name: adapter,
                    signature,
                    body: [
                        cc`${type(raw.result)} result = ${sourceCode}(environment${abi.arguments.map((_, n) => cc`, arg${n}`).join('')});`,
                        cc`${context} *ctx = ${use('allocate_context')}(sizeof *ctx);`,
                        'ctx->source = result;',
                        cc`ctx->read = ${read(storage.get(incoming('ctx->source', raw.result)), input)};`,
                        cc`return (${type(abi.result)}){.read=&ctx->read${separate ? ', .replacement=&ctx->write' : ''}, .restore=${restore}, .context=ctx};`,
                    ],
                });
            });
            continue;
        }
    }
    /** Whether a directly called wrapper reads its environment: only captured code does. */
    const takesEnvironment = (id: string): boolean => {
        const w = program.wrappers.find((w) => w.id === id)!;
        return w.kind === 'invoke'
            ? program.code.find((c) => c.id === w.code)!.captures.length > 0
            : w.kind === 'adapt-lens-result'
              ? takesEnvironment(w.source)
              : false;
    };
    const wrapperFunction = (id: string): string => {
        const w = program.wrappers.find((w) => w.id === id)!;
        return use(
            (w.kind === 'invoke' ? codes.get(w.code) : undefined) ??
                resultAdapters.get(id) ??
                nativeCodes.get(id) ??
                unsupported('Wrapper has no callable function'),
        );
    };
    const functions: TranslationUnit['functions'] = program.code.map((c) =>
        refs.within(codes.get(c.id)!, () => {
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
                options: { pure?: boolean; inline?: boolean; effect?: boolean } = {},
            ): string => {
                variables.push({ name, type: type(id) });
                const zeroInitial = same(expression, zero(id));
                body.push(
                    locals.declaration(name, type(id), expression, {
                        ...options,
                        // A zero value nothing reads or writes has no purpose.
                        pure: options.pure || zeroInitial,
                        zeroInitial,
                    }),
                );
                return name;
            };
            /** A local that raw statements write through or address: never substituted or pruned. */
            const cell = (
                name: string,
                ctype: string,
                init: Expr | undefined,
                body: Statement[],
            ) => {
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
                Array.isArray(view)
                    ? undefined
                    : homes.get(view.cell)?.get(JSON.stringify(view.path));
            /** What a retained arm's owner held before the match moved it out, by reconstruction id. */
            const retainedOwners = new Map<string, Data>();
            /** The storage each moved value came from. */
            const movedFrom = new Map<string, Data>();
            /** The scattered lens each emptied view held before a match moved it out, by cell and path. */
            const scatteredHomes = new Map<Cell, Map<string, Leaf>>();
            const rememberScattered = (view: View) => {
                if (Array.isArray(view)) return;
                const leaf = storage.get(view);
                if (Array.isArray(leaf) || !leaf.scattered) return;
                const at = scatteredHomes.get(view.cell) ?? new Map<string, Leaf>();
                at.set(JSON.stringify(view.path), leaf);
                scatteredHomes.set(view.cell, at);
            };
            /** The constructor and field values of each `construct`, by its output. */
            const constructedBy = new Map<string, { name: string; items: string[] }>();
            /** An lvalue for the storage behind an address. */
            const through = (leaf: Leaf): Expr => leaf.lvalue ?? star(leaf.address!);
            /** Store each payload field that no longer reads its own live storage. */
            const writeBack = (before: Data, after: Data, id: string, body: Statement[]) => {
                if (Array.isArray(before) || !before.address) return;
                if (!Array.isArray(after) && same(after.address, before.address)) return;
                const items = layout(id).fields.filter((f) => f.name.startsWith('item'));
                if (layout(id).kind !== 'record' || !items.length) {
                    body.push(cc`${through(before)} = ${read(after, id)};`);
                    return;
                }
                const from = storage.parts(before),
                    to = storage.parts(after);
                items.forEach((f, n) =>
                    writeBack(from[n]!, to[n]!, (f as { layout: string }).layout, body),
                );
            };
            const bind = (
                p: IRPattern,
                data: Data,
                body: Statement[] = setup,
                retains?: string,
                /** The value may be shared, so a box is emptied only if nothing else holds it. */
                dynamic = false,
            ) => {
                if (p.kind === 'bind') places.set(p.slot.place, storage.own(data));
                else if (p.kind === 'tuple')
                    p.items.forEach((p, i) =>
                        bind(p, storage.parts(data)[i]!, body, undefined, dynamic),
                    );
                else if (p.kind === 'constructor') {
                    // The matched value is still a scattered lens: its fields are the pointers it
                    // carries, so they are read and written in place and nothing is rebuilt.
                    if (!Array.isArray(data) && data.scattered) {
                        const { lens, layout: lensLayout } = data.scattered;
                        const n = tagOf(data.layout, p.name);
                        const pointers = sumParts(lensLayout)!
                            .pointers.filter((q) => q.variant === n)
                            .sort((a, b) => a.index - b.index);
                        const leaf = (q: (typeof pointers)[number]): Data => ({
                            expression: star(dot(lens, q.name)),
                            layout: q.layout,
                            address: dot(lens, q.name),
                            heap: true,
                        });
                        const contents: Data = !pointers.length
                            ? {
                                  expression: zero(variant(data.layout, n).layout),
                                  layout: variant(data.layout, n).layout,
                              }
                            : pointers[0]!.name.includes('_')
                              ? pointers.map(leaf)
                              : leaf(pointers[0]!);
                        if (p.items.length === 1) bind(p.items[0]!, contents, body);
                        else
                            p.items.forEach((item, k) =>
                                bind(item, storage.parts(contents)[k]!, body),
                            );
                        return;
                    }
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
                            variantField(data.expression, n),
                            body,
                        );
                        retainedBoxes.set(retains, box);
                        contents = {
                            expression: cc`(*${box})`,
                            layout: v.layout,
                            address: box,
                            heap: true,
                        };
                    } else if (v.boxed) {
                        const taken =
                            dynamic && reaches(v.layout)
                                ? cc`(${use('unique_context')}(${variantField(data.expression, n)}) ? ${contents.expression} : ${shareValue(contents.expression, v.layout)})`
                                : contents.expression;
                        contents = {
                            expression: declare(v.layout, taken, body),
                            layout: v.layout,
                        };
                        if (retains !== undefined) {
                            // The reconstruction writes its payload into this box.
                            retainedBoxes.set(
                                retains,
                                cell(
                                    fresh(),
                                    `${type(v.layout)} *`,
                                    variantField(data.expression, n),
                                    body,
                                ),
                            );
                        } else
                            body.push(
                                cc`${use('release_context')}(${variantField(data.expression, n)});`,
                            );
                    }
                    if (p.items.length === 1) bind(p.items[0]!, contents, body, undefined, dynamic);
                    else
                        p.items.forEach((item, k) =>
                            bind(item, storage.parts(contents)[k]!, body, undefined, dynamic),
                        );
                } else if (p.kind === 'drop' || p.kind === 'literal') drop(data, body);
            };
            const parameters: { expression: string; layout: string; view: View }[] = [];
            // Incoming lenses as passed, so a call that needs the same lens can forward one.
            const physicalLenses: { expression: string; layout: string; data: Data }[] = [];
            c.parameters.forEach((p, i) => {
                if (p.lensPlace) {
                    const view = incoming(sources[i]!, p.layout);
                    places.set(p.lensPlace, view);
                    parameters.push({ expression: sources[i]!, layout: p.layout, view });
                    physicalLenses.push({
                        expression: sources[i]!,
                        layout: p.layout,
                        data: storage.get(view),
                    });
                } else
                    bind(
                        p.pattern,
                        { expression: sources[i]!, layout: p.layout },
                        undefined,
                        undefined,
                        true,
                    );
            });
            const flushParameters = (body: Statement[]) =>
                parameters.forEach((p) => flush(p.expression, p.layout, storage.get(p.view), body));
            const ref = (s: SlotRef) =>
                storage.project(places.get(s.place) ?? unsupported('Unavailable C place'), s.path);
            const value = (id: string) =>
                values.get(id) ?? unsupported('Indirect/function value requires phase 6');
            // A lens needs no restoration when every endpoint is a plain read pointer.
            const homogeneous = (id: string): boolean => {
                const l = layout(id);
                if (l.fields.some((f) => f.name === 'replacement')) return false;
                if (l.fields.some((f) => f.name === 'read')) return true;
                return l.fields
                    .filter((f) => f.name.startsWith('item'))
                    .every((f) => f.kind === 'value' && homogeneous(f.layout));
            };
            /** Both denote the same live storage at every endpoint. Equal values are not enough. */
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
                return (
                    left.length === right.length && left.every((d, n) => sameStorage(d, right[n]!))
                );
            };
            /**
             * A lens as a heap-allocated runtime lens struct: a context holding the frame locals
             * its restoration reads, and a function that runs `lens.finish` (and, for the
             * function's own result, the incoming lenses' write-back).
             */
            const closureLens = (
                lens: Lens,
                layoutId: string,
                body: Statement[],
                flush: boolean,
            ): string => {
                const h = helperCounter++,
                    context = `Restore${h}`,
                    restore = `restore${h}`;
                // This body hands out the restoration function and its context.
                use(context);
                use(restore);
                const candidates = [...variables];
                const contextFields: string[] = [];
                const initial: Statement[] = [];
                const build = (view: View, id: string, path: string): Expr => {
                    const scattered = sumParts(id);
                    if (scattered) {
                        // The focus is a union copy in the context; each field pointer addresses
                        // the matching member of that copy (valid whichever constructor it holds).
                        const r = `focus${path}`;
                        contextFields.push(cText`${type(scattered.union)} ${r};`);
                        initial.push(cc`ctx->${r} = ${read(storage.get(view), scattered.union)};`);
                        return cc`(${type(id)}){.tag=ctx->${r}.tag, ${joinCode(
                            scattered.pointers.map(
                                (p) =>
                                    cc`.${member(p.name)}=&ctx->${r}.as.v${p.variant}${p.name.includes('_') ? cc`.item${p.index}` : ''}`,
                            ),
                            ', ',
                        )}}`;
                    }
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
                const resultExpression = build(lens.view, layoutId, '');
                const replacement = endpoint(layoutId, 'replacement');
                const saved = storage.snapshot();
                storage.put(lens.view, { expression: 'replacement', layout: replacement });
                const cleanup: Statement[] = [];
                lens.finish(cleanup);
                if (flush) flushParameters(cleanup);
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
                    captured.map((v) => [
                        v.name,
                        locals.access('ctx', '->', locals.literal(v.name)),
                    ]),
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
                auxTypes.push(
                    new Declaration(
                        context,
                        cText`typedef struct { ${contextFields.join(' ') || 'unsigned char inhabitant;'} } ${context};`,
                    ),
                );
                declarations.push(
                    new Declaration(
                        restore,
                        cText`${type(unit.id)} ${restore}(void *opaque, ${type(replacement)} replacement);`,
                    ),
                );
                // What the cleanup mentions was recorded against this function, which is
                // the only function that can reach the restoration function.
                refs.within(restore, () => {
                    use(context);
                    helpers.push({
                        name: restore,
                        signature: cText`${type(unit.id)} ${restore}(void *opaque, ${type(replacement)} replacement)`,
                        body: [
                            cc`${context} *ctx = opaque;`,
                            '(void)replacement;',
                            ...rewriteBody(suppressUnused(locals, cleanup, [])),
                            cc`${use('release_context')}(ctx);`,
                            cc`return ${zero(unit.id)};`,
                        ],
                    });
                });
                body.push(`${context} *ctx = ${use('allocate_context')}(sizeof *ctx);`, {
                    kind: 'if',
                    arms: [{ condition: '!ctx', body: ['abort();'] }],
                });
                captured.forEach((v) => body.push(cc`ctx->${locals.literal(v.name)} = ${v.name};`));
                body.push(...initial);
                const out = fresh();
                body.push(
                    cc`${type(layoutId)} ${out} = ${resultExpression};`,
                    cc`${out}.restore = ${restore};`,
                    cc`${out}.context = ctx;`,
                );
                return out;
            };
            /** Cleanup of the blocks being lowered whose result is the function's returned lens. */
            const enclosingFinishes: ((body: Statement[]) => void)[] = [];
            /** Enclosing cleanup a forwarding join already ran inside each arm's restoration. */
            const consumed = new Set<(body: Statement[]) => void>();
            const count = (s: Statement[]): number =>
                s.reduce<number>((n, x) => n + (Array.isArray(x) ? count(x) : 1), 0);
            /**
             * How a lens-valued case can return its arm's lens as a runtime lens struct, so the
             * function returns whichever arm ran with no selector and no copied contents:
             * `struct` when the arm already is one (a call result, or a pointer into storage
             * that outlives the frame) and nothing else has to run, or `closure` when the arm's
             * own restoration becomes its struct's callback. Either needs the rest of the
             * function (enclosing cleanup and the incoming lenses' write-back) to emit nothing.
             * `after` is the storage state once the arm's restoration has run, which is the
             * state the join then continues from.
             */
            type ForwardPlan = {
                kind: 'struct' | 'closure';
                expression?: Expr;
                after: Map<Cell, Data>;
            };
            const forwardable = (
                lens: Lens,
                arm: { restored?: unknown[] },
                id: string,
            ): ForwardPlan | undefined => {
                if (arm.restored?.length) return undefined;
                // An incoming lens that changes type has no live form to restore it to.
                if (
                    parameters.some((p) =>
                        layout(p.layout).fields.some((f) => f.name === 'replacement'),
                    )
                )
                    return undefined;
                const saved = storage.snapshot(),
                    mark = variables.length;
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                let quiet: boolean, afterEnclosing: Map<Cell, Data>, afterFlush: Map<Cell, Data>;
                try {
                    const trial: Statement[] = [];
                    (lens.forwarded ? lens.forwarded.rest : lens.finish)(trial);
                    const enclosing: Statement[] = [];
                    for (let k = enclosingFinishes.length - 1; k >= 0; k--)
                        enclosingFinishes[k]!(enclosing);
                    afterEnclosing = storage.snapshot();
                    const flushed: Statement[] = [];
                    flushParameters(flushed);
                    quiet = count(trial) === 0 && count(enclosing) === 0 && count(flushed) === 0;
                    // Writing the incoming lenses back is part of the arm's own restoration when
                    // it runs from a callback; the model then sees them as live again.
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
                    variables.length = mark;
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
                            expression: cc`(${type(id)}){.read=${d.address}}`,
                            after: afterEnclosing,
                        };
                }
                // Otherwise the arm's own restoration, the enclosing cleanup and the incoming
                // lenses' write-back all run from the callback of a struct built here.
                return { kind: 'closure', after: afterFlush };
            };
            // Adapt input/output backing at calls. Escaping calls use heap backing, so
            // a returned continuation never retains a pointer into the caller frame.
            const adapt = (
                lens: Lens,
                id: string,
                escapes: boolean,
                body: Statement[],
            ): { expression: string; finish: (body: Statement[]) => void } => {
                // A synchronous call over storage that needs no restoration can reuse
                // live endpoint addresses; the call's results stay in whatever it points at.
                const reusable = !escapes && lens.finish === noFinish && homogeneous(id);
                if (reusable) {
                    const data = storage.get(lens.view);
                    const existing = physicalLenses.find(
                        (p) => p.layout === id && sameStorage(data, p.data),
                    );
                    if (existing) return { expression: existing.expression, finish: noFinish };
                }
                // A same-layout lens over live storage (a field of an in-place box, or an
                // incoming lens) is passed by address: nothing is copied or restored.
                const l = layout(id),
                    input = l.fields.find((f) => f.name === 'read');
                if (
                    input?.kind === 'pointer' &&
                    input.layout &&
                    !l.fields.some((f) => f.name === 'replacement')
                ) {
                    const d = storage.get(lens.view);
                    // An escaping call may keep the pointer, so only storage a heap box owns qualifies.
                    if (
                        !Array.isArray(d) &&
                        d.address &&
                        d.layout === input.layout &&
                        (!escapes || d.heap)
                    ) {
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
                    fieldTypes: string[] = [],
                    init: Statement[] = [];
                /** What each endpoint denotes after the call: its own live storage or the backing. */
                const live = new Map<string, Data>();
                const build = (id: string, path: string): Expr => {
                    const l = layout(id),
                        input = l.fields.find((f) => f.name === 'read');
                    if (input?.kind === 'pointer' && input.layout) {
                        const output = l.fields.find((f) => f.name === 'replacement');
                        const d = storage.get(
                            storage.project(lens.view, path ? path.split('.').map(Number) : []),
                        );
                        // An endpoint already over live storage is pointed at, not copied.
                        if (
                            !escapes &&
                            lens.finish === noFinish &&
                            !output &&
                            !Array.isArray(d) &&
                            d.layout === input.layout &&
                            d.address
                        ) {
                            live.set(path, d);
                            return cc`(${type(id)}){.read=${d.address}}`;
                        }
                        const n = fields.length,
                            r = `read${n}`,
                            w = output ? `write${n}` : r;
                        const access = cc`${name}${escapes ? '->' : '.'}${r}`;
                        live.set(path, {
                            expression: access,
                            address: cc`&${name}${escapes ? '->' : '.'}${w}`,
                            layout:
                                output?.kind === 'pointer' && output.layout
                                    ? output.layout
                                    : input.layout,
                        });
                        fields.push(cText`${type(input.layout)} ${r};`);
                        fieldTypes.push(type(input.layout));
                        // Heap backing is not zeroed; stack backing is, so only a nonzero
                        // value needs writing there.
                        const initial = read(d, input.layout);
                        if (escapes || !same(initial, zero(input.layout)))
                            init.push(cc`${access} = ${initial};`);
                        if (output?.kind === 'pointer' && output.layout) {
                            fields.push(cText`${type(output.layout)} ${w};`);
                            fieldTypes.push(type(output.layout));
                            if (escapes) init.push(cc`${name}->${w} = ${zero(output.layout)};`);
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
                // Every endpoint was already live storage: there is nothing to stage.
                if (!fields.length)
                    return {
                        expression: declare(id, expression, body, undefined, {
                            pure: true,
                            inline: true,
                        }),
                        finish: lens.finish,
                    };
                // Identical backings (same field types) share one definition.
                const backingKey = fields.join(' ');
                let backingType = backingTypes.get(backingKey);
                if (!backingType) {
                    backingType = packageNames.unique(
                        `Backing_${fieldTypes
                            .join('_')
                            .replace(/[^A-Za-z_0-9]/g, '_')
                            .slice(0, 60)}`,
                    );
                    backingTypes.set(backingKey, backingType);
                    auxTypes.push(
                        new Declaration(
                            backingType,
                            cText`typedef struct { ${backingKey || 'unsigned char inhabitant;'} } ${backingType};`,
                        ),
                    );
                }
                use(backingType);
                cell(
                    name,
                    backingType + (escapes ? ' *' : ''),
                    escapes ? cc`${use('allocate_context')}(sizeof *${name})` : undefined,
                    body,
                );
                if (escapes)
                    body.push({
                        kind: 'if',
                        arms: [{ condition: cc`!${name}`, body: ['abort();'] }],
                    });
                body.push(...init);
                const arg = declare(id, expression, body);
                if (reusable) {
                    const result = (id: string, path = ''): Data =>
                        live.get(path) ??
                        layout(id)
                            .fields.filter((f) => f.name.startsWith('item'))
                            .map((f, n) =>
                                result(
                                    (f as { layout: string }).layout,
                                    path ? path + '.' + n : String(n),
                                ),
                            );
                    const data = result(id);
                    return { expression: arg, finish: () => storage.put(lens.view, data) };
                }
                const outputs = (expr: Expr, id: string): Data => {
                    const l = layout(id),
                        f =
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
                        if (escapes) body.push(cc`${use('release_context')}(${name});`);
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
                        const current = storage.get(view);
                        if (
                            sumParts(id) &&
                            !Array.isArray(current) &&
                            current.scattered &&
                            same(current.scattered.lens, name)
                        ) {
                            // Every write already went through the pointers; only the callback of
                            // a lens that carries one still has to run, with the final value.
                            body.push({
                                head: cc`if (${dot(name, 'restore')})`,
                                body: [
                                    cc`${dot(name, 'restore')}(${dot(name, 'context')}, ${sumValue(name, id)});`,
                                ],
                            });
                            after(body);
                            return;
                        }
                        const replacement = declare(
                            endpoint(id, 'replacement'),
                            read(storage.get(view), endpoint(id, 'replacement')),
                            body,
                        );
                        body.push(
                            {
                                head: cc`if (${dot(name, 'restore')})`,
                                body: [
                                    cc`${dot(name, 'restore')}(${dot(name, 'context')}, ${replacement});`,
                                ],
                            },
                            {
                                head: 'else',
                                body: (() => {
                                    const b: Statement[] = [];
                                    if (sumParts(id)) sumWriteBack(name, id, replacement, b);
                                    else flush(name, id, storage.get(view), b);
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
                      ? String(v)
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
                    return cc`${use('string_equals')}(${expr}, ${text.literal}, ${text.length})`;
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
                    [
                        cc`${dot(expr, 'tag')} == ${tagValue(id, n)}`,
                        ...items.filter((m) => !same(m, '1')),
                    ],
                    ' && ',
                );
            };
            /** The scattered lens a match's subject was moved out of, when it can be matched in place. */
            const scatteredSubject = (i: {
                value: string;
                cases: { pattern: IRPattern }[];
            }): Leaf | undefined => {
                const d = movedFrom.get(i.value);
                if (!d || Array.isArray(d) || !d.scattered) return undefined;
                return i.cases.every(
                    (c) => c.pattern.kind === 'constructor' && c.pattern.items.every(irrefutable),
                )
                    ? d
                    : undefined;
            };
            const irrefutable = (p: IRPattern): boolean =>
                p.kind === 'bind' ||
                p.kind === 'drop' ||
                (p.kind === 'tuple' && p.items.every(irrefutable));
            /**
             * Arms in order, as the simplest structure that keeps the semantics. A catch-all
             * ends ordered matching (later arms cannot run) and becomes the `else`; a match
             * on every constructor with irrefutable payloads is a `switch` with no trap; a
             * Bool match tests its condition once. Only a match that can fall through
             * keeps an unmatched-case trap.
             */
            const emitMatch = (
                patterns: IRPattern[],
                arms: Statement[][],
                subject: Expr,
                id: string,
                body: Statement[],
            ) => {
                const wildcard = patterns.findIndex(irrefutable);
                const count = wildcard < 0 ? patterns.length : wildcard + 1;
                const used = patterns.slice(0, count);
                if (wildcard === 0) {
                    body.push(arms[0]!);
                    return;
                }
                const tests = used.slice(0, wildcard < 0 ? count : count - 1);
                const bool = (p: IRPattern) => p.kind === 'literal' && typeof p.value === 'boolean';
                const test = (p: IRPattern): Expr =>
                    bool(p) && (p as { value: boolean }).value
                        ? subject
                        : bool(p)
                          ? cc`!(${subject})`
                          : matches(p, subject, id);
                if (
                    layout(id).kind === 'bool' &&
                    tests.length === 2 &&
                    tests.every(bool) &&
                    (tests[0] as { value: boolean }).value !==
                        (tests[1] as { value: boolean }).value
                ) {
                    body.push({
                        kind: 'if',
                        arms: [{ condition: test(tests[0]!), body: arms[0]! }, { body: arms[1]! }],
                    });
                    return;
                }
                const labels = tests.map((p) =>
                    p.kind === 'constructor' ? tagValue(id, tagOf(id, p.name)) : '',
                );
                if (
                    layout(id).kind === 'union' &&
                    tests.length &&
                    tests.every((p) => p.kind === 'constructor' && p.items.every(irrefutable)) &&
                    new Set(labels).size === labels.length
                ) {
                    const cases: { label?: Expr; body: Statement[] }[] = labels.map((label, n) => ({
                        label,
                        body: arms[n]!,
                    }));
                    if (wildcard >= 0) cases.push({ body: arms[count - 1]! });
                    else if (labels.length !== layout(id).fields.length)
                        cases.push({ body: ['abort();'] });
                    body.push({ kind: 'switch', subject: dot(subject, 'tag'), cases });
                    return;
                }
                body.push({
                    kind: 'if',
                    arms: [
                        ...used.map((p, n) =>
                            irrefutable(p)
                                ? { body: arms[n]! }
                                : { condition: test(p), body: arms[n]! },
                        ),
                        ...(wildcard < 0 ? [{ body: ['abort();'] }] : []),
                    ],
                });
            };
            const block = (b: ConcreteBlock, body: Statement[]): Expr => {
                const finish = (body: Statement[]) =>
                    b.cleanup.forEach((c) => {
                        if (c.kind === 'release') {
                            const lens = loans.get(c.loan);
                            if (lens) lens.finish(body);
                        } else if (c.kind === 'drop-place') {
                            drop(storage.get(ref(c.slot)), body);
                            storage.put(ref(c.slot), {
                                expression: zero(unit.id),
                                layout: unit.id,
                            });
                        }
                    });
                const tracked = returned.has(b.result);
                if (tracked) enclosingFinishes.push(finish);
                for (const i of b.instructions) {
                    if (i.op === 'bind') {
                        bind(
                            i.pattern,
                            {
                                expression: value(i.value),
                                layout: outputLayouts.get(i.value)!,
                            },
                            body,
                            undefined,
                            sharedValues.has(i.value),
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
                        name =
                            hinted && takesName(i)
                                ? locals.reference(versionName(hinted))
                                : fresh();
                    let expr!: Expr;
                    // Only side-effect-free values that read no memory may be inlined or pruned.
                    let pure = false;
                    /** Unused results of these are dropped: they only read or aggregate. */
                    let removable = false;
                    /** The value is a call: an unused result leaves the call as a statement. */
                    let effect = false;
                    switch (i.op) {
                        case 'aslens': {
                            const payload = outputLayouts.get(i.initial)!;
                            const box = i.inPlace ? retainedBoxes.get(i.inPlace) : undefined;
                            if (i.inPlace) {
                                const owner = retainedOwners.get(i.inPlace),
                                    slot = i.reconstruction?.reconstructionOwner;
                                if (!box || !owner || !slot)
                                    return unsupported('Missing retained box');
                                // The temporary is the box payload: fields are live reads through
                                // it, written back only when changed. The owner's header is
                                // unchanged, so restoring it needs no reconstruction.
                                const view = storage.own({
                                    expression: cc`(*${box})`,
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
                                        ? cc`, .${member(e.field)}=${use(codes.get(w.code)!)}`
                                        : w.kind === 'adapt-lens-result'
                                          ? cc`, .${member(e.field)}=${use(resultAdapters.get(w.id)!)}`
                                          : w.kind === 'native' && nativeCodes.has(w.id)
                                            ? cc`, .${member(e.field)}=${use(nativeCodes.get(w.id)!)}`
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
                                        (f) =>
                                            f.kind === 'value' && layout(f.layout).kind === 'unit',
                                    ))
                            ) {
                                expr = cc`(${type(id)}){.environment=NULL${entries}}`;
                                break;
                            }
                            const environment = fresh();
                            cell(
                                environment,
                                `${type(callable.environment)} *`,
                                cc`${use('allocate_context')}(sizeof *${environment})`,
                                body,
                            );
                            i.captures.forEach((capture, n) =>
                                body.push(
                                    cc`${environment}->capture${n} = ${value(capture.value)};`,
                                ),
                            );
                            expr = cc`(${type(id)}){.environment=${environment}, .dispose=${use(disposers.get(callable.dispose)!)}${entries}}`;
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
                                expr = cc`${use('string_new')}(${head.literal}, ${head.length})`;
                                break;
                            }
                            // Parts were evaluated in source order; appending consumes each one.
                            const builder = fresh();
                            cell(builder, 'string_builder', undefined, body);
                            body.push(
                                cc`${use('builder_bytes')}(&${builder}, ${head.literal}, ${head.length});`,
                            );
                            for (const part of i.parts) {
                                const tail = cBytes(part.tail);
                                const appended = value(part.value);
                                use(appendFunction(layout(outputLayouts.get(part.value)!).kind));
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
                                    cc`${use('builder_bytes')}(&${builder}, ${tail.literal}, ${tail.length});`,
                                );
                            }
                            expr = cc`${use('builder_finish')}(&${builder})`;
                            break;
                        }
                        case 'construct': {
                            constructedBy.set(i.out.id, { name: i.name, items: i.items });
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
                                        cc`${use('allocate_context')}(sizeof *${box})`,
                                        body,
                                    );
                                }
                                body.push(cc`*${box} = ${contents};`);
                                contents = box;
                            }
                            expr = cc`(${type(id)}){.tag=${tagValue(id, n)}, .as.v${n}=${contents}}`;
                            // A by-value union nothing reads builds no side effect.
                            removable = !v.boxed;
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
                            rememberScattered(ref(i.slot));
                            expr = read(storage.get(ref(i.slot)), id);
                            storage.put(ref(i.slot), {
                                expression: zero(unit.id),
                                layout: unit.id,
                            });
                            break;
                        case 'acquire':
                            lensSlots.set(i.out.id, i.slot);
                            lenses.set(i.out.id, { view: ref(i.slot), finish: noFinish });
                            continue;
                        case 'lens-tuple':
                            // A tuple of lenses that need no restoration needs none itself.
                            lenses.set(i.out.id, {
                                view: i.items.map((v) => lenses.get(v)!.view),
                                finish: i.items.every((v) => lenses.get(v)!.finish === noFinish)
                                    ? noFinish
                                    : (body) => i.items.forEach((v) => lenses.get(v)!.finish(body)),
                            });
                            continue;
                        case 'lens-construct': {
                            // A constructor of lenses has no storage of its own. Its temporary
                            // holds the value built from the field lenses' current contents (a
                            // read, not a move: ownership stays explicit in the IR), and
                            // restoration checks the tag and writes each payload field back.
                            const union = endpoint(id, 'read');
                            const n = tagOf(union, i.name),
                                v = variant(union, n);
                            if (v.boxed)
                                return unsupported('Constructor lens over a boxed variant');
                            const fields = i.items.map((item) => lenses.get(item)!);
                            const contents = (): Expr => {
                                const items = fields.map((f) => storage.get(f.view));
                                if (items.length === 0) return zero(v.layout);
                                if (items.length === 1) return read(items[0]!, v.layout);
                                const types = layout(v.layout).fields;
                                return cc`(${type(v.layout)}){${joinCode(
                                    items.map((d, k) =>
                                        read(d, (types[k] as { layout: string }).layout),
                                    ),
                                    ', ',
                                )}}`;
                            };
                            const view = storage.own({
                                expression: cc`(${type(union)}){.tag=${tagValue(union, n)}, .as.v${n}=${contents()}}`,
                                layout: union,
                            });
                            // Over a scattered layout, field lenses that are addresses into storage
                            // that outlives the frame need no temporary: the lens is the tag and
                            // those addresses, and whoever restores it writes through them.
                            const scattered = sumParts(id);
                            let direct: string | undefined;
                            if (scattered) {
                                const pointers = scattered.pointers
                                    .filter((p) => p.variant === n)
                                    .sort((a, b) => a.index - b.index);
                                let leaves: Data[] = fields.map((f) => storage.get(f.view));
                                if (pointers.length > 1 && leaves.length === 1)
                                    leaves = storage.parts(leaves[0]!);
                                const live = leaves.map((d) =>
                                    !Array.isArray(d) && d.address && d.heap
                                        ? d.address
                                        : undefined,
                                );
                                if (
                                    leaves.length === pointers.length &&
                                    live.every((a) => a !== undefined)
                                )
                                    direct = declare(
                                        id,
                                        cc`(${type(id)}){.tag=${tagValue(union, n)}${joinCode(
                                            pointers.map(
                                                (p, k) => cc`, .${member(p.name)}=${live[k]!}`,
                                            ),
                                            '',
                                        )}}`,
                                        body,
                                        fresh(),
                                        // Unused when the arm needs a callback instead, so prunable.
                                        { pure: true },
                                    );
                            }
                            lenses.set(i.out.id, {
                                ...(direct
                                    ? { forwarded: { expression: direct, rest: noFinish } }
                                    : {}),
                                view,
                                finish: (output) => {
                                    const replacement = storage.get(view);
                                    if (Array.isArray(replacement))
                                        return unsupported('Constructor lens replacement shape');
                                    output.push({
                                        head: cc`if (${dot(replacement.expression, 'tag')} != ${tagValue(union, n)})`,
                                        body: ['abort();'],
                                    });
                                    const inner: Data = {
                                        expression: payload(replacement.expression, union, n),
                                        layout: v.layout,
                                    };
                                    const parts =
                                        fields.length === 1 ? [inner] : storage.parts(inner);
                                    fields.forEach((f, k) => storage.put(f.view, parts[k]!));
                                    fields.forEach((f) => f.finish(output));
                                },
                            });
                            continue;
                        }
                        case 'swap': {
                            const lens = lenses.get(i.lens)!;
                            const contents = storage.get(lens.view);
                            // Putting a constructed value back into a scattered lens: its constructor
                            // is the one that was matched, so write each field through its pointer
                            // now and leave the lens as it was.
                            const built = constructedBy.get(i.value);
                            const scattered = Array.isArray(lens.view)
                                ? undefined
                                : scatteredHomes
                                      .get(lens.view.cell)
                                      ?.get(JSON.stringify(lens.view.path));
                            if (scattered && built) {
                                const parts = sumParts(scattered.scattered!.layout)!;
                                const pointers = parts.pointers
                                    .filter((p) => p.variant === tagOf(parts.union, built.name))
                                    .sort((a, b) => a.index - b.index);
                                if (pointers.length === built.items.length) {
                                    declare(id, read(contents, id), body, name, { pure: true });
                                    pointers.forEach((p, k) =>
                                        body.push(
                                            cc`*${dot(scattered.scattered!.lens, p.name)} = ${value(built.items[k]!)};`,
                                        ),
                                    );
                                    storage.put(lens.view, scattered);
                                    lens.finish(body);
                                    values.set(i.out.id, name);
                                    continue;
                                }
                            }
                            expr = read(contents, id);
                            // The old value is only read here; an unused one is just dropped.
                            declare(id, expr, body, name, { pure: true });
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
                                body.push(cc`${through(live)} = ${value(i.value)};`);
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
                                                (d) =>
                                                    JSON.stringify(d) === JSON.stringify(data[0]),
                                            ) &&
                                            (arms.length > 1 ||
                                                JSON.stringify(data[0]) ===
                                                    JSON.stringify(previous) ||
                                                // Live storage that outlives the frame needs no copy out of the arm.
                                                (!Array.isArray(data[0]) && data[0]!.heap))
                                        )
                                            return data[0]!;
                                        const first = data[0]!;
                                        if (
                                            !Array.isArray(first) &&
                                            data.every(
                                                (d) =>
                                                    !Array.isArray(d) && d.layout === first.layout,
                                            )
                                        ) {
                                            const phi = declare(
                                                first.layout,
                                                zero(first.layout),
                                                into,
                                            );
                                            arms.forEach((arm, n) =>
                                                arm.nested.push(
                                                    locals.assign(
                                                        phi,
                                                        read(data[n]!, first.layout),
                                                    ),
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
                                        scatteredSubject(i) ?? {
                                            expression: value(i.value),
                                            layout: outputLayouts.get(i.value)!,
                                        },
                                        nested,
                                        arm.retains,
                                        sharedValues.has(i.value),
                                    );
                                    if (arm.retains && movedFrom.has(i.value))
                                        retainedOwners.set(arm.retains, movedFrom.get(i.value)!);
                                    block(arm.body, nested);
                                    normalize(arm.setup, nested);
                                    const lens = lenses.get(arm.body.result)!;
                                    const forward = returned.has(i.out.id)
                                        ? forwardable(
                                              lens,
                                              arm,
                                              outputLayouts.get(arm.body.result)!,
                                          )
                                        : undefined;
                                    // Setup storage used by deferred cleanup is declared in the arm;
                                    // declaration placement lifts it out of the conditional.
                                    return {
                                        nested,
                                        state: storage.snapshot(),
                                        lens,
                                        arm,
                                        index: n,
                                        forward,
                                    };
                                });
                                const forwarding = arms.every((a) => a.forward !== undefined);
                                let forwardedJoin: string | undefined;
                                if (forwarding) {
                                    // Every arm is a runtime lens that restores itself: the result
                                    // is whichever one ran, with no selector and no copied contents.
                                    forwardedJoin = fresh();
                                    variables.push({ name: forwardedJoin, type: type(id) });
                                    body.push(
                                        locals.declaration(forwardedJoin, type(id), zero(id)),
                                    );
                                    const enclosing = [...enclosingFinishes];
                                    arms.forEach((a) => {
                                        const plan = a.forward!;
                                        // The arm's lens, as a struct that restores itself.
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
                                } else
                                    arms.forEach((a) => {
                                        storage.reset(a.state);
                                        a.nested.push(
                                            locals.assign(selected, String(a.index)),
                                            locals.assign(
                                                focus,
                                                read(storage.get(a.lens.view), input),
                                            ),
                                        );
                                    });
                                storage.reset(before);
                                merge(arms, body);
                                emitMatch(
                                    i.cases.map((arm) => arm.pattern),
                                    arms.map((arm) => arm.nested),
                                    scatteredSubject(i)?.scattered?.lens ?? value(i.value),
                                    outputLayouts.get(i.value)!,
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
                                    scatteredSubject(i) ?? {
                                        expression: value(i.value),
                                        layout: outputLayouts.get(i.value)!,
                                    },
                                    nested,
                                    arm.retains,
                                    sharedValues.has(i.value),
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
                            emitMatch(
                                i.cases.map((arm) => arm.pattern),
                                arms.map((arm) => arm.nested),
                                scatteredSubject(i)?.scattered?.lens ?? value(i.value),
                                outputLayouts.get(i.value)!,
                                body,
                            );
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
                                        x.entries.some(
                                            (e) => e.field === i.field && e.abi === i.abi,
                                        ),
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
                                const source = read(storage.get(lens.view), id);
                                expr = i.share ? shareValue(source, id) : duplicate(source, id);
                                adapters.push({ finish: lens.finish });
                            } else if (w?.kind === 'native' && w.definition === 'native/size') {
                                const lens = lenses.get(i.args[0]!)!,
                                    vector = endpoint(outputLayouts.get(i.args[0]!)!, 'read');
                                expr = cc`(double)${dot(read(storage.get(lens.view), vector), 'length')}`;
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
                                    const a = adapt(
                                        lenses.get(v)!,
                                        abi.arguments[n]!,
                                        isLens,
                                        body,
                                    );
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
                                            ? cc`${wrapperFunction(i.wrapper!)}(${
                                                  takesEnvironment(i.wrapper!)
                                                      ? dot(value(i.callee), 'environment')
                                                      : 'NULL'
                                              }${joinCode(
                                                  args.map((a) => cc`, ${a}`),
                                                  '',
                                              )})`
                                            : cc`${dot(value(i.callee), i.field)}(${dot(value(i.callee), 'environment')}${joinCode(
                                                  args.map((a) => cc`, ${a}`),
                                                  '',
                                              )})`;
                                else if (w?.kind === 'native') {
                                    const op = requireImport(w.definition, 'c').name;
                                    pure =
                                        (infixImports.includes(op) &&
                                            (!['==', '!='].includes(op) ||
                                                ['f64', 'bool'].includes(
                                                    layout(abi.arguments[0]!).kind,
                                                ))) ||
                                        op === '%' ||
                                        op === 'not';
                                    effect = !pure && op !== 'heapsize' && op !== '[::]';
                                    expr =
                                        simpleNative(op, args, id, abi.arguments) ??
                                        unsupported(cText`Native import ${w.definition}`);
                                } else return unsupported('Disposer invocation');
                            }
                            declare(id, expr, body, name, {
                                pure: pure || removable,
                                inline: pure,
                                effect: effect || !!(i.field !== undefined || w?.kind !== 'native'),
                            });
                            values.set(i.out.id, name);
                            if (isLens) {
                                const rest = (body: Statement[]) =>
                                    adapters.forEach((a) => a.finish(body));
                                lenses.set(i.out.id, {
                                    ...runtimeLens(name, id, rest),
                                    forwarded: { expression: name, rest },
                                });
                            } else adapters.forEach((a) => a.finish(body));
                            continue;
                        }
                        default:
                            return unsupported(
                                cText`Unknown operation ${(i as { op: string }).op}`,
                            );
                    }
                    declare(id, expr, body, name, { pure: pure || removable });
                    values.set(i.out.id, name);
                }
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
                return value(b.result);
            };
            const outputLayouts = new Map<string, string>();
            /** Values whose type is shared: other holders may reference their allocations. */
            const sharedValues = new Set<string>();
            const index = (b: ConcreteBlock) =>
                b.instructions.forEach((i) => {
                    if ('out' in i) outputLayouts.set(i.out.id, i.out.layout);
                    if ('out' in i && i.out.type.tag === 'plain' && i.out.type.mode === 'shared')
                        sharedValues.add(i.out.id);
                    if (i.op === 'scope') index(i.body);
                    if (i.op === 'aslens') {
                        if (i.inPlace) inPlaceIds.add(i.inPlace);
                        index(i.cleanup);
                    }
                    if (i.op === 'case') i.cases.forEach((a) => index(a.body));
                });
            index(c.body);
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
                places.set(
                    capture.place,
                    storage.own({ expression: name, layout: capture.layout }),
                );
            });
            if (c.captures.length && !erasedEnvironment(c.captures))
                body.push(cc`${use('release_context')}(environment);`);
            const result = block(c.body, body);
            const forwardedResult = lenses.get(c.body.result)?.forwarded;
            const returnsForwarded =
                forwardedResult &&
                (() => {
                    // Nothing is left to restore: the struct already restores itself.
                    const saved = storage.snapshot(),
                        mark = variables.length;
                    const trial: Statement[] = [];
                    try {
                        forwardedResult.rest(trial);
                        flushParameters(trial);
                    } catch (error) {
                        if (error instanceof BackendDiagnostic) return false;
                        throw error;
                    } finally {
                        storage.reset(saved);
                        variables.length = mark;
                    }
                    return count(trial) === 0;
                })();
            if (returnsForwarded) {
                body.push(locals.returnValue(forwardedResult!.expression));
            } else if (lenses.has(c.body.result)) {
                const out = closureLens(lenses.get(c.body.result)!, c.body.layout, body, true);
                body.push(cc`return ${out};`);
            } else {
                flushParameters(body);
                body.push(locals.returnValue(result));
            }
            const placed = locals.place(body);
            activeLocals = undefined;
            return {
                name: codes.get(c.id)!,
                signature: signature(c),
                body: suppressUnused(locals, placed, parameterNames),
            };
        }),
    );
    // Helpers generated while emitting the entry adapter (result printing and drops) follow.
    const emittedHelpers = helpers.length;
    // Runtime functions declare what they call; the allocator mentions the counter.
    runtime?.functions.forEach((f) => refs.within(f.name, () => f.uses.forEach(use)));
    refs.within('allocate_context', () => use('live_contexts'));
    refs.within('release_context', () => use('live_contexts'));
    functions.push(
        ...helpers,
        ...(runtime?.functions ?? []),
        {
            // Every allocation carries a reference count ahead of its payload. Owned data has
            // exactly one reference; a shared read adds one and each holder's drop removes one.
            name: 'allocate_context',
            signature: 'void *allocate_context(size_t size)',
            body: [
                'size_t *context = malloc(size + 2 * sizeof *context);',
                { head: 'if (!context)', body: ['abort();'] },
                '++live_contexts;',
                '*context = 1;',
                'return context + 2;',
            ],
        },
        {
            name: 'retain_context',
            signature: 'void retain_context(void *context)',
            body: ['++((size_t *)context)[-2];'],
        },
        {
            name: 'unique_context',
            signature: '_Bool unique_context(void *context)',
            body: ['return ((size_t *)context)[-2] == 1;'],
        },
        {
            name: 'release_context',
            signature: 'void release_context(void *context)',
            body: [
                { head: 'if (!context || live_contexts == 0)', body: ['abort();'] },
                'size_t *refs = (size_t *)context - 2;',
                { head: 'if (--*refs)', body: ['return;'] },
                '--live_contexts;',
                'free(refs);',
            ],
        },
    );
    // Test-only structured result adapter; never exports borrowed storage.
    let printLoops = 0;
    const print = (expr: Expr, id: string, body: Statement[]) => {
        const l = layout(id);
        if (l.kind === 'f64') body.push(`${use('print_number')}(${expr});`);
        else if (l.kind === 'bool') body.push(`fputs(${expr} ? "true" : "false", stdout);`);
        else if (l.kind === 'unit') body.push('fputs("null", stdout);');
        else if (l.kind === 'string') body.push(`${use('print_string')}(${expr});`);
        else if (l.kind === 'vector') {
            // Nested vectors nest loops; each needs its own index.
            const i = `i${printLoops++}`;
            const each: Statement[] = [{ head: `if (${i})`, body: ["putchar(',');"] }];
            print(`${dot(expr, 'elements')}[${i}]`, element(id), each);
            body.push(
                "putchar('[');",
                {
                    head: `for (size_t ${i} = 0; ${i} < ${dot(expr, 'length')}; ${i}++)`,
                    body: each,
                },
                "putchar(']');",
            );
        } else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
            body.push("putchar('[');");
            l.fields.forEach((f, i) => {
                if (i) body.push("putchar(',');");
                print(field(expr, i), (f as { layout: string }).layout, body);
            });
            body.push("putchar(']');");
        } else if (l.kind === 'union') {
            const names = l.fields.map((f) => f.name);
            const list = names.length === 2 && names[0] === 'nil' && names[1] === 'cons';
            const name = unionHelper('print', id, 'void', (body) => {
                if (list) {
                    // The reference protocol prints cons cells as one JSON array.
                    const cell = variant(id, 1);
                    const tail = layout(cell.layout).fields[1] as { layout: string };
                    if (tail.layout !== id) return unsupported('List tail changed its layout');
                    body.push('int first = 1;', "putchar('[');");
                    const loop: Statement[] = [
                        { head: 'if (!first)', body: ["putchar(',');"] },
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
                        "putchar(']');",
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
                            if (k) arm.push("putchar(',');");
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
                body: [cc`return ${use('live_contexts')};`],
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
                    body: [cc`${use('string_drop')}(s);`],
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
            body.push(cc`${use('release_context')}(cell);`);
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
                    return args.push(`${use('string_new')}(arg${n}, arg${n}_length)`);
                }
                const name = handle(p.layout);
                params.push(`struct ${name} *arg${n}`);
                hostParams.push(`${name} *arg${n}`);
                body.push(
                    `${type(p.layout)} *cell${n} = (${type(p.layout)} *)(void *)arg${n};`,
                    `${type(p.layout)} value${n} = *cell${n};`,
                    `${use('release_context')}(cell${n});`,
                );
                args.push(`value${n}`);
            });
            const result = code.body.layout,
                kind = hostKind(result);
            const call = `${use(codes.get(code.id)!)}(NULL${args.map((a) => `, ${a}`).join('')})`;
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
                    `${type(result)} *cell = ${use('allocate_context')}(sizeof *cell);`,
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
    declarations.push(new Declaration('print_number', 'void print_number(double x);'));
    functions.push({
        name: 'print_number',
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
        // Everything a host export mentions is a root: this code has no owner.
        const unit = libraryExports(options.exports);
        functions.push(...helpers.slice(emittedHelpers), ...unit.functions);
        return {
            declarations: retainedDeclarations(),
            functions: retainedFunctions(functions),
            header: unit.header,
        };
    }
    const main: Statement[] = [];
    const host = usesHost(imports);
    for (const entry of program.entries) {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) unsupported('Function entry requires an explicit host adapter');
        const v = `result${main.length}`;
        main.push(`${type(c.body.layout)} ${v} = ${use(codes.get(entry)!)}(NULL);`, `(void)${v};`);
        // With host output on stdout, a record separator (U+001E) introduces each result.
        if (host) main.push("putchar('\\x1e');");
        print(v, c.body.layout, main);
        main.push("putchar('\\n');");
        drop({ expression: v, layout: c.body.layout }, main);
    }
    main.push({ head: cText`if (${use('live_contexts')} != 0)`, body: ['abort();'] }, 'return 0;');
    use('main'); // the program's only root; every other function is reached from it
    functions.push({ name: 'main', signature: 'int main(void)', body: main });
    functions.push(...helpers.slice(emittedHelpers));
    return { declarations: retainedDeclarations(), functions: retainedFunctions(functions) };
}
