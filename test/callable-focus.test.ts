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
it('independently checks computed callable alias completion', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'computed callable alias cleanup replacement')!
            .source,
    );
    const values = c.analysis.entries[0].values;
    const erase = (b: any) => {
        for (const i of b.instructions) {
            if (i.op === 'manual' || i.op === 'scope') {
                const v = values.find((v: any) => v.value === i.out.id)?.representation;
                if (v?.kind === 'local-focus') v.replacement = structuredClone(v.read);
            }
            if (i.op === 'scope') erase(i.body);
        }
    };
    c.code.forEach((code: any) => erase(code.body));
    expect(() => verifyConcreteProgram(c)).toThrow(
        'Computed callable alias replacement provenance changed',
    );
    expect(() => emitC(c)).toThrow('Computed callable alias replacement provenance changed');
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
it('rejects reordered scattered callable endpoints', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'scattered callable flat swap')!.source,
    );
    const focus = c.analysis.entries[0].values.find(
        (v: any) => v.representation.kind === 'focus-tuple',
    ).representation;
    focus.items.reverse();
    expect(() => verifyConcreteProgram(c)).toThrow('Callable focus tuple children changed');
    expect(() => emitC(c)).toThrow('Callable focus tuple children changed');
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
it('checks forwarded scattered endpoint agreement', () => {
    const c = concrete(
        callableFocusSamples.find(
            (s) => s.name === 'scattered callable forwarded lexical releases',
        )!.source,
    );
    const focus = c.analysis.entries[0].values
        .filter((v: any) => v.representation.kind === 'focus-tuple')
        .at(-1).representation;
    focus.replacement.items[0] = structuredClone(focus.read.items[0]);
    expect(() => verifyConcreteProgram(c)).toThrow('Scope result representation mismatch');
});
it('rejects forged scattered alias completion provenance', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'scattered callable persistent flat alias')!
            .source,
    );
    const focus = c.analysis.entries[0].values.find(
        (v: any) => v.representation.kind === 'focus-tuple',
    ).representation;
    focus.replacement = structuredClone(focus.read);
    expect(() => verifyConcreteProgram(c)).toThrow(
        'Scattered callable alias replacement provenance changed',
    );
    expect(() => emitC(c)).toThrow('Scattered callable alias replacement provenance changed');
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
it('rejects forged callable fst projected read provenance', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'callable fst owned replacement')!.source,
    );
    const focuses = c.analysis.entries[0].values.filter(
        (v: any) => v.representation.kind === 'local-focus',
    );
    focuses.at(-1).representation.read = structuredClone(
        focuses[0].representation.replacement.items[0],
    );
    c.analysis.entries[0].calls.find((call: any) => call.value === focuses.at(-1).value).result =
        structuredClone(focuses.at(-1).representation);
    expect(() => verifyConcreteProgram(c)).toThrow('Callable fst read provenance changed');
    expect(() => emitC(c)).toThrow('Callable fst read provenance changed');
});
it('rejects forged scattered fst selected child', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'callable fst scattered replacement')!.source,
    );
    const call = c.analysis.entries[0].calls.find((v: any) => v.target === 'native/fst');
    const value = c.analysis.entries[0].values.find((v: any) => v.value === call.value);
    value.representation.read = structuredClone(value.representation.replacement);
    call.result = structuredClone(value.representation);
    expect(() => verifyConcreteProgram(c)).toThrow('Scattered fst child provenance changed');
});
it('checks nested fst parent restoration provenance independently', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'callable fst completion nested calls')!.source,
    );
    const root = c.analysis.entries[0].values.find(
        (v: any) => v.representation.kind === 'local-focus',
    ).representation;
    root.replacement = structuredClone(root.read);
    c.analysis.entries[0].calls.find((call: any) => call.target === 'native/fst').arguments[0] =
        structuredClone(root);
    expect(() => verifyConcreteProgram(c)).toThrow(
        'Callable fst parent replacement provenance changed',
    );
    expect(() => emitC(c)).toThrow('Callable fst parent replacement provenance changed');
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
it('rejects forged parent replacement through a returned callable fst frontend', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'callable fst over returned callable lens')!
            .source,
    );
    const call = c.analysis.entries[0].calls.find((call: any) => call.demand);
    expect(call.demand.consumer).toBeString();
    const parent = c.analysis.entries[0].values.find((v: any) => v.value === call.value);
    parent.representation.replacement = structuredClone(parent.representation.read);
    expect(() => verifyConcreteProgram(c)).toThrow('Call result annotation mismatch');
    expect(() => emitC(c)).toThrow('Call result annotation mismatch');
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
for (const mutation of ['read', 'arm', 'result'] as const)
    it(`rejects forged selected callable focus ${mutation}`, () => {
        const c = concrete(
            callableFocusSamples.find((s) => s.name === 'selected callable converts entry tables')!
                .source,
        );
        const join = selectedFocus(c).lensJoin;
        if (mutation === 'read') join.reads[0].to = 'forged-layout';
        if (mutation === 'arm') join.arms.reverse();
        if (mutation === 'result') join.result = 'forged-layout';
        expect(() => verifyConcreteProgram(c)).toThrow(
            'Selected-branch restoration adapter changed',
        );
        expect(() => emitC(c)).toThrow('Selected-branch restoration adapter changed');
    });
