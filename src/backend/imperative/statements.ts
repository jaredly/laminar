import { isExpr, type Expr } from './code.ts';

/**
 * A target-neutral statement tree. Storage decisions belong to the lowerer and
 * spelling to each target's printer. Nested lists are transparent sequencing
 * points: lowering can reserve one and materialize a value there only when an IR
 * consumer actually needs it.
 */
export type LocalDeclaration = {
    kind: 'local';
    name: string;
    type: string;
    /** Absent: declared with the type's zero value. */
    value?: Expr;
    pure?: boolean;
    inline?: boolean;
    load?: boolean;
    // The initializer equals this type's default value. It may be omitted only
    // when the declaration stays here; hoisted cells still need their reset.
    zeroInitial?: boolean;
};
export type LocalAssignment = { kind: 'set'; name: string; value: Expr };
/** One conditional chain. An arm without a condition is the final `else`. */
export type IfChain = { kind: 'if'; arms: { condition?: Expr; body: Statement[] }[] };
/** A multiway branch. A case without a label is the default. */
export type Switch = {
    kind: 'switch';
    subject: Expr;
    cases: { label?: Expr; body: Statement[] }[];
};
/** A target-specific nested scope (a loop, a closure) that passes treat as opaque. */
export type Block = { head: Expr; body: Statement[] };
export type Statement =
    | Expr
    | Statement[]
    | LocalDeclaration
    | LocalAssignment
    | IfChain
    | Switch
    | Block;
export type Single = Exclude<Statement, Statement[]>;

export const isLocal = (s: Statement): s is LocalDeclaration | LocalAssignment =>
    !isExpr(s) && !Array.isArray(s) && 'kind' in s && (s.kind === 'local' || s.kind === 'set');
export const isBlock = (s: Statement): s is Block => !isExpr(s) && !Array.isArray(s) && 'head' in s;
/** A statement that opens nested scopes. */
export const isScope = (s: Statement): s is IfChain | Switch | Block =>
    !isExpr(s) && !Array.isArray(s) && !isLocal(s);

/** The expressions a statement evaluates directly, outside its nested bodies. */
export const expressions = (s: Single): Expr[] =>
    isExpr(s)
        ? [s]
        : isLocal(s)
          ? s.value === undefined
              ? []
              : [s.value]
          : 'head' in s
            ? [s.head]
            : s.kind === 'if'
              ? s.arms.flatMap((a) => (a.condition === undefined ? [] : [a.condition]))
              : [s.subject, ...s.cases.flatMap((c) => (c.label === undefined ? [] : [c.label]))];

/** Nested bodies, each its own lexical scope. */
export const bodies = (s: Single): Statement[][] =>
    isExpr(s) || isLocal(s)
        ? []
        : 'head' in s
          ? [s.body]
          : s.kind === 'if'
            ? s.arms.map((a) => a.body)
            : s.cases.map((c) => c.body);

/** Rebuild a scope statement with rewritten expressions and bodies. */
export function mapScope(
    s: IfChain | Switch | Block,
    expr: (e: Expr) => Expr,
    body: (b: Statement[]) => Statement[],
): IfChain | Switch | Block {
    if ('head' in s) return { head: expr(s.head), body: body(s.body) };
    if (s.kind === 'if')
        return {
            kind: 'if',
            arms: s.arms.map((a) => ({
                ...(a.condition === undefined ? {} : { condition: expr(a.condition) }),
                body: body(a.body),
            })),
        };
    return {
        kind: 'switch',
        subject: expr(s.subject),
        cases: s.cases.map((c) => ({
            ...(c.label === undefined ? {} : { label: expr(c.label) }),
            body: body(c.body),
        })),
    };
}

/** Visit every statement in order, including those in nested scopes. */
export function visit(array: Statement[], fn: (s: Single) => void): void {
    for (const s of array) {
        if (Array.isArray(s)) visit(s, fn);
        else {
            fn(s);
            bodies(s).forEach((b) => visit(b, fn));
        }
    }
}
