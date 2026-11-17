import { expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Decl, FileItem, Linear } from '../src/ast.ts';
import { Checker } from '../src/check.ts';
import type { Elaboration, SemanticType } from '../src/elaborated.ts';
import { backendCorpus } from './backend/corpus.ts';
import {
    BackendDiagnostic,
    targetConfig,
    targetKey,
    wasm32Emscripten,
} from '../src/backend/target.ts';
import { dupAt, evalExpr, type Ctx, type Pointer } from '../src/eval.ts';
import { verifyElaboration } from '../src/backend/verify-elaboration.ts';

function parse(source: string): FileItem[] {
    return readLines(source).nodes.map((node) => {
        const result = grammar.parse<FileItem>('FileItem', node);
        if (result.type === 'failure') throw new Error(`Invalid test source: ${source}`);
        return result.value;
    });
}
function elaborate(source: string, unit = 'test'): { checker: Checker; results: Elaboration[] } {
    const checker = new Checker(undefined, undefined, unit),
        results: Elaboration[] = [];
    let declaration: Decl | undefined;
    for (const item of parse(source)) {
        if (item.type === 'decl') {
            declaration = item;
            continue;
        }
        const checked = checker.check(item, declaration);
        results.push(checked.elaboration);
        if (item.type === 'fn' && item.name) checker.publish(checked);
        declaration = undefined;
    }
    return { checker, results };
}
const named = (e: Elaboration, name: string) =>
    e.bindings.filter((b) => b.name === name && b.kind !== 'global');
const number: SemanticType = { tag: 'con', name: 'Number', args: [] };
const unit: SemanticType = { tag: 'tuple', items: [] };

it('indexes a frozen checked source and preserves its IDs across serialization', () => {
    const ast = parse('{let x = 1\n x}')[0] as Linear;
    const checker = new Checker();
    const checked = checker.check(ast);
    expect(Object.isFrozen(checked.ast)).toBe(true);
    expect(checked.types.get(checked.ast)).toBeDefined();
    expect((checked.ast as Linear & { nodeId: string }).nodeId).toBe(checked.elaboration.root);
    const copy = JSON.parse(JSON.stringify(checked.elaboration)) as Elaboration;
    expect(copy.nodes.map((n) => n.id)).toEqual(checked.elaboration.nodes.map((n) => n.id));
    expect(checked.elaboration.source).not.toBe(ast);
    expect(() => checked.elaboration.nodes.push({ id: 'bad', kind: 'id' })).toThrow();
    expect(() => checked.elaboration.signature.quantified.push('bad')).toThrow();
});

it('keeps shadowed declarations distinct, even when their locations are identical', () => {
    const source = '{let x = 1\n {let x = true\n x}\n x}';
    const ast = parse(source)[0] as Linear;
    const eraseLocations = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if ('loc' in n) (n as { loc: number }).loc = 0;
        Object.values(n).forEach(eraseLocations);
    };
    eraseLocations(ast);
    const e = new Checker().check(ast).elaboration;
    const declarations = named(e, 'x');
    expect(declarations).toHaveLength(2);
    expect(new Set(declarations.map((b) => b.id)).size).toBe(2);
    expect(new Set(declarations.map((b) => b.place)).size).toBe(2);
    expect(e.uses.filter((u) => declarations.some((b) => b.id === u.binding))).toHaveLength(2);
});

it('retains concrete instantiation arguments keyed to the defining scheme', () => {
    const [definition, call] = elaborate('fn id(x) x\n(id(1), id(true))').results;
    expect(definition.signature.quantified).toEqual([`${definition.id}/q0`]);
    const uses = call.instantiations.filter((i) => i.definition === definition.id);
    expect(uses).toHaveLength(2);
    expect(uses.map((i) => i.arguments[0].parameter)).toEqual([
        definition.signature.quantified[0],
        definition.signature.quantified[0],
    ]);
    expect(uses.map((i) => i.arguments[0].type)).toEqual([
        number,
        { tag: 'con', name: 'Bool', args: [] },
    ]);
});

it('records identity type arguments for monomorphic self-recursion inside a generic body', () => {
    const e = elaborate('fn loop(x) loop(x)').results[0];
    const call = e.instantiations.find((i) => i.definition === e.id)!;
    expect(call.arguments.map((a) => a.parameter)).toEqual(e.signature.quantified);
    expect(call.arguments.map((a) => a.type)).toEqual(
        e.signature.quantified.map((id) => ({ tag: 'variable', id, rigid: false })),
    );
});

