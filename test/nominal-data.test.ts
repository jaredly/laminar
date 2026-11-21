import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { emitC } from '../src/c/emit.ts';
import { emitGo } from '../src/go/emit.ts';
import { deriveNominalLayoutDefinitions, layoutSchemaKey } from '../src/layout-definitions.ts';
import { irCon } from '../src/typed-ir.ts';

const target = wasm32Emscripten('test');
const tree = 'type tree(a) {\n    Leaf\n    Node(tree(a), a, tree(a))\n}\n';
const compile = (source: string) => {
    const p = typedProgram(source);
    return compileConcreteProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
};

it('derives complete ordered union schemas from constructor imports', () => {
    const p = typedProgram(`${tree}Leaf`);
    const defs = deriveNominalLayoutDefinitions(p.imports);
    const summary = defs.map((d) => [
        d.name,
        d.parameters,
        d.fields.map((f) => [f.name, !!f.indirect]),
    ]);
    expect(summary).toEqual([
        [
            'List',
            ['p0'],
            [
                ['nil', false],
                ['cons', true],
            ],
        ],
        [
            'Option',
            ['p0'],
            [
                ['Some', false],
                ['None', false],
            ],
        ],
        [
            'tree',
            ['p0'],
            [
                ['Leaf', false],
                ['Node', true],
            ],
        ],
    ]);
    // Multi-argument payloads are tuples; single payloads are the argument itself.
    const node = defs[2]!.fields[1]!.type;
    expect(node.tag === 'tuple' && node.items.length).toBe(3);
    expect(defs[1]!.fields[0]!.type).toEqual({ tag: 'variable', id: 'p0', rigid: false });
});

it('keys layouts only on the schemas they reach', () => {
    const defs = deriveNominalLayoutDefinitions(typedProgram(`${tree}Leaf`).imports);
    expect(layoutSchemaKey(defs, irCon('Number'))).toBe('');
    const list = layoutSchemaKey(defs, irCon('List', irCon('Number')));
    expect(list).toContain('List');
    expect(list).not.toContain('tree');
    // Scalar layouts are identical with or without unrelated unions.
    const plain = compile('1').layouts.map((l) => l.id);
    const withUnion = compile(`${tree}{let t = Leaf\n 1}`).layouts.map((l) => l.id);
    expect(withUnion).toEqual(expect.arrayContaining(plain));
});

it('lowers boxed recursive variants to tagged C with owned drops and deep copies', () => {
    const concrete = compile('{let l = [1, 2]\n (dup(~l), l)}');
    verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
    const c = emitC(concrete);
    expect(c).toMatch(/struct L\d+ \{ uint32_t tag; union \{ L\d+ v0; L\d+ \*v1; \} as; \};/);
    expect(c).toMatch(/L\d+ dup_L\d+\(L\d+ value\);/);
    expect(c).toMatch(/drop_L\d+\(\(result0\)\.item1\);/);
    expect(c).toContain('release_context(value.as.v1);');
    const go = emitGo(concrete);
    expect(go).toMatch(/tag uint32\n\tv0 Unit\n\tv1 \*Tuple_Number_List_Number/);
});

it('reconstructs borrowed constructor patterns without a pattern-specific runtime', () => {
    const concrete = compile(
        `${tree}{let t = Node(Leaf, 1, Leaf)\n match ~t {Leaf -> (); Node(l, x, r) -> {x := 9\n ()}}\n t}`,
    );
    verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
    expect(emitC(concrete)).toContain('.tag == 1');
});
