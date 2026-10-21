import { readFileSync, writeFileSync } from 'fs';
import { parseLinear } from '../src/flowparse.ts';
import { type Ctx, resetId0, toTS } from '../src/flowtots.ts';
import { readLines } from '../src/nnodes.ts';

const error = readLines(readFileSync(import.meta.dirname + '/errors.fl', 'utf-8'));
const good = readLines(readFileSync(import.meta.dirname + '/lens.fl', 'utf-8'));
let result = `
import assert from "assert";
import * as $ from "./runtime.ts";
import {it} from "node:test";

const expect = (m:any) => ({
    toThrow() {assert.throws(m)},
    toEqual(n:any) { assert.deepStrictEqual(m, n) }
})

`;

const fns = [];
const topNames: string[] = [];
const pairs = [];
for (let i = 0; i < good.nodes.length; i++) {
    const node = parseLinear(good.nodes[i]);
    if (node.type === 'fn' && node.name) {
        fns.push({ ...node, loc: good.nodes[i].loc });
        topNames.push(node.name);
    } else {
        const expected = parseLinear(good.nodes[i + 1]);
        i++;
        pairs.push({ node, expected, loc: good.nodes[i - 1].loc });
    }
}

const ctx: Ctx = { globals: topNames };
fns.forEach((fn) => {
    try {
        result += `$.addFn(${JSON.stringify(fn.name)}, ${toTS(ctx, { ...fn, name: null })});`;
    } catch (err) {
        console.log(good.pos(fn.loc));
        throw err;
    }
});

pairs.forEach(({ node, expected, loc }, i) => {
    resetId0();
    const at = good.pos(loc);
    result += `
it("Item ${i} at test/lens.fl:${at.line + 1}:${at.char}", () => {
    const result = $.run((gamma) => {\n${toTS(ctx, node, {})}\n});
    expect(result).toEqual(${toTS(ctx, expected)});
})
`;
});

for (let i = 0; i < error.nodes.length; i++) {
    resetId0();
    const node = error.nodes[i];
    const exp = parseLinear(node);
    const at = error.pos(node.loc);
    result += `
it("Error ${i} at test/errors.fl:${at.line + 1}:${at.char}", () => {
    expect(() => $.run((gamma) => {\n${toTS(ctx, exp, {})}\n})).toThrow();
})
`;
}

writeFileSync(import.meta.dirname + '/lens.fl.test.ts', result);
