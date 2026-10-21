import {
    Id,
    Node,
    stringify,
    ListKind as NodeListKind,
    WrapperKind as NodeWrapperKind,
} from './lexer.ts';

export type { Id, Node };

export type WrapperKind = Id;
export type ListKind = Id;

export type File = FileItem[];
export type FileItem =
    | { type: 'rule'; rule: RawRule }
    | { type: 'function'; rest: Node }
    | { type: 'const'; rest: Node };

const id = (text: string): Id => ({ type: 'id', text, loc: -1 });
export type Pat =
    | { type: 'literal'; text: Id }
    | { type: 'regexp'; regexp: RegExp }
    | { type: 'rule'; name: Id; rule: Id }
    | { type: 'wrapper'; kind: Id; child?: Pat | null }
    // kind could be a set of kinds though ...
    | { type: 'list'; kind: Id; items: Pat[] }
    | { type: 'rest'; name: Id; rule: Id; multi: boolean }
    | { type: 'many'; name: Id; rule: Id }
    | { type: 'many-items'; name: Id; items: Pat[] };

export type Option = { pat: Pat; res?: Function };
export type RawRule = { name: Id; options: RawOption[] };
export type RawOption = { pat: Pat; res?: Node };

export const collectBindings = (
    pat: Pat,
    bindings: Record<string, string>,
    builtinMap: Record<string, string>,
) => {
    switch (pat.type) {
        case 'literal':
            return;
        case 'rule':
            return (bindings[pat.name.text] = builtinMap[pat.rule.text] ?? pat.rule.text);
        case 'wrapper':
            if (pat.child) {
                collectBindings(pat.child, bindings, builtinMap);
            }
            return;
        case 'list':
            return pat.items.forEach((item) => collectBindings(item, bindings, builtinMap));
        case 'rest':
            return (bindings[pat.name.text] = builtinMap[pat.rule.text] ?? pat.rule.text);
        case 'many':
            return (bindings[pat.name.text] = (builtinMap[pat.rule.text] ?? pat.rule.text) + '[]');
        case 'many-items': {
            const inner: Record<string, string> = {};
            pat.items.forEach((child) => collectBindings(child, inner, builtinMap));
            return (bindings[pat.name.text] = `{${Object.entries(inner)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ')}}`);
        }
    }
};

export const list = (kind: NodeListKind, ...items: Pat[]): Pat => ({
    type: 'list',
    kind: id(kind),
    items,
});
export const wrapper = (kind: NodeWrapperKind, child?: Pat | null): Pat => ({
    type: 'wrapper',
    kind: id(kind),
    child,
});
export const lit = (text: string): Pat => ({ type: 'literal', text: id(text) });
export const re = (regexp: RegExp): Pat => ({ type: 'regexp', regexp });
export const spaced = (...x: Pat[]) => list(' ', ...x);
export const squish = (...x: Pat[]) => list('', ...x);
export const string = (...x: Pat[]) => list('"', ...x);
export const comma = (...x: Pat[]) => list(',', ...x);
export const newline = (...x: Pat[]) => list('\n', ...x);
export const semi = (...x: Pat[]) => list(';', ...x);
export const strlit = (text: string): Pat => string(lit(text));
export const colon = (...x: Pat[]) => list(':', ...x);
export const curly = (x: Pat) => wrapper('{', x);
export const round = (x: Pat) => wrapper('(', x);
export const square = (x: Pat) => wrapper('[', x);
export const curlyc = (...x: Pat[]) => wrapper('{', comma(...x));
export const curlyn = (...x: Pat[]) => wrapper('{', newline(...x));
export const roundc = (...x: Pat[]) => wrapper('(', comma(...x));
export const rounds = (...x: Pat[]) => wrapper('(', spaced(...x));
export const squarec = (...x: Pat[]) => wrapper('[', comma(...x));
export const squares = (...x: Pat[]) => wrapper('[', spaced(...x));

export const rest = (name: string, rule: string): Pat => ({
    type: 'rest',
    name: id(name),
    rule: id(rule),
    multi: false,
});
export const mrest = (name: string, rule: string): Pat => ({
    type: 'rest',
    name: id(name),
    rule: id(rule),
    multi: true,
});
export const many = (name: string, rule: string): Pat => ({
    type: 'many',
    name: id(name),
    rule: id(rule),
});
export const manyItems = (name: string, items: Pat[]): Pat => ({
    type: 'many-items',
    name: id(name),
    items,
});
export const option = (pat: Pat, res?: Function): Option => ({ pat, res });
export const b = (name: string, rule: string): Pat => ({
    type: 'rule',
    name: id(name),
    rule: id(rule),
});

