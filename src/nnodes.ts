export type ListKind = '{' | '[' | '(' | ' ' | ': ' | '' | '\n' | '"';
export type Loc = number;
export type Node =
    | { type: 'id'; text: string; loc: Loc }
    | { type: 'op'; text: string; loc: Loc }
    | { type: 'list'; kind: ListKind; children: Node[]; loc: Loc };
export type Id = Node & { type: 'id' };
export type List = Node & { type: 'list' };
export type Op = Node & { type: 'op' };

type Compact = string | Compact[];
export const compact = (node: Node): Compact =>
    node.type !== 'list' ? node.text : [node.kind, ...node.children.map(compact)];

const fail = (msg: string) => {
    throw new Error(msg);
};

export const stringify = (node: Node, indent = 0): string => {
    if (node.type !== 'list') return node.text;
    const children = node.children.map((child) => stringify(child, indent + 2));
    switch (node.kind) {
        case '':
            return children.join('');
        case '"': {
            return (
                '"' +
                node.children
                    .map((child, i) =>
                        i % 2 === 0
                            ? JSON.stringify(
                                  child.type === 'id' ? child.text : fail('string text not an id'),
                              ).slice(1, -1)
                            : '${' + stringify(child, indent) + '}',
                    )
                    .join('') +
                '"'
            );
        }
        case ' ':
            return children.join(' ');
        case ': ':
            return children.join(': ');
        case '\n':
            return children.join('\n\n');
        case '{':
        case '[':
        case '(': {
            const childMulti = children.some((s) => s.includes('\n'));
            const white = Array(indent + 1).join(' ');
            if (childMulti) {
                return `${node.kind}${children.map((c) => '\n  ' + white + c + ',').join('')}\n${white}${closer[node.kind]}`;
            }
            return node.kind + children.join(', ') + closer[node.kind];
        }
    }
};

