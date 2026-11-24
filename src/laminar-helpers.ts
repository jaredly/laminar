import { Linear, Id, IfPart } from './ast.ts';
import { Op } from '../parser-generator/lexer.ts';
type Data<Expr> = {
    type: 'tmp';
    left: Expr | Data<Expr>;
    op: Op;
    prec: number;
    right: Expr | Data<Expr>;
};

const precedence = [['||'], ['&&'], ['!=', '=='], ['>', '<', '>=', '<='], ['%'], ['+', '-'], ['*', '/'], ['^']];

const opprec: Record<string, number> = {};
precedence.forEach((row, i) => {
    row.forEach((n) => (opprec[n] = i));
});

const add = <Expr extends { type: string }>(
    data: Data<Expr> | Expr,
    op: Op,
    right: Expr,
): Data<Expr> => {
    const prec = opprec[op.text];
    if (!data) throw new Error('cant add nothing');
    if (data.type !== 'tmp' || prec <= (data as Data<Expr>).prec) {
        return { type: 'tmp', left: data, op, prec, right };
    } else {
        const d = data as Data<Expr>;
        return { ...d, right: add(d.right, op, right) };
    }
};

const bool = (value: boolean, loc: Linear['loc']): Linear => ({ type: 'bool', value, loc });

/** `if cond then yes else no`: a match on the Bool. */
export const branch = (cond: Linear, yes: Linear, no: Linear, loc: Linear['loc']): Linear => ({
    type: 'case',
    value: cond,
    cases: [
        { pat: { type: 'bool', value: true, loc }, body: yes },
        { pat: { type: 'bool', value: false, loc }, body: no },
    ],
    loc,
});

/** `-x`: a literal negates in place; anything else multiplies by -1, which keeps -0 right. */
export const negate = (arg: Linear, loc: Linear['loc']): Linear =>
    arg.type === 'number'
        ? { ...arg, value: -arg.value, loc }
        : {
              type: 'apply',
              fn: { type: 'id', text: '*', loc },
              args: [{ type: 'number', value: -1, loc }, arg],
              loc,
          };

const dataToExpr = (data: Data<Linear> | Linear): Linear => {
    if (data.type !== 'tmp') return data;
    const left = dataToExpr(data.left);
    const right = dataToExpr(data.right);
    if (data.op.text === '~') {
        console.log('bad datatoexpropp ~');
    }
    // `&&` and `||` short-circuit, so they are a branch on the left operand.
    if (data.op.text === '&&') return branch(left, right, bool(false, left.loc), left.loc);
    if (data.op.text === '||') return branch(left, bool(true, left.loc), right, left.loc);
    return {
        type: 'apply',
        fn: data.op,
        args: [left, right],
        loc: left.loc,
        // src: mergeSrc(left.src, right.src),
    };
};

// This is probably the same algorithm as the simple precedence parser
// https://en.wikipedia.org/wiki/Simple_precedence_parser
export const partition = (left: Linear, rights: { op: Op; right: Linear }[]): Linear => {
    // console.log(left, rights);
    let data: Data<Linear> | Linear = left;
    rights.forEach(({ op, right }) => {
        data = add(data, op, right);
    });
    return dataToExpr(data);
};

/**
 * An infix expression whose tokens may include `not`, which negates up to the next `&&` or `||`
 * (so `not a == b && c` is `(not (a == b)) && c`, as in Python). Each such stretch becomes one
 * operand of the logical operators.
 */
export const infixOf = (parts: IfPart[], loc: Linear['loc']): Linear => {
    type Stretch = { negate: boolean; first?: Linear; rights: { op: Op; right: Linear }[] };
    const operands: { op?: Op; stretch: Stretch }[] = [];
    let current: Stretch = { negate: false, rights: [] };
    let logical: Op | undefined;
    let pending: Op | undefined;
    const finish = () => {
        if (!current.first) throw new Error('Expected an expression');
        operands.push({ op: logical, stretch: current });
    };
    for (const part of parts) {
        if (part.kind === 'not') {
            if (current.first || pending) throw new Error('`not` must start an operand');
            current.negate = true;
        } else if (part.kind === 'op') {
            if (!current.first || pending) throw new Error('Expected an operand before an operator');
            if (part.op.text === '&&' || part.op.text === '||') {
                finish();
                logical = part.op;
                current = { negate: false, rights: [] };
            } else pending = part.op;
        } else if (part.kind === 'value') {
            if (!current.first) current.first = part.value;
            else if (pending) {
                current.rights.push({ op: pending, right: part.value });
                pending = undefined;
            } else throw new Error('Expected an operator');
        } else throw new Error(`Unexpected ${part.kind}`);
    }
    if (pending) throw new Error('Expected an operand after an operator');
    finish();
    const expr = (s: Stretch): Linear => {
        const value = partition(s.first!, s.rights);
        return s.negate
            ? { type: 'apply', fn: { type: 'id', text: 'not', loc }, args: [value], loc }
            : value;
    };
    return partition(
        expr(operands[0]!.stretch),
        operands.slice(1).map(({ op, stretch }) => ({ op: op!, right: expr(stretch) })),
    );
};

/**
 * `if` followed by `cond then yes else no`, each an expression. The `else` may start another
 * `if`, so `if a then b else if c then d else e` chains; a nested `if` anywhere else needs braces.
 */
export const ifExpr = (parts: IfPart[], loc: Linear['loc']): Linear => {
    const then = parts.findIndex((p) => p.kind === 'then');
    const otherwise = parts.findIndex((p) => p.kind === 'else');
    if (then === -1 || otherwise < then) throw new Error('`if` needs `then` and then `else`');
    const no = parts.slice(otherwise + 1);
    return branch(
        infixOf(parts.slice(0, then), loc),
        infixOf(parts.slice(then + 1, otherwise), loc),
        no[0]?.kind === 'if' ? ifExpr(no.slice(1), loc) : infixOf(no, loc),
        loc,
    );
};
