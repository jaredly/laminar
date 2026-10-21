import { compact, type Node } from './nnodes.ts';
import type { Pat, Type, Term, Lens, Linear, Id } from './ast.ts';

// | { type: "op"; op: Id; items: Expr[] }
// | { type: "additive_product"; left: Expr; right: Expr }
// | { type: "ifs"; conds: { cond: Expr; body: Expr }[]; else: Expr }
// promote
// descard, copy, derelict

const parsePat = (cst: Node): Pat => {
    if (cst.type === 'id') {
        if (cst.text === '_') return { type: 'drop' };
        return { type: 'id', text: cst.text };
    }
    if (cst.type === 'op') throw new Error('pat op');
    switch (cst.kind) {
        case '':
            if (cst.children.length === 2) {
                const [a, b] = cst.children;
                if (a.type === 'op' && a.text === '~') {
                    return { type: 'lens', inner: parsePat(b) };
                }
                if (a.type === 'id' && b.type === 'list' && b.kind === '(') {
                    return {
                        type: 'constructor',
                        name: a.text,
                        args: b.children.map((child) => parsePat(child)),
                    };
                }
            }
            console.log('bad', compact(cst), cst);
            throw new Error('bad pat squish');
        case '{':
        case '[':
        case '"':
            throw new ParseError(cst, 'bad pat');
        case '(': {
            const items = cst.children.map((child) => parsePat(child));
            if (items.length === 1) return items[0];
            return { type: 'tuple', items };
        }
        case ' ':
            throw new Error('bad pat');
        case ': ':
            throw new Error('bad pat');
        case '\n':
            throw new Error('bad pat');
    }
};

const parseType = (cst: Node): Type => {
    if (cst.type === 'id') return { type: 'id', text: cst.text };
    if (cst.type === 'op') throw new Error('pat op');
    switch (cst.kind) {
        case '':
            if (cst.children.length === 2) {
                const [a, b] = cst.children;
                if (a.type === 'op' && a.text === '~') {
                    return { type: 'lens', left: parseType(b) };
                }
            }
            if (cst.children.length === 3) {
                const [a, b, c] = cst.children;
                if (b.type === 'op' && b.text === '/') {
                    return {
                        type: 'lens',
                        left: parseType(a),
                        right: parseType(c),
                    };
                }
            }
            console.log('bad', compact(cst));
            throw new Error('bad squish');
        case '{':
        case '[':
        case '"':
            throw new ParseError(cst, 'bad type');
        case '(': {
            const items = cst.children.map((child) => parseType(child));
            if (items.length === 1) return items[0];
            return { type: 'tuple', items };
        }
        case ' ':
            if (cst.children.length === 3) {
                const [a, b, c] = cst.children;
                if (b.type === 'op' && b.text === '=>') {
                    return {
                        type: 'fn',
                        args:
                            a.type === 'list' && a.kind === '('
                                ? a.children.map((child) => parseType(child))
                                : [parseType(a)],
                        body: parseType(c),
                    };
                }
            }
            throw new Error('bad type');
        case ': ':
            throw new Error('bad type');
        case '\n':
            throw new Error('bad type');
    }
};

export const names = (pat: Pat): string[] => {
    switch (pat.type) {
        case 'id':
            return [pat.text];
        case 'drop':
            return [];
        case 'tuple':
            return pat.items.flatMap(names);
        case 'constructor':
            return pat.args.flatMap(names);
        case 'lens':
            return names(pat.inner);
    }
};

export const free = (expr: Term | Lens): string[] => {
    switch (expr.type) {
        case 'aslens': {
            const one = free(expr.value);
            const bound = names(expr.pat);
            const two = free(expr.body);
            return one.concat(two.filter((t) => !one.includes(t) && !bound.includes(t)));
        }
        case 'string': {
            let res: string[] = [];
            expr.interp.forEach((item) => {
                free(item.value).forEach((name) => {
                    if (!res.includes(name)) res.push(name);
                });
            });
            return res;
        }
        case 'id':
            return [expr.text];
        case 'const':
            return [];
        case 'let': {
            const one = free(expr.value);
            const bound = names(expr.pat);
            const two = free(expr.body);
            return one.concat(two.filter((t) => !one.includes(t) && !bound.includes(t)));
        }
        case 'case': {
            const res = free(expr.value);
            expr.cases.forEach((kase) => {
                const bound = names(kase.pat);
                free(kase.body)
                    .filter((t) => !bound.includes(t))
                    .forEach((name) => {
                        if (!res.includes(name)) res.push(name);
                    });
            });
            return res;
        }
        // case "additive_product":
        //     throw new Error("not uet");
        case 'tuple':
            return expr.items.flatMap(free);
        // case "ifs":
        //     throw new Error("nop");
        case 'fn': {
            const bound = expr.args.flatMap((arg) => names(arg.pat));
            return free(expr.body).filter((t) => !bound.includes(t));
        }
        case 'apply': {
            return free(expr.fn).concat(expr.args.flatMap(free));
        }
        case 'lens':
            return free(expr.lens);
        case 'constructor': {
            throw new Error('nop');
        }
        case 'assign': {
            return free(expr.value);
        }
    }
};

