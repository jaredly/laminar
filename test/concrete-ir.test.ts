import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { backendCorpus } from './backend/corpus.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { lowerConcreteProgram, compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten, BackendDiagnostic } from '../src/backend/target.ts';
import { ConcreteLayoutTable } from '../src/concrete-layouts.ts';
import type { ConcreteProgram, ConcreteBlock, ConcreteInstruction } from '../src/concrete-ir.ts';
const target = wasm32Emscripten('test');
function compile(text: string) {
    const p = typedProgram(text);
    return lowerConcreteProgram(
        specializeProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]),
    );
}
function instructions(b: ConcreteBlock): ConcreteInstruction[] {
    return b.instructions.flatMap((i) => [
        i,
        ...(i.op === 'scope'
            ? instructions(i.body)
            : i.op === 'case'
              ? i.cases.flatMap((c) => instructions(c.body))
              : []),
    ]);
}
for (const sample of backendCorpus.filter((s) => s.phase <= 6))
    it(`produces verified concrete IR: ${sample.name}`, () => {
        const p = compile(sample.source);
        expect(() => verifyConcreteProgram(JSON.parse(JSON.stringify(p)))).not.toThrow();
        expect(
            p.code.every(
                (c) =>
                    !!c.abi && instructions(c.body).every((i) => !('out' in i) || !!i.out.layout),
            ),
        ).toBe(true);
        expect(Object.isFrozen(p)).toBe(true);
    });
