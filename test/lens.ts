import { readFileSync, writeFileSync } from 'fs';
import { type Ctx, resetId0, toTS } from '../src/flowtots.ts';
import { Node, readFile, readLines } from '../src/lexer.ts';
import { Linear } from '../src/ast.ts';
import { grammar } from '../src/laminar-parser.ts';
import {
    Failure,
    findDeepest,
    ParseResult,
    showDeepest,
    showFailure,
    showFull,
    showPos,
} from '../src/grammar-lexer.ts';

const error = readFile(readFileSync(import.meta.dirname + '/errors.fl', 'utf-8'));
const good = readFile(readFileSync(import.meta.dirname + '/lens.fl', 'utf-8'));
let result = `
import assert from "assert";
import * as $ from "./runtime.ts";
import {it} from "node:test";

const expect = (m:any) => ({
    toThrow() {assert.throws(m)},
    toEqual(n:any) { assert.deepStrictEqual(m, n) }
})

`;

const parseFile = (node: Node): ParseResult<Linear[]> => {
    return grammar.parse('File', node);
};

const fns = [];
const topNames: string[] = [];
const pairs = [];

const file = parseFile(good.node);
if (file.type === 'failure') {
    const locToPos = (loc: number) => showPos(good.pos(loc));
    console.error(showFailure(file.failure, locToPos));
    const deepest = findDeepest(file.failure);
    if (deepest) {
        console.error(showDeepest(deepest, grammar, good.raw, locToPos));
    }
    writeFileSync('parse-failure.log', showFull(file.failure, grammar, good.raw, locToPos));
    process.exit(1);
}

for (let i = 0; i < file.value.length; i++) {
    const node = file.value[i];
    if (node.type === 'fn' && node.name) {
        fns.push(node);
        topNames.push(node.name);
    } else {
        const expected = file.value[i + 1];
        i++;
        pairs.push({ node, expected });
    }
}

const ctx: Ctx = { globals: topNames, scopes: [] };
fns.forEach((fn) => {
    try {
        result += `$.addFn(${JSON.stringify(fn.name)}, ${toTS(ctx, { ...fn, name: null })});`;
    } catch (err) {
        console.log(good.pos(fn.loc));
        throw err;
    }
});

pairs.forEach(({ node, expected }, i) => {
    resetId0();
    result += `
it("Item ${i} at test/lens.fl:${showPos(good.pos(node.loc))}", () => {
    const result = $.run((gamma) => {\n${toTS(ctx, node, {})}\n});
    expect(result).toEqual(${toTS(ctx, expected)});
})
`;
});

const errorFile = parseFile(error.node);
if (errorFile.type === 'failure') {
    console.error(showFailure(errorFile.failure, (loc) => showPos(error.pos(loc))));
    console.log('stopping');
    process.exit(1);
}

for (let i = 0; i < errorFile.value.length; i++) {
    resetId0();
    const exp = errorFile.value[i];
    const at = error.pos(exp.loc);
    result += `
it("Error ${i} at test/errors.fl:${at.line + 1}:${at.char}", () => {
    expect(() => $.run((gamma) => {\n${toTS(ctx, exp, {})}\n})).toThrow();
})
`;
}

writeFileSync(import.meta.dirname + '/lens.fl.test.ts', result);