export class ParseError extends Error {
    cst: Node | Term;
    constructor(cst: Node | Term, message: string) {
        super(message);
        this.cst = cst;
    }
}

export const parseLensBlock = (children: Node[]): Lens => {
    if (children.length === 1) {
        return parseLens(children[0]);
    }
    const next = children[0];
    if (next.type === 'list' && next.kind === ' ') {
        if (next.children[0].type === 'id' && next.children[0].text === 'let') {
            if (next.children.length < 4) throw new ParseError(next, 'why let');
            const pat = parsePat(next.children[1]);
            if (next.children[2].type !== 'op' || next.children[2].text !== '=') {
                throw new ParseError(next, 'let equal pls');
            }
            const value = parseTerm(
                next.children.length === 4
                    ? next.children[3]
                    : {
                          ...next,
                          children: next.children.slice(3),
                      },
            );
            return {
                type: 'let',
                pat,
                value,
                body: parseLensBlock(children.slice(1)),
            };
        }
        if (next.children[0].type === 'id' && next.children[0].text === 'lens') {
            if (next.children.length < 4) throw new ParseError(next, 'why let');
            const pat = parsePat(next.children[1]);
            if (next.children[2].type !== 'op' || next.children[2].text !== '<-') {
                throw new ParseError(next, 'let equal pls');
            }
            const value = parseLinear(
                next.children.length === 4
                    ? next.children[3]
                    : {
                          ...next,
                          children: next.children.slice(3),
                      },
            );
            return {
                type: 'aslens',
                pat,
                value,
                body: parseBlock(children.slice(1)),
            };
        }
    }
    return {
        type: 'let',
        pat: { type: 'tuple', items: [] },
        value: parseTerm(next),
        body: parseLensBlock(children.slice(1)),
    };
};

export const parseBlock = (children: Node[]): Linear => {
    if (children.length === 1) {
        return parseLinear(children[0]);
    }
    const next = children[0];
    if (next.type === 'list' && next.kind === ' ') {
        if (next.children[0].type === 'id' && next.children[0].text === 'let') {
            if (next.children.length < 4) throw new ParseError(next, 'why let');
            const pat = parsePat(next.children[1]);
            if (next.children[2].type !== 'op' || next.children[2].text !== '=') {
                throw new ParseError(next, 'let equal pls');
            }
            const value = parseTerm(
                next.children.length === 4
                    ? next.children[3]
                    : {
                          ...next,
                          children: next.children.slice(3),
                      },
            );
            return {
                type: 'let',
                pat,
                value,
                body: parseBlock(children.slice(1)),
            };
        }
    }
    return {
        type: 'let',
        pat: { type: 'tuple', items: [] },
        value: parseTerm(next),
        body: parseBlock(children.slice(1)),
    };
};

export const parseTerm = (cst: Node): Term => {
    if (cst.type === 'list' && cst.kind === '' && cst.children.length > 1) {
        const first = cst.children[0];
        if (first.type === 'op' && first.text === '~') {
            return {
                type: 'lens',
                lens: parseLens({ ...cst, children: cst.children.slice(1) }),
            };
        }
    }
    return parseLinear(cst);
};

export const parseLens = (cst: Node): Lens => {
    if (cst.type === 'id') return { type: 'id', text: cst.text };
    if (cst.type === 'op') throw new Error('pat op');
    switch (cst.kind) {
        case '':
            if (cst.children.length === 1) return parseLens(cst.children[0]);
            if (cst.children.length === 2) {
                const [a, b] = cst.children;
                if (b.type === 'list' && b.kind === '(') {
                    return {
                        type: 'apply',
                        fn: parseLinear(a),
                        args: b.children.map((child) => parseTerm(child)),
                    };
                }
            }
            throw new ParseError(cst, 'bad lens squish');
        case '{':
            return parseLensBlock(cst.children);
        case '[':
        case '"':
            throw new ParseError(cst, 'bad lens');
        case '(': {
            const items = cst.children.map((child) => parseLens(child));
            if (items.length === 1) return items[0];
            return { type: 'tuple', items };
        }
        case ' ':
            throw new Error('bad lens');
        case ': ':
            throw new Error('bad lens');
        case '\n':
            throw new Error('bad lens');
    }
};

