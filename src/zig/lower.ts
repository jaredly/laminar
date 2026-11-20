import type { ConcreteProgram, ConcreteBlock, ConcreteLayout } from '../concrete-ir.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { Storage, type Data, type View } from '../c/storage.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { identifier, type Statement, type ZigFile, type ZigFunction } from './syntax.ts';

const unsupported = (message: string): never => {
    throw new BackendDiagnostic('unsupported-zig', message);
};

const arithmetic = ['+', '-', '*', '/', '==', '>=', '<='];

/**
 * Lower ConcreteProgram to a Zig syntax tree: phase 1 of docs/zig-codegen-plan.md
 * (scalars, records, direct calls, native arithmetic). Later-phase operations raise
 * `unsupported-zig` diagnostics instead of emitting partial code.
 *
 * Emission rules (§3 of the plan, proved by test/zig/fixtures/strictness.zig):
 * every binding is `var name: T = expr;` followed by `_ = &name;`, parameters are
 * copied into locals on entry, and every value gets a fresh name, so no struct
 * literal is ever assigned into a destination it reads.
 */
export function lowerZig(program: ConcreteProgram): ZigFile {
    verifyConcreteProgram(program);

    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const names = new Map(program.layouts.map((l, i) => [l.id, `L${i}`]));
    const codes = new Map(program.code.map((c, i) => [c.id, `fn${i}`]));
    const abiNames = new Map(program.abis.map((a, i) => [a.id, `A${i}`]));
    const abis = new Map(program.abis.map((a) => [a.id, a]));
    const wrappers = new Map(program.wrappers.map((w) => [w.id, w]));

    const type = (id: string) => names.get(id) ?? unsupported(`Unknown layout ${id}`);
    const layout = (id: string): ConcreteLayout =>
        layouts.get(id) ?? unsupported(`Unknown layout ${id}`);
    const unit = program.layouts.find((l) => l.kind === 'unit');
    const unitData = (): Data =>
        unit ? { expression: `${type(unit.id)}{}`, layout: unit.id } : unsupported('No unit layout');

    const dataFields = (l: ConcreteLayout) => {
        if (!l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item')))
            return unsupported('Non-data projection requires a later backend phase');
        return l.fields as { name: string; kind: 'value'; layout: string }[];
    };

    const zero = (id: string): string => {
        const l = layout(id);
        if (l.kind === 'f64') return '0';
        if (l.kind === 'bool') return 'false';
        if (l.kind === 'unit') return `${type(id)}{}`;
        return `std.mem.zeroes(${type(id)})`;
    };

    const storage = new Storage((s) =>
        dataFields(layout(s.layout)).map((f) => ({
            expression: `(${s.expression}).${identifier(f.name)}`,
            layout: f.layout,
        })),
    );

    /** Materialize `data` as an expression of layout `id`, rebuilding aggregates. */
    const read = (data: Data, id: string): string => {
        const l = layout(id);
        if (l.kind === 'unit') return `${type(id)}{}`;
        if (!Array.isArray(data) && data.layout === id) return data.expression;
        const parts = storage.parts(data);
        const fields = dataFields(l);
        if (!fields.length || parts.length !== fields.length)
            return unsupported('Mismatched storage read');
        return `${type(id)}{ ${fields
            .map((f, i) => `.${identifier(f.name)} = ${read(parts[i]!, f.layout)}`)
            .join(', ')} }`;
    };

    const literal = (v: unknown, id: string): string => {
        if (v === null) return zero(id);
        if (typeof v === 'boolean') return String(v);
        if (typeof v === 'number') return String(v);
        if (v && typeof v === 'object' && 'number' in v) {
            const special = {
                NaN: 'std.math.nan(f64)',
                Infinity: 'std.math.inf(f64)',
                '-Infinity': '-std.math.inf(f64)',
                '-0': '-@as(f64, 0)',
            }[String((v as { number: string }).number)];
            if (special) return special;
        }
        return unsupported(`Literal ${JSON.stringify(v)}`);
    };

    const declarations: string[] = [];

    for (const l of program.layouts) {
        const name = type(l.id);
        if (l.kind === 'f64') declarations.push(`const ${name} = f64;`);
        else if (l.kind === 'bool') declarations.push(`const ${name} = bool;`);
        else if (l.kind === 'unit') declarations.push(`const ${name} = struct {};`);
        else if (l.kind === 'union') unsupported('Union layout requires Phase 7');
        else {
            const fields = l.fields.map((f) => {
                const field = identifier(f.name);
                if (f.kind === 'value') return `${field}: ${type(f.layout)},`;
                if (f.kind === 'pointer')
                    return f.layout
                        ? `${field}: *${type(f.layout)},`
                        : `${field}: ?*anyopaque = null,`;
                return `${field}: ?${abiNames.get(f.abi)} = null,`;
            });
            declarations.push(
                fields.length
                    ? `const ${name} = struct {\n${fields.map((f) => `    ${f}`).join('\n')}\n};`
                    : `const ${name} = struct {};`,
            );
        }
    }

    for (const a of program.abis) {
        const args = a.arguments.map((id) => `, ${type(id)}`).join('');
        declarations.push(
            `const ${abiNames.get(a.id)} = *const fn (?*anyopaque${args}) ${type(a.result)};`,
        );
    }

    // Native imports referenced as first-class callable entries. Zig analyzes only
    // referenced functions, so emitting unused helpers costs nothing.
    const helpers: ZigFunction[] = [];
    const nativeCodes = new Map<string, string>();
    for (const w of program.wrappers) {
        if (w.kind !== 'native') continue;
        const op = w.definition.slice('native/'.length);
        if (!arithmetic.includes(op)) continue;
        const abi = abis.get(w.abi)!;
        const name = `native${nativeCodes.size}`;
        nativeCodes.set(w.id, name);
        helpers.push({
            signature: `fn ${name}(environment: ?*anyopaque${abi.arguments.map((id, i) => `, arg${i}: ${type(id)}`).join('')}) ${type(abi.result)}`,
            body: ['_ = environment;', `return arg0 ${op} arg1;`],
        });
    }

    const functions: ZigFunction[] = program.code.map((c) => {
        if (c.captures.length) unsupported('Captured environments require Phase 4');
        const values = new Map<string, string>();
        const places = new Map<string, View>();
        let counter = 0;
        const fresh = () => `v${counter++}`;

        const declare = (id: string, expression: string, body: Statement[]): string => {
            const name = fresh();
            body.push(`var ${name}: ${type(id)} = ${expression};`, `_ = &${name};`);
            return name;
        };

        const bind = (p: IRPattern, data: Data) => {
            if (p.kind === 'bind') places.set(p.slot.place, storage.own(data));
            else if (p.kind === 'tuple') p.items.forEach((item, i) => bind(item, storage.parts(data)[i]!));
            else if (p.kind === 'drop') {
                // Plain data needs no disposal; owned callables arrive in Phase 4.
            } else unsupported(`Pattern ${p.kind} requires a later backend phase`);
        };

        const ref = (s: SlotRef) =>
            storage.project(places.get(s.place) ?? unsupported('Unavailable Zig place'), s.path);
        const value = (id: string) => values.get(id) ?? unsupported('Missing value in Zig lowering');

        const outputLayouts = new Map<string, string>();
        const index = (b: ConcreteBlock) =>
            b.instructions.forEach((i) => {
                if ('out' in i) outputLayouts.set(i.out.id, i.out.layout);
                if (i.op === 'scope') index(i.body);
            });
        index(c.body);

        // Capture-free code never reads its environment (captures arrive in Phase 4).
        const body: Statement[] = ['_ = environment;'];
        c.parameters.forEach((p, i) => {
            if (p.lensPlace) unsupported('Lens parameters require Phase 2');
            const local = `p${i}`;
            body.push(`var ${local}: ${type(p.layout)} = arg${i};`, `_ = &${local};`);
            bind(p.pattern, { expression: local, layout: p.layout });
        });

        const block = (b: ConcreteBlock, body: Statement[]): string => {
            for (const i of b.instructions) {
                if (i.op === 'bind') {
                    bind(i.pattern, { expression: value(i.value), layout: outputLayouts.get(i.value)! });
                    continue;
                }
                if (i.op === 'borrow') return unsupported('Borrows require Phase 2');
                const id = i.out.layout;
                let expr: string;
                switch (i.op) {
                    case 'constant':
                        expr = literal(i.value, id);
                        break;
                    case 'tuple': {
                        const fields = layout(id).fields;
                        expr = `${type(id)}{ ${i.items
                            .map((it, n) => `.${identifier(fields[n]!.name)} = ${value(it)}`)
                            .join(', ')} }`;
                        break;
                    }
                    case 'move':
                        expr = read(storage.get(ref(i.slot)), id);
                        storage.put(ref(i.slot), unitData());
                        break;
                    case 'scope':
                        expr = block(i.body, body);
                        break;
                    case 'make-callable': {
                        if (i.captures.length) return unsupported('Captures require Phase 4');
                        const callable = program.callables.find((cb) => cb.id === i.callable)!;
                        const entries = callable.entries.flatMap((e) => {
                            const w = e.wrapper ? wrappers.get(e.wrapper) : undefined;
                            if (!w) return [];
                            if (w.kind === 'invoke') return [`.${identifier(e.field)} = &${codes.get(w.code)}`];
                            if (w.kind === 'native' && nativeCodes.has(w.id))
                                return [`.${identifier(e.field)} = &${nativeCodes.get(w.id)}`];
                            if (w.kind === 'native') return [];
                            return unsupported(`Callable entry ${w.kind} requires Phase 4`);
                        });
                        expr = `${type(id)}{${entries.length ? ` ${entries.join(', ')} ` : ''}}`;
                        break;
                    }
                    case 'invoke': {
                        const w = i.wrapper ? wrappers.get(i.wrapper) : undefined;
                        const callee = value(i.callee);
                        const hasEnvironment = layout(outputLayouts.get(i.callee)!).fields.some(
                            (f) => f.name === 'environment',
                        );
                        const environment = hasEnvironment ? `${callee}.environment` : 'null';
                        const args = i.args.map(value);
                        if (layout(id).fields.some((f) => f.name === 'restore'))
                            return unsupported('Lens results require Phase 5');
                        if (i.field !== undefined)
                            expr = `${callee}.${identifier(i.field)}.?(${[environment, ...args].join(', ')})`;
                        else if (w?.kind === 'invoke')
                            expr = `${codes.get(w.code)}(${[environment, ...args].join(', ')})`;
                        else if (w?.kind === 'native' && arithmetic.includes(w.definition.slice(7)))
                            expr = `(${args[0]} ${w.definition.slice(7)} ${args[1]})`;
                        else return unsupported(`Call through ${w?.kind ?? 'unknown'} wrapper ${w && 'definition' in w ? w.definition : ''}`);
                        break;
                    }
                    default:
                        return unsupported(`Operation ${i.op} requires a later backend phase`);
                }
                values.set(i.out.id, declare(id, expr, body));
            }
            for (const cl of b.cleanup) {
                if (cl.kind === 'drop-place') storage.put(ref(cl.slot), unitData());
                else if (cl.kind === 'release') unsupported('Loan release requires Phase 2');
            }
            return value(b.result);
        };

        body.push(`return ${block(c.body, body)};`);
        return {
            signature: `fn ${codes.get(c.id)}(environment: ?*anyopaque${c.parameters.map((p, i) => `, arg${i}: ${type(p.layout)}`).join('')}) ${type(c.body.layout)}`,
            body,
        };
    });

    helpers.push({
        signature: 'fn printNumber(x: f64) void',
        body: [
            { head: 'if (std.math.isNan(x))', body: ['_ = printf("{\\"number\\":\\"NaN\\"}");'] },
            {
                head: 'else if (std.math.isInf(x))',
                body: [
                    '_ = printf(if (x < 0) "{\\"number\\":\\"-Infinity\\"}" else "{\\"number\\":\\"Infinity\\"}");',
                ],
            },
            {
                head: 'else if (x == 0 and std.math.signbit(x))',
                body: ['_ = printf("{\\"number\\":\\"-0\\"}");'],
            },
            { head: 'else', body: ['_ = printf("%.17g", x);'] },
        ],
    });

    const print = (expr: string, id: string, body: Statement[]) => {
        const l = layout(id);
        if (l.kind === 'f64') body.push(`printNumber(${expr});`);
        else if (l.kind === 'bool') body.push(`_ = printf(if (${expr}) "true" else "false");`);
        else if (l.kind === 'unit') body.push('_ = printf("null");');
        else {
            body.push('_ = printf("[");');
            dataFields(l).forEach((f, i) => {
                if (i) body.push('_ = printf(",");');
                print(`${expr}.${identifier(f.name)}`, f.layout, body);
            });
            body.push('_ = printf("]");');
        }
    };

    const main: Statement[] = [];
    program.entries.forEach((entry, n) => {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) unsupported('Function entry requires an explicit host adapter');
        const v = `result${n}`;
        main.push(`var ${v}: ${type(c.body.layout)} = ${codes.get(entry)}(null);`, `_ = &${v};`);
        print(v, c.body.layout, main);
        main.push('_ = putchar(10);');
    });

    return {
        declarations,
        functions: [...functions, ...helpers, { signature: 'pub fn main() void', body: main }],
    };
}
