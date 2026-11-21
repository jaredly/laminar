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

export const children = (n: Node): Node[] =>
    n.kind === 'compose' ? n.parts : n.kind === 'binary' ? [n.left, n.right] : [];

/** Every local an expression reads, in left-to-right order. */
export const refs = (n: Node): string[] =>
    n.kind === 'ref' ? [n.name] : n.kind === 'opaque' ? [...n.refs] : children(n).flatMap(refs);
