import { it, expect } from 'bun:test';
import { locLines, readLine, showPos } from './lexer.ts';
import { grammar } from './laminar-parser.ts';
import { grammar as ir } from './ir-parser.ts';
import { Expr, Linear } from './ast.ts';
import { linearToExpr, sexpr } from './decompose.ts';
import { evalExpr } from './eval.ts';
import { findDeepest, showDeepest, showFailure } from './debugFailures.ts';

const l = (raw: string) => {
    const node = readLine(raw + '\n');
    const lin = grammar.parse<Linear>('Linear', node);
    if (lin.type !== 'success') {
        // expect(lin).toMatchObject({ type: 'success' });
        const pos = locLines(raw.split('\n'));
        const deepest = findDeepest(lin.failure);
        console.log(showDeepest(deepest!, grammar, raw, (n) => showPos(pos(n))));
        expect(lin.failure.reason).toEqual(null);
        throw 1;
    }
    return linearToExpr(
        {
            scope: {
                inc: -1,
                fst: -1,
                log: -1,
                '+': -1,
                newlens: 0,
            },
            counter: { current: 0 },
        },
        lin.value,
    );
};

const pairs: [string, string, string, any][] = [
    ['num', '1', '1', 1],
    ['null', '()', '()', null],
    ['fn', 'fn hi(x) 20', '(x0)=>20', Function],
    ['let', '{let x = 2\nx}', 'iffe{let x0=2}{x0}{}', 2],
    ['tuple', '(1, 2)', '(1,2)', [1, 2]],
    // ['log(10)', 'log(10)'],
    ['string', '"A string ${5}"', '"A string ${5}"', 'A string 5'],
    ['tuple let', '{let (x,y) = (1,2)\nx}', 'iffe{let (x0,y1)=(1,2)}{x0}{}', 1],
    ['block', '{5\n2}', 'iffe{let _=5}{2}{}', 2],
    ['shadow', '{let x = 2\nlet x = 3\nx}', 'iffe{let x0=2;let x1=3}{x1}{}', 3],
    //['x := 2', 'iffe{let x0=2}{x0}{}'],
    ['swap', '{let x = 2\nx := 3\nx}', 'iffe{let x0=2;let _=swap(x0,3)}{x0}{}', 3],
    [
        'block',
        '{let x = 1\n{let x = 2\n3}\nx}',
        `iffe{let x0=1;let _=iffe{let x1=2}{3}{}}{x0}{}`,
        1,
    ],
    // *** Assignments to local variables ***
    [
        'assign local',
        `{
        let x = 1
        {
            let y = ~x
            y := 2
        }
        x
    }`,
        `iffe{let x0=1;let _=iffe{let y1=x0}{swap(y1,2)}{swap(x0,y1)}}{x0}{}`,
        2,
    ],
    [
        'assign 2 local',
        `{
        let x = 1
        let a = 2
        {
            let y = ~x
            let b = ~a
            y := b := 4
        }
        (a,x)
    }`,
        `iffe{
        let x0=1;
        let a1=2;
        let _=iffe{
            let y2=x0;
            let b3=a1;
        }{
            swap(y2,swap(b3,4))
        }{
            swap(a1,b3);
            swap(x0,y2);
        };
        }{(a1,x0)}{}`,
        [4, 2],
    ],
    [
        'assign 2 tuple',
        `{
        let m = (1,5)
        let n = {
            let (x,y) = ~m
            x := 2
            y := 4
        }
        (m,n)
        }`,
        `iffe{
            let m0=(1,5);
            let n1=iffe{
                let (x2,y3)=m0;
                let _=swap(x2,2)
            }{swap(y3,4)}{
                swap(m0,(x2,y3))
            }
        }{(m0,n1)}{}`,
        [[2, 4], 5],
    ],
    // *** Function calls with lenses ***
    [
        'inc',
        `{
            let m = 5
            (inc(~m),m)
        }`,
        `iffe{
            let m0=5
        }{(iffe{
            let (r1,l2)=inc(m0)
        }{r1}{swap(m0,l2)},m0)}{}`,
        [null, 6],
    ],
    [
        'inc fst',
        `{
            let m = (1,5)
            inc(~fst(~m))
            m
        }`,
        `iffe{
            let m0=(1,5);
            let _=iffe{
                let (t1,c2)=fst(m0)
                let (r3,l4)=inc(t1)
            }{
                r3
            }{
                swap(t1,l4);
                swap(m0,c2(t1))
            }
        }{m0}{}`,
        [2, 5],
    ],
    // *** Tuples of lenses
    [
        'inc fst tuple',
        `{let a = 1\nlet b = 5\ninc(~fst(~(a,b)))\n(a,b)}`,
        `iffe{
            let a0=1
            let b1=5
            let _=iffe{
                let (t2,c3)=fst((a0,b1))
                let (r4,l5)=inc(t2)
            }{r4}{
                swap(t2,l5);
                swap((a0,b1),c3(t2))
            }
        }{(a0,b1)}{}`,
        [2, 5],
    ],
    [
        'assign let tuple',
        `{
            let x = 1
            let y = 2
            {
                let m = ~(x,y)
                m := (4,5)
            }
            (x,y)
        }`,
        `iffe{
            let x0=1;
            let y1=2;
            let _=iffe{let m2=(x0,y1)}{
                swap(m2,(4,5))
            }{swap((x0,y1),m2)}
        }{(x0,y1)}{}`,
        [4, 5],
    ],
    [
        'inc fst tuple',
        `{
            let a = (1,2)
            let b = (5,6)
            inc(~fst(~(fst(~a),fst(~b))))
            (a,b)
        }`,
        `iffe{
            let a0=(1,2);
            let b1=(5,6);
            let _=iffe{
                let (t2,c3)=fst(a0);
                let (t4,c5)=fst(b1);
                let (t6,c7)=fst((t2,t4));
                let (r8,l9)=inc(t6)
            }{r8}{
                swap(t6,l9);
                swap((t2,t4),c7(t6));
                swap(b1,c5(t4));
                swap(a0,c3(t2))
            }
        }{(a0,b1)}{}`,
        [
            [2, 2],
            [5, 6],
        ],
    ],
    [
        'aslens',
        `{
            let x = 2
            {
                let y = ~{
                    lens b <- 10
                    log(b)
                }
                y := x := y
                log("before")
            }
            log("after")
            x
        }`,
        `iffe{
            let x0=2
            let _=iffe{
                let t2=10;
                let c3=(b4)=>log(b4);
                let y1=t2;
                let _=swap(y1,swap(x0,y1))
            }{log("before")}{
                swap(t2,y1);
                swap((),c3(t2))
            }
            let _=log("after")
        }{x0}{}`,
        [10, ['before', 2, 'after']],
    ],
    [
        'assign tuple',
        `{let x = 1
        let y = 2
        (x,y) := (4,5)
        (x,y)}`,
        `iffe{
            let x0=1;
            let y1=2;
            let _=swap((x0,y1),(4,5))
        }{(x0,y1)}{}`,
        [4, 5],
    ],
    [
        'assign fst',
        `{let m = (1,2)
          let n = fst(~m) := 5
          (m,n)}`,
        `iffe{
            let m0=(1,2);
            let n1=iffe{
                let (t2,c3)=fst(m0)
            }{swap(t2,5)}{
                swap(m0,c3(t2))
            }
        }{(m0,n1)}{}`,
        [[5, 2], 1],
    ],
    [
        'lensfn no args',
        `{let m = 2
          newlens() := 4
          m}`,
        `iffe{
            let m0=2;
            let _=iffe{
                let (t1,c2)=newlens0()
            }{swap(t1,4)}{swap((),c2(t1))}
        }{m0}{}`,
        2,
    ],
    [
        'lens fn arg',
        `{
            let inc2 = fn (~x) { x := x + 1 }
            let y = 4
            inc2(~y)
            y
        }`,
        `iffe{
            let inc20=(x4)=>(swap(x4,+(x4,1)),x4);
            let y1=4;
            let _=iffe{
                let (r2,l3)=inc20(y1)
            }{r2}{swap(y1,l3)}
        }{y1}{}`,
        5,
    ],
    [
        'lens fn res',
        `{
            let fst2 = fn (~(a, b)) { ~a }
            let m = (3,5)
            inc(~fst2(~m))
            m
        }`,
        `iffe{
            let fst20=((a6,b7))=>(a6,(a6)=>iffe{}{(a6,b7)}{});
            let m1=(3,5);
            let _=iffe{
                let (t2,c3)=fst20(m1);
                let (r4,l5)=inc(t2)
            }{r4}{
                swap(t2,l5);
                swap(m1,c3(t2))
            }
        }{m1}{}`,
        [4, 5],
    ],
    [
        'lens fn res',
        `{
            let fst2 = fn (~(a,b)) { ~fst(~a) }
            let m = ((3,5),6)
            inc(~fst2(~m))
            m
        }`,
        `iffe{
            let fst20=((a6,b7))=>iffe{let (t8,c9)=fst(a6)}{(t8,(t8)=>iffe{swap(a6,c9(t8))}{(a6,b7)}{})}{};
            let m1=((3,5),6);
            let _=iffe{
                let (t2,c3)=fst20(m1);
                let (r4,l5)=inc(t2)
            }{r4}{
                swap(t2,l5);
                swap(m1,c3(t2))
            }
        }{m1}{}`,
        [[4, 5], 6],
    ],
    ['list nil', `[]`, `[]`, []],
    ['list numbers', `[1,2,3]`, `[1,2,3]`, [1, 2, 3]],
    ['list spread', `[1,2,...[4,5]]`, `[1,2,...[4,5]]`, [1, 2, 4, 5]],
    [
        'match list',
        `{
            match [1] {
                [] -> 5
                [a] -> a + 1
                [a, ...b] -> 7
            }
        }`,
        `match [1] {
            [] -> 5
            [a0] -> +(a0, 1)
            [a1, ...b2] -> 7
        }`,
        2,
    ],
    [
        'change first element',
        `{
            let x = [1,3,5]
            match ~x {
                [a, ...b] -> inc(~a)
            }
            x
        }`,
        `iffe{
            let x0=[1, 3, 5];
            let _=(match x0 {
                [a1,...b2] -> iffe{
                    let (r3,l4)=inc(a1)
                }{r3}{
                    swap(a1,l4);
                    swap(x0,[a1,...b2])
                }
            })
        }{x0}{}`,
        [2, 3, 5],
    ],
    [
        'change first element, preserving blanks',
        `{
            let x = [1,3,5]
            match ~x {
                [] -> ()
                [a, ..._] -> inc(~a)
            }
            x
        }`,
        `iffe{
            let x0=[1, 3, 5];
            let _=(match x0 {
                [] -> iffe{}{()}{swap(x0,[])}
                [a1,..._2] -> iffe{
                    let (r3,l4)=inc(a1)
                }{r3}{
                    swap(a1,l4);
                    swap(x0,[a1,..._2])
                }
            })
        }{x0}{}`,
        [2, 3, 5],
    ],
    [
        'change head',
        `{
            let x = [1,2,3]
            (match ~x {
                [h, ..._] -> h
            }) := 5
            x
        }`,
        `iffe{
            let x0=[1,2,3]
            let _=iffe{
                let (t1,c2)=(match x0 {
                    [h3, ..._4] -> (h3, (h3)=>[h3,..._4])
                })
            }{swap(t1,5)}{swap(x0,c2(t1))}
        }{x0}{}`,
        [5, 2, 3],
    ],
    [
        'change snd fn',
        `{
            let snd = fn (~x) ~{
                match ~x {
                    [_, h, ..._] -> h
                }
            }
            let x = [1,3]
            inc(~snd(~x))
            x
        }`,
        `iffe{let snd0=(x6)=>iffe{
        let (t7,c8)=(match x6 {
            [_9,h10,..._11] -> (h10,(h10)=>[_9, h10, ..._11])
        })}{(t7,(t7)=>iffe{swap(x6,c8(t7))}{x6}{})}{};
        let x1=[1, 3];
        let _=iffe{let (t2,c3)=snd0(x1);
        let (r4,l5)=inc(t2)}{r4}{swap(t2,l5);
        swap(x1,c3(t2))}}{x1}{}`,
        [1, 4],
    ],
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

let log: any[] = [];
const builtins = {
    '+': (a: number, b: number) => a + b,
    fst: ([a, b]: [any, any]) => {
        return [a, (a: any) => [a, b]];
    },
    inc: (v: number) => [null, v + 1],
    log: (v: any) => {
        log.push(v);
    },
    newlens: () => [5, () => void 0],
};

it.each(pairs)('input / output %p', (_name, one, out, result) => {
    const oneExpr = l(one);

    let evalErr;
    // try {
    // } catch (err) {
    //     evalErr = err;
    // }

    if (out != '') {
        const ot = ir.parse<Expr>('Expr', readLine(out + '\n'));
        if (ot.type !== 'success') {
            const pos = locLines(out.split('\n'));
            const deepest = findDeepest(ot.failure);
            console.log(showDeepest(deepest!, ir, out, (n) => showPos(pos(n))));
            expect(ot.failure.reason).toEqual(null);
            // expect(showFailure(ot.failure, (n) => showPos(pos(n)))).toEqual('');
            return;
        }
        expect(sexpr(oneExpr)).toEqual(sexpr(ot.value));
        // if (evalErr) throw evalErr;
    } else {
        // if (evalErr) throw evalErr;
        expect(sexpr(oneExpr)).toEqual('');
    }
    log = [];
    if (result === Function) {
        expect(evalExpr({ scope: {}, builtins }, oneExpr)).toBeInstanceOf(Function);
    } else {
        const got = evalExpr({ scope: {}, builtins }, oneExpr);
        expect(log.length ? [got, log] : got).toEqual(result);
    }
});

// it('ok', () => {
//     expect(l('1')).toEqual('1');
// });
