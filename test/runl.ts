import { readFileSync, writeFileSync } from 'fs';
import { File, Linear } from '../src/ast.ts';
import { type Ctx, resetId0, toTS } from '../src/flowtots.ts';
import {
    findDeepest,
    Grammar,
    ParseResult,
    showDeepest,
    showFailure,
    showFull,
    showPos,
} from '../src/grammar-lexer.ts';
import { grammar as grammarhs } from '../src/laminar-hs.ts';
import { grammar } from '../src/laminar-parser.ts';
import { Node, readFile } from '../src/lexer.ts';

const TOP = `
import assert from "assert";
import * as $ from "./runtime.ts";
import {it} from "node:test";

const expect = (m:any) => ({
    toThrow() {assert.throws(m)},
    toEqual(n:any) { assert.deepStrictEqual(m, n) }
})
`;

const parseFile = (node: Node, parser: Grammar): ParseResult<File> => {
    return parser.parse<File>('File', node);
};

export const runGood = (name: string, parser: Grammar) => {
    const good = readFile(readFileSync(name, 'utf-8'));

    const fns = [];
    const topNames: string[] = [];
    const pairs = [];

    const file = parseFile(good.node, parser);
    if (file.type === 'failure') {
        const locToPos = (loc: number) => showPos(good.pos(loc));
        console.error(showFailure(file.failure, locToPos));
        const deepest = findDeepest(file.failure);
        if (deepest) {
            console.error(showDeepest(deepest, parser, good.raw, locToPos));
        }
        writeFileSync('parse-failure.log', showFull(file.failure, parser, good.raw, locToPos));
        process.exit(1);
    }

    for (let i = 0; i < file.value.length; i++) {
        const node = file.value[i];
        if (node.type === 'fn' && node.name) {
            fns.push(node);
            topNames.push(node.name);
        } else if (node.type === 'decl') {
            // ignore for now
        } else {
            const expected = file.value[i + 1];
            if (expected.type === 'decl') {
                throw new Error(`no expected, found a declaration`);
            }
            i++;
            pairs.push({ node, expected });
        }
    }
    let result = TOP;

    const ctx: Ctx = { globals: topNames, scopes: [new Set()] };
    fns.forEach((fn) => {
        try {
            result += `$.addFn(${JSON.stringify(fn.name)}, ${toTS(ctx, { ...fn, name: null })});\n\n`;
        } catch (err) {
            console.log(good.pos(fn.loc));
            throw err;
        }
    });

    pairs.forEach(({ node, expected }, i) => {
        resetId0();
        result += `
it("Item ${i} at ${name}:${showPos(good.pos(node.loc))}", () => {
    const result = $.run((gamma1) => {\n${toTS(ctx, node, {})}\n});
    expect(result).toEqual(${toTS(ctx, expected)});
})
`;
    });

    const out = name + '.test.ts';
    writeFileSync(out, result);
    return out;
};

export const runError = (name: string, parser: Grammar) => {
    const error = readFile(readFileSync(name, 'utf-8'));
    let result = TOP;

    const errorFile = parseFile(error.node, parser);
    if (errorFile.type === 'failure') {
        console.error(showFailure(errorFile.failure, (loc) => showPos(error.pos(loc))));
        console.log('stopping');
        process.exit(1);
    }

    for (let i = 0; i < errorFile.value.length; i++) {
        resetId0();
        const exp = errorFile.value[i];
        if (exp.type === 'decl') {
            continue;
        }
        const at = error.pos(exp.loc);
        result += `
it("Error ${i} at ${name}:${at.line + 1}:${at.char}", () => {
    expect(() => $.run((gamma1) => {\n${toTS({ globals: [], scopes: [new Set()] }, exp, {})}\n})).toThrow();
})
`;
    }

    const out = name + '.test.ts';
    writeFileSync(out, result);
    return out;
};

export const runFile = (name: string) => {
    resetId0();
    console.log('Running file', name);
    if (!name.match(/\.flh?$/)) {
        throw new Error(`Wrong file extension. fl or flh`);
    }
    const parser = name.endsWith('.fl') ? grammar : grammarhs;

    if (name.includes('.errors.')) {
        return runError(name, parser);
    } else {
        return runGood(name, parser);
    }
};

if (import.meta.main) {
    const [_, __, name] = process.argv;
    runFile(name);
}
