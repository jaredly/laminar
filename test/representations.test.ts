import { expect, it } from 'bun:test';
import { LayoutTable } from '../src/layouts.ts';
import { RepresentationTable } from '../src/representations.ts';
import { targetConfig, wasm32Emscripten } from '../src/backend/target.ts';
import { irCon, irUnit, irPlain } from '../src/typed-ir.ts';
import type { SemanticType } from '../src/elaborated.ts';
const native = targetConfig({
    schemaVersion: 1,
    triple: 'x86_64-unknown-linux-gnu',
    pointerBits: 64,
    byteOrder: 'little',
    abi: 'c11',
    toolchain: { compiler: 'clang', version: 'test' },
    runtime: 'native',
    features: [],
});
const num = irCon('Number'),
    bool = irCon('Bool');
const tuple = (...items: SemanticType[]): SemanticType & { tag: 'tuple' } => ({
    tag: 'tuple',
    items,
});
const table = () => new RepresentationTable(new LayoutTable(native));
it('interns detached immutable layouts', () => {
    const l = new LayoutTable(native),
        input = tuple(num, bool),
        id = l.intern(input);
    expect(l.intern(structuredClone(input))).toBe(id);
    input.items.length = 0;
    expect(l.get(id).dependencies).toHaveLength(2);
    expect(Object.isFrozen(l.get(id).type)).toBe(true);
    expect(l.intern(num)).not.toBe(l.intern(bool));
    expect(l.get(l.intern(irUnit())).storage).toBe('unit');
});
it('orders dependencies deterministically', () => {
    const a = new LayoutTable(native),
        b = new LayoutTable(native);
    a.intern(tuple(num, bool));
    a.intern(tuple(bool));
    b.intern(tuple(bool));
    b.intern(tuple(num, bool));
    expect(a.snapshot()).toEqual(b.snapshot());
    const records = a.snapshot();
    records.forEach((r, i) =>
        r.dependencies.forEach((d) => expect(records.findIndex((x) => x.id === d)).toBeLessThan(i)),
    );
});
it('separates targets', () => {
    const a = table(),
        b = new RepresentationTable(new LayoutTable(wasm32Emscripten('test')));
    expect(a.thin(num, bool)).not.toBe(b.thin(num, bool));
});
it('distinguishes thin and scattered shapes and diagnoses joins', () => {
    const r = table(),
        t = tuple(num, bool),
        thin = r.thin(t, t);
    const parts = [r.thin(num, num), r.thin(bool, bool)],
        scattered = r.tuple(parts);
    expect(thin).not.toBe(scattered);
    expect(r.get(thin).read).toBe(r.get(scattered).read);
    expect(r.tuple(parts)).toBe(scattered);
    expect(() => r.join([thin, scattered])).toThrow('representation adapter');
    expect(r.join([thin, thin])).toBe(thin);
});
it('preserves nested mixed shapes through projection', () => {
    const r = table(),
        t = tuple(num, bool),
        thin = r.thin(t, t),
        leaf = r.thin(num, bool);
    const mixed = r.tuple([thin, r.tuple([leaf])]);
    expect(r.project(mixed, 0)).toBe(thin);
    expect(r.project(r.project(mixed, 1), 0)).toBe(leaf);
    expect(r.project(thin, 1)).toBe(r.thin(bool, bool));
    for (const i of [-1, 0.5, 2]) expect(() => r.project(mixed, i)).toThrow('valid tuple');
});
it('retains independent read and replacement backing', () => {
    const r = table();
    for (const [a, b, access] of [
        [num, num, 'same-layout'],
        [num, bool, 'separate-slots'],
        [irUnit(), num, 'separate-slots'],
    ] as const) {
        const shape = r.get(r.thin(a, b));
        if (shape.kind !== 'thin') throw Error('Expected thin');
        expect(r.backing(shape.backing).access).toBe(access);
    }
});
it('rejects unresolved or unsupported storage and foreign references', () => {
    const l = new LayoutTable(native),
        r = table();
    expect(() => l.intern({ tag: 'variable', id: 'solver-local', rigid: false })).toThrow(
        'type variable',
    );
    expect(() => l.intern(irCon('List', num))).toThrow('No storage definition');
    expect(() => l.intern({ tag: 'fn', args: [], result: irPlain(num) })).toThrow(
        'closure representation',
    );
    expect(() => l.get('foreign')).toThrow('Unknown layout');
    expect(() => r.tuple(['foreign'])).toThrow('Unknown lens');
    expect(() => r.join([])).toThrow('Empty');
});
