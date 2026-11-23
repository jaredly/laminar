import { describe, expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import type { IRBlock, Instruction } from '../src/typed-ir.ts';
import { specializeProgram } from '../src/specialize.ts';
import { inferRepresentations } from '../src/infer-representations.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';

// Step 4 of docs/scattered-constructor-lenses.md: constructor lenses lower to typed IR
// (`lens-construct`), the reference evaluator runs them, and the independent verifier
// checks them. Concrete (C/Go/Wasm) representations are later work.

const find = `fn find(needle, ~lst) ~{
    match ~lst {
        [x, ...rest] -> {
            match (dup(~x) == dup(~needle)) {
                true -> {
                    Some(x)
                }
                false -> {
                    find(needle, ~rest)
                }
            }
        }
        [] -> {
            None
        }
    }
}
`;
const updateFirst = (list: string, needle: number, to: number) =>
    `${find}{
    let x = ${list}
    match ~find(${needle}, ~x) {
        Some(y) -> {
            y := ${to}
            ()
        }
        None -> ()
    }
    x
}`;
const run = (source: string): unknown => {
    const program = JSON.parse(JSON.stringify(typedProgram(source)));
    verifyTypedProgram(program);
    return executeTypedProgram(program);
};

describe('executing constructor lenses', () => {
    it('updates the found element in place', () => {
        expect(run(updateFirst('[1, 2, 3]', 2, 20))).toEqual([1, 20, 3]);
    });
    it('finds the first and the last element', () => {
        expect(run(updateFirst('[1, 2, 3]', 1, 10))).toEqual([10, 2, 3]);
        expect(run(updateFirst('[1, 2, 3]', 3, 30))).toEqual([1, 2, 30]);
    });
    it('only updates the first match', () => {
        expect(run(updateFirst('[5, 7, 5]', 5, 0))).toEqual([0, 7, 5]);
    });
    it('leaves the list unchanged when nothing is found', () => {
        expect(run(updateFirst('[1, 2, 3]', 9, 20))).toEqual([1, 2, 3]);
        expect(run(updateFirst('[]', 1, 20))).toEqual([]);
    });
    it('matches through a named binding', () => {
        expect(
            run(`${find}{
    let x = [1, 2, 3]
    {
        let r = ~find(3, ~x)
        match ~r {
            Some(y) -> {
                y := 33
                ()
            }
            None -> ()
        }
    }
    x
}`),
        ).toEqual([1, 2, 33]);
    });
    it('returns a constructor lens from a non-recursive function', () => {
        expect(
            run(`fn pick(c, ~a) ~{
    match c {
        true -> {
            Some(a)
        }
        false -> {
            None
        }
    }
}
{
    let x = 1
    match ~pick(true, ~x) {
        Some(y) -> {
            y := 5
            ()
        }
        None -> ()
    }
    x
}`),
        ).toEqual(5);
    });
    it('keeps a single-constructor lens replaceable', () => {
        expect(
            run(`type Box(a) {
    Box(a)
}
fn bx(~a) ~{Box(a)}
{
    let x = 1
    bx(~x) := Box(5)
    x
}`),
        ).toEqual(5);
    });
});

const instructions = (b: IRBlock, out: Instruction[] = []): Instruction[] => {
    for (const i of b.instructions) {
        out.push(i);
        if (i.op === 'scope') instructions(i.body, out);
        if (i.op === 'case') i.cases.forEach((c) => instructions(c.body, out));
        if (i.op === 'aslens') instructions(i.cleanup, out);
    }
    return out;
};
const everything = (p: ReturnType<typeof typedProgram>): Instruction[] =>
    p.units.flatMap((u) => [u.entry, ...u.functions.map((f) => f.body)].flatMap((b) => instructions(b)));
const clone = () => JSON.parse(JSON.stringify(typedProgram(updateFirst('[1, 2, 3]', 2, 20))));
const find1 = (p: ReturnType<typeof clone>, op: Instruction['op']) =>
    everything(p).find((i) => i.op === op)!;

describe('verifying constructor lenses independently', () => {
    it('accepts the lowered program and marks the lens non-replaceable', () => {
        const p = clone();
        verifyTypedProgram(p);
        const i = find1(p, 'lens-construct') as Extract<Instruction, { op: 'lens-construct' }>;
        expect(i.out.type).toMatchObject({ tag: 'flow', replaceable: false });
        expect(i.name).toBe('Some');
    });
    it('rejects a constructor name that disagrees with its signature', () => {
        const p = clone();
        (find1(p, 'lens-construct') as { name: string }).name = 'None';
        expect(() => verifyTypedProgram(p)).toThrow('Constructor lens tag/signature mismatch');
    });
    it('rejects a field count that disagrees with the constructor', () => {
        const p = clone();
        (find1(p, 'lens-construct') as { items: string[] }).items = [];
        expect(() => verifyTypedProgram(p)).toThrow('Constructor lens arity mismatch');
    });
    it('rejects a result type that is not the constructor applied to the fields', () => {
        const p = clone();
        const i = find1(p, 'lens-construct') as Extract<Instruction, { op: 'lens-construct' }>;
        if (i.out.type.tag !== 'flow') throw new Error('Expected a lens');
        i.out.type.read = { tag: 'con', name: 'Bool', args: [] };
        expect(() => verifyTypedProgram(p)).toThrow('Type mismatch');
    });
    it('rejects whole-value replacement of a non-replaceable lens', () => {
        const p = clone();
        const swap = find1(p, 'swap') as Extract<Instruction, { op: 'swap' }>;
        const producer = everything(p).find((i) => 'out' in i && i.out.id === swap.lens)!;
        if (!('out' in producer) || producer.out.type.tag !== 'flow')
            throw new Error('Expected a lens producer');
        producer.out.type.replaceable = false;
        expect(() => verifyTypedProgram(p)).toThrow(
            'Whole-value replacement of a non-replaceable lens',
        );
    });
    it('rejects a non-replaceable lens as a tuple lens item', () => {
        const p = JSON.parse(
            JSON.stringify(typedProgram('fn f(~(a, b)) ~(a, b)\n{ let p = (1, 2)\n 1 }')),
        );
        const tuple = find1(p, 'lens-tuple') as Extract<Instruction, { op: 'lens-tuple' }>;
        const item = everything(p).find((i) => 'out' in i && i.out.id === tuple.items[0])!;
        if (!('out' in item) || item.out.type.tag !== 'flow') throw new Error('Expected a lens');
        item.out.type.replaceable = false;
        expect(() => verifyTypedProgram(p)).toThrow('non-replaceable lens cannot be a tuple lens item');
    });
});

describe('backends', () => {
    it('give a non-replaceable lens result a scattered shape', () => {
        const p = typedProgram(updateFirst('[1, 2, 3]', 2, 20));
        const specialized = specializeProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        // Representation inference verifies its own output before returning it.
        const analysis = inferRepresentations(specialized);
        const found = analysis.variants.find((v) => v.result.kind === 'lens')!;
        expect(found).toBeDefined();
        const shape = analysis.shapes.find(
            (r) => found.result.kind === 'lens' && r.id === found.result.shape,
        )!;
        expect(shape.kind).toBe('sum');
    });
});
