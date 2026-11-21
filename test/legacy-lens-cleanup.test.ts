import { expect, it } from 'bun:test';
import { legacyReference } from './backend/legacy-reference.ts';
import { typedProgram } from './backend/typed-program.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';

const cases = [
    {
        name: 'aslens backing survives fst projection',
        source: '{let seen = 0\n let old = fst(~{lens (a, b) <- (3, 4)\n seen := a}) := 7\n (old, seen)}',
        expected: [3, 7],
    },
    {
        name: 'callable temporary argument completes after replacement',
        source: '{let f = fn () 3\n let n = 4\n let seen = 0\n let old = fst(~{{lens finalFocus <- (f, n)\n(f, n) := finalFocus\n{let installed = f := fn () 9\n seen := installed()\n ()}}}) := fn () 7\n (old(), seen, f(), n)}',
        expected: [3, 7, 9, 4],
    },
    {
        name: 'returned lens cleanup precedes argument cleanup',
        source: 'fn first(~(x, y)) ~{{lens finalFocus <- x\nx := finalFocus\n{x := x + 1}}}\n{let seen = 0\n let old = first(~{lens (a, b) <- (3, 4)\n seen := a}) := 7\n (old, seen)}',
        expected: [3, 8],
    },
];
for (const c of cases)
    it(c.name, () => {
        expect(executeTypedProgram(typedProgram(c.source))).toEqual(c.expected);
        expect(legacyReference(c.source)).toEqual(c.expected);
    });

it('preserves cleanup order through unchecked decomposition', async () => {
    const { readLines } = await import('../parser-generator/lexer.ts');
    const { grammar } = await import('../src/laminar-parser.ts');
    const { linearToExpr } = await import('../src/decompose.ts');
    const { evalExpr } = await import('../src/eval.ts');
    const parsed = grammar.parse<import('../src/ast.ts').Linear>(
        'Linear',
        readLines(cases[0]!.source).nodes[0]!,
    );
    if (parsed.type === 'failure') throw Error('Invalid regression source');
    const ctx: import('../src/eval.ts').Ctx = {
        builtins: {
            fst: (_: import('../src/eval.ts').Ctx, p: import('../src/eval.ts').Pointer) => [
                p.type === 'tuple' ? p.items[0] : { ...p, path: [...p.path, 0] },
                () => null,
            ],
        },
        scopes: [{ bindings: {} }],
        stack: [{ values: [], id: 'root' }],
        heap: { lid: 0, data: {} },
    };
    const expression = linearToExpr(
        { scope: { fst: { type: 'builtin' } }, counter: { current: 0 } },
        parsed.value,
    );
    expect(evalExpr(ctx, expression)).toEqual([3, 7]);
    expect(Object.keys(ctx.heap.data)).toHaveLength(0);
});
