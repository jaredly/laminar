import { it, expect } from 'bun:test';
import { readLine } from './lexer.ts';
import { grammar } from './laminar-parser.ts';
import { grammar as ir } from './ir-parser.ts';
import { Expr, Linear } from './ast.ts';
import { linearToExpr, sexpr } from './decompose.ts';

const l = (raw: string) => {
    const node = readLine(raw + '\n');
    const lin = grammar.parse<Linear>('Linear', node);
    if (lin.type !== 'success') {
        expect(lin).toMatchObject({ type: 'success' });
        return;
    }
    const expr = linearToExpr({ scope: {}, counter: { current: 0 } }, lin.value);
    return sexpr(expr);
};

const pairs = [
    ['1', '1'],
    ['()', '()'],
    ['fn hi(x) 20', '(x0)=>20'],
    ['{let x = 2\nx}', 'iffe{let x0=2}{x0}{}'],
    ['(1, 2)', '(1,2)'],
    // ['log(10)', 'log(10)'],
    ['"A string ${5}"', '"A string ${5}"'],
    ['{let (x,y) = 1\nx}', 'iffe{let (x0,y1)=1}{x0}{}'],
    ['{5\n2}', 'iffe{let _=5}{2}{}'],
    ['{let x = 2\nlet x = 3\nx}', 'iffe{let x0=2;let x1=3}{x1}{}'],
    //['x := 2', 'iffe{let x0=2}{x0}{}'],
    ['{let x = 2\nx := 3\nx}', 'iffe{let x0=2;let _=swap(x0,3)}{x0}{}'],
    ['{let x = 1\n{let x = 2\n3}\nx}', `iffe{let x0=1;let _=iffe{let x1=2}{3}{}}{x0}{}`],
    [
        `{
        let x = 1
        {
            let y = ~x
            y := 2
        }
        x
    }`,
        `iffe{let x0=1;let _=iffe{let y1=x0}{swap(y1,2)}{swap(x0,y1)}}{x0}{}`,
    ],
    [
        `{
        let x = 1
        let a = 2
        {
            let y = ~x
            let b = ~a
            y := b := 2
        }
        x
    }`,
        `iffe{
        let x0=1;
        let a1=2;
        let _=iffe{
            let y2=x0;
            let b3=a1;
        }{
            swap(y2,swap(b3,2))
        }{
            swap(x0,y2);
            swap(a1,b3);
        };
        }{x0}{}`,
    ],
    [
        `{
        let m = (1,2)
        let n = {
            let (x,y) = ~m
            x := 2
            y := 4
        }
        (m,n)
        }`,
        `iffe{
            let m0=(1,2);
            let n1=iffe{
                let (x2,y3)=m0;
                let _=swap(x2,2)
            }{swap(y3,4)}{
                swap(m0,(x2,y3))
            }
        }{(m0,n1)}{}`,
    ],
    // [
    //     `{
    //         let m = 5
    //         (inc(~m),m)
    //     }`,
    //     `iffe{
    //         let m0=5
    //     }{(inc(m0){m0},m0)}{}`
    // ],
    [
        `{
            let m = 5
            (inc(~m),m)
        }`,
        `iffe{
            let m0=5
        }{(iffe{
            let (r1,l2)=inc0(m0)
        }{r1}{swap(m0,l2)},m0)}{}`,
    ],
    [
        `{let m = (1,2)\ninc(~fst(~m))\nm}`,
        `iffe{
            let m0=5;
            let _=iffe{
                let (t1,c2)=fst0(m0)
            }{
                iffe{
                    let (r3,l4)=inc0(t1)
                }{r3}{swap(t1,l4)}
            }{swap(m0,c2(t1))}
        }{m0}{}`,
    ],
    // [
    //     `{let m = (1,2)\ninc(~fst(~m))\nm}`,
    //     `iffe{
    //         let m0=5;
    //         let _=iffe{
    //             let (t1,c2)=fst0(m0);
    //             let (r2,l4)=inc0(t1);
    //             swap(m0,c2(l4))
    //         }{r2}{}
    //     }{m0}{}`,
    // ],
    // [
    //     `{
    //         let m = (1,2)
    //         {
    //             let x=~fst(~m)
    //             x := 2
    //         }
    //         m
    //     }`,
    //     `iffe{
    //         let m0=(1,2)
    //         let _=iffe{
    //             let (x1,c2)=fst(m0)
    //         }{swap(x1,2)}{
    //             swap(m0,c2(x1))
    //         }
    //     }{m0}{}
    //     `
    // ]
];

/*

let x = 1
{
    let y = ~x
    y := 2
}
x






let m = (1, 2)
{
    let (x, y) = ~m
    x := 2
}
m

*/

it.each(pairs)('input / output :name %p -> %p', (one, out) => {
    const ot = ir.parse<Expr>('Expr', readLine(out + '\n'));
    if (ot.type !== 'success') {
        expect(ot).toMatchObject({ type: 'success' });
    }
    expect(l(one)).toEqual(sexpr(ot.value));
});

// it('ok', () => {
//     expect(l('1')).toEqual('1');
// });
