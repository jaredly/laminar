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
it('keeps computed callable aliases exclusive over frontend owners', () => {
    expect(() =>
        typedProgram(
            '{let v = 3\n let f = fn () v\n let a = ~{@(f, fn () ())}\n f()\n a := fn () 7}',
        ),
    ).toThrow('Binding is exclusively borrowed until its aliases leave scope');
});
it('rejects forged computed callable owner protection', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'computed callable alias manual replacement')!
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
    const layout = c.layouts.find((v: any) => JSON.parse(v.key)[2] === 'focus-tuple');
    layout.fields[0].kind = 'pointer';
    expect(() => verifyConcreteProgram(c)).toThrow('Incorrect concrete storage fields');
});
it('rejects erased nested scattered endpoint reads', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'scattered callable recursive mixed swap')!
            .source,
    );
    const focuses = c.analysis.entries[0].values.filter(
        (v: any) => v.representation.kind === 'focus-tuple',
    );
    focuses.at(-1).representation.read = structuredClone(focuses[0].representation.read);
    expect(() => verifyConcreteProgram(c)).toThrow();
    expect(() => emitC(c)).toThrow();
});
it('rejects forged scattered manual restoration mode', () => {
    const c = concrete(
        callableFocusSamples.find(
            (s) => s.name === 'scattered callable manual wrapper replacement',
        )!.source,
    );
    const m = c.code.map((code: any) => firstManual(code.body)).find(Boolean);
    m.restoration.kind = 'local-focus';
    expect(() => verifyConcreteProgram(c)).toThrow('Manual restoration contract changed');
    expect(() => emitC(c)).toThrow('Manual restoration contract changed');
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
function firstRetainedScope(b: any): any {
    for (const i of b.instructions) {
        if (i.op === 'scope') {
            if (i.retainedStorage) return i;
            const nested = firstRetainedScope(i.body);
            if (nested) return nested;
        }
    }
}
it('rejects missing retained callable scope descriptors', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'private callable backing whole scope')!.source,
    );
    const annotation = c.analysis.entries
        .flatMap((e: any) => e.values)
        .find((v: any) => v.retainedStorage);
    delete annotation.retainedStorage;
    expect(() => verifyConcreteProgram(c)).toThrow('Retained scope storage provenance changed');
    expect(() => emitC(c)).toThrow('Retained scope storage provenance changed');
});
for (const field of ['layout', 'ownership'])
    it(`rejects forged retained callable backing ${field}`, () => {
        const c = concrete(
            callableFocusSamples.find((s) => s.name === 'private callable backing whole scope')!
                .source,
        );
        const scope = c.code.map((code: any) => firstRetainedScope(code.body)).find(Boolean);
        scope.retainedStorage[0][field] = 'forged-retention';
        expect(() => verifyConcreteProgram(c)).toThrow('Retained scope storage contract changed');
        expect(() => emitC(c)).toThrow('Retained scope storage contract changed');
    });
it('rejects missing private scattered owner coverage', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'private scattered backing lexical swap')!
            .source,
    );
    const annotation = c.analysis.entries
        .flatMap((e: any) => e.values)
        .find((v: any) => v.retainedStorage?.length === 2);
    annotation.retainedStorage.pop();
    expect(() => verifyConcreteProgram(c)).toThrow('Retained scope storage provenance changed');
    expect(() => emitC(c)).toThrow('Retained scope storage provenance changed');
});
it('rejects reordered private scattered physical backing', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'private scattered backing lexical swap')!
            .source,
    );
    const collect = (b: any): any => {
        for (const i of b.instructions)
            if (i.op === 'scope') {
                if (i.retainedStorage?.length === 2) return i;
                const child = collect(i.body);
                if (child) return child;
            }
    };
    c.code
        .map((code: any) => collect(code.body))
        .find(Boolean)
        .retainedStorage.reverse();
    expect(() => verifyConcreteProgram(c)).toThrow('Retained scope storage contract changed');
});
function selectedFocus(c: any): any {
    const find = (b: any): any => {
        for (const i of b.instructions) {
            if (i.op === 'case' && i.lensJoin?.kind === 'selected-focus') return i;
            for (const nested of [i.body, ...(i.cases ?? []).map((a: any) => a.body)])
                if (nested) {
                    const found = find(nested);
                    if (found) return found;
                }
        }
    };
    return c.code.map((code: any) => find(code.body)).find(Boolean);
}
