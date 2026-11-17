import { expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import { lowerTypedProgram } from '../src/lower-typed.ts';
import type { Elaboration } from '../src/elaborated.ts';
import { backendCorpus } from './backend/corpus.ts';
import { specializeProgram } from '../src/specialize.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { irCon } from '../src/typed-ir.ts';

function parse(source: string) {
    const checker = new Checker(),
        elaborations: Elaboration[] = [];
    let declaration: Decl | undefined;
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw Error('Parse failure');
        const item = parsed.value;
        if (item.type === 'decl') {
            declaration = item;
            continue;
        }
        const checked = checker.check(item, declaration);
        elaborations.push(checked.elaboration);
        if (item.type === 'fn' && item.name) checker.publish(checked);
        declaration = undefined;
    }
    return lowerTypedProgram(elaborations);
}
const target = wasm32Emscripten('test');
const run = (source: string) => {
    const p = parse(source);
    return specializeProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
};
for (const sample of backendCorpus)
    it(`specializes semantics: ${sample.name}`, () => {
        const result = run(sample.source);
        expect(executeTypedProgram(result.program) as unknown).toEqual(sample.expected);
        expect(Object.isFrozen(result.generic)).toBe(true);
    });
it('shares equivalent calls and separates numeric/boolean instances', () => {
    const r = run('fn id(x) x\n(id(1), id(2), id(true))');
    const ids = r.instances.filter((s) => s.source.endsWith('/id'));
    expect(ids).toHaveLength(2);
    expect(r.program.units).toHaveLength(3);
    expect(executeTypedProgram(r.program)).toEqual([1, 2, true]);
});
it('omits unused definitions and imports', () => {
    const r = run('fn unused(x) x\n1');
    expect(r.instances).toHaveLength(1);
    expect(r.program.imports).toHaveLength(0);
    expect(r.generic.units).toHaveLength(2);
});
it('reserves a recursive instance before following its references', () => {
    const r = run('fn count(n) (match dup(~n) {0 -> 0; _ -> count(n - 1)})\ncount(3)');
    const count = r.instances.filter((s) => s.source.endsWith('/count'));
    expect(count).toHaveLength(1);
    expect(count[0]!.dependencies).toContain(count[0]!.id);
});
it('specializes reified functions passed through places', () => {
    const r = run('fn id(x) x\n{let f = id\n f(3)}');
    expect(executeTypedProgram(r.program)).toBe(3);
    expect(r.program.units[1]!.entry.instructions.length).toBeGreaterThan(0);
});
it('has deterministic target-specific identities and retains detached generic input', () => {
    const p = parse('fn id(x) x\nid(1)'),
        roots = [{ unit: p.units.at(-1)!.id, arguments: [] }];
    const a = specializeProgram(p, target, roots),
        b = specializeProgram(JSON.parse(JSON.stringify(p)), target, roots);
    expect(a).toEqual(b);
    const other = specializeProgram(
        p,
        { ...target, toolchain: { ...target.toolchain, version: 'other' } },
        roots,
    );
    expect(a.roots).not.toEqual(other.roots);
    expect(a.generic).not.toBe(p);
});
it('requires explicit concrete roots and validates budgets', () => {
    const p = parse('fn id(x) x'),
        unit = p.units[0]!.id;
    expect(() => specializeProgram(p, target, [])).toThrow('Explicit entry');
    expect(() => specializeProgram(p, target, [{ unit: 'missing', arguments: [] }])).toThrow(
        'Unknown entry',
    );
    expect(() => specializeProgram(p, target, [{ unit, arguments: [] }])).toThrow(
        'Wrong type argument',
    );
    expect(() =>
        specializeProgram(p, target, [
            { unit, arguments: [{ tag: 'variable', id: 'free', rigid: false }] },
        ]),
    ).toThrow('Reachable semantic');
    expect(() =>
        specializeProgram(p, target, [{ unit, arguments: [irCon('Number')] }], { maxInstances: 0 }),
    ).toThrow('positive integer');
    const root = specializeProgram(p, target, [{ unit, arguments: [irCon('Number')] }]);
    expect(root.program.units[0]!.signature.quantified).toEqual([]);
});
it('fails with the definition chain instead of returning a partial graph', () => {
    const p = parse('fn id(x) x\nid(1)');
    expect(() =>
        specializeProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }], {
            maxInstances: 1,
        }),
    ).toThrow(/budget 1 exceeded: .* -> .*id/);
});
it('diagnoses changing-specialization recursion in verified generic IR', () => {
    const p = structuredClone(parse('loop :: (a) => Number\nfn loop(x) loop(x)\nloop(1)'));
    const body = p.units[0]!.functions[0]!.body;
    const global = body.instructions.find((i) => i.op === 'global')!;
    const call = body.instructions.find((i) => i.op === 'call')!;
    if (global.op !== 'global' || call.op !== 'call' || global.instance.type.tag !== 'fn')
        throw Error('Expected call');
    const original = global.instance.arguments[0]!.type;
    const unit = { tag: 'tuple' as const, items: [] };
    const pair = { tag: 'tuple' as const, items: [original, unit] };
    global.instance.arguments[0]!.type = pair;
    global.instance.type.args[0] = { tag: 'plain', value: pair };
    global.out.type = { tag: 'plain', value: global.instance.type };
    const index = body.instructions.indexOf(call);
    body.instructions.splice(
        index,
        0,
        {
            op: 'constant',
            origin: call.origin,
            out: { id: 'extra-unit', type: { tag: 'plain', value: unit } },
            value: null,
        },
        {
            op: 'tuple',
            origin: call.origin,
            out: { id: 'extra-pair', type: { tag: 'plain', value: pair } },
            items: [call.args[0]!, 'extra-unit'],
        },
    );
    call.args = ['extra-pair'];
    expect(() =>
        specializeProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]),
    ).toThrow('Changing-specialization recursion');
});
it('rejects unresolved local annotations without erasing unused local callables', () => {
    const p = parse('fn outer(x) {let f = fn (y) y\n x}\nouter(1)');
    expect(() =>
        specializeProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]),
    ).toThrow('Reachable semantic type contains');
});
it('keeps native and wasm semantic caches distinct', () => {
    const p = parse('1'),
        roots = [{ unit: p.units[0]!.id, arguments: [] }];
    const native = {
        ...target,
        triple: 'x86_64-unknown-linux-gnu',
        pointerBits: 64 as const,
        runtime: 'native' as const,
        toolchain: { compiler: 'clang' as const, version: 'test' },
    };
    expect(specializeProgram(p, target, roots).roots).not.toEqual(
        specializeProgram(p, native, roots).roots,
    );
});
