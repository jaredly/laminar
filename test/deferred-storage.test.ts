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
it('normalizes deferred replacement of divergent storage', () => {
    const source = `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match true {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}; false -> x}}
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

it('does not mistake deferred consumption for a descriptor transition', () => {
    const c = concrete();
    expect(c.analysis.entries[0].values.some((v: any) => v.cleanupStorage)).toBe(false);
});
for (const condition of ['true', 'false'])
    it(`normalizes divergent post-cleanup descriptors ${condition}`, () => {
        const source = `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}; false -> x}}
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
it('normalizes distinct cleanup callable provenance with matching result types', () => {
    const source = `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match true {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}};
 false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 8
 old()
 ()}}}}
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
const retainedReplacementSource = (suffix = 'true') =>
    deferredStorageSamples.find((s) => s.name === `deferred retained replacement ${suffix}`)!
        .source;
it('completes callee-local replacement restoration before escape', () => {
    const source = `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}; false -> x}}
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
