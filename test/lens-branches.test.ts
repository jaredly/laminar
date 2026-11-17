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

const first = 'fn first(~(x, y)) ~x\n';
const samples = [
    {
        name: 'true selection',
        source: 'fn choose(b, ~(x, y)) ~{match b {true -> x; false -> y}}\n{let pair = (1, 2)\n choose(true, ~pair) := 3\n pair}',
        expected: [3, 2],
    },
    {
        name: 'false selection',
        source: 'fn choose(b, ~(x, y)) ~{match b {true -> x; false -> y}}\n{let pair = (1, 2)\n choose(false, ~pair) := 3\n pair}',
        expected: [1, 3],
    },
    {
        name: 'type changing alias',
        source: '{let x = 1\n {let f = ~{match true {true -> x; false -> x}}\n f := (true, 3)}\n x}',
        expected: [true, 3],
    },
    {
        name: 'deferred alias in selected branch',
        source:
            first +
            '{let p = (1, 2)\n {let f = ~{match false {true -> first(~p); false -> {let g = ~first(~p)\n g}}}\n f := true}\n p}',
        expected: [true, 2],
    },
    {
        name: 'branch pattern storage',
        source: '{let f = ~{match (true, 1) {(true, n) -> n; (false, n) -> n}}\n f := true}',
        expected: 1,
    },
    {
        name: 'setup availability join',
        source: '{let x = 1\n let spare = 2\n {let f = ~{match false {true -> {spare\n x}; false -> x}}\n f := true}\n spare := 3\n (x, spare)}',
        expected: [true, 3],
    },
];
for (const sample of samples)
    it(`lens branch: ${sample.name}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(sample.source)));
        verifyTypedProgram(p);
        expect(executeTypedProgram(p)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
    });
for (const [source, code] of [
    [
        '{let x = 1\n let y = 2\n {let f = ~{match true {true -> x; false -> y}}\n f := true}\n ()}',
        'branch-state',
    ],
    [
        '{let x = 1\n {let f = ~{match true {true -> x; false -> x}}\n x}\n ()}',
        'use-while-borrowed',
    ],
    ['{let x = 1\n {let f = ~{match true {true -> x; false -> x}}\n f}\n ()}', 'unrestored-lens'],
    ['fn local(b) ~{match b {true -> {let x = 1\n x}; false -> {let x = 2\n x}}}', 'escaping-lens'],
])
    it(`lens branches reject ${code}`, () => {
        try {
            typedProgram(source);
            throw Error('Expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(TypeDiagnostic);
            expect((e as TypeDiagnostic).code).toBe(code);
        }
    });
it('keeps unsupported branch adapters outside semantic checking', () => {
    const p = typedProgram(samples[0].source);
    try {
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        throw Error('Expected backend restriction');
    } catch (e) {
        expect(e).toBeInstanceOf(BackendDiagnostic);
        expect((e as BackendDiagnostic).code).toBe('unsupported-representation');
        expect((e as Error).message).toBe(
            'Lens-valued branches require a selected-branch restoration adapter',
        );
    }
});

for (const [condition, count] of [
    ['true', 1],
    ['false', 10],
] as const)
    it(`executes only selected setup: ${condition}`, () => {
        const source =
            first +
            `fn counted(~(p, count)) ~{count := count + 1\n first(~p)}\n{let p = (1, 2)\n let count = 0\n {let f = ~{match ${condition} {true -> counted(~(p, count)); false -> {count := count + 10\n first(~p)}}}\n f := true}\n (p, count)}`;
        const p = JSON.parse(JSON.stringify(typedProgram(source)));
        expect(executeTypedProgram(p)).toEqual([[true, 2], count]);
        expect(legacyReference(source)).toEqual([[true, 2], count]);
    });

it('defers selected branch closure disposal until restoration', () => {
    const source =
        '{let x = 1\n {let f = ~{match true {flag -> {let unused = fn (()) flag\n x}}}\n f := true}\n x}';
    const events: string[] = [];
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect(
        executeTypedProgram(p, {
            onStep: (_, op) => {
                if (op === 'swap') events.push('swap');
            },
            onDisposeClosure: () => events.push('dispose'),
        }),
    ).toBe(true);
    expect(events).toEqual(['swap', 'dispose']);
    expect(legacyReference(source)).toBe(true);
});

function lensCase(p: ReturnType<typeof typedProgram>) {
    const visit = (
        b: import('../src/typed-ir.ts').IRBlock,
    ): import('../src/typed-ir.ts').Instruction | undefined => {
        for (const i of b.instructions) {
            if (i.op === 'case' && i.out.type.tag === 'flow') return i;
            if (i.op === 'scope') {
                const found = visit(i.body);
                if (found) return found;
            }
        }
    };
    return visit(p.units.at(-1)!.entry)!;
}

it('independently rejects missing setup normalization and deferred cleanup', () => {
    const availability = JSON.parse(JSON.stringify(typedProgram(samples[5].source)));
    const branch = lensCase(availability);
    if (branch.op !== 'case') throw Error('Missing branch');
    expect(branch.cases[1].setup!.length).toBe(1);
    branch.cases[1].setup = [];
    expect(() => verifyTypedProgram(availability)).toThrow(BackendDiagnostic);

    const owned = JSON.parse(JSON.stringify(typedProgram(samples[4].source)));
    const selected = lensCase(owned);
    if (selected.op !== 'case') throw Error('Missing branch');
    selected.cases[0].body.cleanup = [];
    expect(() => verifyTypedProgram(owned)).toThrow(BackendDiagnostic);
});

it('keeps ordinary unmatched cases trapping and applies the same policy to lens branches', () => {
    const p = typedProgram('{let x = 1\n {let f = ~{match false {true -> x}}\n f := true}\n x}');
    expect(() => executeTypedProgram(JSON.parse(JSON.stringify(p)))).toThrow('No case arm matched');
});

it('joins setup availability independently of the selected runtime branch', () => {
    const source =
        '{let x = 1\n let spare = 2\n {let f = ~{match false {true -> {spare\n x}; false -> x}}\n spare}\n ()}';
    try {
        typedProgram(source);
        throw Error('Expected rejection');
    } catch (e) {
        expect(e).toBeInstanceOf(TypeDiagnostic);
        expect((e as TypeDiagnostic).code).toBe('use-after-move');
    }
});

it('retains storage across nested branch selections', () => {
    const source =
        '{let f = ~{match true {flag -> {match flag {true -> {let n = 1\n n}; false -> {let n = 2\n n}}}}}\n f := true}';
    const p = JSON.parse(JSON.stringify(typedProgram(source)));
    expect(executeTypedProgram(p)).toBe(1);
    expect(legacyReference(source)).toBe(1);
});

it('releases owned legacy branch storage after restoration', () => {
    const source = '{{let f = ~{match true {flag -> {let n = 1\n n}}}\n f := true}\n heapsize()}';
    expect(executeTypedProgram(typedProgram(source))).toBe(0);
    expect(legacyReference(source)).toBe(0);
});

it('retains and independently validates branch restoration states', () => {
    const parsed = grammar.parse<Linear>('FileItem', readLines(samples[2].source).nodes[0]);
    if (parsed.type === 'failure') throw Error('Parse failure');
    const checked = new Checker().check(parsed.value);
    const e = JSON.parse(JSON.stringify(checked.elaboration));
    verifyElaboration(e);
    expect(e.branches[0].restored.length).toBeGreaterThan(0);
    delete e.branches[0].arms[0].restored;
    expect(() => verifyElaboration(e)).toThrow('Lens branch is missing restoration states');
});
