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
for (const endpoint of ['read', 'replacement'] as const)
    it(`rejects forged local focus ${endpoint} provenance`, () => {
        const c = concrete();
        const focus = c.analysis.entries[0].values.find(
            (v: any) => v.representation.kind === 'local-focus',
        ).representation;
        focus[endpoint] = focus[endpoint === 'read' ? 'replacement' : 'read'];
        expect(() => verifyConcreteProgram(c)).toThrow(
            endpoint === 'read'
                ? 'Callable focus read provenance changed'
                : 'Callable swap replacement provenance changed',
        );
    });
it('rejects a forged local focus physical pointer', () => {
    const c = concrete();
    const l = c.layouts.find((l: any) => JSON.parse(l.key)[2] === 'local-focus');
    l.fields[0].layout = l.fields[1].layout;
    expect(() => verifyConcreteProgram(c)).toThrow('Incorrect concrete storage fields');
    expect(() => emitC(c)).toThrow('Incorrect concrete storage fields');
});
it('independently rejects a forged convergent branch continuation', () => {
    const c = concrete(
        callableFocusSamples.find(
            (s) => s.name === 'callable focus convergent branch callable true',
        )!.source,
    );
    const values = c.analysis.entries[0].values;
    const moved = values.filter((v: any) => v.representation.kind === 'callable');
    // The final move must retain the descriptor installed by both arms, not
    // a same-type callable descriptor forged from a different provenance.
    const last = moved.at(-1);
    last.representation = { ...last.representation, captures: [] };
    expect(() => verifyConcreteProgram(c)).toThrow();
    expect(() => emitC(c)).toThrow();
});

for (const source of [
    callableFocusSamples[0]!.source,
    callableFocusSamples.find((s) => s.name === 'callable focus aggregate replacement')!.source,
    callableFocusSamples.find((s) => s.name === 'callable focus insertion from data')!.source,
    callableFocusSamples.find((s) => s.name === 'callable focus extraction to data')!.source,
])
    it('rejects erased callable endpoint provenance before consulting a semantic shape', () => {
        const c = concrete(source);
        const annotation = c.analysis.entries[0].values.find(
            (v: any) => v.representation.kind === 'local-focus',
        );
        annotation.representation = { kind: 'lens', shape: 'erased-callable-endpoints' };
        expect(() => verifyConcreteProgram(c)).toThrow(
            'Callable lens endpoints require explicit focus provenance',
        );
        expect(() => emitC(c)).toThrow('Callable lens endpoints require explicit focus provenance');
    });

const aliasSource = callableFocusSamples.find(
    (s) => s.name === 'callable alias replacement and owner continuation',
)!.source;
it('independently checks the final persistent alias replacement at release', () => {
    const c = concrete(aliasSource);
    const focus = c.analysis.entries[0].values.find(
        (v: any) => v.representation.kind === 'local-focus',
    ).representation;
    focus.replacement = structuredClone(focus.read);
    expect(() => verifyConcreteProgram(c)).toThrow(
        'Callable alias final replacement provenance changed',
    );
    expect(() => emitC(c)).toThrow('Callable alias final replacement provenance changed');
});
it('independently checks an alias swap against the current owner', () => {
    const c = concrete(aliasSource);
    const focuses = c.analysis.entries[0].values.filter(
        (v: any) => v.representation.kind === 'local-focus',
    );
    focuses[1].representation.read = structuredClone(focuses[0].representation.replacement);
    expect(() => verifyConcreteProgram(c)).toThrow('Callable focus read provenance changed');
});
it('independently checks the owner continuation after alias release', () => {
    const c = concrete(aliasSource);
    const values = c.analysis.entries[0].values;
    const initial = values.find((v: any) => v.representation.kind === 'local-focus').representation
        .read;
    values.filter((v: any) => v.representation.kind === 'callable').at(-1).representation =
        structuredClone(initial);
    expect(() => verifyConcreteProgram(c)).toThrow('Moved callable provenance changed');
});

for (const [name, source] of [
    [
        'manual endpoint',
        '{let x = 3\n let f = fn () x\n let a = ~{@(f, fn () ())}\n let old = a := fn () 5\n old()}',
    ],
])
    it(`keeps the callable ${name} adapter explicit`, () => {
        const p = typedProgram(source);
        expect(() =>
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ).toThrow('Callable aliases require a direct owned-local loan');
    });
it('keeps persistent aliases exclusive over callable owners', () => {
    expect(() =>
        typedProgram('{let x = 3\n let f = fn () x\n let a = ~f\n f()\n a := fn () 5}'),
    ).toThrow('Binding is exclusively borrowed until its aliases leave scope');
});
it('rejects projected callable read provenance from the whole owner', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'projected callable swap preserves sibling')!
            .source,
    );
    const focuses = c.analysis.entries[0].values.filter(
        (v: any) => v.representation.kind === 'local-focus',
    );
    focuses[1].representation.read = structuredClone(focuses[0].representation.read);
    expect(() => verifyConcreteProgram(c)).toThrow();
    expect(() => emitC(c)).toThrow();
});
it('checks projected subloan final provenance independently', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'projected callable loan nested replacement')!
            .source,
    );
    const focus = c.analysis.entries[0].values.filter(
        (v: any) => v.representation.kind === 'local-focus',
    )[1].representation;
    focus.replacement = structuredClone(focus.read);
    expect(() => verifyConcreteProgram(c)).toThrow(
        'Callable alias final replacement provenance changed',
    );
    expect(() => emitC(c)).toThrow('Callable alias final replacement provenance changed');
});
function firstManual(block: any): any {
    for (const i of block.instructions) {
        if (i.op === 'manual') return i;
        if (i.op === 'scope') {
            const found = firstManual(i.body);
            if (found) return found;
        }
    }
}
for (const field of ['frontend', 'result', 'kind', 'order'] as const)
    it(`rejects a forged manual callable physical ${field}`, () => {
        const c = concrete(
            callableFocusSamples.find((s) => s.name === 'manual callable swap cleanup replacement')!
                .source,
        );
        const m = c.code.map((code: any) => firstManual(code.body)).find(Boolean);
        if (field === 'order') m.restoration.order.reverse();
        else m.restoration[field] = 'forged-endpoint-contract';
        expect(() => verifyConcreteProgram(c)).toThrow('Manual restoration contract changed');
        expect(() => emitC(c)).toThrow('Manual restoration contract changed');
    });
it('independently checks manual callable read provenance', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'manual callable swap cleanup replacement')!
            .source,
    );
    const m = c.code.map((code: any) => firstManual(code.body)).find(Boolean);
    const v = c.analysis.entries[0].values.find((v: any) => v.value === m.out.id).representation;
    v.read = structuredClone(v.replacement);
    expect(() => verifyConcreteProgram(c)).toThrow('Manual callable read provenance changed');
});
it('independently checks forwarded callable endpoint agreement', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'forwarded callable focus lexical swap')!
            .source,
    );
    const focus = c.analysis.entries[0].values
        .filter((v: any) => v.representation.kind === 'local-focus')
        .at(-1).representation;
    focus.replacement = structuredClone(focus.read);
    expect(() => verifyConcreteProgram(c)).toThrow('Scope result representation mismatch');
    expect(() => emitC(c)).toThrow('Scope result representation mismatch');
});
it('keeps escaping private callable backing explicit', () => {
    const p = typedProgram(
        'fn make() {fn () 3}\n{let old = {let f = make()\n f} := fn () 7\n old()}',
    );
    expect(() =>
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    ).toThrow('Escaping callable focus requires retained local backing');
});
