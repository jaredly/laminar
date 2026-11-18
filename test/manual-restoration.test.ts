import { printConcreteProgram } from '../src/print-concrete.ts';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Linear } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import { verifyElaboration } from '../src/backend/verify-elaboration.ts';
import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { TypeDiagnostic } from '../src/types.ts';
import { BackendDiagnostic, wasm32Emscripten } from '../src/backend/target.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { manualRestorationSamples as samples } from './backend/manual-restoration-samples.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { verifyRepresentations } from '../src/verify-representations.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { lowerC } from '../src/c/lower.ts';

for (const sample of samples)
    it(`manual restoration: ${sample.name}`, () => {
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
    });
for (const [source, code] of [
    [
        '{let x = 1\n let resource = 2\n {let f = ~{@(x, fn () resource)}\n resource}\n ()}',
        'use-while-borrowed',
    ],
    ['{let x = 1\n {let f = ~{@(x, fn () ())}\n f}\n ()}', 'unrestored-lens'],
    ['{let x = 1\n let f = fn () {x := 2}\n f()}', 'borrowed-capture'],
    ['fn bad(~x) ~{@(x, fn () x)}', 'unrestored-lens'],
    ['fn bad(~x) ~{@(x, round)}', 'arity-mismatch'],
    ['fn raw() ~{let v = 1\n v}', 'escaping-lens'],
    ['fn bad(~x) ~{@(x, fn () {fn () {x := 3}})}', 'borrowed-capture'],
    [
        'fn first(~(x, y)) ~x\n{let p = (1, 2)\n {let f = ~{@(first(~p), fn () p)}\n f := 3}\n ()}',
        'use-while-borrowed',
    ],
])
    it(`manual cleanup rejects ${code}`, () => {
        try {
            typedProgram(source);
            throw Error('Expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
        }
    });
it('evaluates the cleanup expression and its result only at restoration', () => {
    const source =
        '{let x = 1\n let count = 0\n {let f = ~{@(x, {count := count + 1\n fn () ()})}\n f := true}\n (x, count)}';
    const events: string[] = [];
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect(
        executeTypedProgram(p, {
            onStep: (_, op) => {
                if (['manual', 'swap', 'closure'].includes(op)) events.push(op);
            },
        }),
    ).toEqual([true, 1]);
    expect(events).toEqual(['manual', 'swap', 'swap', 'closure']);
    expect(legacyReference(source)).toEqual([true, 1]);
});

it('disposes owned cleanup results and captured resources once', () => {
    const source =
        '{let x = 1\n let resource = 2\n {let f = ~{@(x, fn () {let owned = fn () resource\n owned})}\n f := true}\n x}';
    let disposals = 0;
    expect(
        executeTypedProgram(JSON.parse(JSON.stringify(typedProgram(source))), {
            onDisposeClosure: () => disposals++,
        }),
    ).toBe(true);
    expect(disposals).toBe(1);
    expect(legacyReference(source)).toBe(true);
});

function manual(p: ReturnType<typeof typedProgram>) {
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
        for (const f of u.functions) {
            const found = visit(f.body);
            if (found) return found;
        }
        const found = visit(u.entry);
        if (found) return found;
    }
    throw Error('Missing manual restoration');
}

it('independently rejects missing dependency protection before running effects', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(samples[1].source)));
    manual(p).holds = [];
    let steps = 0;
    expect(() => executeTypedProgram(p, { onStep: () => steps++ })).toThrow(
        'Manual cleanup dependency protection mismatch',
    );
    expect(steps).toBe(0);
});

it('independently rejects removed restoration effects', () => {
    const p = JSON.parse(JSON.stringify(typedProgram(samples[1].source)));
    const m = manual(p);
    m.holds = [];
    m.cleanup = {
        origin: m.origin,
        instructions: [
            {
                op: 'constant',
                origin: m.origin,
                value: null,
                out: {
                    id: 'removed-cleanup',
                    type: { tag: 'plain', value: { tag: 'tuple', items: [] } },
                },
            },
        ],
        result: 'removed-cleanup',
        cleanup: [],
    };
    expect(() => verifyTypedProgram(p)).toThrow(BackendDiagnostic);
});

it('restores unused and duplicated manual focuses once', () => {
    for (const [body, expected] of [
        ['{let _ = ~{@(x, fn () {count := count + 1})}\n ()}\n (x, count)', [1, 1]],
        ['let copied = dup(~{@(x, fn () {count := count + 1})})\n (copied, x, count)', [1, 1, 1]],
    ] as const) {
        const source = `{let x = 1\n let count = 0\n ${body}}`;
        expect(executeTypedProgram(JSON.parse(JSON.stringify(typedProgram(source))))).toEqual([
            ...expected,
        ]);
        expect(legacyReference(source)).toEqual(expected);
    }
});

it('retains and independently validates restoration-time metadata', () => {
    const parsed = grammar.parse<Linear>('FileItem', readLines(samples[0].source).nodes[0]);
    if (parsed.type === 'failure') throw Error('Parse failure');
    const original = new Checker().check(parsed.value).elaboration;
    verifyElaboration(JSON.parse(JSON.stringify(original)));
    const missing = JSON.parse(JSON.stringify(original));
    missing.manuals = [];
    expect(() => verifyElaboration(missing)).toThrow('Missing manual restoration metadata');
    const phase = JSON.parse(JSON.stringify(original));
    delete phase.manuals[0].cleaned;
    expect(() => verifyElaboration(phase)).toThrow('Missing manual restoration phase');
});

