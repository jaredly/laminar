import { lensResultSamples } from './backend/lens-result-samples.ts';
import { callableResultSamples } from './backend/callable-result-samples.ts';
import { nativeJoinSamples } from './backend/native-join-samples.ts';
import { expect, it } from 'bun:test';
import { callableJoinSamples } from './backend/callable-join-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { BackendDiagnostic } from '../src/backend/target.ts';
import type { ConcreteBlock, ConcreteProgram } from '../src/concrete-ir.ts';
import { verifyRepresentations } from '../src/verify-representations.ts';
import { printConcreteProgram } from '../src/print-concrete.ts';
import { emitC } from '../src/c/emit.ts';

for (const sample of [
    ...callableJoinSamples,
    ...nativeJoinSamples,
    ...callableResultSamples,
    ...lensResultSamples,
])
    it(`normalizes callable joins: ${sample.name}`, () => {
        const p = typedProgram(sample.source);
        expect<unknown>(executeTypedProgram(p)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
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

function compile(source = callableJoinSamples[0]!.source): ConcreteProgram {
    const p = typedProgram(source);
    return JSON.parse(
        JSON.stringify(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        ),
    );
}
function joins(c: ConcreteProgram) {
    const cases: Extract<ConcreteBlock['instructions'][number], { op: 'case' }>[] = [];
    const walk = (body: ConcreteBlock) => {
        for (const i of body.instructions) {
            if (i.op === 'scope') walk(i.body);
            if (i.op === 'manual') walk(i.cleanup);
            if (i.op === 'case') {
                if (i.callableJoin) cases.push(i);
                i.cases.forEach((arm) => walk(arm.body));
            }
        }
    };
    c.code.forEach((code) => walk(code.body));
    return cases;
}
function rejects(action: () => void, code: string) {
    try {
        action();
        throw Error('Verifier accepted malformed join');
    } catch (e) {
        expect(e).toBeInstanceOf(BackendDiagnostic);
        expect((e as BackendDiagnostic).code).toBe(code);
    }
}
it('normalizes differing callable result representations', () => {
    expect(() =>
        compile(
            '{let f = match true {true -> fn () {fn (x) x}; false -> fn () {fn (x) x}}\n let g = f()\n g(1)}',
        ),
    ).not.toThrow();
});
it('requires a host adapter for dynamic callable entry roots', () => {
    expect(() => compile('match true {true -> fn (()) 1; false -> fn (()) 2}')).toThrow(
        'Dynamic callable entry roots require a host adapter',
    );
});
it('counts every reachable alternative against the representation budget', () => {
    const p = typedProgram(callableJoinSamples[0]!.source);
    expect(() =>
        compileConcreteProgram(
            p,
            wasm32Emscripten('test'),
            [{ unit: p.units.at(-1)!.id, arguments: [] }],
            { maxVariants: 1 },
        ),
    ).toThrow('Representation budget');
});

it('gives a callable type one entry per call ABI', () => {
    const p = typedProgram(callableJoinSamples.at(-1)!.source);
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    const types = c.callables.filter(
        (c) => c.descriptor.kind === 'callable' && c.entries.length === 2,
    );
    expect(types).toHaveLength(1);
    expect(new Set(types[0]!.entries.map((e) => e.abi)).size).toBe(2);
});

for (const mutation of ['target', 'import', 'ownership', 'abi'] as const)
    it(`rejects corrupt native join ${mutation}`, () => {
        const p = typedProgram(nativeJoinSamples[0]!.source);
        const c = structuredClone(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        );
        if (mutation === 'target') {
            const call = [...c.analysis.entries, ...c.analysis.variants]
                .flatMap((r) => r.calls)
                .find((call) => call.targets?.includes('native/dup'))!;
            call.targets![call.targets!.indexOf('native/dup')] = 'native/round';
        }
        if (mutation === 'import') {
            const member = c.callables.find((c) => c.descriptor.kind === 'native')!.descriptor;
            if (member.kind !== 'native') throw Error('Expected native member');
            member.definition = 'native/forged';
        }
        if (mutation === 'ownership')
            (
                c.wrappers.find((w) => w.kind === 'native' && w.definition === 'native/dup') as any
            ).ownership = 'transfer-captures-and-free';
        if (mutation === 'abi')
            c.wrappers.find((w) => w.kind === 'native' && w.definition === 'native/dup')!.abi =
                'forged';
        expect(() => emitC(c)).toThrow();
    });
it('keeps unsupported native imports explicit through runtime joins', () => {
    const p = typedProgram('{let f = match false {true -> fn (x) (x + 1); false -> round}\n f(2)}');
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(() => emitC(c)).toThrow('Native import native/round');
});

it('normalizes differing dynamic lens result shapes', () => {
    const p = typedProgram(
        '{let f = match true {true -> fn (~p) ~p; false -> fn (~(x, y)) ~(x, y)}\n let p = (1, 2)\n f(~p) := (true, 3)\n p}',
    );
    expect(() =>
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    ).not.toThrow();
});
it('gives a dynamic lens-returning callable type both lens ABIs', () => {
    const p = typedProgram(
        callableResultSamples.find((s) => s.name === 'dynamic callable result with both lens ABIs')!
            .source,
    );
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(
        c.callables.some((c) => c.descriptor.kind === 'callable' && c.entries.length === 2),
    ).toBe(true);
});
for (const mutation of ['source', 'from', 'to', 'ownership', 'order', 'abi'] as const)
    it(`rejects corrupt lens result adapter ${mutation}`, () => {
        const p = typedProgram(lensResultSamples[0]!.source);
        const c = structuredClone(
            compileConcreteProgram(p, wasm32Emscripten('test'), [
                { unit: p.units.at(-1)!.id, arguments: [] },
            ]),
        );
        const w = c.wrappers.find((w) => w.kind === 'adapt-lens-result')!;
        if (w.kind !== 'adapt-lens-result') throw Error('Expected lens result adapter');
        if (mutation === 'source') w.source = c.wrappers.find((w) => w.kind === 'dispose')!.id;
        if (mutation === 'from') w.from = w.to;
        if (mutation === 'to') w.to = w.from;
        if (mutation === 'ownership') (w as any).ownership = 'transfer-result';
        if (mutation === 'order') (w as any).order = ['release', 'restore-source'];
        if (mutation === 'abi') w.abi = 'forged';
        expect(() => emitC(c)).toThrow();
    });
it('prints lens result restoration and release adapters', () => {
    const p = typedProgram(lensResultSamples[0]!.source);
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(printConcreteProgram(c)).toContain('adapt-lens-result');
    expect(printConcreteProgram(c)).toContain('restore-source-and-release');
});
it('rejects an analysis which keeps one dynamic result topology', () => {
    const p = typedProgram(lensResultSamples[0]!.source);
    const c = structuredClone(
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    );
    const call = c.analysis.entries
        .flatMap((e) => e.calls)
        .find((call) => call.targets && call.result.kind === 'lens')!;
    const raw = call
        .targets!.map((id) => c.analysis.variants.find((v) => v.id === id)!.result)
        .find(
            (r) =>
                r.kind === 'lens' &&
                c.analysis.shapes.find((s) => s.id === r.shape)!.kind === 'tuple',
        )!;
    call.result = raw;
    const value = c.analysis.entries.flatMap((e) => e.values).find((v) => v.value === call.value)!;
    value.representation = raw;
    expect(() => verifyRepresentations(c.semantic, c.analysis)).toThrow(
        'Dynamic lens adapter must expose a thin focus',
    );
});
