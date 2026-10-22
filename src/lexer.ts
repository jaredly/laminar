export type WrapperKind = '{' | '[' | '(' | '<';
export type ListKind = ' ' | ':' | '' | '\n' | '"' | ',' | ';';
const closer = { '(': ')', '{': '}', '[': ']', '<': '>' } as const;

export type Loc = number;
export type Wrapper = { type: 'wrapper'; kind: WrapperKind; child?: Node; loc: Loc };
export type Node =
    | { type: 'id'; text: string; loc: Loc }
    | { type: 'op'; text: string; loc: Loc }
    | Wrapper
    | { type: 'list'; kind: ListKind; children: Node[]; loc: Loc };
export type Id = Node & { type: 'id' };
export type List = Node & { type: 'list' };
export type Op = Node & { type: 'op' };

type Compact = string | Compact[];
export const compact = (node: Node, loc = false): Compact => {
    if (node.type === 'wrapper') {
        if (node.child?.type === 'list' && node.child.kind !== '') {
            return [
                ...(loc ? [node.loc + ''] : []),
                node.kind + node.child.kind,
                ...node.child.children.map((c) => compact(c, loc)),
            ];
        }
    }
    return node.type === 'list'
        ? [...(loc ? [node.loc + ''] : []), node.kind, ...node.children.map((c) => compact(c, loc))]
        : node.type === 'wrapper'
          ? node.child
              ? [...(loc ? [node.loc + ''] : []), node.kind, compact(node.child, loc)]
              : [...(loc ? [node.loc + ''] : []), node.kind]
          : (loc ? node.loc + ':' : '') + node.text;
};

const fail = (msg: string) => {
    throw new Error(msg);
};

export const stringify = (node: Node, indent = 0): string => {
    if (node.type === 'wrapper') {
        return `${node.kind}${node.child ? stringify(node.child) : ''}${closer[node.kind]}`;
    }
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
                                  child.type === 'id' || child.type === 'op'
                                      ? child.text
                                      : JSON.stringify(child), // fail('string text not an id'),
                              ).slice(1, -1)
                            : '${' + stringify(child, indent) + '}',
                    )
                    .join('') +
                '"'
            );
        }
        case ' ':
            return children.join(' ');
        case ':':
            return children.join(': ');
        case '\n':
            return '\n' + children.join('\n') + '\n';
        case ';':
            return children.join(';\n');
        case ',':
            return children.join(', ');
        // case '{':
        // case '[':
        // case '(': {
        //     const childMulti = children.some((s) => s.includes('\n'));
        //     const white = Array(indent + 1).join(' ');
        //     if (childMulti) {
        //         return `${node.kind}${children.map((c) => '\n  ' + white + c + ',').join('')}\n${white}${closer[node.kind]}`;
        //     }
        //     return node.kind + children.join(', ') + closer[node.kind];
        // }
    }
};

