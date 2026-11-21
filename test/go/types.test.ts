import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { reachableGo } from '../../src/go/reachable.ts';
import { goTypes } from '../../src/go/types.ts';
const compile = (source: string) => compileSource(source, { target: goTarget('test') });
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

it('uses primitives directly and prunes unused helpers, layouts and imports', () => {
    const code = compile('true').code;
    expect(code).not.toMatch(/type [LA]\d+/);
    expect(code).not.toContain('type ');
    expect(code).not.toContain('func printNumber');
    expect(code).not.toContain('func printString');
    expect(code).not.toContain('"math"');
    expect(code).not.toContain('"strconv"');
    expect(code).toContain(') bool');
});
it('names nominal types, union tags, tuple and lens layouts', () => {
    const code = compile(
        'type choice { A\n B }\nfn inspect(~x) {dup(~x)}\n{let x = A\n (inspect(~x), 1)}',
    ).code;
    expect(code).toContain('type Choice struct');
    expect(code).toContain('Choice_A');
    expect(code).toContain('type Lens_Choice struct');
    expect(code).toContain('type Tuple_Choice_Number struct');
    expect(code).not.toMatch(/type [LA]\d+/);
});
it('deduplicates equivalent backing definitions without sharing cells', () => {
    const code = compile(
        'fn pass(~x) ~x\n{let x = 1\n let y = 2\n pass(~x) := 3\n pass(~y) := 4\n (x, y)}',
    ).code;
    expect(code.match(/type Backing_\w+ struct/g)).toHaveLength(1);
    expect(code.match(/new\(Backing_\w+\)/g)).toHaveLength(2);
});
it('does not retain helpers named only in string literals', () => {
    const code = compile('"printNumber formatNumber math strconv"').code;
    expect(code).toContain('func printString');
    expect(code).not.toContain('func printNumber');
    expect(code).not.toContain('func formatNumber');
    expect(code).not.toContain('"math"');
});
it('keeps names stable when unrelated types and ABI declarations are added', () => {
    const a = compile('fn id(x) x\nid((1, true))').concrete;
    const b = compile('fn id(x) x\n(id((1, true)), id("unrelated"))').concrete;
    const an = goTypes(a, []),
        bn = goTypes(b, []);
    for (const l of a.layouts) {
        const other = b.layouts.find((x) => x.key === l.key);
        if (other) expect(an.names.get(l.id)).toBe(bn.names.get(other.id));
    }
    for (const abi of a.abis) {
        const other = b.abis.find((x) => x.key === abi.key);
        if (other) expect(an.abis.get(abi.id)).toBe(bn.abis.get(other.id));
    }
});
it('prunes unreachable declaration cycles while retaining reachable cycles', () => {
    const result = reachableGo({
        declarations: [
            'type Node struct { next *Node; run Callback }',
            'type Callback func(Node) Node',
            'type Dead struct { next *Dead }',
        ],
        functions: [
            {
                signature: 'func main()',
                body: ['var n Node', '_ = n', '// Dead', 'println(`Dead`)'],
            },
        ],
    });
    expect(result.declarations).toHaveLength(2);
    expect(result.declarations?.join('\n')).not.toContain('type Dead');
});
it('roots package initializer effects and all init functions', () => {
    const result = reachableGo({
        declarations: ['var initial = effect()'],
        functions: [
            { signature: 'func effect() int', body: ['return 1'] },
            { signature: 'func first()', body: [] },
            { signature: 'func second()', body: [] },
            { signature: 'func init()', body: ['first()'] },
            { signature: 'func init()', body: ['second()'] },
            { signature: 'func main()', body: [] },
        ],
    });
    expect(result.functions).toHaveLength(6);
});

for (const [name, source, expected] of [
    ['scalar primitives', '(1, true, "text")', [1, true, 'text']],
    ['recursive nominal data', '[1, 2, 3]', [1, 2, 3]],
    [
        'nominal tags',
        'type choice { A\n B }\nfn pick(x) {match x {A -> 1; B -> 2}}\n(pick(A), pick(B))',
        [1, 2],
    ],
    [
        'distinct cells sharing backing type',
        'fn pass(~x) ~x\n{let x = 1\n let y = 2\n pass(~x) := 3\n pass(~y) := 4\n (x, y)}',
        [3, 4],
    ],
    ['captured callable ABI', 'fn maker(n) {fn (x) {n + x}}\nmaker(2)(3)', 5],
    [
        'unit nominal name collision',
        'type unit { A\n B }\n(A, ())',
        [{ kind: 'variant', name: 'A', items: [] }, null],
    ],
    [
        'tuple nominal name collision',
        'type tuple_Number_Number { A\n B }\n(A, (1, 2))',
        [{ kind: 'variant', name: 'A', items: [] }, [1, 2]],
    ],
    ['runtime helper source names', 'fn print_Choice(x) {x + 1}\nprint_Choice(2)', 3],
] as const)
    execute(
        `type presentation Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(compile(source).code)).toEqual([expected]);
        },
        60000,
    );
