import { readFileSync, openSync, writeFileSync, readSync, closeSync } from 'fs';
import { compact, defaultConfig, locLines, readFile, readLines, stringify } from '../src/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import { grammar as ir } from '../src/ir-parser.ts';
import { Decl, Expr, File, FileItem, Linear } from '../src/ast.ts';
import { showFailure, findDeepest, showDeepest } from '../src/debugFailures.ts';

const raw = readFileSync(import.meta.dirname + '/flow.test.lm', 'utf-8');
const comments: {
    text: string;
    at: { line: number; char: number };
    loc: number;
    multi: boolean;
}[] = [];
const pos = locLines(raw.split('\n'));
const lexed = readLines(raw, {
    ...defaultConfig,
    onComment(text, loc, multi) {
        const at = pos(loc);
        if (at.char === 0) {
            comments.push({ text, at, loc, multi });
        }
    },
});

console.log(comments.length);

type N<T> = { node: g.Node; v: T };

type Declaration = {
    type: 'decl';
    name: string;
    decl: N<Decl> | null;
    impl: N<Linear & { type: 'fn' }>;
    ir?: N<Expr>;
};
type TestCase = {
    type: 'test';
    body: N<Linear>;
    expected: N<Linear>;
    ir?: N<Expr>;
};

import * as g from '../src/grammar-lexer.ts';
import { lexpr, linearToExpr } from '../src/decompose.ts';
import { evalExpr } from '../src/eval.ts';
const irNode = g.list(' ', g.list('', g.lit('ir'), g.lit('->')), g.rest('ir', 'any', false));

type Comment = { type: 'comment'; text: string; multi: boolean; loc: number };
const items: (Declaration | TestCase | Comment)[] = [];
let decl: null | N<Decl> = null;
let body: null | N<Linear> = null;

for (let lnode of lexed.nodes) {
    while (comments.length && comments[0].loc < lnode.loc) {
        items.push({ ...comments.shift()!, type: 'comment' });
    }
    const results = g.parse<g.Node>('ir', lnode, {
        rules: { ir: [{ pat: irNode, res: (v) => v.ir }] },
        config: {},
    });
    if (results.type !== 'failure') {
        let v = results.value;
        if (v.type === 'list' && v.children.length === 1) {
            v = v.children[0];
        }
        const expr = ir.parse<Expr>('Expr', results.value);
        if (expr.type === 'failure') {
            console.log(pos(lnode.loc));
            throw new Error('failed to parse ir');
        }

        items[items.length - 1].ir = { v: expr.value, node: lnode };
        continue;
    }

    const itemResult = grammar.parse<FileItem>('FileItem', lnode);
    if (itemResult.type === 'failure') {
        const locToPos = (loc: number) => {
            const { line, char } = pos(loc);
            return `${line + 1}:${char}`;
        };
        let text = `Failed to parse at ${showFailure(itemResult.failure, locToPos)}`;
        const deepest = findDeepest(itemResult.failure);
        if (deepest) {
            text += '\n' + showDeepest(deepest, grammar, text, locToPos);
        }

        throw new Error(text);
    }
    const node = itemResult.value;

    if (node.type === 'let' || node.type === 'apply') {
        body = { v: node, node: lnode };
        continue;
    }
    if (node.type === 'decl') {
        decl = { v: node, node: lnode };
        continue;
    }
    if (node.type === 'fn') {
        if (!node.name) {
            throw new Error(`nameless fn at line ${pos(node.loc).line + 1}`);
        }
        items.push({ type: 'decl', name: node.name, decl, impl: { v: node, node: lnode } });
        decl = null;
        continue;
    }
    if (!body) {
        throw new Error(`what is this ${node.type} at line ${pos(node.loc).line + 1}`);
    }
    items.push({ type: 'test', body, expected: { v: node, node: lnode } });
    body = null;
}
console.log(items.length, 'items found');

