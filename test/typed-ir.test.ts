import { expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem } from '../src/ast.ts';
import { Checker, checkTypedFile } from '../src/check.ts';
import { lowerTypedProgram } from '../src/lower-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import type { Elaboration } from '../src/elaborated.ts';
import { backendCorpus } from './backend/corpus.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { BackendDiagnostic } from '../src/backend/target.ts';
import { Solver, con, fn, plain } from '../src/types.ts';
import { constructorTypes } from '../src/builtins.ts';
import {
    irCon,
    irPlain,
    type Instruction,
    type IRBlock,
    type TypedProgram,
} from '../src/typed-ir.ts';

export function program(source: string) {
    const checker = new Checker(),
        elaborations: Elaboration[] = [];
    let declaration: Decl | undefined;
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error(`Parse error in ${source}`);
        const item = parsed.value;
        if (item.type === 'decl') {
            declaration = item;
            continue;
        }
        if (item.type === 'type-alias' || item.type === 'union') {
            throw new Error('not supported yet');
        }
        const checked = checker.check(item, declaration);
        elaborations.push(checked.elaboration);
        if (item.type === 'fn' && item.name) checker.publish(checked);
        declaration = undefined;
    }
    return lowerTypedProgram(elaborations);
}

for (const sample of backendCorpus)
    it(`verifies typed IR: ${sample.name}`, () => {
        const ir = program(sample.source);
        expect(() => verifyTypedProgram(ir)).not.toThrow();
        expect(() => verifyTypedProgram(JSON.parse(JSON.stringify(ir)))).not.toThrow();
    });

for (const sample of backendCorpus)
    it(`executes typed IR: ${sample.name}`, () => {
        const ir = program(sample.source);
        expect(executeTypedProgram(ir) as unknown).toEqual(sample.expected);
        expect(executeTypedProgram(ir) as unknown).toEqual(legacyReference(sample.source));
    });

function allInstructions(p: TypedProgram): Instruction[] {
    const visit = (b: IRBlock): Instruction[] =>
        b.instructions.flatMap((i) => [
            i,
            ...(i.op === 'scope'
                ? visit(i.body)
                : i.op === 'case'
                  ? i.cases.flatMap((c) => visit(c.body))
                  : []),
        ]);
    return p.units.flatMap((u) => [
        ...visit(u.entry),
        ...u.functions.flatMap((f) => visit(f.body)),
    ]);
}

it('rejects corrupted types before reference execution can run effects', () => {
    const ir = structuredClone(program('1'));
    const constant = allInstructions(ir).find((i) => i.op === 'constant')!;
    if ('out' in constant) constant.out.type = irPlain(irCon('Bool'));
    let steps = 0;
    expect(() => executeTypedProgram(ir, { onStep: () => steps++ })).toThrow(BackendDiagnostic);
    expect(steps).toBe(0);
    const unknown = structuredClone(program('1'));
    (unknown.units[0].entry.instructions[0] as { op: string }).op = 'invented';
    expect(() => verifyTypedProgram(unknown)).toThrow(BackendDiagnostic);
});

it('rejects duplicated operands and temporaries used before their definition', () => {
    const ir = structuredClone(program('(1, 2)'));
    const tuple = allInstructions(ir).find((i) => i.op === 'tuple')!;
    if (tuple.op === 'tuple') tuple.items[1] = tuple.items[0];
    expect(() => verifyTypedProgram(ir)).toThrow(BackendDiagnostic);
    const future = structuredClone(program('(1, 2)'));
    const entry = future.units[0].entry;
    entry.instructions.unshift(entry.instructions.pop()!);
    expect(() => verifyTypedProgram(future)).toThrow(BackendDiagnostic);
});

it('requires disposal of unused owned scope values and balanced exclusive loans', () => {
    const ir = structuredClone(program('{let x = 1\n ()}'));
    const scope = allInstructions(ir).find((i) => i.op === 'scope')!;
    if (scope.op === 'scope') scope.body.cleanup = [];
    expect(() => verifyTypedProgram(ir)).toThrow(BackendDiagnostic);
    const borrowed = structuredClone(program('{let x = 1\n {let y = ~x\n y := 2}\n x}'));
    for (const i of allInstructions(borrowed))
        if (i.op === 'scope') i.body.cleanup = i.body.cleanup.filter((c) => c.kind !== 'release');
    expect(() => verifyTypedProgram(borrowed)).toThrow(BackendDiagnostic);
    const unpermitted = structuredClone(program('{let x = 1\n {let y = ~x\n y := 2}\n x}'));
    const access = allInstructions(unpermitted).find((i) => i.op === 'acquire' && i.slot.permit)!;
    if (access.op === 'acquire') delete access.slot.permit;
    expect(() => verifyTypedProgram(unpermitted)).toThrow(BackendDiagnostic);
});

it('verifies lens restoration independently of cleanup annotations', () => {
    const ir = structuredClone(program('fn id(x) x'));
    const unit = ir.units[0],
        f = unit.functions[0];
    const t = f.type.args[0];
    if (t.tag !== 'plain') throw new Error('Expected ordinary parameter');
    f.type.args[0] = { tag: 'flow', read: t.value, write: t.value };
    unit.signature.type = f.type;
    const closure = unit.entry.instructions[0];
    if ('out' in closure) closure.out.type = irPlain(f.type);
    const binding = f.parameters[0].pattern;
    if (binding.kind !== 'bind') throw new Error('Expected parameter binding');
    f.parameters[0].lensPlace = binding.slot.place;
    f.body.cleanup = [];
    expect(() => verifyTypedProgram(ir)).toThrow(BackendDiagnostic);
});