it('rejects selected callable completions that write the wrong arm owner', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'selected callable alias true')!.source,
    );
    const selected = c.analysis.entries[0].values.find(
        (v: any) => v.representation.kind === 'local-focus' && v.cleanupJoins,
    );
    expect(selected).toBeDefined();
    selected.cleanupJoins[0].arms.reverse();
    expect(() => verifyConcreteProgram(c)).toThrow('Cleanup storage arm provenance changed');
});
it('rejects callee-selected completions that write the wrong arm owner', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'selected callable result true')!.source,
    );
    const selected = c.analysis.variants
        .flatMap((v: any) => v.values)
        .find((v: any) => v.representation.kind === 'local-focus' && v.cleanupJoins);
    expect(selected).toBeDefined();
    selected.cleanupJoins[0].arms.reverse();
    expect(() => verifyConcreteProgram(c)).toThrow('Cleanup storage arm provenance changed');
});
it('rejects a forged callee-selected result demand', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'selected callable result true')!.source,
    );
    const call = c.analysis.entries[0].calls.find((call: any) => call.demand);
    call.demand.replacement = structuredClone(call.result.read);
    expect(() => verifyConcreteProgram(c)).toThrow('Callable result demand changed');
});
for (const mutation of ['ownership', 'read', 'missing'] as const)
    it(`rejects forged dispatched focus result adapter ${mutation}`, () => {
        const c = concrete(
            callableFocusSamples.find(
                (s) => s.name === 'dispatched callable result converts entry tables',
            )!.source,
        );
        const w = c.wrappers.find(
            (w: any) => w.kind === 'adapt-focus-arguments' && w.result?.read.kind === 'callable',
        );
        expect(w).toBeDefined();
        if (mutation === 'ownership') w.ownership = 'stage-and-convert-replacements';
        if (mutation === 'read') w.result.read.to = 'forged-layout';
        if (mutation === 'missing') delete w.result;
        const message =
            mutation === 'ownership'
                ? 'Invalid focus argument adapter'
                : 'Focus result adapter changed';
        expect(() => verifyConcreteProgram(c)).toThrow(message);
        expect(() => emitC(c)).toThrow(message);
    });
it('rejects dispatched focus results completed on different demands', () => {
    const c = concrete(
        callableFocusSamples.find((s) => s.name === 'dispatched callable result true')!.source,
    );
    const call = c.analysis.entries[0].calls.find((call: any) => call.demand && call.targets);
    call.demand.replacement = structuredClone(call.result.read);
    expect(() => verifyConcreteProgram(c)).toThrow('Callable result demand changed');
});