export class ParseError extends Error {
    node: Node;
    constructor(node: Node, msg: string) {
        super(msg);
        this.node = node;
    }
}

type Failure = { reason: string; loc: number; children?: Failure[] };

export const showFailure = (failure: Failure, locToPos: (loc: number) => string): string => {
    return (
        `${locToPos(failure.loc)} ${failure.reason}` +
        (failure.children
            ? failure.children.map(
                  (child, i) =>
                      `\n  ${i + 1}) ` + showFailure(child, locToPos).replace(/\n/g, '\n  '),
              )
            : '')
    );
};

export type ParseResult<T> =
    | {
          type: 'success';
          value: T;
      }
    | {
          type: 'failure';
          failure: Failure;
      };

export type PatResult =
    | {
          type: 'success';
          bindings?: Record<string, any>;
          value?: any;
      }
    | {
          type: 'failure';
          failure: Failure;
      };

export class Grammar {
    rules: Record<string, Option[]> = {};
    fns: Record<string, Pat[]> = {};
    constructor() {}
    add(name: string, rule: Option[]) {
        this.rules[name] = rule;
    }
    addRaw(name: string, rule: RawOption[]) {
        this.rules[name] = rule.map((option: RawOption): Option => {
            if (!option.res) return { pat: option.pat };
            const bindings: Record<string, string> = {};
            collectBindings(option.pat, bindings, {});
            const body = stringify(option.res);
            // console.log(bindings, body);
            const res = new Function(
                `{${Object.keys(bindings).join(',')}}`,
                body.trim().startsWith('{') ? body : 'return ' + body,
            );
            return { pat: option.pat, res };
        });
    }
    addFn(name: string, pats: Pat[]) {
        this.fns[name] = pats;
    }
    parsePat(pat: Pat, node: Node): PatResult {
        // console.log(pat.type === "list" ? pat.kind : pat.type, brief(node));
        switch (pat.type) {
            case 'regexp': {
                if (node.type === 'id' || node.type === 'op') {
                    if (node.text.match(pat.regexp)) {
                        return { type: 'success', value: node };
                    } else {
                        return {
                            type: 'failure',
                            failure: {
                                reason: `regexp mismatch, found ${JSON.stringify(node.text)}, expected ${pat.regexp}`,
                                loc: node.loc,
                            },
                        };
                    }
                } else {
                    return {
                        type: 'failure',
                        failure: {
                            reason: 'not an id/op: ' + brief(node),
                            loc: node.loc,
                        },
                    };
                }
            }
            case 'literal':
                if (node.type === 'id' || node.type === 'op') {
                    if (node.text === pat.text.text) {
                        return { type: 'success', value: node };
                    } else {
                        return {
                            type: 'failure',
                            failure: {
                                reason: `literal mismatch, found ${JSON.stringify(node.text)}, expected ${JSON.stringify(pat.text.text)}`,
                                loc: node.loc,
                            },
                        };
                    }
                } else {
                    return {
                        type: 'failure',
                        failure: {
                            reason: 'not an id/op: ' + brief(node),
                            loc: node.loc,
                        },
                    };
                }
            case 'rule': {
                const name = pat.rule.text;
                if (name === 'id') {
                    if (node.type === 'id') {
                        return {
                            type: 'success',
                            bindings: { [pat.name.text]: node },
                        };
                    }
                    return {
                        type: 'failure',
                        failure: {
                            reason: `not an id, found a ${node.type}`,
                            loc: node.loc,
                        },
                    };
                } else if (name === '*') {
                    return { type: 'success', value: node };
                } else {
                    const inner = this.parse(name, node);
                    if (inner.type === 'failure') {
                        return inner;
                    }
                    return {
                        type: 'success',
                        bindings: { [pat.name.text]: inner.value },
                    };
                }
            }
            case 'wrapper': {
                if (node.type !== 'wrapper') {
                    return {
                        type: 'failure',
                        failure: {
                            reason: 'not a wrapper, found a ' + brief(node),
                            loc: node.loc,
                        },
                    };
                }
                if (node.kind !== pat.kind.text) {
                    return {
                        type: 'failure',
                        failure: {
                            reason: `expected ${JSON.stringify(pat.kind.text)} wrapper, found ${JSON.stringify(node.kind)}`,
                            loc: node.loc,
                        },
                    };
                }
                if (!node.child) {
                    if (!pat.child) return { type: 'success' };
                    if (pat.child.type === 'list') {
                        return this.parsePat(pat.child, {
                            type: 'list',
                            kind: pat.child.kind.text as NodeListKind,
                            children: [],
                            loc: node.loc,
                        });
                    }
                    return {
                        type: 'failure',
                        failure: {
                            reason: `wrapper has no contents`,
                            loc: node.loc,
                        },
                    };
                }
                if (!pat.child) {
                    return {
                        type: 'failure',
                        failure: {
                            reason: `wrapper has contents, expected empty`,

                            loc: node.loc,
                        },
                    };
                }
                return this.parsePat(pat.child, node.child);
            }
            case 'list': {
                if (node.type !== 'list') {
                    return {
                        type: 'failure',
                        failure: {
                            reason: 'not a list, found a ' + brief(node),
                            loc: node.loc,
                        },
                    };
                }
                if (node.kind !== pat.kind.text) {
                    return {
                        type: 'failure',
                        failure: {
                            reason: `expected ${JSON.stringify(pat.kind.text)} list, found ${JSON.stringify(node.kind)}`,
                            loc: node.loc,
                        },
                    };
                }
                const bindings: Record<string, any> = {};
                let i = 0;
                for (let item of pat.items) {
                    // console.log(`LIST ITEM ${i}`, item);
                    if (i >= node.children.length) {
                        return {
                            type: 'failure',
                            failure: {
                                reason: `ran out of items while processing ${node.kind}. ${node.children.length} total items; ${pat.items.length} pattern items`,
                                loc: node.loc,
                            },
                        };
                    }
                    switch (item.type) {
                        case 'rest': {
                            if (item.multi) {
                                const got: any[] = [];
                                const options = this.rules[item.rule.text];
                                if (!options) throw new Error(`Unknown rule ${item.rule.text}`);
                                while (i < node.children.length) {
                                    for (let option of options) {
                                        if (option.pat.type !== 'list') {
                                            continue;
                                        }

                                        let failed = false;
                                        const inner: Record<string, any> = {};
                                        for (const child of option.pat.items) {
                                            if (i >= node.children.length) {
                                                failed = true;
                                                break;
                                            }
                                            const result = this.parsePat(child, node.children[i]);
                                            if (result.type === 'failure') {
                                                failed = true;
                                                break;
                                            }
                                            Object.assign(inner, result.bindings);
                                            i++;
                                        }
                                        if (failed) {
                                            continue;
                                        }
                                        got.push(inner);
                                        break;
                                    }
                                }
                                bindings[item.name.text] = got;
                                return { type: 'success', bindings };
                            }

                            const parsed = this.parse(item.rule.text, {
                                ...node,
                                children: node.children.slice(i),
                            });
                            if (parsed.type === 'failure') return parsed;
                            bindings[item.name.text] = parsed.value;
                            return { type: 'success', bindings };
                        }
                        case 'many': {
                            const got: any[] = [];
                            for (; i < node.children.length; i++) {
                                const parsed = this.parse(item.rule.text, node.children[i]);
                                if (parsed.type === 'failure') return parsed;
                                got.push(parsed.value);
                            }
                            bindings[item.name.text] = got;
                            return { type: 'success', bindings };
                        }
                        case 'many-items': {
                            const got: Record<string, any>[] = [];
                            while (i < node.children.length) {
                                const inner: Record<string, any> = {};
                                for (const child of item.items) {
                                    if (i >= node.children.length) {
                                        return {
                                            type: 'failure',
                                            failure: {
                                                reason: `ran out of items`,
                                                loc: node.loc,
                                            },
                                        };
                                    }
                                    const result = this.parsePat(child, node.children[i]);
                                    if (result.type === 'failure') return result;
                                    Object.assign(inner, result.bindings);
                                    i++;
                                }
                                got.push(inner);
                            }
                            bindings[item.name.text] = got;
                            return { type: 'success', bindings };
                        }
                        default: {
                            // console.log(
                            //     "into list pat",
                            //     item.type,
                            //     node.children[i].type,
                            //     i,
                            // );
                            const parsed = this.parsePat(item, node.children[i]);
                            if (parsed.type === 'failure') {
                                return parsed;
                            }
                            Object.assign(bindings, parsed.bindings);
                            i++;
                            continue;
                        }
                    }
                }
                if (i < node.children.length) {
                    return {
                        type: 'failure',
                        failure: {
                            reason: `Didn't parse all children`,
                            loc: node.children[i].loc,
                        },
                    };
                }
                if (Object.keys(bindings).length === 0) {
                    return { type: 'success', value: node };
                }
                return { type: 'success', bindings };
            }
            case 'rest':
            case 'many':
            case 'many-items':
                throw new Error(`Invalid rule; cant have ${pat.type} outside of a list literal`);
        }
    }
    parse(rule: string, node: Node): ParseResult<any> {
        // console.log("try parse", rule, node.type);
        if (rule === 'id') {
            if (node.type === 'id') {
                return { type: 'success', value: node };
            } else {
                return {
                    type: 'failure',
                    failure: {
                        reason: 'not an id, found ' + node.type,
                        loc: node.loc,
                    },
                };
            }
        }
        if (rule === 'any') {
            return { type: 'success', value: node };
        }
        if (!this.rules[rule]) {
            throw new ParseError(node, 'Unknown rule: ' + rule);
        }
        const failures = [];
        for (const { pat, res } of this.rules[rule]) {
            const result = this.parsePat(pat, node);
            if (result.type === 'success') {
                return {
                    type: 'success',
                    value: res
                        ? res(
                              Object.keys(result.bindings ?? {}).length
                                  ? result.bindings
                                  : { node },
                          )
                        : result.value,
                };
            }
            failures.push(result);
        }
        // console.log("failed on ", rule, node.type);
        return {
            type: 'failure',
            failure: {
                reason: `no option of rule ${rule} matched.`,
                loc: node.loc,
                children: failures.map((f) => f.failure),
            },
        };
    }
}

