import { JSONValue } from './json.ts';
import { Id, Op, Node, stringify, ListKind, WrapperKind, compact, listLevels } from './lexer.ts';

export type { Id, Op, Node };

export type File = FileItem[];
export type FileItem =
    | { type: 'rule'; rule: RawRule }
    | { type: 'function'; rest: Node }
    | { type: 'import'; rest: Node }
    | { type: 'config'; values: Record<string, ConfigValue> }
    | { type: 'const'; rest: Node };

export type ConfigItem = [string, ConfigValue];
export type ConfigValue = JSONValue;

const id = (text: string): Id => ({ type: 'id', text, loc: -1 });
export type Pat =
    | { type: 'literal'; text: Id }
    | { type: 'regexp'; regexp: RegExp }
    | { type: 'rule'; name: Id; rule: Id | { type: 'regex'; rx: RegExp } }
    | { type: 'wrapper'; kind: Id; child?: Pat | null }
    // kind could be a set of kinds though ...
    | { type: 'list'; kind: Id; items: Pat[] }
    | { type: 'rest'; name: Id; rule: Id; multi: boolean }
    | { type: 'many'; name: Id; rule: Id }
    | { type: 'many-items'; name: Id; items: Pat[] };

export type Option = { pat: Pat; res?: Function };
export type RawRule = { name: { name: Id; ann?: Node }; options: RawOption[] };
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
            return (bindings[pat.name.text] =
                pat.rule.type === 'regex' ? 'Id' : (builtinMap[pat.rule.text] ?? pat.rule.text));
        case 'wrapper':
            if (pat.child) {
                collectBindings(pat.child, bindings, builtinMap);
            }
            return;
        case 'list':
            return pat.items.forEach((item) => collectBindings(item, bindings, builtinMap));
        case 'rest':
            return (bindings[pat.name.text] =
                (builtinMap[pat.rule.text] ?? pat.rule.text) + (pat.multi ? '[]' : ''));
        case 'many':
            return (bindings[pat.name.text] = (builtinMap[pat.rule.text] ?? pat.rule.text) + '[]');
        case 'many-items': {
            const inner: Record<string, string> = {};
            pat.items.forEach((child) => collectBindings(child, inner, builtinMap));
            return (bindings[pat.name.text] = `{${Object.entries(inner)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ')}}[]`);
        }
    }
};