it('aligns annotated contracts with body types without leaking skolem variables', () => {
    for (const signature of ['(a) => a', '(Number) => Number']) {
        const e = elaborate(`id :: ${signature}\nfn id(x) x`).results[0];
        expect(e.signature.bodyType).toEqual(e.signature.type);
        expect(e.signature.bodyVariables).toHaveLength(1);
        expect(e.signature.unresolved).toEqual([]);
        expect(JSON.stringify(e)).not.toContain('"rigid":true');
        const parameter = named(e, 'x')[0];
        expect(parameter.initialType).toEqual(
            signature.includes('Number')
                ? number
                : { tag: 'variable', id: `${e.id}/q0`, rigid: false },
        );
    }
});

it('records immutable move/write states and distinguishes empty storage from unit', () => {
    const e = elaborate('{let x = ()\n x\n x := 2\n x}').results[0];
    const x = named(e, 'x')[0];
    const events = e.transitions.filter((t) => t.before.place === x.place);
    expect(events.map((t) => t.kind)).toEqual(['move', 'write', 'move']);
    expect(events[0].before).toMatchObject({ type: unit, empty: [] });
    expect(events[0].after).toMatchObject({ type: unit, empty: [[]] });
    expect(events[1].before.empty).toEqual([[]]);
    expect(events[1].after).toMatchObject({ type: number, empty: [] });
    expect(Object.isFrozen(events[0].before.empty)).toBe(true);
    // The initial declaration type was not overwritten by later storage mutations.
    expect(x.initialType).toEqual(unit);
});

it('retains alias paths, exclusive borrow scopes, and capture moves', () => {
    const e = elaborate(`{let x = (1, 2)
        {let (a, b) = ~x
            let f = fn (()) a
            a := true
            f(())
        }
        x}`).results[0];
    const a = named(e, 'a')[0],
        b = named(e, 'b')[0],
        x = named(e, 'x')[0];
    expect(a.place).toBe(x.place);
    expect(b.place).toBe(x.place);
    expect(a.path).toEqual([0]);
    expect(b.path).toEqual([1]);
    expect(a.borrow).toBe(e.borrows[0].id);
    expect(b.borrow).toBe(e.borrows[0].id);
    expect(a.initialType).toEqual(number);
    const capture = e.captures.find((c) => c.from === a.id)!;
    expect(capture.type).toEqual(number);
    expect(e.bindings.find((v) => v.id === capture.to)?.kind).toBe('capture');
    expect(e.transitions.find((t) => t.kind === 'borrow-open')?.after.borrows).toHaveLength(1);
    expect(e.transitions.find((t) => t.kind === 'borrow-close')?.after.borrows).toEqual([]);
});

it('retains separate branch states and event spans before joining availability', () => {
    const e = elaborate('{let x = 1\n match true {true -> {x\n ()}; false -> ()}\n ()}').results[0];
    const x = named(e, 'x')[0],
        branch = e.branches[0];
    expect(branch.input.find((s) => s.place === x.place)?.empty).toEqual([]);
    expect(branch.arms.map((a) => a.output.find((s) => s.place === x.place)?.empty)).toEqual([
        [[]],
        [],
    ]);
    expect(branch.output.find((s) => s.place === x.place)?.empty).toEqual([[]]);
    expect(branch.arms[0].transitions[1] - branch.arms[0].transitions[0]).toBe(1);
});

it('namespaces generic variables across definitions and reports internal unresolved variables', () => {
    const [one, two] = elaborate('fn one(x) x\nfn two(x) x').results;
    expect(one.signature.quantified[0]).not.toBe(two.signature.quantified[0]);
    const e = elaborate('{let unused = []\n ()}').results[0];
    expect(e.signature.quantified).toEqual([]);
    expect(e.signature.unresolved.length).toBeGreaterThan(0);
});

it('produces deterministic metadata for the same compilation unit', () => {
    const source = 'fn id(x) x\n{let x = 1\n id(x)}';
    expect(elaborate(source).results).toEqual(elaborate(source).results);
});

it('validates serialized metadata and rejects broken cross-references and transition regions', () => {
    const e = elaborate('{let x = 1\n x}').results[0];
    const copy = JSON.parse(JSON.stringify(e)) as Elaboration;
    expect(() => verifyElaboration(copy)).not.toThrow();
    copy.uses[0].binding = 'missing';
    expect(() => verifyElaboration(copy)).toThrow(BackendDiagnostic);
    const damaged = structuredClone(e);
    damaged.transitions[0].after.place = 'other/place';
    expect(() => verifyElaboration(damaged)).toThrow(BackendDiagnostic);
});