for (const corruption of ['temporary', 'call', 'provenance'] as const)
    it(`rejects corrupted deferred-cleanup ${corruption} annotations`, () => {
        const p = typedProgram(
            samples.find((s) => s.name === 'cleanup calls reusable definition')!.source,
        );
        const source = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        const analysis = JSON.parse(JSON.stringify(inferRepresentations(source)));
        const cleanup = manual(source.program).cleanup;
        const call = cleanup.instructions.find((i) => i.op === 'call');
        if (!call || call.op !== 'call') throw Error('Missing deferred call');
        const record = [...analysis.entries, ...analysis.variants].find((r) =>
            r.calls.some((c: { value: string }) => c.value === call.out.id),
        );
        if (!record) throw Error('Missing deferred call record');
        if (corruption === 'temporary')
            record.values = record.values.filter((v: { value: string }) => v.value !== call.callee);
        else if (corruption === 'call')
            record.calls = record.calls.filter((c: { value: string }) => c.value !== call.out.id);
        else
            record.values.find((v: { value: string }) => v.value === call.callee).representation = {
                kind: 'native',
                definition: source.program.imports[0]!.definition,
            };
        expect(() => verifyRepresentations(JSON.parse(JSON.stringify(source)), analysis)).toThrow(
            corruption === 'temporary'
                ? 'Missing temporary annotation'
                : corruption === 'call'
                  ? 'Missing call annotation'
                  : 'Global callable provenance changed',
        );
    });

it('keeps callable focus replacement explicit at the representation boundary', () => {
    const p = typedProgram('{let x = 1\n {let f = ~{@(x, fn () {x()})}\n f := fn () 2}\n ()}');
    expect(executeTypedProgram(JSON.parse(JSON.stringify(p)))).toBe(null);
    const source = specializeProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(() => inferRepresentations(source)).toThrow(
        'Callable focuses require a direct whole-owned-local swap',
    );
});

function concreteManual(p: import('../src/concrete-ir.ts').ConcreteProgram) {
    const visit = (
        b: import('../src/concrete-ir.ts').ConcreteBlock,
    ):
        | Extract<import('../src/concrete-ir.ts').ConcreteInstruction, { op: 'manual' }>
        | undefined => {
        for (const i of b.instructions) {
            if (i.op === 'manual') return i;
            if (i.op === 'scope') {
                const found = visit(i.body);
                if (found) return found;
            }
            if (i.op === 'case')
                for (const arm of i.cases) {
                    const found = visit(arm.body);
                    if (found) return found;
                }
        }
    };
    for (const code of p.code) {
        const found = visit(code.body);
        if (found) return found;
    }
    throw Error('Missing concrete manual');
}

for (const corruption of [
    'cleanup',
    'dependency',
    'frontend',
    'result',
    'order',
    'retention',
    'invoke',
] as const)
    it(`independently rejects corrupted concrete manual ${corruption}`, () => {
        const p = typedProgram(samples[1]!.source);
        const concrete = JSON.parse(
            JSON.stringify(
                compileConcreteProgram(p, wasm32Emscripten('test'), [
                    { unit: p.units.at(-1)!.id, arguments: [] },
                ]),
            ),
        );
        const m = concreteManual(concrete);
        if (corruption === 'cleanup') delete (m as Partial<typeof m>).cleanup;
        if (corruption === 'dependency') m.holds = [];
        if (corruption === 'frontend') m.restoration.frontend = 'lost-frontend';
        if (corruption === 'result') m.restoration.result = 'lost-focus';
        if (corruption === 'order') m.restoration.order.reverse();
        if (corruption === 'retention')
            (m.restoration as { retention: string }).retention = 'setup-only';
        if (corruption === 'invoke') {
            const call = m.cleanup.instructions.find((i) => i.op === 'invoke');
            if (!call || call.op !== 'invoke') throw Error('Missing cleanup invocation');
            call.wrapper = 'lost-wrapper';
        }
        expect(() => verifyConcreteProgram(concrete)).toThrow(
            corruption === 'cleanup'
                ? 'Missing manual cleanup block'
                : corruption === 'invoke'
                  ? 'Concrete invocation target/ABI changed'
                  : 'Manual restoration contract changed',
        );
    });

it('prints the complete concrete deferred-cleanup contract', () => {
    const p = typedProgram('{let x = 1\n @(x, fn () ()) := 2\n x}');
    const concrete = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(printConcreteProgram(concrete)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2)
          abis (abi0, abi1)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = f64
          L2 = record thin {
              read: ptr<L1>
              restore: code<abi0>
              context: ptr<void>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L0
          abi1 = (env: ptr<void>) -> L1
      }
      wrappers {}
      callables {}
      fn entry0() : abi1 env L0 {
          %0: L1 = 1
          %1: L1 = scope {
              bind $x = %0
              %2: L2 = acquire $x
              %3: L2 = manual %2 holds () order (stage, cleanup, dispose-result, restore, release) retain through-enclosing-cleanup deferred {
                  %4: L0 = ()
                  return %4 : L0
              }
              %5: L1 = 2
              %6: L1 = swap(%3, %5)
              %7: L1 = scope {
                  bind _ = %6
                  %8: L1 = move $x
                  return %8 : L1
              }
              return %7 : L1
              cleanup {drop $x}
          }
          return %1 : L1
      }"
    `);
});

it('lowers captured generic cleanup invocation through the C callable boundary', () => {
    const p = typedProgram(
        '{let x = 1\n let resource = 2\n let cleanup = fn () resource\n {let f = ~{@(x, cleanup)}\n f := true}\n x}',
    );
    expect(executeTypedProgram(JSON.parse(JSON.stringify(p)))).toBe(true);
    const concrete = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(() => lowerC(JSON.parse(JSON.stringify(concrete)))).not.toThrow();
});
