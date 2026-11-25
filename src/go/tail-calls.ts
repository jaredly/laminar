/**
 * Go does not eliminate tail calls, so a function that ends by calling itself would grow the
 * stack and pay for a call on every step. This pass turns the recognisable case into a loop:
 * the function body moves into `for { ... }` and each self call in tail position reassigns the
 * parameters and continues.
 *
 * A call is in tail position when nothing runs between it and the function's `return`:
 * either it assigns the variable the function returns (`v = f(...)` then `return v`), or the
 * function returns `Unit{}` and the call is a statement. Both are checked on the finished
 * statement tree, so a call whose result is used, or followed by cleanup, is left alone.
 */
import { isExpr } from '../backend/imperative/code.ts';
import { isLocal, type Statement } from '../backend/imperative/statements.ts';
import { printGoStatements, type GoFunction } from './syntax.ts';

/** Split at commas outside brackets and string or rune literals. */
const splitTop = (text: string): string[] => {
    const parts: string[] = [];
    let depth = 0,
        start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c === '"' || c === "'") {
            for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
        } else if (c === '`') i = text.indexOf('`', i + 1);
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) {
            parts.push(text.slice(start, i).trim());
            start = i + 1;
        }
        if (i < 0) return [];
    }
    if (text.slice(start).trim()) parts.push(text.slice(start).trim());
    return parts;
};

/** The arguments of `name(...)` when the whole text is exactly that one call. */
const callArguments = (text: string, name: string): string[] | undefined => {
    const open = name.length;
    if (!text.startsWith(`${name}(`) || !text.endsWith(')')) return undefined;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i]!;
        if (c === '"' || c === "'") {
            for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
        } else if (c === '`') i = text.indexOf('`', i + 1);
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c) && --depth === 0 && i !== text.length - 1) return undefined;
        if (i < 0) return undefined;
    }
    return splitTop(text.slice(open + 1, -1));
};

/** The text between the braces that open at `open`, skipping string and rune literals. */
const closureText = (text: string, open: number): string | undefined => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i]!;
        if (c === '"' || c === "'") {
            for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
        } else if (c === '`') {
            i = text.indexOf('`', i + 1);
            if (i < 0) return undefined;
        } else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return text.slice(open + 1, i);
    }
    return undefined;
};

const flatten = (list: Statement[]): Statement[] =>
    list.flatMap((s) => (Array.isArray(s) ? flatten(s) : [s]));

export function loopSelfTailCalls(fn: GoFunction): GoFunction {
    const header = /^func ([A-Za-z_]\w*)\((.*)\)(?: (.+))?$/s.exec(fn.signature);
    if (!header) return fn;
    const name = header[1]!;
    const parameters = splitTop(header[2]!).map((p) => p.split(/\s+/)[0]!);
    if (parameters.includes('environment') || parameters.includes('_')) return fn;

    const body = flatten(fn.body);
    const last = body[body.length - 1];
    if (last === undefined || !isExpr(last)) return fn;
    const returned = /^return (.+)$/s.exec(String(last))?.[1];
    if (returned === undefined) return fn;
    const effect = returned === 'Unit{}';
    if (!effect && !/^[A-Za-z_]\w*$/.test(returned)) return fn;

    // A closure that mentions a parameter, or the address of one, could observe the
    // reassignment. A closure that only uses locals is fine: each pass through the loop body
    // declares its own.
    const text = printGoStatements(body).join('\n');
    if (/\bdefer\s/.test(text)) return fn;
    if (parameters.some((p) => new RegExp(`&\\s*${p}\\b`).test(text))) return fn;
    const mentions = (code: string) => parameters.some((p) => new RegExp(`\\b${p}\\b`).test(code));
    for (const literal of text.matchAll(/\bfunc\s*\(/g)) {
        const open = text.indexOf('{', literal.index);
        if (open < 0 || closureText(text, open) === undefined) return fn;
        if (mentions(closureText(text, open)!)) return fn;
    }

    let replaced = 0;
    const jump = (args: string[]): Statement[] | undefined => {
        if (args.length !== parameters.length) return undefined;
        const changed = parameters.flatMap((p, i) => (args[i] === p ? [] : [[p, args[i]!]]));
        replaced++;
        return [
            ...(changed.length
                ? [`${changed.map(([p]) => p).join(', ')} = ${changed.map(([, a]) => a).join(', ')}`]
                : []),
            'continue',
        ];
    };
    const tail = (list: Statement[]): Statement[] => {
        const flat = flatten(list);
        const end = flat[flat.length - 1];
        if (end === undefined) return flat;
        const before = flat.slice(0, -1);
        if (isExpr(end)) {
            const jumped = effect ? callArguments(String(end), name) : undefined;
            const out = jumped && jump(jumped);
            return out ? [...before, ...out] : flat;
        }
        if (isLocal(end)) {
            if (effect || end.kind !== 'set' || end.name !== returned) return flat;
            const args = callArguments(String(end.value), name);
            const out = args && jump(args);
            return out ? [...before, ...out] : flat;
        }
        if ('head' in end) return flat;
        if (end.kind === 'if')
            return [...before, { ...end, arms: end.arms.map((a) => ({ ...a, body: tail(a.body) })) }];
        return [...before, { ...end, cases: end.cases.map((c) => ({ ...c, body: tail(c.body) })) }];
    };

    const rewritten = [...tail(body.slice(0, -1)), last];
    if (!replaced) return fn;
    return { signature: fn.signature, body: [{ head: 'for', body: rewritten }] };
}
