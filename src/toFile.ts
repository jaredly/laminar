import { FileItem, ConfigValue, Grammar, Pat, collectBindings } from './grammar-lexer.ts';
import { stringify } from './lexer.ts';

export const toFile = (items: FileItem[], config: ToFileConfig) => {
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
type ToFileConfig = { lib: string; types: string };

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

export const dslHead = (pat: Pat, ruleTypes: Record<string, string>) => {
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
