import { Expr, Pat, Stmt } from './ast.ts';

/*

Question being:
can we ... turn the lin+lens language into just the linear language?
That would be quite interesting.

Then we just need reliable generation for the linear language.

*/

type Scope = Record<string, string>;

export const stmtToTS = (scope: Scope, stmt: Stmt): string => {
    switch (stmt.type) {
        case 'let': {
            const v = exprToTS(scope, stmt.value);
            return `let ${patLHS(stmt.pat, scope)} = ${v};`;
        }
        case 'return': {
            return `return ${exprToTS(scope, stmt.value)}`;
        }
        default:
            return exprToTS(scope, stmt) + ';';
    }
    //
};

export const exprToTS = (scope: Scope, lin: Expr): string => {
    switch (lin.type) {
        case 'op': {
            throw new Error(`op should be handled by apply, not fall through`);
        }
        case 'id': {
            if (!scope[lin.text]) {
                throw new Error(`Unbound ${lin.text}`);
            }
            return scope[lin.text];
        }
        case 'string': {
            return (
                '`' +
                lin.head +
                lin.interp
                    .map(({ value, tail }): string => exprToTS(scope, value) + tail)
                    .join('') +
                '`'
            );
        }
        case 'const': {
            return lin.value + '';
        }
        case 'apply': {
            if (lin.fn.type === 'op' && lin.args.length === 2) {
                return `(${exprToTS(scope, lin.args[0])} ${lin.fn.text} ${exprToTS(scope, lin.args[1])})`;
            }
            return `${exprToTS(scope, lin.fn)}(${lin.args.map((term) => {
                return exprToTS(scope, term);
            })})`;
        }
        case 'fn': {
            const bodyScope = { ...scope };
            return `(${lin.args.map((arg) => patLHS(arg.pat, bodyScope)).join(', ')}) => ${
                Array.isArray(lin.body)
                    ? `{${lin.body.map((s) => stmtToTS(bodyScope, s)).join('\n')}}`
                    : exprToTS(scope, lin.body)
            }`;
        }
        case 'tuple': {
            return `[${lin.items.map((lin) => exprToTS(scope, lin)).join(', ')}]`;
        }
        case 'block': {
            const blockScope = { ...scope };
            return `(() => {${lin.block.map((item) => stmtToTS(blockScope, item)).join('\n')}})()`;
        }
    }
};

const norm = (t: string) => t.replace(/[^a-zA-Z0-9_]/g, '_');

export const patLHS = (pat: Pat, scope: Scope): string => {
    switch (pat.type) {
        case 'id': {
            const id = norm(pat.text);
            let i = 0;
            while (scope[id + (i === 0 ? '' : i)]) {
                i++;
            }
            scope[pat.text] = id + (i === 0 ? '' : i);
            return scope[pat.text];
        }
        case 'drop': {
            return '_';
        }
        case 'tuple': {
            return `[${pat.items.map((pat) => patLHS(pat, scope)).join(', ')}]`;
        }
        case 'constructor': {
            throw new Error('not support constructor yet');
        }
        case 'lens': {
            throw new Error(`not support lens`);
        }
    }
};
