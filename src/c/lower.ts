import type { ConcreteProgram, ConcreteBlock } from '../concrete-ir.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { identifier, type Statement, type TranslationUnit } from './syntax.ts';

type Storage = { expr: string; layout: string } | Storage[];
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
    const children = (s: Storage): Storage[] =>
        Array.isArray(s)
            ? s
            : layout(s.layout).fields.map((f, i) => {
                  if (f.kind !== 'value') return unsupported('Non-data projection');
                  return { expr: field(s.expr, i), layout: f.layout };
              });
    const project = (s: Storage, path: number[]): Storage =>
        path.reduce((s, n) => children(s)[n]!, s);
    const read = (s: Storage, id: string): string => {
        if (layout(id).kind === 'unit') return zero(id);
        if (!Array.isArray(s) && s.layout === id) return s.expr;
        const parts = children(s);
        if (!layout(id).fields.length) return unsupported('Mismatched storage read');
        return `(${type(id)}){${parts.map((x, i) => read(x, (layout(id).fields[i] as { layout: string }).layout)).join(', ') || '0'}}`;
    };
    const write = (s: Storage, expr: string, id: string, body: Statement[]) => {
        if (Array.isArray(s))
            s.forEach((x, i) =>
                write(x, field(expr, i), (layout(id).fields[i] as { layout: string }).layout, body),
            );
        else if (s.layout !== id) unsupported('Type-changing storage requires phase 5');
        else body.push(`${s.expr} = ${expr};`);
    };
    const fromLens = (expr: string, id: string): Storage => {
        const l = layout(id);
        const input = l.fields.find((f) => f.name === 'read'),
            output = l.fields.find((f) => f.name === 'replacement');
        if (
            input?.kind === 'pointer' &&
            output?.kind === 'pointer' &&
            input.layout !== output.layout &&
            layout(input.layout!).kind !== 'unit'
        )
            unsupported('Type-changing lens ABI requires phase 5');
        const ptr =
            l.fields.find((f) => f.name === 'replacement') ??
            l.fields.find((f) => f.name === 'read');
        if (ptr?.kind === 'pointer' && ptr.layout)
            return { expr: `*(${expr}).${ptr.name}`, layout: ptr.layout };
        return l.fields
            .filter((f) => f.name.startsWith('item'))
            .map((f) => {
                if (f.kind !== 'value') return unsupported('Invalid scattered lens');
                return fromLens(`(${expr}).${identifier(f.name)}`, f.layout);
            });
    };
    const lensValue = (s: Storage, id: string): string => {
        const l = layout(id);
        if (l.fields.some((f) => f.name === 'read')) {
            if (Array.isArray(s)) return unsupported('Scattered to thin adapter');
            const ptr =
                l.fields.find((f) => f.name === 'replacement') ??
                l.fields.find((f) => f.name === 'read')!;
            if (ptr.kind !== 'pointer' || ptr.layout !== s.layout)
                return unsupported('Type-changing storage requires phase 5');
            return `(${type(id)}){.${ptr.name} = &(${s.expr})}`;
        }
        return `(${type(id)}){${children(s)
            .map(
                (x, i) =>
                    ` .item${i} = ${lensValue(x, (l.fields[i] as { layout: string }).layout)}`,
            )
            .join(', ')}}`;
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
    program.code.forEach((c) => declarations.push(signature(c) + ';'));
    const functions = program.code.map((c) => {
        if (c.captures.length) unsupported('Captured closures require phase 6');
        const values = new Map<string, string>(),
            lenses = new Map<string, Storage>(),
            places = new Map<string, Storage>(),
            direct = new Map<string, string>();
        let counter = 0;
        const fresh = () => `v${counter++}`;
        const bind = (p: IRPattern, s: Storage) => {
            if (p.kind === 'bind') places.set(p.slot.place, s);
            else if (p.kind === 'tuple') p.items.forEach((p, i) => bind(p, children(s)[i]!));
            else if (p.kind === 'constructor') unsupported('Constructor pattern requires phase 7');
        };
        c.parameters.forEach((p, i) =>
            p.lensPlace
                ? places.set(p.lensPlace, fromLens(`arg${i}`, p.layout))
                : bind(p.pattern, { expr: `arg${i}`, layout: p.layout }),
        );
        const ref = (s: SlotRef) =>
            project(places.get(s.place) ?? unsupported('Unavailable C place'), s.path);
        const value = (id: string) =>
            values.get(id) ?? unsupported('Indirect/function value requires phase 6');
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
                    bind(i.pattern, { expr: value(i.value), layout: outputLayouts.get(i.value)! });
                    continue;
                }
                if (i.op === 'borrow') {
                    const loan = program.semantic.program.units
                        .find((u) => u.id === c.unit)
                        ?.loans.find((l) => l.id === i.loan);
                    if (!loan) unsupported('Missing loan');
                    places.set(loan!.place, lenses.get(i.lens)!);
                    continue;
                }
                const id = i.out.layout,
                    name = fresh();
                let expr!: string;
                switch (i.op) {
                    case 'make-callable':
                        if (i.captures.length) unsupported('Captured closures require phase 6');
                        direct.set(i.out.id, i.callable);
                        continue;
                    case 'constant':
                        expr = literal(i.value, id);
                        break;
                    case 'tuple':
                        expr = `(${type(id)}){${i.items.map(value).join(', ') || '0'}}`;
                        break;
                    case 'move':
                        expr = read(ref(i.slot), id);
                        break;
                    case 'acquire':
                        lenses.set(i.out.id, ref(i.slot));
                        continue;
                    case 'lens-tuple':
                        lenses.set(
                            i.out.id,
                            i.items.map((v) => lenses.get(v)!),
                        );
                        continue;
                    case 'swap':
                        expr =
                            layout(id).kind === 'unit' ? zero(id) : read(lenses.get(i.lens)!, id);
                        body.push(`${type(id)} ${name} = ${expr};`, `(void)${name};`);
                        write(
                            lenses.get(i.lens)!,
                            value(i.value),
                            outputLayouts.get(i.value)!,
                            body,
                        );
                        values.set(i.out.id, name);
                        continue;
                    case 'scope':
                        expr = block(i.body, body);
                        break;
                    case 'case': {
                        body.push(`${type(id)} ${name};`);
                        i.cases.forEach((arm, n) => {
                            const nested: Statement[] = [];
                            bind(arm.pattern, {
                                expr: value(i.value),
                                layout: outputLayouts.get(i.value)!,
                            });
                            const result = block(arm.body, nested);
                            nested.push(`${name} = ${result};`);
                            body.push({
                                head: `${n ? 'else if' : 'if'} (${matches(arm.pattern, value(i.value))})`,
                                body: nested,
                            });
                        });
                        body.push({ head: 'else', body: ['abort();'] });
                        values.set(i.out.id, name);
                        continue;
                    }
                    case 'invoke': {
                        const callable =
                            program.callables.find((x) => x.id === direct.get(i.callee)) ??
                            unsupported('Indirect call requires phase 6');
                        if (!callable.entries.some((e) => e.wrapper === i.wrapper))
                            unsupported('Invalid direct call');
                        const w = program.wrappers.find((w) => w.id === i.wrapper)!;
                        const abi = program.abis.find((a) => a.id === i.abi)!;
                        const args = i.args.map((v, n) =>
                            lenses.has(v) ? lensValue(lenses.get(v)!, abi.arguments[n]!) : value(v),
                        );
                        if (w.kind === 'invoke')
                            expr = `${codes.get(w.code)}(NULL${args.map((a) => `, ${a}`).join('')})`;
                        else if (w.kind === 'native') {
                            const op = w.definition.slice(7);
                            if (['+', '-', '*', '/', '==', '>=', '<='].includes(op))
                                expr = `(${args[0]} ${op} ${args[1]})`;
                            else if (op === 'dup') expr = read(lenses.get(i.args[0]!)!, id);
                            else unsupported(`Native import ${w.definition}`);
                        } else return unsupported('Disposer invocation');
                        break;
                    }
                    default:
                        return unsupported(`Operation ${i.op} requires a later backend phase`);
                }
                body.push(`${type(id)} ${name} = ${expr};`, `(void)${name};`);
                values.set(i.out.id, name);
            }
            return value(b.result);
        };
        const outputLayouts = new Map<string, string>();
        const index = (b: ConcreteBlock) =>
            b.instructions.forEach((i) => {
                if ('out' in i) outputLayouts.set(i.out.id, i.out.layout);
                if (i.op === 'scope') index(i.body);
                if (i.op === 'case') i.cases.forEach((a) => index(a.body));
            });
        index(c.body);
        const body: Statement[] = [
            '(void)environment;',
            ...c.parameters.map((_, i) => `(void)arg${i};`),
        ];
        const result = block(c.body, body);
        body.push(`return ${result};`);
        return { signature: signature(c), body };
    });
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
    main.push('return 0;');
    functions.push({ signature: 'int main(void)', body: main });
    return { declarations, functions };
}
