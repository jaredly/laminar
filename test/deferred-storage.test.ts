import { verifyTypedProgram } from '../src/verify-ir.ts';
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
it('normalizes deferred replacement of divergent storage', () => {
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
    ).not.toThrow();
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
for (const name of [
    'deferred scattered continuation true',
    'deferred nested scattered continuation true',
    'deferred scattered aggregate continuation true',
])
    it(`independently rejects stale provenance after ${name}`, () => {
        const c = concrete(deferredStorageSamples.find((s) => s.name === name)!.source);
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
for (const name of [
    'deferred plain call continuation true',
    'deferred returned call continuation true',
    'deferred forwarded call continuation true',
    'deferred returned aggregate call continuation true',
])
    it(`independently rejects stale provenance after ${name}`, () => {
        const c = concrete(deferredStorageSamples.find((s) => s.name === name)!.source);
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
for (const condition of ['true', 'false'])
    it(`normalizes divergent post-cleanup descriptors ${condition}`, () => {
        const source = `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> @(x, {let old = f := replacement
 old()
 fn () ()}); false -> x}}
 focus := true}
 (f(), x)}`;
        const p = typedProgram(source);
        expect(legacyReference(source)).toEqual([condition === 'true' ? 9 : 3, true]);
        expect(executeTypedProgram(p)).toEqual([condition === 'true' ? 9 : 3, true]);
        expect(() =>
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ).not.toThrow();
    });
for (const name of [
    'deferred selected convergent continuation true',
    'deferred selected aggregate continuation true',
    'deferred selected nested continuation true',
])
    it(`independently rejects stale provenance after ${name}`, () => {
        const c = concrete(deferredStorageSamples.find((s) => s.name === name)!.source);
        const values = c.analysis.entries[0].values;
        const transition = values.find((v: any) => v.cleanupStorage).cleanupStorage[0];
        const moved = values.findLast(
            (v: any) => JSON.stringify(v.representation) === JSON.stringify(transition.after),
        );
        moved.representation = transition.before;
        expect(() => verifyConcreteProgram(c)).toThrow('Moved callable provenance changed');
        expect(() => emitC(c)).toThrow('Moved callable provenance changed');
    });
it('normalizes distinct cleanup callable provenance with matching result types', () => {
    const source = `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match true {
 true -> @(x, {let old = f := fn () 9
 old()
 fn () ()});
 false -> @(x, {let old = f := fn () 8
 old()
 fn () ()})}}
 focus := true}
 (f(), x)}`;
    const p = typedProgram(source);
    expect(legacyReference(source)).toEqual([9, true]);
    expect(executeTypedProgram(p)).toEqual([9, true]);
    expect(() =>
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    ).not.toThrow();
});
const postCleanupSource = () =>
    deferredStorageSamples.find((s) => s.name === 'deferred selected divergent continuation true')!
        .source;
function cleanupCase(c: any): any {
    function find(block: any): any {
        for (const i of block.instructions) {
            if (i.cleanupJoins) return i;
            if (i.op === 'scope') {
                const nested = find(i.body);
                if (nested) return nested;
            }
            if (i.op === 'case') {
                const nested = i.cases.map((arm: any) => find(arm.body)).find(Boolean);
                if (nested) return nested;
            }
        }
    }
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
for (const mutation of ['missing', 'place', 'arms', 'result', 'extra'] as const)
    it(`independently rejects forged post-cleanup join ${mutation}`, () => {
        const c = concrete(postCleanupSource());
        const annotation = c.analysis.entries[0].values.find((v: any) => v.cleanupJoins);
        const join = annotation.cleanupJoins[0];
        if (mutation === 'missing') delete annotation.cleanupJoins;
        if (mutation === 'place') join.place = 'unknown-place';
        if (mutation === 'arms') join.arms.reverse();
        if (mutation === 'result') join.result = join.arms[0];
        if (mutation === 'extra') annotation.cleanupJoins.push(join);
        expect(() => verifyConcreteProgram(c)).toThrow();
        expect(() => emitC(c)).toThrow();
    });
for (const mutation of [
    'missing',
    'place',
    'ownership',
    'order',
    'layout',
    'arms',
    'entries',
] as const)
    it(`rejects forged physical post-cleanup adapter ${mutation}`, () => {
        const c = concrete(postCleanupSource());
        const selected = cleanupCase(c);
        const join = selected.cleanupJoins[0];
        if (mutation === 'missing') delete selected.cleanupJoins;
        if (mutation === 'place') join.place = 'unknown-place';
        if (mutation === 'ownership') join.ownership = 'copy';
        if (mutation === 'order') join.order.reverse();
        if (mutation === 'layout') join.arms[0].to = 'forged-layout';
        if (mutation === 'arms') join.arms.reverse();
        if (mutation === 'entries') join.arms[0].entries = [];
        expect(() => verifyConcreteProgram(c)).toThrow('Cleanup storage adapter changed');
        expect(() => emitC(c)).toThrow('Cleanup storage adapter changed');
    });
it('prints post-cleanup joins and verifies adapters without emission', () => {
    const c = concrete(postCleanupSource());
    expect(cleanupCase(c).cleanupJoins[0].order).toEqual(['cleanup', 'normalize', 'merge']);
    expect(printConcreteProgram(c)).toContain('selected-cleanup-storage');
    verifyConcreteProgram(c);
});
it('independently rejects stale provenance after divergent selected cleanup', () => {
    const c = concrete(postCleanupSource());
    const values = c.analysis.entries[0].values;
    const join = values.find((v: any) => v.cleanupJoins).cleanupJoins[0];
    const moved = values.findLast(
        (v: any) => JSON.stringify(v.representation) === JSON.stringify(join.result),
    );
    moved.representation = join.arms[0];
    expect(() => verifyConcreteProgram(c)).toThrow('Moved callable provenance changed');
});
const retainedReplacementSource = (suffix = 'true') =>
    deferredStorageSamples.find((s) => s.name === `deferred retained replacement ${suffix}`)!
        .source;
for (const mutation of ['missing', 'mode'] as const)
    it(`rejects forged retained replacement normalization ${mutation}`, () => {
        const c = concrete(retainedReplacementSource());
        const selected = selectedCase(c);
        const restoration = selected.storageJoins[0].restoration;
        expect(restoration.normalization).toBe('post-cleanup');
        if (mutation === 'missing') delete restoration.normalization;
        else restoration.normalization = 'setup';
        expect(() => verifyConcreteProgram(c)).toThrow('Branch storage adapter changed');
        expect(() => emitC(c)).toThrow('Branch storage adapter changed');
    });
it('rejects consume mode on retained replacement', () => {
    const c = concrete(retainedReplacementSource());
    const annotation = c.analysis.entries[0].values.find((v: any) =>
        v.storageJoins?.some((j: any) => j.restoration === 'replace'),
    );
    annotation.storageJoins[0].restoration = 'consume';
    expect(() => verifyConcreteProgram(c)).toThrow('Selected storage restoration contract changed');
});
it('requires a post-cleanup adapter even when replacement results converge', () => {
    const c = concrete(retainedReplacementSource('convergent true'));
    const annotation = c.analysis.entries[0].values.find((v: any) =>
        v.storageJoins?.some((j: any) => j.restoration === 'replace'),
    );
    expect(annotation.cleanupJoins).toHaveLength(1);
    expect(annotation.cleanupJoins[0].arms[0]).toEqual(annotation.cleanupJoins[0].arms[1]);
    delete annotation.cleanupJoins;
    expect(() => verifyConcreteProgram(c)).toThrow('Cleanup storage join coverage changed');
});
it('retains original cleanup invocation slots through a slot-free replacement join', () => {
    const c = concrete(retainedReplacementSource('unused true'));
    const selected = selectedCase(c);
    const join = selected.storageJoins[0];
    expect(c.callables.find((v: any) => v.layout === join.arms[0].to).entries).toHaveLength(0);
    expect(
        c.callables.find((v: any) => v.layout === join.restoration.retained[0]).entries,
    ).toHaveLength(1);
    verifyConcreteProgram(c);
});
it('completes callee-local replacement restoration before escape', () => {
    const source = `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 @(x, {let old = f := fn () 9
 old()
 fn () ()})}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(true, fn () a, fn () b, ~x) := true
 (old, x)}`;
    const p = typedProgram(source);
    expect(legacyReference(source)).toEqual([1, true]);
    expect(executeTypedProgram(p)).toEqual([1, true]);
    expect(() =>
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    ).not.toThrow();
});
const returnedLocalSource = () =>
    deferredStorageSamples.find((s) => s.name === 'returned local replacement true')!.source;
for (const mutation of ['post-cleanup', 'mode', 'retention'] as const)
    it(`independently rejects forged returned-local restoration ${mutation}`, () => {
        const c = concrete(returnedLocalSource());
        const variant = c.analysis.variants.find((v: any) =>
            v.values.some((a: any) =>
                a.storageJoins?.some((j: any) => j.restoration === 'replace'),
            ),
        );
        expect(variant).toBeDefined();
        const annotation = variant.values.find((v: any) =>
            v.storageJoins?.some((j: any) => j.restoration === 'replace'),
        );
        if (mutation === 'post-cleanup') delete annotation.cleanupJoins;
        if (mutation === 'mode') annotation.storageJoins[0].restoration = 'consume';
        if (mutation === 'retention') selectedCase(c).storageJoins[0].restoration.retained = [];
        expect(() => verifyConcreteProgram(c)).toThrow();
        expect(() => emitC(c)).toThrow();
    });
it('retains original invocation slots in returned local restoration', () => {
    const c = concrete(returnedLocalSource());
    const join = selectedCase(c).storageJoins[0];
    expect(c.callables.find((v: any) => v.layout === join.arms[0].to).entries).toHaveLength(0);
    expect(
        c.callables.find((v: any) => v.layout === join.restoration.retained[0]).entries,
    ).toHaveLength(1);
    expect(selectedCase(c).cleanupJoins).toHaveLength(1);
    verifyConcreteProgram(c);
    expect(() => emitC(c)).not.toThrow();
});
const armLocalAliasSource = () =>
    deferredStorageSamples.find((s) => s.name === 'selected arm local alias true')!.source;
for (const use of ['let stolen = f', 'dup(~x)'])
    it(`protects original owners while selected alias remains live: ${use}`, () => {
        const source = armLocalAliasSource().replace(' focus := true}', ` ${use}\n focus := true}`);
        expect(() => typedProgram(source)).toThrow('exclusively borrowed');
    });
for (const mutation of ['missing', 'forged'] as const)
    it(`independently rejects selected alias protection ${mutation}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(armLocalAliasSource())));
        const loan = p.units.at(-1).loans.at(-1);
        expect(loan.owners).toHaveLength(2);
        if (mutation === 'missing') loan.owners.pop();
        else loan.owners[0].place = 'unknown-place';
        expect(() => verifyTypedProgram(p)).toThrow('Computed loan owner protection mismatch');
    });
it('rejects missing selected alias owner protection before C emission', () => {
    const c = concrete(armLocalAliasSource());
    c.semantic.program.units.at(-1).loans.at(-1).owners.pop();
    expect(() => verifyConcreteProgram(c)).toThrow('Computed loan owner protection mismatch');
    expect(() => emitC(c)).toThrow('Computed loan owner protection mismatch');
});
