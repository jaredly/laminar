import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from 'fs';
import { Decl, FileItem, Linear } from '../src/ast.ts';
import { findDeepest, showDeepest, showFailure } from '../parser-generator/debugFailures.ts';
import { lexpr, linearToExpr, Scope } from '../src/decompose.ts';
import { Ctx, dupAt, evalExpr, Frame, LocError, Mem, Pointer } from '../src/eval.ts';
import { Expr } from '../src/expr.ts';
import * as g from '../parser-generator/grammar-lexer.ts';
import { grammar as ir } from '../src/ir-parser.ts';
import { grammar } from '../src/laminar-parser.ts';
import { defaultConfig, locLines, readLines, stringify } from '../parser-generator/lexer.ts';

/**
 * What does this do?
 * It takes a `file.test.lm` or a `file.errors.lm`,
 * recreates the snapshot, reformatting, creating IR,
 * and checking results.
 */

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

const irNode = g.list(' ', g.list('', g.lit('ir'), g.lit('->')), g.rest('ir', 'any', false));
type Comment = { type: 'comment'; text: string; multi: boolean; loc: number };

export const runSnapshot = (raw: string, filePath: string, verbose = false) => {
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

    const items: (Declaration | TestCase | Comment)[] = [];
    let decl: null | N<Decl> = null;
    let body: null | N<Linear> = null;

    for (let lnode of lexed.nodes) {
        while (comments.length && comments[0].loc < lnode.loc) {
            items.push({ ...comments.shift()!, type: 'comment' });
        }
        const results = g.parse<g.Node>('ir', lnode, {
            rules: { ir: [{ pat: irNode, res: (v: { ir: g.Node }) => v.ir }] },
            config: {},
        });

        if (results.type !== 'failure') {
            let v = results.value;
            if (v.type === 'list' && v.children.length === 1) {
                v = v.children[0];
            }
            const expr = ir.parse<Expr>('Expr', results.value);
            if (expr.type === 'failure') {
                if (verbose) {
                    console.log(pos(lnode.loc));
                }
                // throw new Error('failed to parse ir');
                const locToPos = (loc: number) => {
                    const { line, char } = pos(loc);
                    return `${line + 1}:${char}`;
                };
                let text = `Failed to parse at ${showFailure(expr.failure, locToPos)}`;
                const deepest = findDeepest(expr.failure);
                if (deepest) {
                    text += '\n' + showDeepest(deepest, ir, text, locToPos);
                }

                console.warn(text);
            } else {
                const last = items[items.length - 1];
                if (last.type !== 'comment') {
                    last.ir = { v: expr.value, node: lnode };
                } else {
                    throw new Error('Cant have comment there');
                }
            }
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

            throw new Error(`Cnat do ir`);
        }
        const node = itemResult.value;

        if (
            body == null &&
            (node.type === 'let' ||
                node.type === 'apply' ||
                node.type === 'constructor' ||
                node.type === 'case')
        ) {
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
    if (verbose) {
        console.log(items.length, 'items found');
    }

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
    let input: string[] = [];
    const builtins = {
        heapsize: (v: any) => {
            throw new Error(`heap fn is handled specially by the eval`);
        },
        heap: (v: any) => {
            throw new Error(`heap fn is handled specially by the eval`);
        },
        '+': (_: any, a: number, b: number) => a + b,
        '-': (_: any, a: number, b: number) => a - b,
        '*': (_: any, a: number, b: number) => a * b,
        '/': (_: any, a: number, b: number) => a / b,
        '==': (_: any, a: number, b: number) => a == b,
        '>=': (_: any, a: number, b: number) => a >= b,
        '<=': (_: any, a: number, b: number) => a <= b,
        round: (_: any, n: number) => Math.round(n),
        charList: (_: any, v: string) => {
            console.log('got teh chars', v);
            return [...v];
        },
        fst: (_stack: Frame[], pointer: Pointer): [Pointer, () => void] => {
            if (pointer.type === 'tuple') {
                return [pointer.items[0], () => {}];
            }
            return [{ ...pointer, path: pointer.path.concat([0]) }, () => {}];
        },
        dup: (mem: Mem, x: any) => {
            // let d = typeof x === 'string' || typeof x === 'number' ? x : structuredClone(x);
            return dupAt({ ...mem, scopes: [], builtins: {} }, x, -1);
        },
        drop(v: any) {},
        consume(v: any) {},
        inc: (v: number) => [null, v + 1],
        log: (_: any, v: any) => {
            log.push(v);
        },
        setInput: (ins: string[]) => {
            input = ins;
        },
        getInput(text: string) {
            if (!input.length) throw new Error('no more input');
            log.push(text);
            return input.shift();
        },
        Some: (v: number) => ({ type: 'Some', args: [v] }),
        None: () => ({ type: 'None' }),
        // newlens: () => [5, () => void 0],
        putStrLn: (_: any, v: any, w: any) => {
            log.push(v);
            return [null, w];
        },
        print: (_: any, v: any, w: any) => {
            log.push(v);
            return [null, w];
        },
        openFile(_: any, fileName: string, w: any) {
            if (fileName === 'example.txt') {
                if (verbose) console.log('opened');
                return -1;
            }
            return openSync(fileName, 'r');
        },
        readFile(stack: Mem, ok: Pointer) {
            // console.log('readfile', JSON.stringify(ok));
            const [w, f] = dupAt({ ...stack, builtins: {}, scopes: [] }, ok, -1);
            // if (f === -1) return ['one', [w, f]];
            if (f === -1) return 'two\nthree four five\nsix seven height nine';
            if (verbose) console.log('bot bas');
            const buffer = new Uint8Array(
                new ArrayBuffer(4096, { maxByteLength: 10 * 1000 * 1000 }),
            );
            let read = 0;
            while (true) {
                const num = readSync(f, buffer, read, 4096, read);
                if (num === 0) break;
                read += num;
                buffer.buffer.resize(read + 4096);
            }
            return new TextDecoder().decode(buffer.slice(0, read));
        },
        closeFile(stack: any, f: number, w: any) {
            if (f === -1) return [null, w];
            closeSync(f);
            return [null, w];
        },
        logs() {
            return log.slice();
        },
    };

    const newScope = (globals: Record<string, any>): Scope =>
        Object.fromEntries(Object.keys(globals).map((name) => [name, { type: 'builtin' }]));

    const out = [];
    const globals: Record<string, any> = { ...builtins };

    // let errors = 0;

    const heap: Ctx['heap'] = { lid: 0, data: {} };

    const nctx = (): Ctx => ({
        builtins: globals,
        scopes: [{ bindings: {} }],
        stack: [{ values: [], id: '<root>' }],
        heap,
    });

    const testResults: {
        title: string;
        failure?: Error | [string, string];
    }[] = [];

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
                const title = `Declaration at ${filePath}:${pos(item.impl.node.loc).line + 1}`;
                try {
                    const ir = linearToExpr(
                        {
                            counter: { current: 0 },
                            scope: newScope({ ...globals, [item.name]: { type: 'stack', id: 0 } }),
                        },
                        item.impl.v,
                    );
                    const impl = evalExpr(nctx(), ir);
                    globals[item.name] = impl;
                    out.push('');
                    out.push('ir-> ' + stringify(lexpr(ir)));
                    testResults.push({ title });
                } catch (err) {
                    if (err instanceof LocError) {
                        err.message += ' at line ' + pos(err.loc).line + 1;
                    }
                    if (verbose) {
                        console.log('Error at line', pos(item.impl.node.loc).line + 1);
                        console.error(err);
                    }
                    testResults.push({
                        title,
                        failure: err as Error,
                    });
                    // errors++;
                    // throw err;
                }
                out.push('');
                break;
            }
            case 'test': {
                log = [];
                // reset the heap
                heap.lid = 0;
                heap.data = {};
                out.push(stringify(item.body.node));
                out.push('');
                out.push(stringify(item.expected.node));
                const title = `Test at ${filePath}:${pos(item.expected.node.loc).line + 1}`;
                if (verbose) {
                    console.log('####', title);
                }
                try {
                    const ir = linearToExpr(
                        { counter: { current: 0 }, scope: newScope(globals) },
                        item.body.v,
                    );
                    out.push('');
                    out.push('ir-> ' + stringify(lexpr(ir)));
                    const result = evalExpr(nctx(), ir);
                    const rir = linearToExpr(
                        { counter: { current: 0 }, scope: newScope(globals) },
                        item.expected.v,
                    );
                    const rresult = evalExpr(nctx(), rir);
                    if (JSON.stringify(result) !== JSON.stringify(rresult)) {
                        if (verbose) {
                            console.error(
                                'Not equal at line ',
                                pos(item.expected.node.loc).line + 1,
                            );
                            console.error('-> ', result);
                            console.error('!> ', rresult);
                        }
                        testResults.push({
                            title,
                            failure: [JSON.stringify(result), JSON.stringify(rresult)],
                        });
                    } else {
                        if (verbose) {
                            console.log(
                                `Test pass ${filePath}:${pos(item.expected.node.loc).line + 1}`,
                            );
                        }
                        testResults.push({ title });
                    }
                } catch (err) {
                    if (err instanceof LocError) {
                        err.message += ' at line ' + (pos(err.loc).line + 1);
                    }
                    if (verbose) {
                        console.log('Error at line', pos(item.expected.node.loc).line + 1);
                        console.error(err);
                    }
                    testResults.push({ title, failure: err as Error });
                }
                out.push('');
            }
        }
    }
    comments.forEach((c) => out.push(c.text.trim()));
    return { comments, testResults, text: out.join('\n') };
};

if (import.meta.main) {
    const [_, __, path] = process.argv;
    if (!path || !path.endsWith('.test.lm') || !existsSync(path)) {
        console.warn(`Usage: fixtures some.test.lm`);
        process.exit(2);
    }
    const { testResults, text } = runSnapshot(readFileSync(path, 'utf-8'), path, true);

    const errors = testResults.filter((r) => r.failure).length;
    if (errors) {
        console.error(`Errors: ${errors}`);
    } else {
        console.log('✅ All Clear!');
    }
    writeFileSync(path, text);
}
