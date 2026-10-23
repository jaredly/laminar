import { Linear, Id } from './ast.ts';
type Data<Expr> = {
    type: 'tmp';
    left: Expr | Data<Expr>;
    op: Id;
    prec: number;
    right: Expr | Data<Expr>;
};

const precedence = [['!=', '=='], ['>', '<', '>=', '<='], ['%'], ['+', '-'], ['*', '/'], ['^']];

const opprec: Record<string, number> = {};
precedence.forEach((row, i) => {
    row.forEach((n) => (opprec[n] = i));
});

const add = <Expr extends { type: string }>(
    data: Data<Expr> | Expr,
    op: Id,
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

const dataToExpr = (data: Data<Linear> | Linear): Linear => {
    if (data.type !== 'tmp') return data;
    const left = dataToExpr(data.left);
    const right = dataToExpr(data.right);
    if (data.op.text === '~') {
        console.log('bad datatoexpropp ~');
    }
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
export const partition = (left: Linear, rights: { op: Id; right: Linear }[]): Linear => {
    // console.log(left, rights);
    let data: Data<Linear> | Linear = left;
    rights.forEach(({ op, right }) => {
        data = add(data, op, right);
    });
    return dataToExpr(data);
};