type Config = { lib: string; types: string };
export const toFile = (items: FileItem[], config: Config) => {
    const imports = new Set<string>();
    const names: string[] = [];
    const chunks = items.map((item) => {
        if (item.type === 'rule') {
            const { rule } = item;
            names.push(rule.name.text);
            rule.options.forEach((opt) => dslImports(opt.pat, imports));
            return `grammar.add(${JSON.stringify(rule.name.text)}, [
            ${rule.options
                .map(
                    (opt) => `    option(
                    ${asDSL(opt.pat)},${opt.res ? `\n    ${dslHead(opt.pat)}: ${rule.name.text} => ${stringify(opt.res)}` : ''}
                )`,
                )
                .join(',\n')}
            ])`;
        } else if (item.type === 'const') {
            return `const ${stringify(item.rest)}`;
        } else if (item.type === 'function') {
            return `function ${stringify(item.rest)}`;
        }
    });
    return `\
import {Grammar, Id, Node, option, ${[...imports].join(', ')}} from "${config.lib}";
import {${names.join(', ')}} from "${config.types}";

export const grammar = new Grammar();

${chunks.join('\n\n')}
    `;
};

const dslHead = (pat: Pat) => {
    const bindings: Record<string, string> = {};
    collectBindings(pat, bindings, { id: 'Id', any: 'Node', op: 'Id' });
    if (!Object.keys(bindings).length) return '({node}:{node:Node})';
    return `({${Object.keys(bindings).join(',')}}: {${Object.entries(bindings)
        .map(([name, value]) => `${name}: ${value}`)
        .join(',')}})`;
};