for (const source of [
    '{let x = 1\n x := x + 1}',
    '{let x = 1\n x := x := true}',
    '{let x = 1\n {let y = ~x\n {let z = ~y\n z := true}}\n x}',
    '{let x = 1\n {let y = ~x\n match true {true -> {y\n ()}; false -> ()}\n y := true}\n x}',
    'match [1, 2] {[x, ...xs] -> x; [] -> 0}',
    'fn view(~x) ~x\n{let x = 1\n view(~x) := true\n x}',
    'fn view(~(a, b)) ~(b, a)\n{let x = (1, 2)\n view(~x) := (true, false)\n x}',
    '{let g = {let f = fn (~x) ~x\n fn (~y) ~f(~y)}\n let x = 1\n g(~x) := true\n x}',
    'fn unit(~x) ~()\n{let x = 1\n unit(~x) := ()\n x}',
])
    it(`differential typed execution: ${source.slice(0, 45)}`, () => {
        expect(executeTypedProgram(program(source)) as unknown).toEqual(legacyReference(source));
    });

it('drops unused closure environments on the right branch without duplicating captures', () => {
    for (const condition of ['true', 'false']) {
        const ir = program(
            `{let x = 1\n let f = fn (()) x\n match ${condition} {true -> {f(())\n ()}; false -> ()}}`,
        );
        let drops = 0;
        expect(executeTypedProgram(ir, { onDisposeClosure: () => drops++ })).toBeNull();
        expect(drops).toBe(condition === 'true' ? 0 : 1);
    }
});

it('has an owned typed lowering API and a whole-file typed path', () => {
    const source = 'fn id(x) x\nid(2)';
    const items = readLines(source).nodes.map((node) => {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error('Parse failed');
        return parsed.value;
    });
    const compiled = checkTypedFile(items);
    expect(executeTypedProgram(compiled.program)).toBe(2);
    const checker = new Checker(),
        ast = items[1];
    if (ast.type === 'decl') throw new Error('Expected expression');
    const literal = grammar.parse<import('../src/ast.ts').Linear>(
        'Linear',
        readLines('1').nodes[0],
    );
    if (literal.type === 'failure') throw new Error('Expected literal');
    const checked = checker.check(literal.value);
    expect(checker.lowerTyped(checked).entry.instructions[0].op).toBe('constant');
    expect(() => new Checker().lowerTyped(checked)).toThrow();
});

it('materializes empty unit focuses at call boundaries without reading uninitialized storage', () => {
    // The legacy evaluator cannot structuredClone its private deleted sentinel.
    // This expectation follows the checked flow contract rather than that runtime representation.
    expect(executeTypedProgram(program('{let x = ()\n x\n dup(~x)}'))).toBeNull();
});

it('preserves all numeric literal values through JSON serialization', () => {
    for (const value of [NaN, Infinity, -Infinity, -0, 1.25]) {
        const { program: ir } = checkTypedFile([{ type: 'number', value, loc: 0 }]);
        expect(Object.is(executeTypedProgram(JSON.parse(JSON.stringify(ir))), value)).toBe(true);
    }
    const huge = '9'.repeat(400);
    const ir = program(`match ${huge} {${huge} -> 1; _ -> 0}`);
    expect(executeTypedProgram(JSON.parse(JSON.stringify(ir)))).toBe(1);
});

it('verifies registered constructor schemas and executes their patterns', () => {
    const solver = new Solver(),
        a = solver.fresh(),
        option = con('Option', a);
    const constructors = constructorTypes();
    constructors.set('Some', solver.generalize(fn([plain(a)], plain(option)), []));
    constructors.set('None', solver.generalize(fn([], plain(option)), []));
    const source = 'match Some(2) {Some(x) -> x; None -> 0}';
    const items = readLines(source).nodes.map((node) => {
        const result = grammar.parse<FileItem>('FileItem', node);
        if (result.type === 'failure') throw new Error('Invalid constructor test');
        return result.value;
    });
    const { program: ir } = checkTypedFile(items, undefined, constructors);
    expect(executeTypedProgram(ir)).toBe(2);
    const corrupt = structuredClone(ir);
    const construct = allInstructions(corrupt).find((i) => i.op === 'construct')!;
    if (construct.op === 'construct') construct.name = 'None';
    expect(() => verifyTypedProgram(corrupt)).toThrow(BackendDiagnostic);
});

it('traps unmatched cases and applies a deterministic reference step limit', () => {
    expect(() => executeTypedProgram(program('match true {false -> 1}'))).toThrow(
        'No case arm matched',
    );
    expect(() =>
        executeTypedProgram(program('fn loop(x) loop(x)\nloop(1)'), { maxSteps: 40 }),
    ).toThrow('step limit');
});

it('uses an execution snapshot and drops discarded earlier expression roots', () => {
    const ir = structuredClone(program('1'));
    const constant = ir.units[0].entry.instructions[0];
    expect(
        executeTypedProgram(ir, {
            onStep: () => {
                if (constant.op === 'constant') constant.value = 99;
            },
        }),
    ).toBe(1);
    let drops = 0;
    expect(
        executeTypedProgram(program('fn (()) 1\n()'), { onDisposeClosure: () => drops++ }),
    ).toBeNull();
    expect(drops).toBe(1);
});
