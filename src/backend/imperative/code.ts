/**
 * Expressions as trees. Lowering assembles `Code` values whose structure travels
 * with them, so optimization never recovers meaning from printed text. A plain
 * string in an expression position is either a local's name or literal text.
 */
export type Node =
    /** Literal spelling: punctuation, field and type names. Never a read. */
    | { kind: 'text'; text: string }
    | { kind: 'ref'; name: string }
    | { kind: 'scalar'; value: number | boolean }
    | { kind: 'binary'; op: string; left: Node; right: Node }
    | {
          kind: 'compose';
          parts: Node[];
          emit: (parts: string[]) => string;
          /** How tightly the composed spelling binds; see `precedence`. Absent: unknown. */
          prec?: number;
          /** Per part, the loosest binding it may have unparenthesized. A looser part is
           * wrapped in parentheses when spelled, including after a pass has put a different
           * expression in its place. Absent: the template spells its own parentheses. */
          operands?: number[];
          /** A `return` of its single part. */
          returns?: boolean;
          /** Its parts build an aggregate from these values. */
          aggregate?: Node[];
      }
    /** Text built outside the tree; it reads `refs` but cannot be rewritten. */
    | { kind: 'opaque'; text: string; refs: ReadonlySet<string> };

export class Code {
    constructor(
        readonly node: Node,
        readonly text: string,
    ) {}
    toString(): string {
        return this.text;
    }
    /** Structural comparisons of storage data compare spellings, as for strings. */
    toJSON(): string {
        return this.text;
    }
}

/** Equal Go spelling. Expressions are objects, so never compare them with `===`. */
export const same = (a: Expr | undefined, b: Expr | undefined): boolean =>
    a === undefined || b === undefined ? a === b : String(a) === String(b);

export type Expr = string | Code;

export const isExpr = (value: unknown): value is Expr =>
    typeof value === 'string' || value instanceof Code;

/**
 * How tightly an expression's spelling binds. 0 is a primary expression (a name, a
 * member access, a call, a binary spelled with its own parentheses); 1 is unary; larger
 * values bind more loosely. A spelling nothing declared is the loosest, so it is
 * parenthesized wherever binding matters.
 */
export const LOOSEST = 99;
/** The operators lowering builds: multiplicative, additive, then every comparison as one class. */
export const binaryRank = (op: string): number =>
    op === '*' || op === '/' ? 2 : op === '+' || op === '-' ? 3 : 4;
export const precedence = (n: Node): number =>
    n.kind === 'ref'
        ? 0
        : n.kind === 'binary'
          ? binaryRank(n.op)
          : n.kind === 'scalar'
            ? typeof n.value === 'number' && n.value < 0
                ? 1
                : 0
            : n.kind === 'compose'
              ? (n.prec ?? LOOSEST)
              : n.kind === 'opaque' && /^[A-Za-z_]\w*$/.test(n.text)
                ? 0
                : LOOSEST;
export const precedenceOf = (e: Expr): number =>
    typeof e === 'string' ? (/^[A-Za-z_]\w*$/.test(e) ? 0 : LOOSEST) : precedence(e.node);

/** An expression with a known binding, for code with no function body to track it in. */
const spelled = (text: string, prec: number): Code =>
    new Code({ kind: 'compose', parts: [], emit: () => text, prec }, text);
/** `base.member`: a primary expression, so a base is parenthesized only if it binds looser. */
export const memberText = (base: Expr, op: '.' | '->', member: string): Code =>
    spelled(`${precedenceOf(base) > 0 ? `(${base})` : base}${op}${member}`, 0);
/** `*operand`: a unary expression. */
export const derefText = (operand: Expr): Code =>
    spelled(`*${precedenceOf(operand) > 1 ? `(${operand})` : operand}`, 1);

export const children = (n: Node): Node[] =>
    n.kind === 'compose' ? n.parts : n.kind === 'binary' ? [n.left, n.right] : [];

/** Every local an expression reads, in left-to-right order. */
export const refs = (n: Node): string[] =>
    n.kind === 'ref' ? [n.name] : n.kind === 'opaque' ? [...n.refs] : children(n).flatMap(refs);
