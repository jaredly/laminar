import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { backendCorpus } from './backend/corpus.ts';
const target = wasm32Emscripten('test');
const semantic = (text: string) => {
    const p = typedProgram(text);
    return specializeProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
};
const analyze = (text: string) => inferRepresentations(semantic(text));
for (const sample of backendCorpus.filter((s) => s.phase <= 6))
    it(`infers representations: ${sample.name}`, () => {
        const result = analyze(sample.source);
        expect(result.roots).toHaveLength(1);
        expect(result.layouts.length).toBeGreaterThan(0);
        expect(Object.isFrozen(result)).toBe(true);
    });
it('reuses variants for equivalent calls', () => {
    const r = analyze('fn id(x) x\n(id(1),id(2),id(true))');
    expect(r.variants).toHaveLength(2);
    expect(r.entries[0]!.calls[0]!.target).toBe(r.entries[0]!.calls[1]!.target);
});
it('separates thin and scattered variants at identical semantic types', () => {
    const r = analyze(
        'fn inc(~(x, y)) {x := x + 1}\n{let pair = (1, 2)\n let a = 1\n let b = 2\n inc(~pair)\n inc(~(a, b))\n (pair, a, b)}',
    );
    expect(r.variants).toHaveLength(2);
    const args = r.variants.map((v) => v.arguments[0]!);
    expect(args.every((a) => a.kind === 'lens')).toBe(true);
    const shapes = args.map((a) => r.shapes.find((s) => a.kind === 'lens' && s.id === a.shape)!);
    expect(new Set(shapes.map((s) => s.kind))).toEqual(new Set(['thin', 'tuple']));
    expect(shapes[0]!.read).toBe(shapes[1]!.read);
    expect(shapes[0]!.replacement).toBe(shapes[1]!.replacement);
});
it('reserves recursive variants before analyzing bodies', () => {
    const r = analyze(backendCorpus.find((s) => s.name === 'recursion')!.source);
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]!.calls.some((c) => c.target === r.variants[0]!.id)).toBe(true);
});
it('diagnoses unsupported nominal storage and callable roots', () => {
    expect(() => analyze('[1,2]')).toThrow('No storage definition');
    expect(() => analyze('fn id(x) x\nid')).toThrow('Wrong type argument count');
    const p = typedProgram('fn id(x) x\nid(1)');
    const s = specializeProgram(p, target, [
        { unit: p.units[0]!.id, arguments: [{ tag: 'con', name: 'Number', args: [] }] },
    ]);
    expect(() => inferRepresentations(s)).toThrow('Callable entry roots');
});
it('rejects invalid budgets and reports variant expansion', () => {
    const p = semantic('fn id(x) x\n(id(1),id(true))');
    expect(() => inferRepresentations(p, { maxVariants: 0 })).toThrow('positive integer');
    expect(() => inferRepresentations(p, { maxVariants: 1 })).toThrow(
        'Representation budget 1 exceeded',
    );
});
it('is deterministic after serialization and separates targets', () => {
    const p = semantic('fn id(x) x\nid(1)'),
        a = inferRepresentations(p);
    expect(inferRepresentations(JSON.parse(JSON.stringify(p)))).toEqual(a);
    const native = {
        ...target,
        triple: 'x86_64-unknown-linux-gnu',
        pointerBits: 64 as const,
        runtime: 'native' as const,
        toolchain: { compiler: 'clang' as const, version: 'test' },
    };
    const generic = p.generic,
        roots = [{ unit: generic.units.at(-1)!.id, arguments: [] }];
    expect(
        inferRepresentations(specializeProgram(generic, native, roots)).variants[0]!.id,
    ).not.toBe(a.variants[0]!.id);
});
it('propagates known higher-order callable arguments', () => {
    const r = analyze('fn apply(f, x) f(x)\nfn id(x) x\napply(id, 1)');
    expect(r.variants).toHaveLength(2);
    expect(r.variants.some((v) => v.arguments[0]?.kind === 'callable')).toBe(true);
    const ids = new Set(r.variants.map((v) => v.id));
    // Direct calls name a variant; `f(x)` dispatches over f's type members.
    expect(
        r.variants.every((v) =>
            v.calls.every((c) =>
                c.targets
                    ? c.targets.every((t) => ids.has(t))
                    : c.target.startsWith('native/') || ids.has(c.target),
            ),
        ),
    ).toBe(true);
});
it('records every target of a runtime callable join', () => {
    const analysis = analyze('{let f = match true {true -> fn (x) x; false -> fn (x) x}\n f(1)}');
    const call = analysis.entries.at(-1)!.calls.find((c) => c.targets)!;
    expect(call.targets).toHaveLength(2);
    expect(call.targets!.every((id) => analysis.variants.some((v) => v.id === id))).toBe(true);
});
it('records nested mixed topology and projection without flattening', () => {
    const r = analyze(
        'fn set(~(x, y)) {x := true}\n{let a = (1, 2)\n let b = 3\n set(~(a, b))\n (a, b)}',
    );
    const arg = r.variants[0]!.arguments[0]!;
    if (arg.kind !== 'lens') throw Error('Expected lens');
    const root = r.shapes.find((s) => s.id === arg.shape)!;
    expect(root.kind).toBe('tuple');
    if (root.kind !== 'tuple') throw Error('Expected scattered tuple');
    expect(root.items.map((id) => r.shapes.find((s) => s.id === id)!.kind)).toEqual([
        'thin',
        'thin',
    ]);
    const child = r.shapes.find((s) => s.id === root.items[0])!;
    expect(r.layouts.find((l) => l.id === child.read)!.storage).toBe('tuple');
    expect(r.layouts.find((l) => l.id === child.replacement)!.storage).toBe('bool');
    expect(
        r.backings.some(
            (b) =>
                b.read === child.read &&
                b.replacement === child.replacement &&
                b.access === 'separate-slots',
        ),
    ).toBe(true);
});
it('propagates user returned-lens representations to callers', () => {
    const r = analyze(
        'fn first(~(x, y)) ~x\n{let pair = ((1, 2), 3)\n first(~pair) := true\n pair}',
    );
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]!.result?.kind).toBe('lens');
    const call = r.entries[0]!.calls[0]!;
    expect(call.result).toEqual(r.variants[0]!.result);
});
it('diagnoses recursive changes from thin to scattered arguments', () => {
    expect(() =>
        analyze(
            'fn rec(n, ~(x, y)) (match dup(~n) {0 -> (); _ -> rec(n - 1, ~(x, y))})\n{let pair = (1, 2)\n rec(2, ~pair)}',
        ),
    ).toThrow('Changing representation recursion');
});
