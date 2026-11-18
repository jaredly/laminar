import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import { Storage, type Data, type View } from './storage.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { identifier, type Statement, type TranslationUnit } from './syntax.ts';

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
    for (const l of program.layouts)
        declarations.push(
            l.kind === 'f64'
                ? `typedef double ${type(l.id)};`
                : l.kind === 'bool'
                  ? `typedef _Bool ${type(l.id)};`
                  : `typedef struct ${type(l.id)} ${type(l.id)};`,
        );
    for (const a of program.abis)
        declarations.push(
            `typedef ${type(a.result)} (*${abiNames.get(a.id)})(void *${a.arguments.map((id) => `, ${type(id)}`).join('')});`,
        );
    for (const l of program.layouts)
        if (!['f64', 'bool'].includes(l.kind)) {
            if (l.kind === 'union') unsupported('Heap/nominal data requires phase 7');
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
    );
    program.code.forEach((c) => declarations.push(signature(c) + ';'));
    const helpers: TranslationUnit['functions'] = [];
    let helperCounter = 0;
    const disposers = new Map(
        program.wrappers.filter((w) => w.kind === 'dispose').map((w, i) => [w.id, `dispose${i}`]),
    );
    const drop = (data: Data, body: Statement[]): void => {
        if (Array.isArray(data)) return data.forEach((d) => drop(d, body));
        const l = layout(data.layout);
        if (l.fields.some((f) => f.name === 'dispose')) {
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
            else if (p.kind === 'constructor') unsupported('Constructor pattern requires phase 7');
            else if (p.kind === 'drop') drop(data, body);
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
                    ? String(v)
                    : v && typeof v === 'object' && 'number' in v
                      ? {
                            NaN: 'NAN',
                            Infinity: 'INFINITY',
                            '-Infinity': '(-INFINITY)',
                            '-0': '(-0.0)',
                        }[String(v.number)]!
                      : unsupported('Literal');
        const matches = (p: IRPattern, expr: string): string =>
            p.kind === 'literal'
                ? `${expr} == ${literal(p.value, unit.id)}`
                : p.kind === 'tuple'
                  ? p.items.map((p, i) => matches(p, field(expr, i))).join(' && ') || '1'
                  : p.kind === 'constructor'
                    ? unsupported('Constructor match')
                    : '1';
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
                    places.set(loan!.place, lens.view);
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
                                // Native intrinsics still lower through their explicit storage contract.
                                return w.kind === 'invoke'
                                    ? `, .${e.field}=${codes.get(w.code)}`
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
                                };
                            });
                            storage.reset(before);
                            merge(arms, body);
                            i.cases.forEach((arm, n) =>
                                body.push({
                                    head: `${n ? 'else if' : 'if'} (${matches(arm.pattern, value(i.value))})`,
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
                                        return { nested, complete, state: storage.snapshot(), arm };
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
                        const arms = i.cases.map((arm) => {
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
                                head: `${n ? 'else if' : 'if'} (${matches(arm.pattern, value(i.value))})`,
                                body: arms[n]!.nested,
                            }),
                        );
                        body.push({ head: 'else', body: ['abort();'] });
                        values.set(i.out.id, name);
                        continue;
                    }
                    case 'invoke': {
                        const callable =
                            program.callables.find(
                                (x) =>
                                    x.layout === outputLayouts.get(i.callee) &&
                                    x.entries.some((e) => e.wrapper === i.wrapper),
                            ) ?? unsupported('Missing callable storage contract');
                        if (!callable.entries.some((e) => e.wrapper === i.wrapper))
                            unsupported('Invalid callable entry');
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
                            if (w.kind === 'invoke')
                                expr = `(${value(i.callee)}).${identifier(i.field)}((${value(i.callee)}).environment${args.map((a) => `, ${a}`).join('')})`;
                            else if (w.kind === 'native') {
                                const op = w.definition.slice(7);
                                if (['+', '-', '*', '/', '==', '>=', '<='].includes(op))
                                    expr = `(${args[0]} ${op} ${args[1]})`;
                                else unsupported(`Native import ${w.definition}`);
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
                        return unsupported(`Operation ${i.op} requires a later backend phase`);
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
    functions.push(
        ...helpers,
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
        else if (l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'))) {
            body.push('putchar(91);');
            l.fields.forEach((f, i) => {
                if (i) body.push('putchar(44);');
                print(field(expr, i), (f as { layout: string }).layout, body);
            });
            body.push('putchar(93);');
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
    for (const entry of program.entries) {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) unsupported('Function entry requires an explicit host adapter');
        const v = `result${main.length}`;
        main.push(`${type(c.body.layout)} ${v} = ${codes.get(entry)}(NULL);`, `(void)${v};`);
        print(v, c.body.layout, main);
        main.push('putchar(10);');
    }
    main.push({ head: 'if (live_contexts != 0)', body: ['abort();'] }, 'return 0;');
    functions.push({ signature: 'int main(void)', body: main });
    return { declarations, functions };
}