export const parseLinear = (cst: Node): Linear => {
    if (cst.type === 'id') {
        if (cst.text === '~') throw new Error('bad text ~');
        if (cst.text.match(/^[0-9]+$/)) {
            return { type: 'const', value: +cst.text };
        }
        if (cst.text === 'true' || cst.text === 'false') {
            return { type: 'const', value: cst.text === 'true' };
        }
        return { type: 'id', text: cst.text };
    }
    if (cst.type === 'op') {
        console.log(cst);
        throw new Error('shouldnt get this far');
    }
    switch (cst.kind) {
        case '': {
            return parseOp(cst.children);
        }
        case '"': {
            if (cst.children.length % 2 !== 1) {
                throw new Error(`strings expected to have odd number of children`);
            }
            if (cst.children[0].type !== 'id') {
                throw new Error('string expected to have id as first child');
            }
            const node: Linear & { type: 'string' } = {
                head: cst.children[0].text,
                interp: [],
                type: 'string',
            };
            for (let i = 1; i < cst.children.length; i += 2) {
                const tail = cst.children[i + 1];
                if (tail.type !== 'id') {
                    throw new ParseError(tail, `string interp tail not id`);
                }
                node.interp.push({
                    value: parseLinear(cst.children[i]),
                    tail: tail.text,
                });
            }
            return node;
        }
        case '{':
            return parseBlock(cst.children);
        case '[':
            throw new ParseError(cst, 'no arrays yet');
        case '(':
            if (!cst.children.length) {
                return { type: 'const', value: null };
            }
            if (cst.children.length === 1) {
                return parseLinear(cst.children[0]);
            }
            return {
                type: 'tuple',
                items: cst.children.map((child) => parseLinear(child)),
            };
        case ' ':
            if (cst.children.length === 1) return parseLinear(cst.children[0]);
            // if (
            //     cst.children[0].type === "id" &&
            //     cst.children[0].text === "if"
            // ) {
            //     const ifs: Expr & { type: "ifs" } = {
            //         type: "ifs",
            //         conds: [],
            //         else: { type: "tuple", items: [] },
            //     };
            //     let bins: Node[] = [];
            //     let i = 1;
            //     for (; i < cst.children.length; i++) {
            //         const at = cst.children[i];
            //         if (at.type === "list" && at.kind === "{") {
            //             break;
            //         }
            //         bins.push(at);
            //     }
            //     const cond = parseExpr({
            //         type: "list",
            //         kind: " ",
            //         children: bins,
            //     });
            //     if (i >= cst.children.length) {
            //         throw new ParseError(cst, "no block");
            //     }
            //     const at = cst.children[i];
            //     if (at.type !== "list" || at.kind !== "{") {
            //         throw new ParseError(at, "not block");
            //     }
            //     const body = parseBlock(at.children);
            //     ifs.conds.push({ cond, body });
            //     i++;
            //     if (i < cst.children.length - 1) {
            //         const next = cst.children[i];
            //         if (next.type !== "id" || next.text !== "else") {
            //             throw new ParseError(cst, "bad if else");
            //         }
            //         ifs.else = parseExpr(cst.children[i + 1]);
            //         i += 2;
            //     }
            //     if (i < cst.children.length) {
            //         throw new ParseError(cst, "trailing if items");
            //     }
            //     return ifs;
            // }
            if (cst.children.length === 3) {
                const [a, b, c] = cst.children;
                if (a.type === 'id' && a.text === 'match') {
                    if (c.type !== 'list' || c.kind !== '{') {
                        throw new Error('match bad body');
                    }
                    return {
                        type: 'case',
                        value: parseLinear(b),
                        cases: c.children.map((child) => {
                            if (child.type !== 'list' || child.kind !== ' ') {
                                throw new ParseError(child, 'bad case');
                            }
                            if (
                                child.children[1].type !== 'op' ||
                                child.children[1].text !== '=>'
                            ) {
                                throw new ParseError(child, 'bad case');
                            }
                            const pat = parsePat(child.children[0]);
                            const body = parseLinear({
                                ...child,
                                children: child.children.slice(2),
                            });
                            return { pat, body };
                        }),
                    };
                }
                if (a.type === 'id' && a.text === 'fn') {
                    const [head, ann] = getAnn(b);
                    let name = null;
                    let args: Node[] = [];
                    if (head.type === 'list' && head.kind === '(') {
                        args = head.children;
                    } else if (
                        head.type !== 'list' ||
                        head.kind !== '' ||
                        head.children.length !== 2 ||
                        head.children[0].type !== 'id' ||
                        head.children[1].type !== 'list' ||
                        head.children[1].kind !== '('
                    ) {
                        throw new Error(`bad fn head`);
                    } else {
                        name = head.children[0].text;
                        args = head.children[1].children;
                    }
                    const body: Term =
                        c.type === 'list' &&
                        c.kind === '' &&
                        c.children[0].type === 'op' &&
                        c.children[0].text === '~'
                            ? {
                                  type: 'lens',
                                  lens: parseLens({
                                      ...c,
                                      children: c.children.slice(1),
                                  }),
                              }
                            : c.type === 'list' && c.kind === '{'
                              ? c.children.length === 1
                                  ? parseTerm(c.children[0])
                                  : parseBlock(c.children)
                              : fail(new ParseError(c, 'fn bad body'));
                    //
                    // }
                    // if (c.type !== "list" || c.kind !== "{") {
                    //     throw new Error("fn bad body");
                    // }
                    return {
                        type: 'fn',
                        name: name,
                        ann: ann ? parseType(ann) : null,
                        args: args.map((arg) => {
                            const [pat, ann] = getAnn(arg);
                            return {
                                pat: parsePat(pat),
                                typ: ann ? parseType(ann) : { type: 'id', text: '()' },
                            };
                        }),
                        body,
                    };
                }
            }
            if (
                cst.children.length >= 3 &&
                cst.children[1].type === 'op' &&
                cst.children[1].text === ':='
            ) {
                return {
                    type: 'assign',
                    lens: parseLens(cst.children[0]),
                    value: parseLinear({
                        ...cst,
                        children: cst.children.slice(2),
                    }),
                };
            }
            if (cst.children.length % 2 !== 1) {
                console.log(cst);
                throw new Error('binops need odd number');
            }
            const ops: { op: Id; right: Linear }[] = [];
            for (let i = 1; i < cst.children.length; i += 2) {
                const op = cst.children[i];
                if (op.type !== 'op') throw new Error('not an op' + compact(op));
                const right = parseLinear(cst.children[i + 1]);
                if (op.text === '~') throw new Error('bad op tilde ~');
                ops.push({ op: { type: 'id', text: op.text }, right });
            }
            return partition(parseLinear(cst.children[0]), ops);
        // console.log(compact(cst));
        // throw new Error("niopsss");
        case ': ':
            throw new Error('colon bad spot');
        case '\n':
            throw new Error('multiline expr maybe');
    }
};

