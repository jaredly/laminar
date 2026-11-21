import type { ConcreteCode, ConcreteProgram } from '../concrete-ir.ts';
import type { BindingRecord, SemanticType } from '../elaborated.ts';
import type { IRBlock, IRPattern, SlotRef } from '../typed-ir.ts';

const keywords = new Set(
    `break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var`.split(
        ' ',
    ),
);
// These predeclared names appear in generated expressions. Shadowing one would
// change the meaning of that code. min/max, for example, are safe source names.
const builtins = new Set(
    `any append bool byte float64 int len make new nil panic rune string true false uint32`.split(
        ' ',
    ),
);
const runtime = new Set([
    'main',
    'init',
    'stdin',
    'printNumber',
    'printString',
    'formatNumber',
    'laminarRound',
    'hostInput',
    'fmt',
    'math',
    'strconv',
    'os',
    'bufio',
    'environment',
    'replacement',
    'focus',
    'write',
    'result',
]);
const generated =
    /^(?:L\d+|A\d+|v\d+|arg\d+|back\d+|Backing\d+|native\d+|result\d+|result_adapter\d+|(?:hostPrint|char_list|print)_[A-Za-z_0-9]+|Backing_[A-Za-z_0-9]+)$/;

/** Escape source spelling, then disambiguate within one Go namespace. */
export class GoNames {
    readonly taken: Set<string>;
    constructor(reserved: Iterable<string> = []) {
        this.taken = new Set([...keywords, ...builtins, ...runtime, ...reserved]);
    }
    source(raw: string): string {
        let base = [...raw]
            .map((c) => (/[A-Za-z_0-9]/.test(c) ? c : `_u${c.codePointAt(0)!.toString(16)}_`))
            .join('');
        if (!base || base === '_') base = 'value';
        if (/^[0-9]/.test(base)) base = `n_${base}`;
        if (generated.test(base)) base += '_source';
        return this.unique(base);
    }
    unique(base: string): string {
        let name = base;
        for (let n = 2; this.taken.has(name); n++) name = `${base}_${n}`;
        this.taken.add(name);
        return name;
    }
}

export const patternSlots = (p: IRPattern): SlotRef[] =>
    p.kind === 'bind'
        ? [p.slot]
        : p.kind === 'tuple' || p.kind === 'constructor'
          ? p.items.flatMap(patternSlots)
          : [];
export const sourceBinding = (bindings: readonly BindingRecord[], slot: SlotRef) =>
    bindings.find(
        (b) =>
            b.kind !== 'global' &&
            b.place === slot.place &&
            b.path.length === slot.path.length &&
            b.path.every((v, i) => v === slot.path[i]) &&
            b.borrow === slot.permit &&
            !b.name.startsWith('$'),
    );

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const semanticName = (t: SemanticType): string =>
    t.tag === 'con'
        ? [t.name.toLowerCase(), ...t.args.map(semanticName)].join('_')
        : t.tag === 'tuple'
          ? t.items.length
              ? `tuple_${t.items.map(semanticName).join('_')}`
              : 'unit'
          : t.tag === 'fn'
            ? 'function'
            : 'generic';

/** Names come from retained generic IR, not specialization hashes or source text. */
export function functionNames(program: ConcreteProgram): Map<string, string> {
    const source = new Map<string, { name: string; priority: number }>();
    for (const u of program.semantic.generic.units) {
        const owner =
            u.definition &&
            u.bindings.find((b) => b.kind === 'global' && b.definition === u.definition)?.name;
        const producers = new Map<string, IRBlock['instructions'][number]>();
        const bindings: Extract<IRBlock['instructions'][number], { op: 'bind' }>[] = [];
        const scan = (b: IRBlock) => {
            for (const i of b.instructions) {
                if ('out' in i) producers.set(i.out.id, i);
                if (i.op === 'bind') bindings.push(i);
                if (i.op === 'scope') scan(i.body);
                if (i.op === 'manual') scan(i.cleanup);
                if (i.op === 'case') i.cases.forEach((a) => scan(a.body));
            }
        };
        scan(u.entry);
        u.functions.forEach((f) => scan(f.body));
        const closures = (id: string): string[] => {
            const i = producers.get(id);
            return i?.op === 'closure'
                ? [i.function]
                : i?.op === 'scope'
                  ? closures(i.body.result)
                  : i?.op === 'case'
                    ? i.cases.flatMap((a) => closures(a.body.result))
                    : [];
        };
        if (owner)
            closures(u.entry.result).forEach((id) => source.set(id, { name: owner, priority: 0 }));
        for (const b of bindings) {
            const slot = b.pattern.kind === 'bind' && b.pattern.slot;
            const named = slot && sourceBinding(u.bindings, slot);
            if (named)
                closures(b.value).forEach((id) => {
                    if (!source.has(id))
                        source.set(id, {
                            name: owner ? `${owner}_${named.name}` : named.name,
                            priority: 1,
                        });
                });
        }
        u.functions.forEach((f) => {
            if (!source.has(f.id))
                source.set(f.id, { name: owner ? `${owner}_closure` : 'closure', priority: 2 });
        });
    }
    const layout = (id: string) => program.layouts.find((l) => l.id === id)!;
    const physicalName = (id: string): string => {
        const l = layout(id);
        return l.fields.some((f) => f.name === 'restore')
            ? l.fields.some((f) => f.name === 'read')
                ? 'thin'
                : 'scattered'
            : l.kind === 'f64'
              ? 'number'
              : l.kind === 'bool' || l.kind === 'string' || l.kind === 'unit'
                ? l.kind
                : l.kind === 'record'
                  ? 'tuple'
                  : 'union';
    };
    const fn = (c: ConcreteCode) =>
        program.semantic.program.units
            .find((u) => u.id === c.unit)!
            .functions.find((f) => f.id === c.function);
    const parameterName = (c: ConcreteCode, n: number) => {
        const arg = fn(c)!.type.args[n]!;
        if (arg.tag === 'plain') return semanticName(arg.value);
        const read = semanticName(arg.read),
            write = semanticName(arg.write);
        return read === write ? read : `${read}_to_${write}`;
    };
    const groups = new Map<string, ConcreteCode[]>();
    for (const c of program.code) {
        const key = c.function ?? c.id;
        groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const info = (key: string) => source.get(key) ?? { name: 'entry', priority: 3 };
    const allocator = new GoNames();
    const result = new Map<string, string>();
    for (const [key, members] of [...groups].sort(
        ([a], [b]) =>
            info(a).priority - info(b).priority ||
            compare(info(a).name, info(b).name) ||
            compare(a, b),
    )) {
        for (const c of [...members].sort((a, b) => compare(a.id, b.id))) {
            let suffix = '';
            if (members.length > 1) {
                const different = c.parameters
                    .map((_, n) => n)
                    .filter((n) => new Set(members.map((m) => m.parameters[n]?.layout)).size > 1);
                const parts = different.map((n) => {
                    const shape = physicalName(c.parameters[n]!.layout);
                    const semantic = parameterName(c, n);
                    const semanticDiffers =
                        new Set(members.map((m) => parameterName(m, n))).size > 1;
                    return shape === 'thin' || shape === 'scattered'
                        ? semanticDiffers
                            ? `${shape}_${semantic}`
                            : shape
                        : semantic;
                });
                suffix = `_${parts.length ? parts.join('_') : physicalName(c.body.layout)}`;
            }
            result.set(c.id, allocator.source(info(key).name + suffix));
        }
    }
    return result;
}
