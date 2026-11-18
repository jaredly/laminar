import { Checker } from '../src/check.ts';
import { verifyElaboration } from '../src/backend/verify-elaboration.ts';
import { TypeDiagnostic } from '../src/types.ts';
import { aslensSamples } from './backend/aslens-samples.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { specializeProgram } from '../src/specialize.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { verifyRepresentations } from '../src/verify-representations.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { lowerC } from '../src/c/lower.ts';
import { expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Linear } from '../src/ast.ts';
import { linearToExpr } from '../src/decompose.ts';
import { evalExpr, type Ctx } from '../src/eval.ts';
import { typedProgram } from './backend/typed-program.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { legacyReference } from './backend/legacy-reference.ts';

/** Deliberately unchecked: establishes the active pointer path's restoration contract.
 * This is not evidence of checker acceptance or owned-result disposal support. */
function reference(source: string) {
    const events: unknown[] = [];
    const ctx: Ctx = {
        builtins: {
            heapsize: () => Object.keys(ctx.heap.data).length,
            record: (_: Ctx, value: unknown) => {
                events.push(value);
                return null;
            },
            '+': (_: Ctx, a: number, b: number) => a + b,
        },
        scopes: [{ bindings: {} }],
        stack: [{ values: [], id: 'root' }],
        heap: { lid: 0, data: {} },
    };
    let result: unknown;
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<Linear>('Linear', node);
        if (parsed.type === 'failure') throw Error('Invalid aslens audit source');
        const ast = parsed.value;
        const scope = Object.fromEntries(
            Object.keys(ctx.builtins).map((name) => [name, { type: 'builtin' as const }]),
        );
        result = evalExpr(ctx, linearToExpr({ scope, counter: { current: 0 } }, ast));
        if (ast.type === 'fn' && ast.name) ctx.builtins[ast.name] = result;
    }
    expect(ctx.heap.data).toEqual({});
    return { result, events, allocations: ctx.heap.lid };
}

for (const sample of [
    {
        name: 'binds final contents after the consumer finishes',
        source: '{let f = ~{lens v <- 1\n record(v)}\n f := true\n record(2)}',
        result: null,
        events: [2, true],
        allocations: 1,
    },
    {
        name: 'binds tuple patterns to the final type rather than the initial type',
        source: '{let f = ~{lens (a, b) <- 1\n record((a, b))}\n f := (true, 4)}',
        result: 1,
        events: [[true, 4]],
        allocations: 1,
    },
    {
        name: 'consumes temporary contents without refill',
        source: '{let f = ~{lens v <- 1\n record(v)}\n f := 3}',
        result: 1,
        events: [3],
        allocations: 1,
    },
    {
        name: 'allows cleanup to refill a consumed temporary',
        source: '{let f = ~{lens v <- 1\n record(v)\n v := true}\n f := 3}',
        result: 1,
        events: [3],
        allocations: 1,
    },
    {
        name: 'restores an unused focus once',
        source: '{let _ = ~{lens v <- 1\n record(v)}\n record(2)}',
        result: null,
        events: [2, 1],
        allocations: 1,
    },
    {
        name: 'retains backing across a returned lens',
        source: 'fn temp() ~{lens v <- 1\n record(v)}\n {let f = ~temp()\n f := 8}',
        result: 1,
        events: [8],
        allocations: 1,
    },
    {
        name: 'evaluates setup once and cleanup late',
        source: '{let f = ~{lens v <- {record(1)\n 2}\n record(v)}\n record(3)\n f := 4}',
        result: 2,
        events: [1, 3, 4],
        allocations: 1,
    },
    {
        name: 'keeps backing live during cleanup and releases it afterward',
        source: '{let _ = ~{lens v <- heapsize()\n record((v, heapsize()))}\n record(heapsize())}\n heapsize()',
        result: 0,
        events: [1, [0, 1]],
        allocations: 1,
    },
])
    it(`unchecked aslens: ${sample.name}`, () => {
        expect(reference(sample.source)).toEqual({
            result: sample.result,
            events: sample.events,
            allocations: sample.allocations,
        });
    });

it('checks and executes an owned temporary after JSON detachment', () => {
    const source = 'fn temp() ~{lens v <- 1\n v}\n {let f = ~temp()\n f := 8}';
    const artifact = JSON.parse(JSON.stringify(typedProgram(source)));
    expect(executeTypedProgram(artifact)).toBe(1);
    expect(legacyReference(source)).toBe(1);
});

