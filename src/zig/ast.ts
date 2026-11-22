/**
 * A small Zig expression/statement tree, its printer, and the readability pass.
 * lower.ts emits one `let` per IR value, in IR order. `tidy` then folds that into
 * the code a person would write. Every rewrite preserves evaluation order:
 *
 * - An unnamed temporary with no uses is removed if pure. If it is a call, it
 *   becomes a `_ = call;` statement.
 * - An unnamed temporary used once is substituted into its use when the value is
 *   pure. A call is substituted only if every statement in between is a pure let
 *   and the using statement has no call that could run before it. Calls that
 *   enclose the use are fine, because arguments run first.
 * - A temporary whose value is a name or literal is substituted everywhere.
 * - Projections of a temporary struct whose fields are names or literals read
 *   those fields directly.
 * - `field(struct literal)` folds to that field's value when the dropped fields
 *   are pure.
 *
 * Source-named lets are kept, so the code reads like its source. They are dropped
 * only when unused and pure. Nothing is ever reassigned in the phases this covers,
 * so every let prints as `const`.
 */

export type Expr =
    | { k: 'name'; name: string }
    /** `untyped` marks bare number literals (comptime_int/float in Zig). */
    | { k: 'lit'; text: string; untyped?: boolean }
    | { k: 'field'; of: Expr; name: string }
    | { k: 'unwrap'; of: Expr }
    | { k: 'struct'; type: string; fields: { name: string; value: Expr }[] }
    | { k: 'binary'; op: string; left: Expr; right: Expr }
    | { k: 'call'; callee: Expr; args: Expr[] };

export type Stmt =
    | { k: 'let'; name: string; type: string; value: Expr; named: boolean }
    | { k: 'discard'; value: Expr }
    | { k: 'return'; value: Expr }
    | { k: 'raw'; text: string };

export const name = (n: string): Expr => ({ k: 'name', name: n });
export const field = (of: Expr, n: string): Expr => ({ k: 'field', of, name: n });
export const nullLit: Expr = { k: 'lit', text: 'null' };

const children = (e: Expr): Expr[] =>
    e.k === 'field' || e.k === 'unwrap'
        ? [e.of]
        : e.k === 'struct'
          ? e.fields.map((f) => f.value)
          : e.k === 'binary'
            ? [e.left, e.right]
            : e.k === 'call'
              ? [e.callee, ...e.args]
              : [];

const hasCall = (e: Expr): boolean => e.k === 'call' || children(e).some(hasCall);
const calls = (e: Expr): number =>
    (e.k === 'call' ? 1 : 0) + children(e).reduce((n, c) => n + calls(c), 0);
const uses = (e: Expr, n: string): number =>
    (e.k === 'name' && e.name === n ? 1 : 0) + children(e).reduce((s, c) => s + uses(c, n), 0);
const hasName = (e: Expr): boolean => e.k === 'name' || children(e).some(hasName);

/** Calls in `e` that are not ancestors of the use of `n`. Arguments run before their
 * enclosing call, so only these could be reordered by substituting a call for `n`. */
const siblingCalls = (e: Expr, n: string): number => {
    if (uses(e, n) === 0) return calls(e);
    return children(e).reduce((s, c) => s + siblingCalls(c, n), 0);
};

const trivial = (e: Expr) => e.k === 'name' || e.k === 'lit';

const map = (e: Expr, f: (e: Expr) => Expr): Expr => {
    switch (e.k) {
        case 'field':
        case 'unwrap':
            return f({ ...e, of: map(e.of, f) });
        case 'struct':
            return f({ ...e, fields: e.fields.map((x) => ({ ...x, value: map(x.value, f) })) });
        case 'binary':
            return f({ ...e, left: map(e.left, f), right: map(e.right, f) });
        case 'call':
            return f({ ...e, callee: map(e.callee, f), args: e.args.map((a) => map(a, f)) });
        default:
            return f(e);
    }
};

const substitute = (e: Expr, n: string, value: Expr) =>
    map(e, (x) => (x.k === 'name' && x.name === n ? value : x));

/** Fold projections of struct literals. A missing field is a defaulted `null`. */
const fold = (e: Expr): Expr =>
    map(e, (x) => {
        if (x.k !== 'field' || x.of.k !== 'struct') return x;
        const others = x.of.fields.filter((f) => f.name !== x.name);
        if (others.some((f) => hasCall(f.value))) return x;
        return x.of.fields.find((f) => f.name === x.name)?.value ?? nullLit;
    });

const stmtExprs = (s: Stmt): Expr[] => (s.k === 'raw' ? [] : [s.value]);
const withExpr = (s: Stmt, f: (e: Expr) => Expr): Stmt =>
    s.k === 'raw' ? s : { ...s, value: f(s.value) };

