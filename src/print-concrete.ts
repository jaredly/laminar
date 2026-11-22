import { dsl as l, stringify, type Node } from '../parser-generator/lexer.ts';
import type {
    ConcreteProgram,
    ConcreteBlock,
    ConcreteInstruction,
    ConcreteField,
} from './concrete-ir.ts';
import type { IRPattern, SlotRef, Cleanup, EncodedNumber } from './typed-ir.ts';
import type { SemanticType } from './elaborated.ts';

export type ConcretePrintOptions = { ids?: 'short' | 'full'; origins?: boolean };
const words = (...items: (Node | string)[]): Node => l.l(' ', items);
const tuple = (items: (Node | string)[]): Node => l.l('(,', items);
const braces = (items: Node[]): Node => l.l('{\n', items);
const call = (name: Node | string, args: (Node | string)[]): Node => l.l('', [name, tuple(args)]);
const typed = (name: Node | string, type: Node | string): Node => l.l(':', [name, type]);
const quote = (value: string): Node => l.l('"', [value]);
const literal = (value: EncodedNumber | string | boolean | null): Node =>
    typeof value === 'string'
        ? quote(value)
        : value === null
          ? tuple([])
          : l.i(typeof value === 'object' ? value.number : String(value));

/** Lexer-node view of emitted IR. Diagnostic generic snapshots and cache keys are intentionally omitted. */
export function lconcrete(program: ConcreteProgram, options: ConcretePrintOptions = {}): Node {
    const names = new Map<string, string>();
    const full = options.ids === 'full';
    const name = (id: string): string => (full ? id : (names.get(id) ?? id));
    program.layouts.forEach((v, i) => names.set(v.id, `L${i}`));
    program.abis.forEach((v, i) => names.set(v.id, `abi${i}`));
    program.wrappers.forEach((v, i) => names.set(v.id, `wrap${i}`));
    program.callables.forEach((v, i) => names.set(v.id, `callable${i}`));
    const instances = new Map(program.semantic.instances.map((v) => [v.id, v.source]));
    const units = new Map(program.semantic.program.units.map((u) => [u.id, u]));
    const counts = new Map<string, number>();
    const usedCodeNames = new Set<string>();
    const clean = (text: string) => text.replace(/[^a-zA-Z0-9_]/g, '_');
    program.code.forEach((v) => {
        const u = units.get(v.unit),
            entry = u?.entry.instructions[0];
        const source = instances.get(v.unit);
        const sourceName = source?.includes('/definition/') ? source.split('/').at(-1)! : 'lambda';
        const base = v.function
            ? clean(
                  entry?.op === 'closure' && entry.function === v.function
                      ? sourceName
                      : sourceName === 'lambda'
                        ? 'lambda'
                        : `${sourceName}_lambda`,
              )
            : 'entry';
        let index = counts.get(base) ?? 0;
        while (usedCodeNames.has(`${base}${index}`)) index++;
        const alias = `${base}${index}`;
        usedCodeNames.add(alias);
        counts.set(base, index + 1);
        names.set(v.id, alias);
    });
    const ptr = (id?: string): Node => l.l('', ['ptr', l.w('<', l.i(id ? name(id) : 'void'))]);
    const codePtr = (id: string): Node => l.l('', ['code', l.w('<', l.i(name(id)))]);
    const field = (f: ConcreteField): Node =>
        typed(
            f.name,
            f.kind === 'value'
                ? name(f.layout)
                : f.kind === 'pointer'
                  ? ptr(f.layout)
                  : codePtr(f.abi),
        );
    const semantic = (t: SemanticType): Node => {
        switch (t.tag) {
            case 'variable':
                return l.i(t.id);
            case 'con':
                return t.args.length ? call(t.name, t.args.map(semantic)) : l.i(t.name);
            case 'tuple':
                return tuple(t.items.map(semantic));
            case 'fn':
                return words(
                    tuple(
                        t.args.map((f) =>
                            f.tag === 'plain'
                                ? semantic(f.value)
                                : words(semantic(f.read), '/', semantic(f.write)),
                        ),
                    ),
                    '->',
                    t.result.tag === 'plain'
                        ? semantic(t.result.value)
                        : words(semantic(t.result.read), '/', semantic(t.result.write)),
                );
        }
    };
    const lines: Node[] = [
        words('concrete-ir', String(program.schemaVersion)),
        words(
            'target',
            quote(program.target.triple),
            `${program.target.pointerBits}bit`,
            program.target.byteOrder,
            program.target.abi,
            program.target.runtime,
        ),
        words(
            'toolchain',
            program.target.toolchain.compiler,
            quote(program.target.toolchain.version),
            'features',
            tuple([...program.target.features]),
        ),
        words('entries', tuple(program.entries.map(name))),
        words(
            'forward',
            braces([
                words('layouts', tuple(program.forward.layouts.map(name))),
                words('abis', tuple(program.forward.abis.map(name))),
                words('code', tuple(program.forward.code.map(name))),
            ]),
        ),
        words(
            'layouts',
            braces(
                program.layouts.map((v) => {
                    let hint = '';
                    try {
                        const key = JSON.parse(v.key);
                        if (key[2] === 'lens')
                            hint =
                                program.analysis.shapes.find((s) => s.id === key[3])?.kind ===
                                'tuple'
                                    ? 'scattered'
                                    : 'thin';
                        else if (key[2] === 'environment' || key[2] === 'callable') hint = key[2];
                    } catch {
                        /* An incomplete diagnostic artifact can still be inspected. */
                    }
                    return words(
                        name(v.id),
                        '=',
                        v.kind,
                        ...(hint ? [hint] : []),
                        ...(v.fields.length ? [braces(v.fields.map(field))] : []),
                    );
                }),
            ),
        ),
        words(
            'abis',
            braces(
                program.abis.map((v) =>
                    words(
                        name(v.id),
                        '=',
                        tuple([typed('env', ptr()), ...v.arguments.map((id) => name(id))]),
                        '->',
                        name(v.result),
                    ),
                ),
            ),
        ),
        words(
            'wrappers',
            braces(
                program.wrappers.map((v) =>
                    words(
                        name(v.id),
                        ':',
                        name(v.abi),
                        'env',
                        name(v.environment),
                        '=',
                        v.kind === 'invoke'
                            ? words('invoke', name(v.code))
                            : v.kind === 'native'
                              ? words('native', quote(v.definition))
                              : v.kind === 'adapt-lens-result'
                                ? words(
                                      'adapt-lens-result',
                                      name(v.source),
                                      quote(v.from),
                                      '->',
                                      quote(v.to),
                                      tuple(v.order),
                                  )
                                : words('dispose', tuple(v.captures.map(name))),
                        v.ownership,
                    ),
                ),
            ),
        ),
        words(
            'callables',
            braces(
                program.callables.map((v) =>
                    words(
                        name(v.id),
                        ':',
                        name(v.layout),
                        'env',
                        name(v.environment),
                        braces([
                            words('dispose', name(v.dispose)),
                            ...v.entries.map((e) =>
                                words(
                                    e.field,
                                    ...(e.wrapper ? ['=', name(e.wrapper)] : []),
                                    ':',
                                    name(e.abi),
                                ),
                            ),
                        ]),
                    ),
                ),
            ),
        ),
    ];
    for (const fn of program.code) {
        const local = new Map<string, string>();
        const lensResults = new Set<string>();
        let nextValue = 0,
            nextPlace = 0,
            nextLoan = 0;
        const bindingNames = new Map(
            program.semantic.generic.units.flatMap((u) =>
                u.bindings
                    .filter((b) => b.kind === 'local' || b.kind === 'capture')
                    .map((b) => [b.place, b.name] as const),
            ),
        );
        const used = new Map<string, number>();
        const usedPlaceNames = new Set<string>();
        const ref = (id: string, kind: 'value' | 'place' | 'loan'): string => {
            if (full) return id;
            const key = `${kind}:${id}`;
            let result = local.get(key);
            if (!result) {
                if (kind === 'value') result = `%${nextValue++}`;
                else if (kind === 'loan') result = `loan${nextLoan++}`;
                else {
                    const source = bindingNames.get(id);
                    const base = source ? clean(source) : `p${nextPlace++}`;
                    let count = used.get(base) ?? 0;
                    while (usedPlaceNames.has(`$${base}${count ? `_${count}` : ''}`)) count++;
                    used.set(base, count + 1);
                    result = `$${base}${count ? `_${count}` : ''}`;
                    usedPlaceNames.add(result);
                }
                local.set(key, result);
            }
            return result;
        };
        const value = (id: string) => ref(id, 'value');
        const slot = (s: SlotRef): Node =>
            l.l('', [
                ref(s.place, 'place'),
                ...s.path.map((i) => `.${i}`),
                ...(s.permit ? [`@${ref(s.permit, 'loan')}`] : []),
            ]);
        const pattern = (p: IRPattern): Node => {
            switch (p.kind) {
                case 'bind':
                    return slot(p.slot);
                case 'drop':
                    return l.i('_');
                case 'literal':
                    return literal(p.value);
                case 'tuple':
                    return tuple(p.items.map(pattern));
                case 'constructor':
                    return call(p.name, p.items.map(pattern));
            }
        };
        const cleanup = (c: Cleanup): Node =>
            c.kind === 'release'
                ? words('release', ref(c.loan, 'loan'))
                : c.kind === 'drop-place'
                  ? words('drop', slot(c.slot))
                  : words('restored', slot(c.slot), ':', semantic(c.type));
        const instruction = (i: ConcreteInstruction): Node => {
            let expression: Node;
            switch (i.op) {
                case 'bind':
                    return words(
                        'bind',
                        pattern(i.pattern),
                        '=',
                        value(i.value),
                        ...(options.origins ? [words('@', quote(i.origin))] : []),
                    );
                case 'borrow':
                    return words(
                        'borrow',
                        ref(i.loan, 'loan'),
                        '=',
                        value(i.lens),
                        ...(options.origins ? [words('@', quote(i.origin))] : []),
                    );
                case 'constant':
                    expression = literal(i.value);
                    break;
                case 'string':
                    expression = l.l('"', [
                        i.head,
                        ...i.parts.flatMap((p) => [l.i(value(p.value)), p.tail]),
                    ]);
                    break;
                case 'tuple':
                    expression = tuple(i.items.map(value));
                    break;
                case 'construct':
                    expression = call(i.name, i.items.map(value));
                    if (i.reuses) expression = words(expression, 'reuses', i.reuses);
                    break;
                case 'move':
                    expression = words('move', slot(i.slot));
                    break;
                case 'acquire':
                    expression = words('acquire', slot(i.slot));
                    break;
                case 'lens-tuple':
                    expression = call('lens-tuple', i.items.map(value));
                    break;
                case 'swap':
                    expression = call('swap', [value(i.lens), value(i.value)]);
                    break;
                case 'make-callable':
                    expression = words(
                        'make-callable',
                        name(i.callable),
                        braces(
                            i.captures.map((c, index) =>
                                words(full ? c.place : `capture${index}`, '<-', value(c.value)),
                            ),
                        ),
                    );
                    break;
                case 'invoke':
                    expression = words(
                        call(
                            i.field === undefined
                                ? value(i.callee)
                                : l.l('', [value(i.callee), '.', i.field]),
                            i.args.map(value),
                        ),
                        ...(i.wrapper ? ['via', name(i.wrapper)] : []),
                        ':',
                        name(i.abi),
                    );
                    break;
                case 'aslens':
                    expression = words(
                        'aslens',
                        value(i.initial),
                        'backing',
                        slot({ place: i.backing, path: [] }),
                        'holds',
                        tuple(i.holds.map(slot)),
                        'deferred',
                        block(i.cleanup),
                    );
                    break;
                case 'scope':
                    expression = words('scope', block(i.body));
                    break;
                case 'case': {
                    const topology = (id: string): Node => {
                        const shape = program.analysis.shapes.find((s) => s.id === id)!;
                        return shape.kind === 'thin'
                            ? l.i('thin')
                            : call('tuple', shape.items.map(topology));
                    };
                    expression = words(
                        'match',
                        value(i.value),
                        ...(i.lensJoin
                            ? [
                                  call('selected-focus', i.lensJoin.arms.map(topology)),
                                  '->',
                                  topology(i.lensJoin.result),
                              ]
                            : []),
                        braces(
                            i.cases.map((c) =>
                                words(
                                    pattern(c.pattern),
                                    ...(c.retains ? ['retains', c.retains] : []),
                                    '->',
                                    ...(c.setup?.length
                                        ? [words('setup', braces(c.setup.map(cleanup)))]
                                        : []),
                                    block(c.body),
                                    ...(c.restored?.length
                                        ? [words('restored', braces(c.restored.map(cleanup)))]
                                        : []),
                                ),
                            ),
                        ),
                    );
                    break;
                }
                default: {
                    const unknown: never = i;
                    throw new Error(`Unknown concrete operation: ${JSON.stringify(unknown)}`);
                }
            }
            return words(
                typed(value(i.out.id), name(i.out.layout)),
                '=',
                expression,
                ...(options.origins ? [words('@', quote(i.origin))] : []),
            );
        };
        function block(b: ConcreteBlock): Node {
            return braces([
                ...b.instructions.map(instruction),
                words('return', value(b.result), ':', name(b.layout)),
                ...(b.cleanup.length
                    ? [
                          words(
                              'cleanup',
                              ...(lensResults.has(b.result) ? ['after-restore'] : []),
                              braces(b.cleanup.map(cleanup)),
                          ),
                      ]
                    : []),
            ]);
        }
        // Assign SSA aliases up front so nested scopes follow source instruction order.
        const reserve = (b: ConcreteBlock): void => {
            for (const i of b.instructions) {
                if ('out' in i) {
                    value(i.out.id);
                    if (i.out.type.tag === 'flow') lensResults.add(i.out.id);
                }
                if (i.op === 'scope') reserve(i.body);
                if (i.op === 'aslens') reserve(i.cleanup);
                else if (i.op === 'case') i.cases.forEach((c) => reserve(c.body));
            }
        };
        reserve(fn.body);
        const captures = fn.captures.map((c, index) =>
            typed(words(`capture${index}`, ref(c.place, 'place')), name(c.layout)),
        );
        const parameters = fn.parameters.map((p) =>
            typed(
                p.lensPlace
                    ? words('lens', ref(p.lensPlace, 'place'), pattern(p.pattern))
                    : pattern(p.pattern),
                name(p.layout),
            ),
        );
        lines.push(
            words(
                'fn',
                call(name(fn.id), parameters),
                ':',
                name(fn.abi),
                'env',
                name(fn.environment),
                ...(captures.length ? [words('captures', tuple(captures))] : []),
                ...(options.origins
                    ? [
                          words(
                              'source',
                              quote(fn.unit),
                              ...(fn.function ? [quote(fn.function)] : []),
                          ),
                      ]
                    : []),
                block(fn.body),
            ),
        );
    }
    return l.l('\n', lines);
}

/** Convenience equivalent of stringify(lconcrete(program, options)). */
export function printConcreteProgram(
    program: ConcreteProgram,
    options: ConcretePrintOptions = {},
): string {
    return stringify(lconcrete(program, options));
}
