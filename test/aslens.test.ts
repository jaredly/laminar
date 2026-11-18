import { expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { Linear } from '../src/ast.ts';
import { linearToExpr } from '../src/decompose.ts';
import { evalExpr, type Ctx } from '../src/eval.ts';
import { Checker } from '../src/check.ts';

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

it('keeps checked aslens explicitly unsupported until retained checking exists', () => {
    const parsed = grammar.parse<Linear>(
        'Linear',
        readLines('fn temp() ~{lens v <- 1\n v}').nodes[0],
    );
    if (parsed.type === 'failure') throw Error('Invalid aslens audit source');
    expect(() => new Checker().check(parsed.value)).toThrow(
        'aslens lenses require scoped restoration checking',
    );
});
