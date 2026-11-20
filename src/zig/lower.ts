import type { ConcreteProgram, ConcreteBlock, ConcreteLayout, ConcreteCode } from '../concrete-ir.ts';
import type { IRPattern, SlotRef } from '../typed-ir.ts';
import { verifyConcreteProgram } from '../verify-concrete.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import { Storage, type Data, type View } from './storage.ts';
import { field, name, nullLit, type Expr, type Stmt } from './ast.ts';
import { identifier, sourceIdentifier, type Statement, type ZigFile, type ZigFunction } from './syntax.ts';

const unsupported = (message: string): never => {
    throw new BackendDiagnostic('unsupported-zig', message);
};

const arithmetic: Record<string, string> = {
    '+': 'add',
    '-': 'sub',
    '*': 'mul',
    '/': 'div',
    '==': 'eq',
    '>=': 'ge',
    '<=': 'le',
};

/** `unit/definition/<name>/...` → `<name>`. */
const definitionName = (id: string | undefined) => id?.match(/^unit\/definition\/([^/]+)\//)?.[1];

/**
 * Lower ConcreteProgram to a Zig syntax tree: phase 1 of docs/zig-codegen-plan.md
 * (scalars, records, direct calls, native arithmetic). Later-phase operations raise
 * `unsupported-zig` diagnostics instead of emitting partial code.
 *
 * Every IR value becomes one `let` in IR order. `tidy` (ast.ts) then inlines the
 * unnamed temporaries, so the printed code keeps source names and drops IR
 * plumbing. Values are never reassigned, so no struct literal is ever written into
 * a destination it reads.
 */
export function lowerZig(program: ConcreteProgram): ZigFile {
    verifyConcreteProgram(program);

    const layouts = new Map(program.layouts.map((l) => [l.id, l]));
    const abis = new Map(program.abis.map((a) => [a.id, a]));
    const wrappers = new Map(program.wrappers.map((w) => [w.id, w]));
    const layout = (id: string): ConcreteLayout =>
        layouts.get(id) ?? unsupported(`Unknown layout ${id}`);
    const unit = program.layouts.find((l) => l.kind === 'unit');

    // Top-level names. Zig forbids locals that shadow them, so locals avoid this set.
    const globals = new Set(['main', 'printNumber']);
    const callableLayouts = new Set(program.callables.map((c) => c.layout));
    const isTuple = (l: ConcreteLayout) =>
        l.kind === 'record' &&
        l.fields.length > 0 &&
        l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item'));

    const typeNames = new Map<string, string>();
    const type = (id: string): string => {
        const known = typeNames.get(id);
        if (known) return known;
        const l = layout(id);
        let result: string;
        if (l.kind === 'f64') result = 'f64';
        else if (l.kind === 'bool') result = 'bool';
        else if (l.kind === 'unit') result = sourceIdentifier('Unit', globals);
        else if (isTuple(l))
            result = sourceIdentifier(
                `Tuple_${l.fields.map((f) => type((f as { layout: string }).layout)).join('_')}`,
                globals,
            );
        else
            result = sourceIdentifier(
                callableLayouts.has(id) ? 'Callable' : 'Record',
                globals,
            );
        typeNames.set(id, result);
        return result;
    };
    program.layouts.forEach((l) => type(l.id));
    const abiNames = new Map(program.abis.map((a) => [a.id, sourceIdentifier('Abi', globals)]));

    // Function names: the source definition, suffixed by parameter types when a
    // generic definition has several specializations.
    const baseName = (c: ConcreteCode) =>
        definitionName(c.function) ??
        definitionName(program.semantic.program.units.find((u) => u.id === c.unit)?.functions[0]?.id) ??
        'entry';
    const groups = new Map<string, ConcreteCode[]>();
    program.code.forEach((c) => groups.set(baseName(c), [...(groups.get(baseName(c)) ?? []), c]));
    const codes = new Map<string, string>();
    groups.forEach((members, base) =>
        members.forEach((c) =>
            codes.set(
                c.id,
                sourceIdentifier(
                    members.length > 1 && c.parameters.length
                        ? `${base}_${c.parameters.map((p) => type(p.layout)).join('_')}`
                        : base,
                    globals,
                ),
            ),
        ),
    );
    const entryNames = new Map(program.code.map((c) => [c.id, sourceIdentifier(`${codes.get(c.id)}_entry`, globals)]));

    const dataFields = (l: ConcreteLayout) => {
        if (!l.fields.every((f) => f.kind === 'value' && f.name.startsWith('item')))
            return unsupported('Non-data projection requires a later backend phase');
        return l.fields as { name: string; kind: 'value'; layout: string }[];
    };

    const unitExpr = (): Expr =>
        unit ? { k: 'struct', type: type(unit.id), fields: [] } : unsupported('No unit layout');
    const unitData = (): Data => ({ expression: unitExpr(), layout: unit!.id });

    const storage = new Storage((s) =>
        dataFields(layout(s.layout)).map((f) => ({
            expression: field(s.expression, identifier(f.name)),
            layout: f.layout,
        })),
    );

    /** Materialize `data` as an expression of layout `id`, rebuilding aggregates. */
    const read = (data: Data, id: string): Expr => {
        const l = layout(id);
        if (l.kind === 'unit') return unitExpr();
        if (!Array.isArray(data) && data.layout === id) return data.expression;
        const parts = storage.parts(data);
        const fields = dataFields(l);
        if (!fields.length || parts.length !== fields.length)
            return unsupported('Mismatched storage read');
        return {
            k: 'struct',
            type: type(id),
            fields: fields.map((f, i) => ({ name: identifier(f.name), value: read(parts[i]!, f.layout) })),
        };
    };

    const literal = (v: unknown, id: string): Expr => {
        if (v === null) return layout(id).kind === 'unit' ? unitExpr() : unsupported('Null literal');
        if (typeof v === 'boolean') return { k: 'lit', text: String(v) };
        if (typeof v === 'number') return { k: 'lit', text: String(v), untyped: true };
        if (v && typeof v === 'object' && 'number' in v) {
            const special = {
                NaN: 'std.math.nan(f64)',
                Infinity: 'std.math.inf(f64)',
                '-Infinity': '-std.math.inf(f64)',
                '-0': '-@as(f64, 0)',
            }[String((v as { number: string }).number)];
            if (special) return { k: 'lit', text: special };
        }
        return unsupported(`Literal ${JSON.stringify(v)}`);
    };

    const declarations: { name: string; text: string }[] = [];
    for (const l of program.layouts) {
        if (l.kind === 'f64' || l.kind === 'bool') continue;
        if (l.kind === 'union') unsupported('Union layout requires Phase 7');
        const fields = l.fields.map((f) => {
            const n = identifier(f.name);
            if (f.kind === 'value') return `${n}: ${type(f.layout)},`;
            if (f.kind === 'pointer')
                return f.layout ? `${n}: *${type(f.layout)},` : `${n}: ?*anyopaque = null,`;
            return `${n}: ?${abiNames.get(f.abi)} = null,`;
        });
        declarations.push({
            name: type(l.id),
            text: fields.length
                ? `const ${type(l.id)} = struct {\n${fields.map((f) => `    ${f}`).join('\n')}\n};`
                : `const ${type(l.id)} = struct {};`,
        });
    }
    for (const a of program.abis)
        declarations.push({
            name: abiNames.get(a.id)!,
            text: `const ${abiNames.get(a.id)} = *const fn (?*anyopaque${a.arguments.map((id) => `, ${type(id)}`).join('')}) ${type(a.result)};`,
        });

    const functions: ZigFunction[] = [];

    // Native imports referenced as first-class callable entries.
    const nativeCodes = new Map<string, string>();
    for (const w of program.wrappers) {
        if (w.kind !== 'native') continue;
        const op = w.definition.slice('native/'.length);
        if (!arithmetic[op]) continue;
        const abi = abis.get(w.abi)!;
        const fn = sourceIdentifier(`native_${arithmetic[op]}`, globals);
        nativeCodes.set(w.id, fn);
        functions.push({
            name: fn,
            params: [{ name: 'environment', type: '?*anyopaque' }, ...abi.arguments.map((id, i) => ({ name: 'ab'[i] ?? `arg${i}`, type: type(id) }))],
            result: type(abi.result),
            body: [{ k: 'return', value: { k: 'binary', op, left: name('a'), right: name('b') } }],
        });
    }

    for (const c of program.code) {
        if (c.captures.length) unsupported('Captured environments require Phase 4');
        const taken = new Set(globals);
        const irUnit = program.semantic.program.units.find((u) => u.id === c.unit);
        const placeName = (place: string) =>
            irUnit?.bindings.find((b) => b.place === place && !b.path.length)?.name;
        const values = new Map<string, Expr>();
        const places = new Map<string, View>();
        const body: Stmt[] = [];
        let temps = 0;
        const temp = () => {
            let n = `t${temps++}`;
            while (taken.has(n)) n = `t${temps++}`;
            taken.add(n);
            return n;
        };
        const declare = (id: string, value: Expr, named?: string): Expr => {
            const n = named ? sourceIdentifier(named, taken) : temp();
            body.push({ k: 'let', name: n, type: type(id), value, named: !!named });
            return name(n);
        };

        const bind = (p: IRPattern, data: Data) => {
            if (p.kind === 'bind') {
                const source = !p.slot.path.length ? placeName(p.slot.place) : undefined;
                places.set(
                    p.slot.place,
                    storage.own(
                        source && !Array.isArray(data)
                            ? { expression: declare(data.layout, data.expression, source), layout: data.layout }
                            : data,
                    ),
                );
            } else if (p.kind === 'tuple') p.items.forEach((item, i) => bind(item, storage.parts(data)[i]!));
            else if (p.kind === 'drop') {
                // Plain data needs no disposal; owned callables arrive in Phase 4.
            } else unsupported(`Pattern ${p.kind} requires a later backend phase`);
        };

        const params = c.parameters.map((p, i) => {
            if (p.lensPlace) unsupported('Lens parameters require Phase 2');
            const source = p.pattern.kind === 'bind' && !p.pattern.slot.path.length ? placeName(p.pattern.slot.place) : undefined;
            const n = sourceIdentifier(source ?? `arg${i}`, taken);
            const data = { expression: name(n), layout: p.layout };
            if (p.pattern.kind === 'bind') places.set(p.pattern.slot.place, storage.own(data));
            else bind(p.pattern, data);
            return { name: n, type: type(p.layout) };
        });

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

        const block = (b: ConcreteBlock): Expr => {
            for (const i of b.instructions) {
                if (i.op === 'bind') {
                    bind(i.pattern, { expression: value(i.value), layout: outputLayouts.get(i.value)! });
                    continue;
                }
                if (i.op === 'borrow') return unsupported('Borrows require Phase 2');
                const id = i.out.layout;
                let expr: Expr;
                switch (i.op) {
                    case 'constant':
                        expr = literal(i.value, id);
                        break;
                    case 'tuple': {
                        const fields = layout(id).fields;
                        expr = {
                            k: 'struct',
                            type: type(id),
                            fields: i.items.map((it, n) => ({ name: identifier(fields[n]!.name), value: value(it) })),
                        };
                        break;
                    }
                    case 'move':
                        expr = read(storage.get(ref(i.slot)), id);
                        storage.put(ref(i.slot), unitData());
                        break;
                    case 'scope':
                        expr = block(i.body);
                        break;
                    case 'make-callable': {
                        if (i.captures.length) return unsupported('Captures require Phase 4');
                        const callable = program.callables.find((cb) => cb.id === i.callable)!;
                        expr = {
                            k: 'struct',
                            type: type(id),
                            fields: callable.entries.flatMap((e) => {
                                const w = e.wrapper ? wrappers.get(e.wrapper) : undefined;
                                if (!w) return [];
                                const f = identifier(e.field);
                                if (w.kind === 'invoke') return [{ name: f, value: { k: 'lit', text: `&${entryNames.get(w.code)}` } }];
                                if (w.kind === 'native')
                                    return nativeCodes.has(w.id) ? [{ name: f, value: { k: 'lit', text: `&${nativeCodes.get(w.id)}` } }] : [];
                                return unsupported(`Callable entry ${w.kind} requires Phase 4`);
                            }),
                        };
                        break;
                    }
                    case 'invoke': {
                        const w = i.wrapper ? wrappers.get(i.wrapper) : undefined;
                        const args = i.args.map(value);
                        if (layout(id).fields.some((f) => f.name === 'restore'))
                            return unsupported('Lens results require Phase 5');
                        if (i.field !== undefined) {
                            const callee = value(i.callee);
                            const hasEnvironment = layout(outputLayouts.get(i.callee)!).fields.some((f) => f.name === 'environment');
                            expr = {
                                k: 'call',
                                callee: { k: 'unwrap', of: field(callee, identifier(i.field)) },
                                args: [hasEnvironment ? field(callee, 'environment') : nullLit, ...args],
                            };
                        } else if (w?.kind === 'invoke') expr = { k: 'call', callee: name(codes.get(w.code)!), args };
                        else if (w?.kind === 'native' && arithmetic[w.definition.slice(7)])
                            expr = { k: 'binary', op: w.definition.slice(7), left: args[0]!, right: args[1]! };
                        else return unsupported(`Call through ${w?.kind ?? 'unknown'} wrapper`);
                        break;
                    }
                    default:
                        return unsupported(`Operation ${i.op} requires a later backend phase`);
                }
                values.set(i.out.id, declare(id, expr));
            }
            for (const cl of b.cleanup) {
                if (cl.kind === 'drop-place') storage.put(ref(cl.slot), unitData());
                else if (cl.kind === 'release') unsupported('Loan release requires Phase 2');
            }
            return value(b.result);
        };

        body.push({ k: 'return', value: block(c.body) });
        const fn = codes.get(c.id)!;
        const result = type(c.body.layout);
        functions.push({ name: fn, params, result, body });
        // Capture-free code has a plain signature. Callable records hold this
        // adapter for the opaque-environment ABI.
        const adapterParams = params.map((p) => ({ ...p }));
        functions.push({
            name: entryNames.get(c.id)!,
            params: [{ name: 'environment', type: '?*anyopaque' }, ...adapterParams],
            result,
            body: [{ k: 'return', value: { k: 'call', callee: name(fn), args: adapterParams.map((p) => name(p.name)) } }],
        });
    }

    functions.push({
        name: 'printNumber',
        params: [{ name: 'x', type: 'f64' }],
        result: 'void',
        body: [
            { head: 'if (std.math.isNan(x))', body: ['_ = printf("{\\"number\\":\\"NaN\\"}");'] },
            {
                head: 'else if (std.math.isInf(x))',
                body: ['_ = printf(if (x < 0) "{\\"number\\":\\"-Infinity\\"}" else "{\\"number\\":\\"Infinity\\"}");'],
            },
            { head: 'else if (x == 0 and std.math.signbit(x))', body: ['_ = printf("{\\"number\\":\\"-0\\"}");'] },
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

    // Test-only entry adapter: one JSON line per entry.
    const main: Statement[] = [];
    program.entries.forEach((entry, n) => {
        const c = program.code.find((c) => c.id === entry)!;
        if (c.parameters.length) unsupported('Function entry requires an explicit host adapter');
        const v = program.entries.length > 1 ? `result${n}` : 'result';
        main.push(`const ${v} = ${codes.get(entry)}();`);
        const l = layout(c.body.layout);
        if (l.kind === 'unit') main.push(`_ = ${v};`);
        print(v, c.body.layout, main);
        main.push('_ = putchar(10);');
    });
    functions.push({ name: 'main', pub: true, params: [], result: 'void', body: main });

    return { declarations, functions };
}