for (const sample of aslensSamples)
    it(`checked aslens: ${sample.name}`, () => {
        const artifact = JSON.parse(JSON.stringify(typedProgram(sample.source)));
        verifyTypedProgram(artifact);
        expect(executeTypedProgram(artifact)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        const specialized = specializeProgram(artifact, wasm32Emscripten('test'), [
            { unit: artifact.units.at(-1)!.id, arguments: [] },
        ]);
        const detached = JSON.parse(JSON.stringify(specialized.program));
        verifyTypedProgram(detached);
        expect(executeTypedProgram(detached)).toEqual(sample.expected);
        const analysis = JSON.parse(JSON.stringify(inferRepresentations(specialized)));
        verifyRepresentations(JSON.parse(JSON.stringify(specialized)), analysis);
        const concrete = compileConcreteProgram(artifact, wasm32Emscripten('test'), [
            { unit: artifact.units.at(-1)!.id, arguments: [] },
        ]);
        verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
        lowerC(concrete);
    });

for (const [source, code, message] of [
    [
        '{let f = ~{lens v <- 1\n (v, v)}\n f := true}',
        'use-after-move',
        'Value has already been consumed',
    ],
    [
        '{let f = ~{lens v <- 1\n ()}\n f}',
        'unrestored-lens',
        'Lens must contain a value at the end of its lifetime',
    ],
    [
        '{let x = 1\n {let f = ~{lens v <- 2\n x := v}\n x}\n ()}',
        'use-while-borrowed',
        'Binding is exclusively borrowed until its aliases leave scope',
    ],
    ['{let f = ~{lens v <- 1\n ()}\n f := true\n v}', 'unbound-name', 'Unbound name v'],
    [
        'fn bad(~x) ~{lens v <- x\n v}',
        'unrestored-lens',
        'Lens must contain a value at the end of its lifetime',
    ],
    [
        '{let x = 1\n let f = fn () ~{lens v <- 2\n x := v}\n ()}',
        'borrowed-capture',
        'Closure cannot borrow outer binding x',
    ],
    [
        '{let x = 1\n {let f = ~{lens v <- 2\n fn () {x := v}}\n f := 3}\n x}',
        'borrowed-capture',
        'Closure cannot borrow outer binding x',
    ],
    ['fn raw() ~{let v = 1\n v}', 'escaping-lens', 'Returned lens must refer to a lens parameter'],
    [
        'fn bad() ~{lens [h, ...t] <- [1]\n h}',
        'unsupported-lens-pattern',
        'Temporary lens cleanup supports identifier, wildcard, and tuple patterns',
    ],
    ['fn bad() ~{lens (v, v) <- (1, 2)\n v}', 'duplicate-pattern', 'Duplicate pattern name v'],
] as const)
    it(`aslens rejects ${code}: ${source}`, () => {
        try {
            typedProgram(source);
            throw Error('Expected ownership rejection');
        } catch (error) {
            expect(error).toBeInstanceOf(TypeDiagnostic);
            expect((error as TypeDiagnostic).code).toBe(code);
            expect((error as Error).message).toBe(message);
        }
    });

it('disposes cleanup results and unused pattern contents exactly once', () => {
    for (const body of ['fn () v', 'let unused = fn () v\n ()', 'let _ = fn () v\n ()']) {
        let disposed = 0;
        const source = `{let f = ~{lens v <- 1\n ${body}}\n f := true}`;
        expect(
            executeTypedProgram(JSON.parse(JSON.stringify(typedProgram(source))), {
                onDisposeClosure: () => disposed++,
            }),
        ).toBe(1);
        expect(disposed).toBe(1);
    }
});

function restoration(p: ReturnType<typeof typedProgram>) {
    const visit = (
        b: import('../src/typed-ir.ts').IRBlock,
    ): Extract<import('../src/typed-ir.ts').Instruction, { op: 'manual' }> | undefined => {
        for (const i of b.instructions) {
            if (i.op === 'manual') return i;
            if (i.op === 'scope') {
                const found = visit(i.body);
                if (found) return found;
            }
        }
    };
    for (const u of p.units) {
        const found = visit(u.entry);
        if (found) return found;
        for (const f of u.functions) {
            const found = visit(f.body);
            if (found) return found;
        }
    }
    throw Error('Missing temporary restoration');
}

it('independently rejects lost temporary backing protection', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(aslensSamples[0].source)));
    restoration(p).holds = [];
    let steps = 0;
    expect(() => executeTypedProgram(p, { onStep: () => steps++ })).toThrow(
        'Manual cleanup dependency protection mismatch',
    );
    expect(steps).toBe(0);
});