/*

Ok we've got our items. Next step:
-> for each item:
    -> generate IR
    -> run tests
    -> output w/ values and/or errors
    -> parse errors ... become files w/ dump maybe?
        -> for now we'll hard fail
    -> also let's preserve comments

*/

let log: any[] = [];
const builtins = {
    '+': (a: number, b: number) => a + b,
    '-': (a: number, b: number) => a - b,
    '*': (a: number, b: number) => a * b,
    '/': (a: number, b: number) => a / b,
    '==': (a: number, b: number) => a == b,
    charList: (v: string) => [...v],
    fst: ([a, b]: [any, any]) => {
        return [a, (a: any) => [a, b]];
    },
    dup: (x: any) => [x, x],
    drop(v: any) {},
    consume(v: any) {},
    inc: (v: number) => [null, v + 1],
    log: (v: any) => {
        log.push(v);
    },
    Some: (v: number) => ({ type: 'Some', args: [v] }),
    None: () => ({ type: 'None' }),
    newlens: () => [5, () => void 0],
    putStrLn: (v: any, w: any) => {
        log.push(v);
    },
    print: (v: any, w: any) => {
        log.push(v);
    },
    openFile(fileName, w) {
        return [openSync(fileName, 'r'), w];
    },
    readFile([w, f]) {
        const buffer = new Uint8Array();
        let read = 0;
        while (true) {
            const num = readSync(f, buffer, read, 4096, read);
            if (num === 0) break;
            read += num;
        }
        return [new TextDecoder().decode(buffer), [w, f]];
    },
    closeFile(f, w) {
        closeSync(f);
    },
};

const newScope = (globals: Record<string, any>) =>
    Object.fromEntries(Object.keys(globals).map((name) => [name, -1]));

const out = [];
const globals: Record<string, any> = { ...builtins };

let errors = 0;

for (let item of items) {
    switch (item.type) {
        case 'comment': {
            out.push(item.text.trim());
            break;
        }
        case 'decl': {
            if (item.decl) {
                out.push(stringify(item.decl.node));
            }
            out.push(stringify(item.impl.node));
            try {
                const ir = linearToExpr(
                    { counter: { current: 0 }, scope: newScope({ ...globals, [item.name]: 0 }) },
                    item.impl.v,
                );
                const impl = evalExpr({ builtins: globals, scopes: [{}] }, ir);
                globals[item.name] = impl;
                out.push('');
                out.push('ir-> ' + stringify(lexpr(ir)));
            } catch (err) {
                console.log('Error at line', pos(item.impl.node.loc).line + 1);
                console.log((err as Error).stack);
                errors++;
                // throw err;
            }
            out.push('');
            break;
        }
        case 'test': {
            out.push(stringify(item.body.node));
            out.push('');
            out.push(stringify(item.expected.node));
            try {
                const ir = linearToExpr(
                    { counter: { current: 0 }, scope: newScope(globals) },
                    item.body.v,
                );
                const result = evalExpr({ builtins: globals, scopes: [{}] }, ir);
                const rir = linearToExpr(
                    { counter: { current: 0 }, scope: newScope(globals) },
                    item.expected.v,
                );
                const rresult = evalExpr({ builtins: globals, scopes: [{}] }, rir);
                if (JSON.stringify(result) !== JSON.stringify(rresult)) {
                    console.error('Not equal at line ', pos(item.expected.node.loc).line + 1);
                    console.error(result);
                    errors++;
                    console.error(rresult);
                }
                out.push('');
                out.push('ir-> ' + stringify(lexpr(ir)));
            } catch (err) {
                console.log('Error at line', pos(item.expected.node.loc).line + 1);
                console.log((err as Error).stack);
                errors++;
            }
            out.push('');
        }
    }
}
comments.forEach((c) => out.push(c.text.trim()));

console.log(`Errors: ${errors}`);
writeFileSync(import.meta.dirname + '/flow.test.lm', out.join('\n'));
