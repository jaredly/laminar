import { expect, it } from 'bun:test';
import { callableFocusSamples } from './backend/callable-focus-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
for (const sample of callableFocusSamples)
    it(sample.name, () => {
        const p = typedProgram(sample.source);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
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

function concrete(source = callableFocusSamples[0]!.source) {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
it('rejects a forged callable lens physical pointer', () => {
    const c = concrete();
    const l = c.layouts.find((l: any) => JSON.parse(l.key)[2] === 'lens');
    l.fields[0].kind = 'value';
    expect(() => verifyConcreteProgram(c)).toThrow('Incorrect concrete storage fields');
    expect(() => emitC(c)).toThrow('Incorrect concrete storage fields');
});
for (const source of [
    callableFocusSamples[0]!.source,
    callableFocusSamples.find((s) => s.name === 'callable focus aggregate replacement')!.source,
    callableFocusSamples.find((s) => s.name === 'callable focus insertion from data')!.source,
    callableFocusSamples.find((s) => s.name === 'callable focus extraction to data')!.source,
])
    it('rejects a foreign ordinary lens shape over callable storage', () => {
        const c = concrete(source);
        const annotation = c.analysis.entries[0].values.find(
            (v: any) => v.representation.kind === 'lens',
        );
        annotation.representation = { kind: 'lens', shape: 'erased-callable-endpoints' };
        expect(() => verifyConcreteProgram(c)).toThrow('Missing or foreign lens shape');
        expect(() => emitC(c)).toThrow('Missing or foreign lens shape');
    });

const aliasSource = callableFocusSamples.find(
    (s) => s.name === 'callable alias replacement and owner continuation',
)!.source;
it('keeps persistent aliases exclusive over callable owners', () => {
    expect(() =>
        typedProgram('{let x = 3\n let f = fn () x\n let a = ~f\n f()\n a := fn () 5}'),
    ).toThrow('Binding is exclusively borrowed until its aliases leave scope');
});
it('rejects a projected callable lens with its whole owner shape', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'projected callable swap preserves sibling')!
            .source,
    );
    const focuses = c.analysis.entries[0].values.filter(
        (v: any) => v.representation.kind === 'lens',
    );
    focuses[1].representation.shape = focuses[0].representation.shape;
    expect(() => verifyConcreteProgram(c)).toThrow();
    expect(() => emitC(c)).toThrow();
});
it('keeps computed callable aliases exclusive over frontend owners', () => {
    expect(() =>
        typedProgram(
            '{let v = 3\n let f = fn () v\n let a = ~{{lens finalFocus <- f\nf := finalFocus\n()}}\n f()\n a := fn () 7}',
        ),
    ).toThrow('Binding is exclusively borrowed until its aliases leave scope');
});
it('rejects forged computed callable owner protection', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'computed callable alias temporary replacement')!
            .source,
    );
    const loan = c.semantic.program.units.flatMap((u: any) => u.loans).find((l: any) => l.owners);
    loan.owners = [];
    expect(() => verifyConcreteProgram(c)).toThrow('Computed loan owner protection mismatch');
    expect(() => emitC(c)).toThrow('Computed loan owner protection mismatch');
});
it('rejects forged scattered callable physical fields', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'scattered callable flat swap')!.source,
    );
    const layout = c.layouts.find(
        (v: any) =>
            JSON.parse(v.key)[2] === 'lens' && v.fields.some((f: any) => f.name === 'item0'),
    );
    layout.fields[0].kind = 'pointer';
    expect(() => verifyConcreteProgram(c)).toThrow('Incorrect concrete storage fields');
});
it('rejects a nested scattered callable lens with its child shape', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'scattered callable recursive mixed swap')!
            .source,
    );
    const focuses = c.analysis.entries[0].values.filter(
        (v: any) =>
            v.representation.kind === 'lens' &&
            c.analysis.shapes.find((s: any) => s.id === v.representation.shape)?.kind === 'tuple',
    );
    focuses.at(-1).representation.shape = focuses[0].representation.shape;
    expect(() => verifyConcreteProgram(c)).toThrow();
    expect(() => emitC(c)).toThrow();
});
it('rejects missing scattered alias owner protection', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'scattered callable persistent flat alias')!
            .source,
    );
    const loan = c.semantic.program.units
        .flatMap((u: any) => u.loans)
        .find((l: any) => l.owners?.length === 2);
    loan.owners.pop();
    expect(() => verifyConcreteProgram(c)).toThrow('Computed loan owner protection mismatch');
    expect(() => emitC(c)).toThrow('Computed loan owner protection mismatch');
});
it('keeps scattered callable alias owners exclusive', () => {
    expect(() =>
        typedProgram('{let f = fn () 3\n let n = 4\n let (a, b) = ~(f, n)\n f()\n a := fn () 7}'),
    ).toThrow('Binding is exclusively borrowed until its aliases leave scope');
});