/** Names read anywhere in `body` (used to drop unused parameters to `_`). */
export function usedNames(body: Stmt[]): Set<string> {
    const found = new Set<string>();
    const visit = (e: Expr) => {
        if (e.k === 'name') found.add(e.name);
        children(e).forEach(visit);
    };
    body.forEach((s) => stmtExprs(s).forEach(visit));
    for (const s of body)
        if (s.k === 'raw') s.text.match(/[A-Za-z_][A-Za-z_0-9]*/g)?.forEach((n) => found.add(n));
    return found;
}

export function tidy(input: Stmt[]): Stmt[] {
    let body = input.map((s) => withExpr(s, fold));
    for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i < body.length; i++) {
            const s = body[i]!;
            if (s.k !== 'let') continue;
            const rest = body.slice(i + 1);
            // Raw lines are opaque: a name they mention is never substituted or removed.
            if (rest.some((r) => r.k === 'raw' && new RegExp(`\\b${s.name}\\b`).test(r.text)))
                continue;
            const count = rest.reduce(
                (n, r) => n + stmtExprs(r).reduce((m, e) => m + uses(e, s.name), 0),
                0,
            );
            const replace = (value: Expr) => {
                body = [
                    ...body.slice(0, i),
                    ...rest.map((r) => withExpr(r, (e) => fold(substitute(e, s.name, value)))),
                ];
                changed = true;
            };
            if (count === 0) {
                if (hasCall(s.value)) {
                    body[i] = { k: 'discard', value: s.value };
                    changed = true;
                    continue;
                }
                body.splice(i, 1);
                changed = true;
                break;
            }
            if (s.named) continue;
            if (trivial(s.value)) {
                replace(s.value);
                break;
            }
            // Projections of a temporary tuple of names/literals read through it.
            const struct = s.value;
            if (struct.k === 'struct' && struct.fields.every((f) => trivial(f.value))) {
                const project = (e: Expr) =>
                    map(e, (x) =>
                        x.k === 'field' && x.of.k === 'name' && x.of.name === s.name
                            ? (struct.fields.find((f) => f.name === x.name)?.value ?? nullLit)
                            : x,
                    );
                const projected = rest.map((r) => withExpr(r, project));
                if (JSON.stringify(projected) !== JSON.stringify(rest)) {
                    body = [...body.slice(0, i + 1), ...projected];
                    changed = true;
                    break;
                }
            }
            if (count !== 1) continue;
            if (!hasCall(s.value)) {
                replace(s.value);
                break;
            }
            const j = rest.findIndex((r) => stmtExprs(r).some((e) => uses(e, s.name) > 0));
            const between = rest.slice(0, j);
            const target = rest[j]!;
            if (
                target.k !== 'raw' &&
                between.every((b) => b.k === 'let' && !hasCall(b.value)) &&
                siblingCalls(target.value, s.name) === 0
            ) {
                replace(s.value);
                break;
            }
        }
    }
    return body;
}

const untypedLiteral = (e: Expr) => e.k === 'lit' && e.untyped;

/** `typed`: whether the context lacks a result type, so a struct literal needs its type name. */
export function printExpr(e: Expr, typed = false): string {
    switch (e.k) {
        case 'name':
            return e.name;
        case 'lit':
            return e.text;
        case 'field': {
            const of = printExpr(e.of, true);
            return `${e.of.k === 'binary' || (e.of.k === 'lit' && e.of.text.startsWith('-')) ? `(${of})` : of}.${e.name}`;
        }
        case 'unwrap':
            return `${printExpr(e.of, true)}.?`;
        case 'struct': {
            const fields = e.fields.filter(
                (f) => !(f.value.k === 'lit' && f.value.text === 'null'),
            );
            const inner = fields.map((f) => `.${f.name} = ${printExpr(f.value)}`).join(', ');
            return `${typed ? e.type : '.'}{${inner ? ` ${inner} ` : ''}}`;
        }
        case 'binary': {
            const operand = (x: Expr, left: boolean) => {
                if (left && untypedLiteral(x) && untypedLiteral(left ? e.right : e.left))
                    return `@as(f64, ${x.k === 'lit' ? x.text : ''})`;
                const s = printExpr(x, true);
                return x.k === 'binary' || (x.k === 'lit' && x.text.startsWith('-')) ? `(${s})` : s;
            };
            return `${operand(e.left, true)} ${e.op} ${operand(e.right, false)}`;
        }
        case 'call':
            return `${printExpr(e.callee, true)}(${e.args.map((a) => printExpr(a)).join(', ')})`;
    }
}

/** Lets whose value already names its type omit the annotation. */
const needsType = (e: Expr): boolean =>
    e.k === 'lit' || e.k === 'struct' || (e.k === 'binary' && !hasName(e));

export function printStmt(s: Stmt): string {
    switch (s.k) {
        case 'let':
            return needsType(s.value)
                ? `const ${s.name}: ${s.type} = ${printExpr(s.value)};`
                : `const ${s.name} = ${printExpr(s.value, true)};`;
        case 'discard':
            return `_ = ${printExpr(s.value, true)};`;
        case 'return':
            return `return ${printExpr(s.value)};`;
        case 'raw':
            return s.text;
    }
}