const idrx = /[0-9a-zA-Z_']+/y;
const oprx = /[-+/~=*!@:#$%^&<>?.|]+/y;
const aftercolon = /[=]+/y;
const lineCommentrx = /\s*\/\/[^\n]*\n/y;
const multiCommentrx = /\s*\/\*.+?\*\//sy;

type Config = {
    id: RegExp;
    op: RegExp;
    aftercolon: RegExp;
    quotes: string;
    lineComment?: RegExp;
    multiComment?: RegExp;
};

export const defaultConfig: Config = {
    id: idrx,
    op: oprx,
    aftercolon: aftercolon,
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
    const result = readUntilCloser(0, text, config, '\n');
    if (result.i < text.length - 1) {
        throw new Error(
            `didnt lex everyting: ${result}, ${JSON.stringify(text.slice(result.i + 1))}`,
        );
    }
    if (!result.node) {
        throw new Error(`nothing to lex?`);
    }
    return result.node;
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
    const pos = locLines(text.split('\n'));
    try {
        const { node, i } = readUntilCloser(0, text, config);
        if (i !== text.length) {
            throw new Error(`didnt lex everyting: ${node}, ${i} ${JSON.stringify(text.slice(i))}`);
        }
        if (!node) throw new Error(`nothing lexed`);
        return {
            nodes: node.type === 'list' && node.kind === '\n' ? node.children : [node],
            pos,
        };
    } catch (err) {
        if (err instanceof LexError) {
            throw new Error(err.message + ' at ' + JSON.stringify(pos(err.loc)));
        }
        throw err;
    }
};

export const readFile = (
    text: string,
    config = defaultConfig,
): { node: Node; raw: string; pos: (loc: number) => { line: number; char: number } } => {
    const lines = readLines(text, config);
    return {
        node: { type: 'list', kind: '\n', children: lines.nodes, loc: 0 },
        pos: lines.pos,
        raw: text,
    };
};

const addToWrapper = (wrapper: { child?: Node }, sep: ListKind, next: Node) => {
    const level = listLevels.indexOf(sep);
    if (
        !wrapper.child ||
        wrapper.child.type !== 'list' ||
        wrapper.child.kind === '"' ||
        listLevels.indexOf(wrapper.child.kind) > level
    ) {
        wrapper.child = wrapper.child
            ? {
                  type: 'list',
                  kind: sep,
                  children: [wrapper.child, next],
                  loc: wrapper.child.loc,
              }
            : next; // ???
        return;
    }
    let parent = wrapper.child;
    while (parent.type === 'list') {
        if (parent.kind === sep) {
            parent.children.push(next);
            return;
        }
        if (!parent.children.length) {
            parent.children.push({ type: 'list', kind: sep, children: [next], loc: next.loc });
            return;
        }
        const lastChild = parent.children[parent.children.length - 1];
        if (
            lastChild.type !== 'list' ||
            lastChild.kind === '"' ||
            listLevels.indexOf(lastChild.kind) > level
        ) {
            parent.children[parent.children.length - 1] = {
                type: 'list',
                kind: sep,
                children: [lastChild, next],
                loc: lastChild.loc,
            };
            return;
        }
        parent = lastChild;
    }
    throw new Error(`Logic error; this should be unreachable.`);
};

/*

general approach:

if we're in a wrapped context,
keep reading until you find the pair.
Otherwise, there's a hierarchy to the levels.

export type ListKind = ' ' | ': ' | '' | '\n' | '"' | ',' | ';';



*/

const skipComments = (i: number, text: string, config: Config): [number, boolean] => {
    let lineComments = false;
    while (i < text.length) {
        if (config.lineComment) {
            config.lineComment.lastIndex = i;
            const lc = config.lineComment.exec(text);
            if (lc) {
                lineComments = true;
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
    return [i, lineComments];
};

const readId = (i: number, text: string, config: Config): void | { i: number; node: Node } => {
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
};

const read_ = (i: number, text: string, config: Config): void | { i: number; node: Node } => {
    const idop = readId(i, text, config);
    if (idop) {
        return idop;
    }

    switch (text[i]) {
        case '"':
            return readString(i, text, config);
        // case '<':
        case '(':
        case '[':
        case '{': {
            const result = readUntilCloser(i + 1, text, config, closer[text[i]]);
            if (!result) throw new Error('could not read wrapped child ' + text[i]);
            return {
                i: result.i + 1,
                node: { type: 'wrapper', kind: text[i], child: result.node, loc: i },
            };
        }
    }
};

export const listLevels: ListKind[] = ['\n', ';', ',', ' ', ':', ''];

export class LexError extends Error {
    loc: number;
    constructor(loc: number, message: string) {
        super(message);
        this.loc = loc;
    }
}

const readUntilCloser = (
    i: number,
    text: string,
    config: Config,
    closer?: string,
    // wrapper: WrapperKind,
): { i: number; node?: Node } => {
    let node: { child?: Node } = {};
    // let node: Wrapper = { type: 'wrapper', kind: wrapper, loc: i };
    while (i < text.length && text[i] !== closer) {
        let lc;
        [i, lc] = skipComments(i, text, config);
        if (i >= text.length || text[i] === closer) break;
        let level = listLevels.length - 1;
        if (lc) {
            level = listLevels.indexOf('\n');
        }
        while (listLevels.includes(text[i] as '')) {
            if (text[i] === ':') {
                config.aftercolon.lastIndex = i + 1;
                if (config.aftercolon.exec(text)) {
                    break; // allow : to be at the start of operators
                }
            }
            if (level === listLevels.length - 2 && text[i] === ' ') {
                // ignore the whitespace if we have a colon already
            } else if (level < listLevels.length - 1 && text[i] === '\n') {
                // ignore newline if we alreayd have another sep
            } else {
                level = Math.min(level, listLevels.indexOf(text[i] as ''));
            }
            i = skipComments(i + 1, text, config)[0];
        }
        if (i >= text.length || text[i] === closer) break;
        const next = read_(i, text, config);
        if (!next) throw new LexError(i, `cannot read until closer ` + closer);
        addToWrapper(node, listLevels[level], next.node);
        i = next.i;
    }
    if (closer && i >= text.length) throw new Error(`unclosed ${closer}`);
    return { i, node: node.child };
};

const readString = (i: number, text: string, config: Config): { i: number; node: Node } => {
    const nodes: Node[] = [];
    const loc = i;
    i++;
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
            let li = i + 2;
            const result = readUntilCloser(li, text, config, '}');
            if (!result) throw new Error(`could not read string interp`);
            if (!result.node) throw new Error(`string interp must have something in it`);
            i = result.i + 1;
            hi = i;
            nodes.push(result.node);
            continue;
        } else if (text[i] === '"') {
            nodes.push({ type: 'id', text: head, loc: hi });
            return { node: { type: 'list', kind: '"', children: nodes, loc }, i: i + 1 };
        } else {
            head += text[i];
            i++;
        }
    }
    throw new Error('unterminated string');
};

// <> might be context-sensitive tbh.
// < at the start of something makes a list
// if ': ' exists inside a {[( list, then it wraps higher than a ' '
// if it's within a ' ', then it's lower.
// export const read_ = (
//     i: number,
//     text: string,
//     config: Config,
//     // parent: ListKind,
// ): void | { i: number; node: Node } => {
//     config.id.lastIndex = i;
//     const id = config.id.exec(text);
//     if (id) {
//         return {
//             i: i + id[0].length,
//             node: { type: 'id', text: id[0], loc: i },
//         };
//     }
//     config.op.lastIndex = i;
//     const op = config.op.exec(text);
//     if (op) {
//         return {
//             i: i + op[0].length,
//             node: { type: 'op', text: op[0], loc: i },
//         };
//     }
//     switch (text[i]) {
//         case '"':
//         case '(':
//         case '[':
//         case '{': {
//             const nodes: Node[] = [];
//             const result = readList(i + 1, text, config, text[i], nodes);
//             return {
//                 i: result,
//                 node: { type: 'list', kind: text[i], children: nodes, loc: i },
//             };
//         }
//     }
// };
//
// export const readList = (
//     i: number,
//     text: string,
//     config: Config,
//     parent: ListKind,
//     nodes: Node[],
// ): number => {
//     let cut = true;
//     while (i < text.length) {
//         switch (parent) {
//             case '"': {
//                 let head = '';
//                 let hi = i;
//                 while (i < text.length) {
//                     if (text[i] === '\\' && i < text.length - 1) {
//                         const next = text[i + 1];
//                         // TODO: support \012 octal
//                         // and \x12ab
//                         // and \u1234
//                         switch (next) {
//                             case 'n':
//                                 head += '\n';
//                                 break;
//                             case 'b':
//                                 head += '\b';
//                                 break;
//                             case 't':
//                                 head += '\t';
//                                 break;
//                             case 'r':
//                                 head += '\r';
//                                 break;
//                             default:
//                                 head += next;
//                         }
//                         i += 2;
//                         continue;
//                     }
//                     if (text[i] === '$' && text[i + 1] === '{') {
//                         nodes.push({ type: 'id', text: head, loc: hi });
//                         head = '';
//                         const children: Node[] = [];
//                         let li = i + 2;
//                         i = readList(li, text, config, ' ', children);
//                         // skip trailing white
//                         while (i < text.length) {
//                             if (text[i] === ' ' || text[i] === '\n') {
//                                 i++;
//                                 continue;
//                             }
//                             if (config.lineComment) {
//                                 config.lineComment.lastIndex = i;
//                                 const lc = config.lineComment.exec(text);
//                                 if (lc) {
//                                     i += lc[0].length;
//                                     continue;
//                                 }
//                             }
//                             if (config.multiComment) {
//                                 config.multiComment.lastIndex = i;
//                                 const lc = config.multiComment.exec(text);
//                                 if (lc) {
//                                     i += lc[0].length;
//                                     continue;
//                                 }
//                             }
//                             break;
//                         }
//                         if (text[i] !== '}') {
//                             throw new Error(`unterminated string interpolation: ${text[i]}`);
//                         }
//                         i++;
//                         hi = i;
//                         if (children.length) {
//                             nodes.push(
//                                 children.length > 1
//                                     ? {
//                                           type: 'list',
//                                           children,
//                                           kind: ' ',
//                                           loc: li,
//                                       }
//                                     : children[0],
//                             );
//                         }
//                         continue;
//                     } else if (text[i] === '"') {
//                         nodes.push({ type: 'id', text: head, loc: hi });
//                         return i + 1;
//                     } else {
//                         head += text[i];
//                         i++;
//                     }
//                 }
//                 break;
//             }
//             case '(':
//             case '{':
//             case '[': {
//                 if (text[i] === closer[parent]) {
//                     return i + 1;
//                 }
//                 if (text[i] === ',' || text[i] === ';' || text[i] === '\n') {
//                     cut = true;
//                     i++;
//                     continue;
//                 }
//                 if (config.lineComment) {
//                     config.lineComment.lastIndex = i;
//                     const lc = config.lineComment.exec(text);
//                     if (lc) {
//                         i += lc[0].length;
//                         cut = true;
//                         continue;
//                     }
//                 }
//                 if (config.multiComment) {
//                     config.multiComment.lastIndex = i;
//                     const lc = config.multiComment.exec(text);
//                     if (lc) {
//                         i += lc[0].length;
//                         continue;
//                     }
//                 }
//                 break;
//             }
//             case '\n': {
//                 if ('\n;\r'.includes(text[i])) {
//                     cut = true;
//                     i++;
//                     continue;
//                 }
//                 if (config.lineComment) {
//                     config.lineComment.lastIndex = i;
//                     const lc = config.lineComment.exec(text);
//                     if (lc) {
//                         i += lc[0].length;
//                         cut = true;
//                         continue;
//                     }
//                 }
//                 if (config.multiComment) {
//                     config.multiComment.lastIndex = i;
//                     const lc = config.multiComment.exec(text);
//                     if (lc) {
//                         i += lc[0].length;
//                         cut = true;
//                         continue;
//                     }
//                 }
//                 break;
//             }
//             case ' ': {
//                 if (text[i] === ' ') {
//                     cut = true;
//                     i++;
//                     continue;
//                 }
//                 break;
//             }
//             case '': {
//                 if (' )]}:'.includes(text[i])) {
//                     return i;
//                 }
//                 cut = true;
//                 break;
//             }
//         }
//
//         let colon = false;
//         if (!cut && text[i] === ':') {
//             colon = true;
//             i++;
//         }
//
//         let spaced = false;
//         while (text[i] === ' ' && i < text.length - 1) {
//             if (!cut) {
//                 spaced = true;
//             }
//             i++;
//         }
//
//         if (!cut) {
//             const last = nodes[nodes.length - 1];
//             if (colon) {
//                 const sub: Node[] = [];
//                 const subKind: ListKind =
//                     // NOTE: if we want more complex type annotations (" "-spaced)
//                     // then we could have a config option to change this back
//                     // parent === " " ? "" : " ";
//                     '';
//                 const ni = readList(i, text, config, subKind, sub);
//                 if (sub.length === 0) return i; // nothing parsed, bail
//                 nodes[nodes.length - 1] = {
//                     type: 'list',
//                     kind: ': ',
//                     children: [
//                         last,
//                         sub.length === 1
//                             ? sub[0]
//                             : {
//                                   type: 'list',
//                                   kind: subKind,
//                                   children: sub,
//                                   loc: sub[0].loc,
//                               },
//                     ],
//                     loc: i,
//                 };
//                 i = ni;
//             } else {
//                 const inner: Node[] = [last];
//                 const ni = readList(i, text, config, spaced ? ' ' : '', inner);
//                 if (inner.length === 1 && inner[0] === last) {
//                     // cut = false
//                     if (spaced) {
//                         continue;
//                     }
//                     return i; // nothing parsed, bail
//                 }
//                 nodes[nodes.length - 1] = {
//                     type: 'list',
//                     kind: spaced ? ' ' : '',
//                     children: inner,
//                     loc: last.loc,
//                 };
//                 i = ni;
//             }
//             cut = false;
//             continue;
//         }
//
//         const next = read_(i, text, config);
//         if (!next) {
//             switch (parent) {
//                 case '(':
//                 case '{':
//                 case '[': {
//                     if (text[i] === closer[parent]) {
//                         return i + 1;
//                     }
//                 }
//             }
//             return i;
//         }
//
//         nodes.push(next.node);
//         i = next.i;
//         cut = false;
//     }
//     return i;
// };