const idrx = /[0-9a-zA-Z_']+/y;
const oprx = /[-+/~=*!@:#$%^&<>?.]+/y;
const lineCommentrx = /\s*\/\/[^\n]*\n/y;
const multiCommentrx = /\s*\/\*.+?\*\//sy;

type Config = {
    id: RegExp;
    op: RegExp;
    quotes: string;
    lineComment?: RegExp;
    multiComment?: RegExp;
};

const closer = { '(': ')', '{': '}', '[': ']' } as const;

export const defaultConfig: Config = {
    id: idrx,
    op: oprx,
    quotes: `"'`,
    lineComment: lineCommentrx,
    multiComment: multiCommentrx,
};

export const read = (text: string, config = defaultConfig) => {
    const result = read_(0, text, config);
    if (!result) throw new Error(`failed to lex`);
    if (result.i !== text.length)
        throw new Error(
            `didnt lex everyting: ${result.i}, ${JSON.stringify(text.slice(result.i))}`,
        );
    return result.node;
};

export const readLine = (text: string, config = defaultConfig): Node => {
    const nodes: Node[] = [];
    const result = readList(0, text, config, ' ', nodes);
    if (result !== text.length) {
        throw new Error(`didnt lex everyting: ${result}, ${JSON.stringify(text.slice(result))}`);
    }
    return nodes.length === 1 ? nodes[0] : { type: 'list', kind: ' ', children: nodes, loc: 0 };
};

const locLines =
    (lines: string[]) =>
    (loc: number): { line: number; char: number } => {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (loc < line.length + 1) {
                return { line: i, char: loc };
            }
            loc -= line.length + 1;
        }
        return { line: lines.length, char: loc };
    };

export const readLines = (
    text: string,
    config = defaultConfig,
): { nodes: Node[]; pos: (loc: number) => { line: number; char: number } } => {
    const nodes: Node[] = [];
    const result = readList(0, text, config, '\n', nodes);
    if (result !== text.length)
        throw new Error(`didnt lex everyting: ${result}, ${JSON.stringify(text.slice(result))}`);
    return { nodes, pos: locLines(text.split('\n')) };
};

// <> might be context-sensitive tbh.
// < at the start of something makes a list
// if ': ' exists inside a {[( list, then it wraps higher than a ' '
// if it's within a ' ', then it's lower.
export const read_ = (
    i: number,
    text: string,
    config: Config,
    // parent: ListKind,
): void | { i: number; node: Node } => {
    config.id.lastIndex = i;
    const id = config.id.exec(text);
    if (id) {
        return {
            i: i + id[0].length,
            node: { type: 'id', text: id[0], loc: i },
        };
    }
    config.op.lastIndex = i;
    const op = config.op.exec(text);
    if (op) {
        return {
            i: i + op[0].length,
            node: { type: 'op', text: op[0], loc: i },
        };
    }
    switch (text[i]) {
        case '"':
        case '(':
        case '[':
        case '{': {
            const nodes: Node[] = [];
            const result = readList(i + 1, text, config, text[i], nodes);
            return {
                i: result,
                node: { type: 'list', kind: text[i], children: nodes, loc: i },
            };
        }
    }
};

export const readList = (
    i: number,
    text: string,
    config: Config,
    parent: ListKind,
    nodes: Node[],
): number => {
    let cut = true;
    while (i < text.length) {
        switch (parent) {
            case '"': {
                let head = '';
                let hi = i;
                while (i < text.length) {
                    if (text[i] === '\\' && i < text.length - 1) {
                        const next = text[i + 1];
                        // TODO: support \012 octal
                        // and \x12ab
                        // and \u1234
                        switch (next) {
                            case 'n':
                                head += '\n';
                                break;
                            case 'b':
                                head += '\b';
                                break;
                            case 't':
                                head += '\t';
                                break;
                            case 'r':
                                head += '\r';
                                break;
                            default:
                                head += next;
                        }
                        i += 2;
                        continue;
                    }
                    if (text[i] === '$' && text[i + 1] === '{') {
                        nodes.push({ type: 'id', text: head, loc: hi });
                        head = '';
                        const children: Node[] = [];
                        let li = i + 2;
                        i = readList(li, text, config, ' ', children);
                        // skip trailing white
                        while (i < text.length) {
                            if (text[i] === ' ' || text[i] === '\n') {
                                i++;
                                continue;
                            }
                            if (config.lineComment) {
                                config.lineComment.lastIndex = i;
                                const lc = config.lineComment.exec(text);
                                if (lc) {
                                    i += lc[0].length;
                                    continue;
                                }
                            }
                            if (config.multiComment) {
                                config.multiComment.lastIndex = i;
                                const lc = config.multiComment.exec(text);
                                if (lc) {
                                    i += lc[0].length;
                                    continue;
                                }
                            }
                            break;
                        }
                        if (text[i] !== '}') {
                            throw new Error(`unterminated string interpolation: ${text[i]}`);
                        }
                        i++;
                        hi = i;
                        if (children.length) {
                            nodes.push(
                                children.length > 1
                                    ? {
                                          type: 'list',
                                          children,
                                          kind: ' ',
                                          loc: li,
                                      }
                                    : children[0],
                            );
                        }
                        continue;
                    } else if (text[i] === '"') {
                        nodes.push({ type: 'id', text: head, loc: hi });
                        return i + 1;
                    } else {
                        head += text[i];
                        i++;
                    }
                }
                break;
            }
            case '(':
            case '{':
            case '[': {
                if (text[i] === closer[parent]) {
                    return i + 1;
                }
                if (text[i] === ',' || text[i] === ';' || text[i] === '\n') {
                    cut = true;
                    i++;
                    continue;
                }
                if (config.lineComment) {
                    config.lineComment.lastIndex = i;
                    const lc = config.lineComment.exec(text);
                    if (lc) {
                        i += lc[0].length;
                        cut = true;
                        continue;
                    }
                }
                if (config.multiComment) {
                    config.multiComment.lastIndex = i;
                    const lc = config.multiComment.exec(text);
                    if (lc) {
                        i += lc[0].length;
                        continue;
                    }
                }
                break;
            }
            case '\n': {
                if ('\n;\r'.includes(text[i])) {
                    cut = true;
                    i++;
                    continue;
                }
                if (config.lineComment) {
                    config.lineComment.lastIndex = i;
                    const lc = config.lineComment.exec(text);
                    if (lc) {
                        i += lc[0].length;
                        cut = true;
                        continue;
                    }
                }
                if (config.multiComment) {
                    config.multiComment.lastIndex = i;
                    const lc = config.multiComment.exec(text);
                    if (lc) {
                        i += lc[0].length;
                        cut = true;
                        continue;
                    }
                }
                break;
            }
            case ' ': {
                if (text[i] === ' ') {
                    cut = true;
                    i++;
                    continue;
                }
                break;
            }
            case '': {
                if (' )]}:'.includes(text[i])) {
                    return i;
                }
                cut = true;
                break;
            }
        }

        let colon = false;
        if (!cut && text[i] === ':') {
            colon = true;
            i++;
        }

        let spaced = false;
        while (text[i] === ' ' && i < text.length - 1) {
            if (!cut) {
                spaced = true;
            }
            i++;
        }

        if (!cut) {
            const last = nodes[nodes.length - 1];
            if (colon) {
                const sub: Node[] = [];
                const subKind: ListKind =
                    // NOTE: if we want more complex type annotations (" "-spaced)
                    // then we could have a config option to change this back
                    // parent === " " ? "" : " ";
                    '';
                const ni = readList(i, text, config, subKind, sub);
                if (sub.length === 0) return i; // nothing parsed, bail
                nodes[nodes.length - 1] = {
                    type: 'list',
                    kind: ': ',
                    children: [
                        last,
                        sub.length === 1
                            ? sub[0]
                            : {
                                  type: 'list',
                                  kind: subKind,
                                  children: sub,
                                  loc: sub[0].loc,
                              },
                    ],
                    loc: i,
                };
                i = ni;
            } else {
                const inner: Node[] = [last];
                const ni = readList(i, text, config, spaced ? ' ' : '', inner);
                if (inner.length === 1 && inner[0] === last) {
                    // cut = false
                    if (spaced) {
                        continue;
                    }
                    return i; // nothing parsed, bail
                }
                nodes[nodes.length - 1] = {
                    type: 'list',
                    kind: spaced ? ' ' : '',
                    children: inner,
                    loc: last.loc,
                };
                i = ni;
            }
            cut = false;
            continue;
        }

        const next = read_(i, text, config);
        if (!next) {
            switch (parent) {
                case '(':
                case '{':
                case '[': {
                    if (text[i] === closer[parent]) {
                        return i + 1;
                    }
                }
            }
            return i;
        }

        nodes.push(next.node);
        i = next.i;
        cut = false;
    }
    return i;
};