export const dslImports = (pat: Pat, imports: Set<string>): unknown => {
    switch (pat.type) {
        case 'literal':
            return imports.add('lit');
        case 'rule':
            return imports.add('b');
        case 'list':
            pat.items.forEach((pat) => dslImports(pat, imports));
            return imports.add(`list`);
        case 'regexp':
            return imports.add(`re`);
        case 'rest':
            return imports.add(`rest`);
        case 'wrapper':
            imports.add(`wrapper`);
            return pat.child ? dslImports(pat.child, imports) : null;
        case 'many':
            return imports.add(`many`);
        case 'many-items':
            pat.items.forEach((pat) => dslImports(pat, imports));
            return imports.add(`manyItems`);
    }
};

export const asDSL = (pat: Pat): string => {
    switch (pat.type) {
        case 'regexp':
            return `re(${pat.regexp + ''})`;
        case 'literal':
            return `lit(${JSON.stringify(pat.text.text)})`;
        case 'rule':
            return `b(${JSON.stringify(pat.name.text)},"${pat.rule.text}")`;
        case 'wrapper':
            return `wrapper(${JSON.stringify(pat.kind.text)}, ${pat.child ? asDSL(pat.child) : 'null'})`;
        case 'list':
            return `list(${JSON.stringify(pat.kind.text)}, ${pat.items.map(asDSL).join(', ')})`;
        case 'rest':
            return `rest("${pat.name.text}", "${pat.rule.text}")`;
        case 'many':
            return `many("${pat.name.text}", "${pat.rule.text}")`;
        case 'many-items':
            return `manyItems("${pat.name.text}", [${pat.items.map(asDSL).join(', ')}])`;
    }
};

const brief = (node: Node) => {
    if (node.type === 'list') return `list(${JSON.stringify(node.kind)})`;
    if (node.type === 'wrapper') return `wrapper(${JSON.stringify(node.kind)})`;
    return node.type + ':' + node.text;
};
