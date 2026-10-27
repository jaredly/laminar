import { Failure, Grammar, asSyntax, FailurePath } from './grammar-lexer.ts';
import { compact } from './lexer.ts';

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
        `Tried to match:
  pattern: ${asSyntax(option.pat)}
  path:    ${JSON.stringify(failure.path)}
  source:  ${failure.loc}=${locToPos(failure.loc)}  ${JSON.stringify(raw.slice(failure.loc, failure.loc + 20))}
  message: ${failure.reason}
  node: ${JSON.stringify(compact(failure.rule.node))}`
    );
};
const showRule = (
    rule: Failure['rule'],
    path: FailurePath,
    loc: number,
    raw: string,
    grammar: Grammar,
    locToPos: (loc: number) => string,
) => {
    if (!rule) return '(no trace)';
    return `\
pattern: ${asSyntax(grammar.rules[rule.name][rule.option].pat)}
   path:   ${JSON.stringify(path)}
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
            failure.path,
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