it('independently rejects lost cleanup-local disposal', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(aslensSamples[10].source)));
    restoration(p).cleanup.cleanup = [];
    expect(() => verifyTypedProgram(p)).toThrow('Owned scope value has no disposal');
});

it('independently rejects cleanup access to a retired local place', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(aslensSamples[0].source)));
    const m = restoration(p);
    const move = m.cleanup.instructions.find((i) => i.op === 'move')!;
    if (move.op !== 'move') throw Error('Missing cleanup move');
    move.slot.place = 'retired-place';
    expect(() => verifyTypedProgram(p)).toThrow('Manual cleanup dependency protection mismatch');
});

function temporaryElaboration() {
    const parsed = grammar.parse<Linear>(
        'Linear',
        readLines('fn temp() ~{lens v <- 1\n v}').nodes[0],
    );
    if (parsed.type === 'failure') throw Error('Invalid source');
    return JSON.parse(
        JSON.stringify(new Checker().check(parsed.value).elaboration),
    ) as import('../src/elaborated.ts').Elaboration;
}

it('verifies detached temporary elaboration with final-content bindings', () => {
    const e = temporaryElaboration();
    verifyElaboration(e);
    const m = e.manuals[0];
    const backing = e.bindings.find((b) => b.id === m.temporary)!;
    expect(backing.initialType).toEqual({ tag: 'con', name: 'Number', args: [] });
    expect(e.bindings.find((b) => b.name === 'v')!.initialType).toEqual({
        tag: 'variable',
        id: `${e.id}/q0`,
        rigid: false,
    });
});

for (const mutation of ['metadata', 'backing', 'protection', 'staging', 'retirement'] as const)
    it(`rejects corrupted temporary elaboration: ${mutation}`, () => {
        const e = temporaryElaboration();
        if (mutation === 'metadata') e.manuals = [];
        else if (mutation === 'backing') delete e.manuals[0].temporary;
        else if (mutation === 'protection') e.manuals[0].dependencies = [];
        else if (mutation === 'staging') e.manuals[0].staged = [];
        else e.manuals[0].restored = [];
        expect(() => verifyElaboration(e)).toThrow(
            mutation === 'metadata'
                ? 'Missing manual restoration metadata'
                : mutation === 'staging' || mutation === 'retirement'
                  ? 'Invalid temporary lens lifetime phases'
                  : 'Missing temporary lens backing retention',
        );
    });

it('rejects removing temporary retention while returning its raw focus', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(aslensSamples[0].source)));
    const m = restoration(p);
    const visit = (b: import('../src/typed-ir.ts').IRBlock): void => {
        b.instructions = b.instructions.filter((i) => i !== m);
        if (b.result === m.out.id) b.result = m.lens;
        for (const i of b.instructions) if (i.op === 'scope') visit(i.body);
    };
    for (const u of p.units) for (const f of u.functions) visit(f.body);
    expect(() => verifyTypedProgram(p)).toThrow('Lens return escapes owned local storage');
});

it('rejects disposing backing before consumer access', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(aslensSamples[0].source)));
    const m = restoration(p);
    const visit = (b: import('../src/typed-ir.ts').IRBlock): void => {
        const index = b.instructions.indexOf(m);
        if (index >= 0)
            b.instructions.splice(
                index,
                0,
                {
                    op: 'move',
                    origin: m.origin,
                    slot: m.holds[0],
                    out: {
                        id: 'premature-move',
                        type: { tag: 'plain', value: { tag: 'con', name: 'Number', args: [] } },
                    },
                },
                {
                    op: 'bind',
                    origin: m.origin,
                    value: 'premature-move',
                    pattern: { kind: 'drop', type: { tag: 'con', name: 'Number', args: [] } },
                },
            );
        for (const i of b.instructions) if (i.op === 'scope') visit(i.body);
    };
    for (const u of p.units) for (const f of u.functions) visit(f.body);
    expect(() => verifyTypedProgram(p)).toThrow(
        'Type mismatch: ["tuple",[]] versus ["con","Number",[]]',
    );
});

it('disposes residual callable contents and the replaced value once', () => {
    for (const pattern of ['v', '_']) {
        let disposals = 0;
        const source = `{let f = ~{lens ${pattern} <- fn () 1\n ()}\n f := fn () 2\n ()}`;
        expect(
            executeTypedProgram(JSON.parse(JSON.stringify(typedProgram(source))), {
                onDisposeClosure: () => disposals++,
            }),
        ).toBe(null);
        expect(disposals).toBe(2);
    }
});