export const list = (kind: ListKind, ...items: Pat[]): Pat => ({
    type: 'list',
    kind: id(kind),
    items,
});
export const wrapper = (kind: WrapperKind, child?: Pat | null): Pat => ({
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

export const rest = (name: string, rule: string, multi = false): Pat => ({
    type: 'rest',
    name: id(name),
    rule: id(rule),
    multi,
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
export const b = (name: string, rule: string | RegExp): Pat => ({
    type: 'rule',
    name: id(name),
    rule: typeof rule === 'string' ? id(rule) : { type: 'regex', rx: rule },
});

export class ParseError extends Error {
    node: Node;
    constructor(node: Node, msg: string) {
        super(msg);
        this.node = node;
    }
}

export type Failure = {
    reason: string;
    rule?: { name: string; option: number; node: Node };
    loc: number;
    children?: Failure[];
};

export const findDeepest = (
    failure: Failure,
): null | { path: Failure['rule'][]; failure: Failure } => {
    let deepest: null | { path: Failure['rule'][]; failure: Failure } = null;
    const next = (failure: Failure, path: Failure['rule'][]) => {
        if (
            !deepest ||
            failure.loc > deepest.failure.loc ||
            (failure.loc === deepest.failure.loc && path.length > deepest.path.length)
        ) {
            deepest = { path, failure };
        }
        const childPath = [...path, failure.rule];
        failure.children?.forEach((child) => next(child, childPath));
    };
    next(failure, []);
    return deepest;
};

export const showPos = ({ line, char }: { line: number; char: number }) => `${line + 1}:${char}`;

export const showDeepest = (
    { failure, path }: { path: Failure['rule'][]; failure: Failure },
    grammar: Grammar,
    raw: string,
    locToPos: (loc: number) => string,
) => {
    if (!failure.rule) return `Dont have rule provenance`;
    const rule = grammar.rules[failure.rule.name];
    const option = rule[failure.rule.option];
    return (
        path
            .map((item) => {
                if (!item) return '- ?\n';
                return `- ${item.name}\n  -> ${item.option}: ${asSyntax(grammar.rules[item.name][item.option].pat)}\n  -> ${JSON.stringify(compact(item.node)).slice(0, 100)}\n`;
            })
            .join('') +
        `Tried to match:\n  pattern: ${asSyntax(option.pat)} \n  source: ${failure.loc}=${locToPos(failure.loc)}  ${JSON.stringify(raw.slice(failure.loc, failure.loc + 20))}\n  message: ${failure.reason}\n  node: ${JSON.stringify(compact(failure.rule.node))}`
    );
};

const showRule = (
    rule: Failure['rule'],
    loc: number,
    raw: string,
    grammar: Grammar,
    locToPos: (loc: number) => string,
) => {
    if (!rule) return '(no trace)';
    return `\
pattern: ${asSyntax(grammar.rules[rule.name][rule.option].pat)}
   source: (${loc} = ${locToPos(loc)}) ${JSON.stringify(raw.slice(loc, loc + 20))}
   node: ${JSON.stringify(compact(rule.node, true)).slice(0, 200)}`;
};

export const showFull = (
    failure: Failure,
    grammar: Grammar,
    raw: string,
    locToPos: (loc: number) => string,
): string => {
    return (
        `${showRule(
            failure.rule,
            failure.loc,
            raw,
            grammar,
            locToPos,
        )}\n   message: ${locToPos(failure.loc)} ${failure.reason}\n` +
        (failure.children
            ? failure.children
                  .map(
                      (child, i) =>
                          `\n  ${failure.rule?.name} ${i + 1}) ` +
                          showFull(child, grammar, raw, locToPos).replace(/\n/g, '\n  '),
                  )
                  .join('')
            : '')
    );
};

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

export type GrammarConfig = {
    reserved?: string[];
};

export class Grammar {
    rules: Record<string, Option[]> = {};
    fns: Record<string, Pat[]> = {};
    config: GrammarConfig;
    constructor(grammarConfig: GrammarConfig = {}) {
        this.config = grammarConfig;
    }
    add(name: string, rule: Option[]) {
        if (!name) throw new Error(`no name given`);
        this.rules[name] = rule;
    }
    addRaw(name: string, rule: RawOption[]) {
        if (!name) throw new Error(`no name given`);
        this.rules[name] = rule.map((option: RawOption): Option => {
            if (!option.res) return { pat: option.pat };
            const bindings: Record<string, string> = {};
            collectBindings(option.pat, bindings, {});
            const body = stringify(option.res);
            // console.log(bindings, body);
            try {
                const res = new Function(
                    `{${Object.keys(bindings).join(',')}}`,
                    body.trim().startsWith('{') ? body : 'return ' + body,
                );
                return { pat: option.pat, res };
            } catch (err) {
                console.log(bindings, body);
                throw err;
            }
        });
    }
    addFn(name: string, pats: Pat[]) {
        this.fns[name] = pats;
    }
    parsePat(pat: Pat, node: Node, path: string[]): PatResult {
        if (path.length > 100) throw new Error('too deep');
        const childPath = path; // ignore
        // let childPath = [
        //     ...path,
        //     pat.type === 'list' || pat.type === 'wrapper' ? pat.kind.text : pat.type,
        // ];
        // console.log(
        //     pat.type === 'list' || pat.type === 'wrapper' ? pat.kind.text : pat.type,
        //     brief(node),
        //     node.loc,
        //     path,
        // );
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
                if (pat.rule.type === 'regex') {
                    if (node.type === 'id') {
                        if (node.text.match(pat.rule.rx)) {
                            return { type: 'success', bindings: { [pat.name.text]: node } };
                        } else {
                            return {
                                type: 'failure',
                                failure: {
                                    loc: node.loc,
                                    reason: `regex failed to match ${pat.rule.rx} vs ${node.text}`,
                                },
                            };
                        }
                    }
                    return {
                        type: 'failure',
                        failure: {
                            reason: `not an id, found a ${node.type}`,
                            loc: node.loc,
                        },
                    };
                }
                const name = pat.rule.text;
                if (name === 'id') {
                    if (node.type === 'id') {
                        if (this.config.reserved?.includes(node.text)) {
                            return {
                                type: 'failure',
                                failure: {
                                    loc: node.loc,
                                    reason: node.text + ' is a reserved word',
                                },
                            };
                        }
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
                } else if (name === 'op') {
                    if (node.type === 'op') {
                        return {
                            type: 'success',
                            bindings: { [pat.name.text]: node },
                        };
                    }
                    return {
                        type: 'failure',
                        failure: {
                            reason: `not an op, found a ${node.type}`,
                            loc: node.loc,
                        },
                    };
                } else if (name === '*') {
                    return { type: 'success', value: node };
                } else {
                    const inner = this.parse(name, node, childPath);
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
                        return this.parsePat(
                            pat.child,
                            {
                                type: 'list',
                                kind: pat.child.kind.text as ListKind,
                                children: [],
                                loc: node.loc,
                            },
                            childPath,
                        );
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
                if (
                    pat.child.type === 'list' &&
                    pat.child.items.length === 1 &&
                    isSpread(pat.child.items[0])
                ) {
                    const patLevel = listLevels.indexOf(pat.child.kind.text as '');
                    const childLevel =
                        node.child.type === 'list' ? listLevels.indexOf(node.child.kind) : null;
                    // don't ignore strings
                    if (
                        patLevel !== -1 &&
                        (childLevel == null || childLevel === -1 || childLevel > patLevel)
                    ) {
                        return this.parsePat(
                            pat.child,
                            {
                                type: 'list',
                                children: [node.child],
                                kind: pat.child.kind.text as '',
                                loc: node.child.loc,
                            },
                            childPath,
                            // [...childPath, 'pseudo-' + pat.child.kind.text],
                        );
                    }
                }
                return this.parsePat(pat.child, node.child, childPath);
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
                const hasSpread = pat.items.some(isSpread);
                const minCount = pat.items.filter((n) => !isSpread(n));
                if (hasSpread) {
                    if (minCount.length > node.children.length) {
                        return {
                            type: 'failure',
                            failure: {
                                reason: `not enough items ${node.kind}. ${node.children.length} total items; ${minCount} required pattern items`,
                                loc: node.loc,
                            },
                        };
                    }
                } else if (pat.items.length !== node.children.length) {
                    return {
                        type: 'failure',
                        failure: {
                            reason: `wrong number of items while processing ${node.kind}. ${node.children.length} total items; ${pat.items.length} pattern items`,
                            loc: node.loc,
                        },
                    };
                }
                const bindings: Record<string, any> = {};
                let i = 0;
                for (let item of pat.items) {
                    // childPath = [...childPath, ':list-item'];
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
                                    let failures: Failure[] = [];
                                    let advanced = i;
                                    for (let option of options) {
                                        if (option.pat.type !== 'list') {
                                            failures.push({
                                                loc: node.children[i].loc,
                                                reason: `option not a list`,
                                            });
                                            continue;
                                        }
                                        let io = i;

                                        let failed = false;
                                        const inner: Record<string, any> = {};
                                        for (const child of option.pat.items) {
                                            if (i >= node.children.length) {
                                                failed = true;
                                                break;
                                            }
                                            const result = this.parsePat(
                                                child,
                                                node.children[i],
                                                childPath,
                                            );
                                            if (result.type === 'failure') {
                                                failed = true;
                                                failures.push(result.failure);
                                                break;
                                            }
                                            Object.assign(inner, result.bindings);
                                            i++;
                                        }
                                        if (failed) {
                                            i = io; // reset i
                                            continue;
                                        }
                                        got.push(
                                            option.res
                                                ? option.res({
                                                      ...inner,
                                                      node: {
                                                          ...node,
                                                          children: node.children.slice(io, i),
                                                          loc: node.children[io].loc,
                                                      },
                                                  })
                                                : inner,
                                        );
                                        break;
                                    }
                                    if (advanced === i) {
                                        return {
                                            type: 'failure',
                                            failure: {
                                                loc: node.loc,
                                                reason: `No option consumed children in **${item.rule.text}`,
                                                children: failures.map((f, i) => ({
                                                    ...f,
                                                    rule: {
                                                        name: item.rule.text,
                                                        option: i,
                                                        node: {
                                                            ...node,
                                                            children: node.children.slice(i),
                                                            loc: node.children[i].loc,
                                                        },
                                                    },
                                                })),
                                            },
                                        };
                                    }
                                }
                                bindings[item.name.text] = got;
                                return { type: 'success', bindings };
                            }

                            const parsed = this.parse(
                                item.rule.text,
                                {
                                    ...node,
                                    loc: node.children[i].loc,
                                    children: node.children.slice(i),
                                },
                                childPath,
                            );
                            if (parsed.type === 'failure') return parsed;
                            bindings[item.name.text] = parsed.value;
                            return { type: 'success', bindings };
                        }
                        case 'many': {
                            const got: any[] = [];
                            for (; i < node.children.length; i++) {
                                const parsed = this.parse(
                                    item.rule.text,
                                    node.children[i],
                                    childPath,
                                );
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
                                    const result = this.parsePat(
                                        child,
                                        node.children[i],
                                        childPath,
                                    );
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
                            const parsed = this.parsePat(item, node.children[i], childPath);
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
                            reason: `Didn't parse all children ${i}`,
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
                return {
                    type: 'failure',
                    failure: {
                        reason: `Cant have a ${pat.type} outside of a list`,
                        loc: node.loc,
                    },
                };
            // throw new Error(`Invalid rule; cant have ${pat.type} outside of a list literal`);
        }
    }
    parse<T>(rule: string, node: Node, path: string[] = []): ParseResult<T> {
        if (rule === 'id') {
            if (node.type === 'id') {
                return { type: 'success', value: node as T };
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
            return { type: 'success', value: node as T };
        }
        if (!this.rules[rule]) {
            console.log(this.rules);
            throw new ParseError(node, 'Unknown rule: ' + rule);
        }
        const failures = [];
        let i = 0;
        for (const { pat, res } of this.rules[rule]) {
            const result = this.parsePat(pat, node, [...path, rule + ':' + i++]);
            if (result.type === 'success') {
                return {
                    type: 'success',
                    value: res
                        ? res(
                              Object.keys(result.bindings ?? {}).length
                                  ? { ...result.bindings, node }
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
                // rule: { name: rule, option: 0, node },
                children: failures.map((f, option): Failure => ({
                    ...f.failure,
                    rule: { name: rule, option, node: f.failure.rule?.node ?? node },
                })),
            },
        };
    }
}
const isSpread = (s: Pat) => s.type === 'rest' || s.type === 'many' || s.type === 'many-items';

type Config = { lib: string; types: string };

export const toSyntax = (grammar: Grammar) => {
    return Object.entries(grammar.rules)
        .map(([name, options]) => {
            return `${name} {${options
                .map((option) => {
                    return `\n    ${asSyntax(option.pat)}${option.res ? ' -> ' + (option.res + '').replace(/^.*?=>/, '').trim() : ''}`;
                })
                .join('')}\n}`;
        })
        .join('\n\n');
};

export const toFile = (items: FileItem[], config: Config) => {
    const imports = new Set<string>();
    const names: string[] = [];
    const ruleTypes: Record<string, string> = {};
    const grammarConfig: Record<string, ConfigValue> = {};
    items.forEach((item) => {
        if (item.type === 'rule') {
            ruleTypes[item.rule.name.name.text] = item.rule.name.ann
                ? stringify(item.rule.name.ann)
                : item.rule.name.name.text;
        }
        if (item.type === 'config') {
            Object.assign(grammarConfig, item.values);
        }
    });

    const chunks = items.map((item) => {
        if (item.type === 'rule') {
            const { rule } = item;
            if (!rule.name.ann) {
                names.push(rule.name.name.text);
            }
            rule.options.forEach((opt) => dslImports(opt.pat, imports));
            return `grammar.add(${JSON.stringify(rule.name.name.text)}, [
            ${rule.options
                .map(
                    (opt, i) => `    // ${item.rule.name.name.text}:${i + 1}\n    option(
                    ${asDSL(opt.pat)},${
                        opt.res
                            ? `\n    ${dslHead(opt.pat, ruleTypes)}: ${ruleTypes[rule.name.name.text]} => ${stringify(opt.res)}`
                            : ''
                    }
                )`,
                )
                .join(',\n')}
            ])`;
        } else if (item.type === 'const') {
            return `const ${stringify(item.rest)}`;
        } else if (item.type === 'import') {
            return `import ${stringify(item.rest)}`;
        } else if (item.type === 'function') {
            return `function ${stringify(item.rest)}`;
        }
    });
    return `\
import {Grammar, Id, Op, Node, option, ${[...imports].join(', ')}} from "${config.lib}";
import {${names.join(', ')}} from "${config.types}";

export const grammar = new Grammar(${JSON.stringify(grammarConfig)});

${chunks.join('\n\n')}
    `;
};

const dslHead = (pat: Pat, ruleTypes: Record<string, string>) => {
    const bindings: Record<string, string> = {};
    collectBindings(pat, bindings, { id: 'Id', any: 'Node', op: 'Op', ...ruleTypes });
    if (!Object.keys(bindings).length) return '({node}:{node:Node})';
    return `({${Object.keys(bindings).join(',')},node}: {${Object.entries(bindings)
        .map(([name, value]) => `${name}: ${value}`)
        .join(',')},node:Node})`;
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
            return `b(${JSON.stringify(pat.name.text)},${pat.rule.type === 'regex' ? pat.rule.rx + '' : JSON.stringify(pat.rule.text)})`;
        case 'wrapper':
            return `wrapper(${JSON.stringify(pat.kind.text)}, ${pat.child ? asDSL(pat.child) : 'null'})`;
        case 'list':
            return `list(${JSON.stringify(pat.kind.text)}, ${pat.items.map(asDSL).join(', ')})`;
        case 'rest':
            return `rest("${pat.name.text}", "${pat.rule.text}", ${pat.multi})`;
        case 'many':
            return `many("${pat.name.text}", "${pat.rule.text}")`;
        case 'many-items':
            return `manyItems("${pat.name.text}", [${pat.items.map(asDSL).join(', ')}])`;
    }
};

export const asSyntax = (pat: Pat): string => {
    switch (pat.type) {
        case 'regexp':
            return `re${JSON.stringify((pat.regexp + '').slice(1, -1))}`;
        case 'literal':
            return `${JSON.stringify(pat.text.text)}`;
        case 'rule':
            return `${pat.name.text}:${pat.rule.type === 'regex' ? 're' + JSON.stringify((pat.rule.rx + '').slice(1, -1)) : pat.rule.text}`;
        case 'wrapper':
            if (pat.child) {
                return `[${JSON.stringify(pat.kind.text)} ${asSyntax(pat.child)}]`;
            } else {
                return `[${JSON.stringify(pat.kind.text)}]`;
            }
        case 'list':
            return `[${JSON.stringify(pat.kind.text)} ${pat.items.map(asSyntax).join(' ')}]`;
        case 'rest':
            return `...${pat.name.text}:*${pat.multi ? '*' : ''}${pat.rule.text}`;
        case 'many':
            return `...${pat.name.text}:${pat.rule.text}`;
        case 'many-items':
            return `...${pat.name.text}:(${pat.items.map(asSyntax).join(' ')})`;
    }
};

const brief = (node: Node) => {
    if (node.type === 'list') return `list(${JSON.stringify(node.kind)})`;
    if (node.type === 'wrapper') return `wrapper(${JSON.stringify(node.kind)})`;
    return node.type + ':' + node.text;
};