it('retains persistent alias endpoints and excludes uncaptured outer storage from function entries', () => {
    const e = elaborate(
        '{let x = 1\n let untouched = true\n let y = ~x\n let f = fn (()) y\n y := 2\n f(())}',
    ).results[0];
    const ownerUse = e.uses.find(
        (u) => u.mode === 'lens' && e.bindings.find((b) => b.id === u.binding)?.name === 'x',
    )!;
    expect(e.nodes.find((n) => n.id === ownerUse.node)?.type).toMatchObject({
        tag: 'flow',
        read: number,
        write: number,
    });
    const untouched = named(e, 'untouched')[0];
    expect(e.functions[0].entry.some((s) => s.place === untouched.place)).toBe(false);
    const capture = e.captures[0],
        capturedPlace = e.bindings.find((b) => b.id === capture.to)!.place;
    expect(e.functions[0].entry.some((s) => s.place === capturedPlace)).toBe(true);
    expect(e.functions[0].transitions[0]).toBeGreaterThan(0); // Capture move precedes body execution.
});

for (const sample of backendCorpus)
    it(`acceptance metadata: ${sample.name} (phase ${sample.phase})`, () => {
        const { results } = elaborate(sample.source, `corpus/${sample.name}`);
        expect(results.length).toBeGreaterThan(0);
        for (const e of results) {
            expect(e.nodes.find((n) => n.id === e.root)?.type).toBeDefined();
            const ids = new Set(e.bindings.map((b) => b.id));
            expect(e.uses.every((u) => ids.has(u.binding))).toBe(true);
            expect(e.uses.every((u) => e.nodes.some((n) => n.id === u.node))).toBe(true);
        }
    });

for (const sample of backendCorpus)
    it(`acceptance reference result: ${sample.name}`, () => {
        const builtins: Ctx['builtins'] = {
            '+': (_: Ctx, a: number, b: number) => a + b,
            '-': (_: Ctx, a: number, b: number) => a - b,
            dup: (ctx: Ctx, p: Pointer) => dupAt(ctx, p, 0),
            fst: (_: Ctx, p: Pointer) => [
                p.type === 'tuple' ? p.items[0] : { ...p, path: [...p.path, 0] },
                () => null,
            ],
        };
        const context: Ctx = {
            builtins,
            scopes: [{ bindings: {} }],
            stack: [{ values: [], id: 'root' }],
            heap: { lid: 0, data: {} },
        };
        const checker = new Checker();
        let declaration: Decl | undefined, result: unknown;
        for (const ast of parse(sample.source)) {
            if (ast.type === 'decl') {
                declaration = ast;
                continue;
            }
            const checked = checker.check(ast, declaration);
            result = evalExpr(context, checker.lower(checked));
            if (ast.type === 'fn' && ast.name) {
                builtins[ast.name] = result;
                checker.publish(checked);
            }
            declaration = undefined;
        }
        expect(result).toEqual(sample.expected);
    });

it('keys concrete caches by explicit target data rather than the build host', () => {
    const wasm = wasm32Emscripten('test-version');
    const native = targetConfig({
        ...wasm,
        triple: 'aarch64-apple-darwin',
        pointerBits: 64,
        runtime: 'native',
        toolchain: { compiler: 'clang', version: 'test-version' },
    });
    expect(targetKey(wasm)).not.toBe(targetKey(native));
    expect(targetKey({ ...wasm, features: ['b', 'a', 'b'] })).toBe(
        targetKey({ ...wasm, features: ['a', 'b'] }),
    );
    expect(() => targetConfig({ ...wasm, pointerBits: 64 })).toThrow(BackendDiagnostic);
    expect(() =>
        targetConfig({ ...native, toolchain: { ...native.toolchain, version: '' } }),
    ).toThrow(BackendDiagnostic);
    expect(Object.isFrozen(wasm.toolchain)).toBe(true);
});

it('retains a wildcard lens parameter place even when no name is declared', () => {
    const e = elaborate('fn ignore(~_) ()').results[0];
    expect(e.functions[0].parameters).toEqual([[]]);
    expect(e.functions[0].parameterPlaces[0]).toHaveLength(1);
    expect(e.functions[0].entry[0].place).toBe(e.functions[0].parameterPlaces[0][0]);
});
