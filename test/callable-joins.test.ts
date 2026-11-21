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
import type { ConcreteBlock, ConcreteInstruction, ConcreteProgram } from '../src/concrete-ir.ts';
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
    ).toThrow('Representation resource limit');
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
it('reifies registered natives such as round through runtime joins', () => {
    const p = typedProgram('{let f = match false {true -> fn (x) (x + 1); false -> round}\n f(2)}');
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(emitC(c)).toMatch(/\.invoke0=native0[\s\S]*return round_L\d+\(arg0\);/);
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

function instructions(body: ConcreteBlock): ConcreteInstruction[] {
    return body.instructions.flatMap((i) => [
        i,
        ...(i.op === 'scope'
            ? instructions(i.body)
            : i.op === 'manual'
              ? instructions(i.cleanup)
              : i.op === 'case'
                ? i.cases.flatMap((arm) => instructions(arm.body))
                : []),
    ]);
}
it('invokes callable ABI slots without dispatch wrappers or callable joins', () => {
    const c = compile();
    const types = c.callables.filter((r) => r.descriptor.kind === 'callable');
    expect(types.some((r) => r.entries.length > 0)).toBe(true);
    expect(types.every((r) => r.entries.every((e) => e.wrapper === undefined))).toBe(true);
    const calls = c.code
        .flatMap((code) => instructions(code.body))
        .filter((i) => i.op === 'invoke' && i.field !== undefined);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((i) => i.op === 'invoke' && i.wrapper === undefined)).toBe(true);
    expect(
        c.wrappers.every((w) =>
            ['invoke', 'native', 'dispose', 'adapt-lens-result'].includes(w.kind),
        ),
    ).toBe(true);
});
for (const mutation of ['missing', 'abi', 'field', 'wrapper'] as const)
    it(`rejects corrupt callable type ABI slot ${mutation}`, () => {
        const c = compile();
        const record = c.callables.find(
            (r) => r.descriptor.kind === 'callable' && r.entries.length,
        )!;
        if (mutation === 'missing') record.entries.pop();
        if (mutation === 'abi') record.entries[0]!.abi = 'forged';
        if (mutation === 'field') record.entries[0]!.field = 'dispose';
        if (mutation === 'wrapper') record.entries[0]!.wrapper = record.dispose;
        expect(() => verifyConcreteProgram(c)).toThrow();
    });
for (const mutation of ['missing', 'wrapper', 'abi'] as const)
    it(`rejects corrupt callable member entry ${mutation}`, () => {
        const c = compile();
        const record = c.callables.find(
            (r) => r.descriptor.kind === 'closure' && r.entries.length,
        )!;
        if (mutation === 'missing') record.entries.pop();
        if (mutation === 'wrapper') record.entries[0]!.wrapper = record.dispose;
        if (mutation === 'abi') record.entries[0]!.abi = 'forged';
        expect(() => verifyConcreteProgram(c)).toThrow();
    });
for (const mutation of ['wrapper', 'field', 'abi'] as const)
    it(`rejects corrupt indirect callable invocation ${mutation}`, () => {
        const c = compile();
        const call = c.code
            .flatMap((code) => instructions(code.body))
            .find((i) => i.op === 'invoke' && i.field !== undefined)!;
        if (call.op !== 'invoke') throw Error('Missing indirect invocation');
        (call as any)[mutation] = 'forged';
        expect(() => verifyConcreteProgram(c)).toThrow('Concrete invocation target/ABI changed');
    });
it('rejects obsolete callable join metadata on a plain branch move', () => {
    const c = compile();
    const branch = c.code.flatMap((code) => instructions(code.body)).find((i) => i.op === 'case')!;
    (branch as any).callableJoin = { kind: 'erased-environment', arms: [] };
    expect(() => verifyConcreteProgram(c)).toThrow('Obsolete callable join adapter');
});
