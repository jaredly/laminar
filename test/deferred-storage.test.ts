import { printConcreteProgram } from '../src/print-concrete.ts';
import { specializeProgram } from '../src/specialize.ts';
import { expect, it } from 'bun:test';
import { deferredStorageSamples } from './backend/deferred-storage-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of deferredStorageSamples)
    it(sample.name, () => {
        const p = typedProgram(sample.source);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
        const specialized = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        expect(executeTypedProgram(specialized.program)).toEqual(sample.expected);
        const c = JSON.parse(
            JSON.stringify(
                compileConcreteProgram(p, wasm32Emscripten('test'), [
                    { unit: p.units.at(-1)!.id, arguments: [] },
                ]),
            ),
        );
        verifyConcreteProgram(c);
        expect(() => emitC(c)).not.toThrow();
    });
function concrete(
    source = deferredStorageSamples.find((s) => s.name === 'deferred storage consume true')!.source,
) {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
function selectedCase(c: any): any {
    function find(block: any): any {
        for (const i of block.instructions) {
            if (i.storageJoins?.some((j: any) => j.restoration)) return i;
            if (i.op === 'scope') {
                const nested = find(i.body);
                if (nested) return nested;
            }
        }
    }
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
it('retains original invocation slots when the common callable has none', () => {
    const c = concrete();
    const j = selectedCase(c).storageJoins[0];
    expect(c.callables.find((v: any) => v.layout === j.arms[0].to).entries).toHaveLength(0);
    expect(
        c.callables.find((v: any) => v.layout === j.restoration.retained[0]).entries,
    ).toHaveLength(1);
});
for (const mutation of ['missing', 'ownership', 'order', 'layout', 'arms'] as const)
    it(`rejects forged deferred storage retention ${mutation}`, () => {
        const c = concrete();
        const j = selectedCase(c).storageJoins[0];
        const r = j.restoration;
        if (mutation === 'missing') delete j.restoration;
        if (mutation === 'ownership') r.ownership = 'copy';
        if (mutation === 'order') r.order.reverse();
        if (mutation === 'layout') r.retained[0] = j.arms[0].to;
        if (mutation === 'arms') r.retained.reverse();
        expect(() => verifyConcreteProgram(c)).toThrow('Branch storage adapter changed');
        expect(() => emitC(c)).toThrow('Branch storage adapter changed');
    });
for (const mutation of ['missing', 'mode'] as const)
    it(`independently rejects forged deferred storage annotation ${mutation}`, () => {
        const c = concrete();
        const j = c.analysis.entries[0].values.find((v: any) => v.storageJoins).storageJoins[0];
        if (mutation === 'missing') delete j.restoration;
        else j.restoration = 'replace';
        expect(() => verifyConcreteProgram(c)).toThrow(
            'Selected storage restoration contract changed',
        );
    });
it('keeps deferred replacement of divergent storage explicit', () => {
    const source = `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match true {true -> {let old = f := fn () y
 @(x, {let old = f := fn () 9
 old()
 fn () ()})}; false -> x}}
 focus := 2}
 x}`;
    const p = typedProgram(source);
    expect(legacyReference(source)).toEqual(2);
    expect(executeTypedProgram(p)).toEqual(2);
    expect(() =>
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    ).toThrow('Deferred callable storage replacement requires a restoration adapter');
});

for (const mutation of ['missing', 'place', 'before', 'after', 'extra', 'operation'] as const)
    it(`independently rejects forged cleanup storage transition ${mutation}`, () => {
        const c = concrete(deferredStorageSamples[0]!.source);
        const values = c.analysis.entries[0].values;
        const annotation = values.find((v: any) => v.cleanupStorage);
        expect(annotation).toBeDefined();
        const transition = annotation.cleanupStorage[0];
        expect(transition.before).not.toEqual(transition.after);
        if (mutation === 'missing') delete annotation.cleanupStorage;
        if (mutation === 'place') transition.place = 'unknown-place';
        if (mutation === 'before') transition.before = transition.after;
        if (mutation === 'after') transition.after = transition.before;
        if (mutation === 'extra') annotation.cleanupStorage.push(transition);
        if (mutation === 'operation') {
            const other = values.find((v: any) => v !== annotation);
            other.cleanupStorage = annotation.cleanupStorage;
        }
        const diagnostic =
            mutation === 'operation'
                ? 'Unexpected cleanup storage annotation'
                : 'Cleanup storage transitions changed';
        expect(() => verifyConcreteProgram(c)).toThrow(diagnostic);
        expect(() => emitC(c)).toThrow(diagnostic);
    });
it('retains recursive cleanup descriptor endpoints without changing setup provenance', () => {
    const c = concrete(deferredStorageSamples[1]!.source);
    const values = c.analysis.entries[0].values;
    const transitions = values.flatMap((v: any) => v.cleanupStorage ?? []);
    expect(transitions).toHaveLength(1);
    const transition = transitions[0];
    expect(transition.before.kind).toBe('aggregate');
    expect(transition.after.kind).toBe('aggregate');
    expect(transition.before.items[0].kind).toBe('callable');
    expect(transition.after.items[0].kind).toBe('callable');
    expect(transition.before.items[0]).not.toEqual(transition.after.items[0]);
    expect(transition.before.items[1]).toEqual(transition.after.items[1]);
    verifyConcreteProgram(c);
});
it('does not mistake deferred consumption for a descriptor transition', () => {
    const c = concrete();
    expect(c.analysis.entries[0].values.some((v: any) => v.cleanupStorage)).toBe(false);
});
function transitionManual(c: any): any {
    function find(block: any): any {
        for (const i of block.instructions) {
            if (i.op === 'manual' && i.restoration.storageTransitions) return i;
            if (i.op === 'scope') {
                const nested = find(i.body);
                if (nested) return nested;
            }
        }
    }
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
for (const mutation of ['missing', 'place', 'before', 'after', 'ownership', 'extra'] as const)
    it(`rejects forged physical cleanup storage transition ${mutation}`, () => {
        const c = concrete(deferredStorageSamples[0]!.source);
        const manual = transitionManual(c);
        const transition = manual.restoration.storageTransitions[0];
        expect(transition.before).not.toBe(transition.after);
        if (mutation === 'missing') delete manual.restoration.storageTransitions;
        if (mutation === 'place') transition.place = 'unknown-place';
        if (mutation === 'before') transition.before = transition.after;
        if (mutation === 'after') transition.after = transition.before;
        if (mutation === 'ownership') transition.ownership = 'copy';
        if (mutation === 'extra') manual.restoration.storageTransitions.push(transition);
        expect(() => verifyConcreteProgram(c)).toThrow('Manual restoration contract changed');
        expect(() => emitC(c)).toThrow('Manual restoration contract changed');
    });
it('reifies exact aggregate cleanup endpoint layouts and prints ownership', () => {
    const c = concrete(deferredStorageSamples[1]!.source);
    const manual = transitionManual(c);
    const transition = manual.restoration.storageTransitions[0];
    const before = c.layouts.find((l: any) => l.id === transition.before);
    const after = c.layouts.find((l: any) => l.id === transition.after);
    expect(before.kind).toBe('record');
    expect(after.kind).toBe('record');
    expect(before.fields[0].layout).not.toBe(after.fields[0].layout);
    expect(before.fields[1].layout).toBe(after.fields[1].layout);
    expect(transition.ownership).toBe('transfer-cleanup-storage');
    expect(printConcreteProgram(c)).toContain('storage-transitions');
    expect(printConcreteProgram(c)).toContain('transfer-cleanup-storage');
});
it('rejects invented physical transitions on consumption-only cleanup', () => {
    const c = concrete();
    function mutate(block: any): boolean {
        for (const i of block.instructions) {
            if (i.op === 'manual') {
                i.restoration.storageTransitions = [];
                return true;
            }
            if (i.op === 'scope' && mutate(i.body)) return true;
            if (i.op === 'case' && i.cases.some((arm: any) => mutate(arm.body))) return true;
        }
        return false;
    }
    expect(c.code.some((code: any) => mutate(code.body))).toBe(true);
    expect(() => verifyConcreteProgram(c)).toThrow('Manual restoration contract changed');
});
it('independently rejects stale callable provenance after alias release', () => {
    const c = concrete(
        deferredStorageSamples.find((s) => s.name === 'deferred storage continuation true')!.source,
    );
    const values = c.analysis.entries[0].values;
    const transition = values.find((v: any) => v.cleanupStorage).cleanupStorage[0];
    const moved = values.findLast(
        (v: any) => JSON.stringify(v.representation) === JSON.stringify(transition.after),
    );
    expect(moved).toBeDefined();
    moved.representation = transition.before;
    expect(() => verifyConcreteProgram(c)).toThrow('Moved callable provenance changed');
    expect(() => emitC(c)).toThrow('Moved callable provenance changed');
});