it('emits wrappers for first-class and higher-order function values', () => {
    const p = compile('fn apply(f, x) f(x)\nfn id(x) x\napply(id, 1)');
    expect(p.wrappers.filter((w) => w.kind === 'invoke')).toHaveLength(2);
    const ops = p.code.flatMap((c) => instructions(c.body));
    expect(ops.some((i) => i.op === 'make-callable')).toBe(true);
    expect(
        ops
            .filter((i) => i.op === 'invoke')
            .every((i) => i.op === 'invoke' && !!i.callee && !!i.field),
    ).toBe(true);
});
it('gives identical semantic types distinct thin/scattered invocation slots', () => {
    const p = compile(
        'fn inc(~(x, y)) {x := x + 1}\n{let pair = (1, 2)\n let a = 1\n let b = 2\n inc(~pair)\n inc(~(a, b))\n (pair, a, b)}',
    );
    const c = p.callables.find((c) => c.descriptor.kind === 'callable')!;
    expect(c.entries).toHaveLength(2);
    expect(c.entries[0]!.abi).not.toBe(c.entries[1]!.abi);
});
it('uses disposal-only callable storage when invocation is unreachable', () => {
    const p = compile('{let x = 1\n let f = fn (()) x\n 2}');
    expect(p.callables).toHaveLength(1);
    expect(p.callables[0]!.entries).toHaveLength(0);
    expect(p.wrappers).toHaveLength(1);
    expect(p.wrappers[0]!.kind).toBe('dispose');
    expect(p.code).toHaveLength(1);
});
it('resolves recursive code and all forward declarations', () => {
    const p = compile(backendCorpus.find((s) => s.name === 'recursion')!.source);
    const variants = p.code.filter((c) => c.function);
    expect(variants).toHaveLength(1);
    expect(
        instructions(variants[0]!.body).some(
            (i) =>
                i.op === 'invoke' &&
                p.wrappers.some(
                    (w) => w.id === i.wrapper && w.kind === 'invoke' && w.code === variants[0]!.id,
                ),
        ),
    ).toBe(true);
    expect(p.forward.code).toEqual(p.code.map((c) => c.id).sort());
});
function reject(name: string, mutate: (p: ConcreteProgram) => void) {
    it(`rejects concrete corruption: ${name}`, () => {
        const p = structuredClone(compile('fn id(x) x\n(id(1), id(true))'));
        mutate(p);
        try {
            verifyConcreteProgram(p);
            throw Error('Accepted corrupt concrete IR');
        } catch (e) {
            expect(e).toBeInstanceOf(BackendDiagnostic);
            expect((e as BackendDiagnostic).code).toBe('invalid-concrete-ir');
        }
    });
}
reject('missing ABI', (p) => {
    p.abis.pop();
});
reject('missing wrapper', (p) => {
    p.wrappers.pop();
});
reject('missing code', (p) => {
    p.code.pop();
});
reject('missing layout', (p) => {
    p.layouts.pop();
});
reject('duplicate code', (p) => {
    p.code.push(p.code[0]!);
});
reject('bad ownership', (p) => {
    (p.wrappers.find((w) => w.kind === 'invoke') as any).ownership = 'no-environment';
});
reject('missing forward name', (p) => {
    p.forward.code.pop();
});
reject('changed output layout', (p) => {
    const op = p.code.flatMap((c) => instructions(c.body)).find((i) => 'out' in i)!;
    if ('out' in op) op.out.layout = 'missing';
});
reject('wrong wrapper invocation', (p) => {
    const op = p.code.flatMap((c) => instructions(c.body)).find((i) => i.op === 'invoke')!;
    if (op.op === 'invoke') op.wrapper = p.wrappers.find((w) => w.kind === 'dispose')!.id;
});
reject('changed body operation', (p) => {
    const op = p.code.flatMap((c) => instructions(c.body)).find((i) => i.op === 'constant')!;
    if (op.op === 'constant') op.value = 1234;
});
reject('changed capture environment', (p) => {
    p.callables[0]!.environment = 'missing';
});
reject('changed physical target', (p) => {
    p.target = { ...p.target, toolchain: { ...p.target.toolchain, version: 'other' } };
});
const variable = { tag: 'variable' as const, id: 'T', rigid: false };
it('declares pointer-recursive generic data and dependencies', () => {
    const t = new ConcreteLayoutTable(target, [
        {
            name: 'Node',
            parameters: ['T'],
            kind: 'record',
            fields: [
                { name: 'value', type: variable },
                {
                    name: 'next',
                    type: { tag: 'con', name: 'Node', args: [variable] },
                    indirect: true,
                },
            ],
        },
    ]);
    const id = t.data({
        tag: 'con',
        name: 'Node',
        args: [{ tag: 'con', name: 'Number', args: [] }],
    });
    const p = t.finish();
    expect(p.forward).toContain(id);
    expect(p.layouts.find((l) => l.id === id)!.fields[1]).toEqual({
        name: 'next',
        kind: 'pointer',
        layout: id,
    });
});
it('rejects infinitely sized by-value recursive data', () => {
    const t = new ConcreteLayoutTable(target, [
        {
            name: 'Bad',
            parameters: [],
            kind: 'record',
            fields: [{ name: 'self', type: { tag: 'con', name: 'Bad', args: [] } }],
        },
    ]);
    t.data({ tag: 'con', name: 'Bad', args: [] });
    expect(() => t.finish()).toThrow('Infinitely sized');
});
it('accepts recursion across an earlier indirect edge', () => {
    const t = new ConcreteLayoutTable(target, [
        {
            name: 'A',
            parameters: [],
            kind: 'record',
            fields: [{ name: 'b', type: { tag: 'con', name: 'B', args: [] }, indirect: true }],
        },
        {
            name: 'B',
            parameters: [],
            kind: 'record',
            fields: [{ name: 'a', type: { tag: 'con', name: 'A', args: [] } }],
        },
    ]);
    t.data({ tag: 'con', name: 'A', args: [] });
    expect(() => t.finish()).not.toThrow();
});
it('diagnoses unbounded generic layout expansion', () => {
    const t = new ConcreteLayoutTable(
        target,
        [
            {
                name: 'Grow',
                parameters: ['T'],
                kind: 'record',
                fields: [
                    {
                        name: 'tail',
                        type: {
                            tag: 'con',
                            name: 'Grow',
                            args: [{ tag: 'tuple', items: [variable, variable] }],
                        },
                        indirect: true,
                    },
                ],
            },
        ],
        8,
    );
    expect(() =>
        t.data({ tag: 'con', name: 'Grow', args: [{ tag: 'con', name: 'Number', args: [] }] }),
    ).toThrow('Unbounded layout expansion');
});
it('compiles explicit generic function entries with concrete incoming lens topology', () => {
    const generic = typedProgram('fn inc(~(x, y)) {x := x + 1}');
    const semantic = specializeProgram(generic, target, [
        { unit: generic.units[0]!.id, arguments: [{ tag: 'con', name: 'Number', args: [] }] },
    ]);
    const shapes = [
        { kind: 'thin' as const },
        { kind: 'tuple' as const, items: [{ kind: 'thin' as const }, { kind: 'thin' as const }] },
    ];
    const programs = shapes.map((topology) => {
        const analysis = inferRepresentations(semantic, {
            entryArguments: [{ unit: semantic.roots[0]!, arguments: [{ kind: 'lens', topology }] }],
        });
        return lowerConcreteProgram(semantic, analysis);
    });
    programs.forEach((p) => expect(p.entries[0]).toBe(p.code[0]!.id));
    expect(programs[0]!.code[0]!.abi).not.toBe(programs[1]!.code[0]!.abi);
});
it('compiles an explicit generic scalar function entry', () => {
    const generic = typedProgram('fn id(x) x');
    const semantic = specializeProgram(generic, target, [
        { unit: generic.units[0]!.id, arguments: [{ tag: 'con', name: 'Number', args: [] }] },
    ]);
    const analysis = inferRepresentations(semantic, {
        entryArguments: [{ unit: semantic.roots[0]!, arguments: [{ kind: 'data' }] }],
    });
    const p = lowerConcreteProgram(semantic, analysis);
    expect(p.code).toHaveLength(1);
    expect(p.code[0]!.parameters).toHaveLength(1);
});
it('gives returned closures typed wrappers and environment layouts', () => {
    const p = compile('fn make(x) {fn (y) {x + y}}\n{let f = make(1)\n f(2)}');
    expect(p.callables.filter((c) => c.descriptor.kind === 'callable')).toHaveLength(2);
    expect(p.wrappers.filter((w) => w.kind === 'invoke')).toHaveLength(2);
    expect(p.code.some((c) => c.captures.length === 1)).toBe(true);
});
const listSchemas: import('../src/layout-definitions.ts').NominalLayoutDefinition[] = [
    {
        name: 'List',
        parameters: ['T'],
        kind: 'union',
        fields: [
            { name: 'nil', type: { tag: 'tuple', items: [] } },
            {
                name: 'cons',
                type: {
                    tag: 'tuple',
                    items: [variable, { tag: 'con', name: 'List', args: [variable] }],
                },
                indirect: true,
            },
        ],
    },
];
it('carries registered recursive container layouts through concrete IR without executing a runtime', () => {
    const generic = typedProgram('[1,2]'),
        s = specializeProgram(generic, target, [{ unit: generic.units[0]!.id, arguments: [] }]);
    const a = inferRepresentations(s, { layoutDefinitions: listSchemas }),
        p = lowerConcreteProgram(s, a);
    expect(p.layouts.some((l) => l.kind === 'union')).toBe(true);
    expect(() => verifyConcreteProgram(JSON.parse(JSON.stringify(p)))).not.toThrow();
    expect(
        p.code.flatMap((c) => instructions(c.body)).filter((i) => i.op === 'construct'),
    ).toHaveLength(3);
});
it('rejects registered layout schemas inconsistent with constructor signatures', () => {
    const generic = typedProgram('[1]'),
        s = specializeProgram(generic, target, [{ unit: generic.units[0]!.id, arguments: [] }]);
    const wrong = structuredClone(listSchemas);
    wrong[0]!.fields[1]!.type = { tag: 'con', name: 'Bool', args: [] };
    expect(() => inferRepresentations(s, { layoutDefinitions: wrong })).toThrow(
        'semantic type mismatch',
    );
});
it('layout cache identities include normalized schema definitions', () => {
    const a = new ConcreteLayoutTable(target, listSchemas),
        changed = structuredClone(listSchemas);
    changed[0]!.fields[1]!.indirect = false;
    const b = new ConcreteLayoutTable(target, changed),
        type = {
            tag: 'con' as const,
            name: 'List',
            args: [{ tag: 'con' as const, name: 'Number', args: [] }],
        };
    expect(a.data(type)).not.toBe(b.data(type));
    const renamed = structuredClone(listSchemas);
    renamed[0]!.parameters = ['X'];
    const rename = (
        t: import('../src/elaborated.ts').SemanticType,
    ): import('../src/elaborated.ts').SemanticType =>
        t.tag === 'variable'
            ? { ...t, id: 'X' }
            : t.tag === 'con'
              ? { ...t, args: t.args.map(rename) }
              : t.tag === 'tuple'
                ? { ...t, items: t.items.map(rename) }
                : t;
    renamed[0]!.fields.forEach((f) => (f.type = rename(f.type)));
    expect(new ConcreteLayoutTable(target, renamed).data(type)).toBe(a.data(type));
});
it('keeps concrete native and wasm layouts, wrappers, and ABIs separate', () => {
    const generic = typedProgram('fn id(x) x\nid(1)'),
        roots = [{ unit: generic.units.at(-1)!.id, arguments: [] }];
    const native = {
        ...target,
        triple: 'x86_64-unknown-linux-gnu',
        pointerBits: 64 as const,
        runtime: 'native' as const,
        toolchain: { compiler: 'clang' as const, version: 'test' },
    };
    const a = lowerConcreteProgram(specializeProgram(generic, target, roots)),
        b = lowerConcreteProgram(specializeProgram(generic, native, roots));
    expect(a.layouts.some((x) => b.layouts.some((y) => x.id === y.id))).toBe(false);
    expect(a.abis.some((x) => b.abis.some((y) => x.id === y.id))).toBe(false);
    expect(a.wrappers.some((x) => b.wrappers.some((y) => x.id === y.id))).toBe(false);
});
it('canonicalizes concrete callable keys independently of property order', () => {
    const p = compile('fn apply(f, x) f(x)\nfn id(x) x\napply(id, 1)');
    const reorder = (v: any): any =>
        Array.isArray(v)
            ? v.map(reorder)
            : v && typeof v === 'object'
              ? Object.fromEntries(
                    Object.entries(v)
                        .reverse()
                        .map(([k, x]) => [k, reorder(x)]),
                )
              : v;
    const r = lowerConcreteProgram(reorder(p.semantic), reorder(p.analysis));
    expect(r).toEqual(p);
});
it('keeps cache identities independent of source-local place IDs', () => {
    const generic = typedProgram('fn inc(~x) {x := x + 1}\n{let a = 1\n inc(~a)\n a}');
    const rename = (v: any): any =>
        Array.isArray(v)
            ? v.map(rename)
            : v && typeof v === 'object'
              ? Object.fromEntries(
                    Object.entries(v).map(([k, x]) => [
                        k,
                        (k === 'place' || k === 'lensPlace') && typeof x === 'string'
                            ? `renamed:${x}`
                            : rename(x),
                    ]),
                )
              : v;
    const roots = [{ unit: generic.units.at(-1)!.id, arguments: [] }];
    const a = lowerConcreteProgram(specializeProgram(generic, target, roots)),
        b = lowerConcreteProgram(specializeProgram(rename(generic), target, roots));
    expect(a.layouts).toEqual(b.layouts);
    expect(a.abis).toEqual(b.abis);
    expect(a.wrappers).toEqual(b.wrappers);
    expect(a.code.map((c) => c.id)).toEqual(b.code.map((c) => c.id));
});
it('shares a single concrete specialization across repeated calls', () => {
    const p = compile('fn id(x) x\n(id(1), id(2))');
    expect(p.code.filter((c) => c.function)).toHaveLength(1);
    expect(p.wrappers.filter((w) => w.kind === 'invoke')).toHaveLength(1);
});
it('omits unused generic definitions from concrete code', () => {
    const p = compile('fn unused(x) x\n1');
    expect(p.code).toHaveLength(1);
    expect(p.callables).toHaveLength(0);
    expect(p.semantic.generic.units).toHaveLength(2);
});
it('propagates returned lens representation contracts into concrete call results', () => {
    const p = compile(
        'fn first(~(x, y)) ~x\n{let pair = ((1, 2), 3)\n first(~pair) := true\n pair}',
    );
    const c = p.code.find((c) => c.function)!;
    const abi = p.abis.find((a) => a.id === c.abi)!;
    expect(p.layouts.find((l) => l.id === abi.result)!.fields.map((f) => f.name)).toEqual([
        'read',
        'replacement',
        'restore',
        'context',
    ]);
});
it('keeps semantic and dynamic result diagnostics in the concrete API', () => {
    expect(() => compile('fn id(x) x\nid')).toThrow('Wrong type argument count');
    expect(() =>
        compile(
            '{let f = match true {true -> fn () {fn (x) x}; false -> fn () {fn (x) x}}\n let g = f()\n g(1)}',
        ),
    ).not.toThrow();
});