const fail = (e: Error) => {
    throw e;
};

const getAnn = (node: Node): [Node, null | Node] => {
    if (node.type === 'list' && node.kind === ': ' && node.children.length === 2) {
        return [node.children[0], node.children[1]];
    }
    return [node, null];
};

// const binops = ["<", ">", "<=", ">=", "!=", "==", "+", "-", "*", "/", "^", "%"];
const precedence = [['!=', '=='], ['>', '<', '>=', '<='], ['%'], ['+', '-'], ['*', '/'], ['^']];

const opprec: Record<string, number> = {};
precedence.forEach((row, i) => {
    row.forEach((n) => (opprec[n] = i));
});

type Data<Expr> = {
    type: 'tmp';
    left: Expr | Data<Expr>;
    op: Id;
    prec: number;
    right: Expr | Data<Expr>;
};

const add = <Expr extends { type: string }>(
    data: Data<Expr> | Expr,
    op: Id,
    right: Expr,
): Data<Expr> => {
    const prec = opprec[op.text];
    if (data.type !== 'tmp' || prec <= (data as Data<Expr>).prec) {
        return { type: 'tmp', left: data, op, prec, right };
    } else {
        const d = data as Data<Expr>;
        return { ...d, right: add(d.right, op, right) };
    }
};

const dataToExpr = (data: Data<Linear> | Linear): Linear => {
    if (data.type !== 'tmp') return data;
    const left = dataToExpr(data.left);
    const right = dataToExpr(data.right);
    if (data.op.text === '~') {
        console.log('bad datatoexpropp ~');
    }
    return {
        type: 'apply',
        fn: data.op,
        args: [left, right],
        // src: mergeSrc(left.src, right.src),
    };
};

// This is probably the same algorithm as the simple precedence parser
// https://en.wikipedia.org/wiki/Simple_precedence_parser
const partition = (left: Linear, rights: { op: Id; right: Linear }[]) => {
    let data: Data<Linear> | Linear = left;
    rights.forEach(({ op, right }) => {
        data = add(data, op, right);
    });
    return dataToExpr(data);
};

const parseOp = (items: Node[]): Linear => {
    if (items[0].type === 'op') {
        if (items[0].text === '~') {
            throw new Error('bad op text ~');
        }
        return {
            type: 'apply',
            fn: { type: 'id', text: items[0].text },
            args: [parseOp(items.slice(1))],
        };
    }
    let head = parseLinear(items[0]);
    for (let i = 1; i < items.length; i++) {
        const tail = items[i];
        if (tail.type === 'list' && tail.kind === '(') {
            head = {
                type: 'apply',
                fn: head,
                args: tail.children.map((item) => parseTerm(item)),
            };
        } else {
            console.log(tail);
            throw new Error('no op idk');
        }
    }

    return head;
};
