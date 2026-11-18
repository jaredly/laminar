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

for (const sample of callableJoinSamples)
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
for (const mutation of ['order', 'duplicate', 'missing', 'target', 'coverage', 'captures'] as const)
    it(`rejects malformed callable-choice analysis: ${mutation}`, () => {
        const c = compile();
        const records = [...c.analysis.entries, ...c.analysis.variants];
        const call = records.flatMap((r) => r.calls).find((call) => call.targets)!;
        const choice = records
            .flatMap((r) => r.values)
            .map((v) => v.representation)
            .find((r) => r.kind === 'callable-choice')!;
        if (choice.kind !== 'callable-choice') throw Error('Missing choice');
        if (mutation === 'order') choice.options.reverse();
        if (mutation === 'duplicate') choice.options.push(choice.options[0]!);
        if (mutation === 'missing') choice.options.pop();
        if (mutation === 'target') call.targets!.reverse();
        if (mutation === 'coverage') call.targets!.pop();
        if (mutation === 'captures') choice.options[0]!.captures = [];
        rejects(
            () => verifyRepresentations(c.semantic, c.analysis),
            'invalid-representation-analysis',
        );
    });
for (const mutation of [
    'entry',
    'environment',
    'ownership',
    'target',
    'coverage',
    'adapter',
] as const)
    it(`rejects malformed callable join adapter: ${mutation}`, () => {
        const c = compile();
        const join = joins(c)[0]!;
        const callable = c.callables.find((callable) => callable.id === join.callableJoin!.result)!;
        const dispatch = c.wrappers.find((w) => w.kind === 'dispatch')!;
        if (dispatch.kind !== 'dispatch') throw Error('Missing dispatch');
        if (mutation === 'entry') join.callableJoin!.arms[0]!.entries[0]!.source = 'dispose';
        if (mutation === 'environment')
            c.layouts.find((l) => l.id === callable.layout)!.fields[0] = {
                name: 'environment',
                kind: 'pointer',
                layout: callable.environment,
            };
        if (mutation === 'ownership') (dispatch as any).ownership = 'no-environment';
        if (mutation === 'target') dispatch.targets[0]!.wrapper = callable.dispose;
        if (mutation === 'coverage') dispatch.targets.pop();
        if (mutation === 'adapter') delete join.callableJoin;
        rejects(() => emitC(c), 'invalid-concrete-ir');
    });
it('keeps incompatible dynamic result representations explicit', () => {
    expect(() =>
        compile(
            '{let f = match true {true -> fn () {fn (x) x}; false -> fn () {fn (x) x}}\n let g = f()\n g(1)}',
        ),
    ).toThrow('Dynamic callable results require a common representation');
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

it('prints the erased environment and typed dispatch adapters', () => {
    const p = typedProgram(callableJoinSamples[0]!.source);
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    const printed = printConcreteProgram(c);
    expect(printed).toContain('selected-callable');
    expect(printed).toContain('dispatch');
    expect(printed).toContain('selected-environment');
    const choice = c.callables.find((c) => c.descriptor.kind === 'callable-choice')!;
    expect(c.layouts.find((l) => l.id === choice.layout)!.fields[0]).toEqual({
        name: 'environment',
        kind: 'pointer',
    });
});

it('retains both concrete lens ABIs on one joined callable', () => {
    const p = typedProgram(callableJoinSamples.at(-1)!.source);
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    const choices = c.callables.filter((c) => c.descriptor.kind === 'callable-choice');
    expect(choices).toHaveLength(1);
    expect(choices[0]!.entries).toHaveLength(2);
    expect(new Set(choices[0]!.entries.map((e) => e.abi)).size).toBe(2);
});