it('compiles two explicit shape variants of the same generic function entry', () => {
    const generic = typedProgram('fn inc(~(x, y)) {x := x + 1}');
    const base = {
        unit: generic.units[0]!.id,
        arguments: [{ tag: 'con' as const, name: 'Number', args: [] }],
    };
    const p = compileConcreteProgram(generic, target, [
        { ...base, parameters: [{ kind: 'lens', topology: { kind: 'thin' } }] },
        {
            ...base,
            parameters: [
                {
                    kind: 'lens',
                    topology: { kind: 'tuple', items: [{ kind: 'thin' }, { kind: 'thin' }] },
                },
            ],
        },
    ]);
    expect(p.entries).toHaveLength(2);
    expect(new Set(p.entries).size).toBe(2);
    expect(p.code).toHaveLength(2);
    expect(p.semantic.generic.units).toHaveLength(1);
});
it('diagnoses infinite semantic layouts before producing a concrete artifact', () => {
    const generic = typedProgram('[1]'),
        s = specializeProgram(generic, target, [{ unit: generic.units[0]!.id, arguments: [] }]);
    const defs = structuredClone(listSchemas);
    defs[0]!.fields[1]!.indirect = false;
    expect(() => inferRepresentations(s, { layoutDefinitions: defs })).toThrow(
        'Infinitely sized by-value',
    );
});
it('requires a positive physical layout expansion budget', () => {
    expect(() => new ConcreteLayoutTable(target, [], 0)).toThrow('positive integer');
});
it('does not leave partial layout cache records after a failed expansion', () => {
    const t = new ConcreteLayoutTable(target);
    expect(() =>
        t.data({
            tag: 'tuple',
            items: [
                { tag: 'con', name: 'Number', args: [] },
                { tag: 'con', name: 'Missing', args: [] },
            ],
        }),
    ).toThrow('Missing concrete layout schema');
    expect(t.finish().layouts).toHaveLength(0);
    expect(() => t.data({ tag: 'con', name: 'Number', args: [] })).not.toThrow();
});
it('preserves specialization and representation budgets through the whole phase-3 API', () => {
    const generic = typedProgram('fn id(x) x\n(id(1), id(true))'),
        roots = [{ unit: generic.units.at(-1)!.id, arguments: [] }];
    expect(() => compileConcreteProgram(generic, target, roots, { maxInstances: 1 })).toThrow(
        'Specialization budget',
    );
    expect(() => compileConcreteProgram(generic, target, roots, { maxVariants: 1 })).toThrow(
        'Representation budget',
    );
});
