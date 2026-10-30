import { it, expect } from 'bun:test';
import { locLines, readFile, readLine, showPos } from './lexer.ts';
import { grammar } from './laminar-parser.ts';
import { grammar as ir } from './ir-parser.ts';
import { Expr, File, Linear } from './ast.ts';
import { linearToExpr, sexpr } from './decompose.ts';
import { evalExpr } from './eval.ts';
import { findDeepest, showDeepest } from './debugFailures.ts';

type TestCase = {
    name: string;
    source: string;
    ir: string;
    defns?: { source: string; ir: Record<string, string> };
    result: any;
};

const t = (name: string, source: string, ir: string, result: any): TestCase => ({
    name,
    source,
    ir,
    result,
});

const pairs: TestCase[] = [
    t('num', '1', '1', 1),
    t('null', '()', '()', null),
    t('fn', 'fn hi(x) 20', '(x0)=>20', Function),
    t('let', '{let x = 2\nx}', 'iffe{let x0=2}{x0}{}', 2),
    t('tuple', '(1, 2)', '(1,2)', [1, 2]),
    // ['log(10)', 'log(10)'],
    t('string', '"A string ${5}"', '"A string ${5}"', 'A string 5'),
    t('tuple let', '{let (x,y) = (1,2)\nx}', 'iffe{let (x0,y1)=(1,2)}{x0}{}', 1),
    t('block', '{5\n2}', 'iffe{let _=5}{2}{}', 2),
    t('shadow', '{let x = 2\nlet x = 3\nx}', 'iffe{let x0=2;let x1=3}{x1}{}', 3),
    //['x := 2', 'iffe{let x0=2}{x0}{}'],
    t('swap', '{let x = 2\nx := 3\nx}', 'iffe{let x0=2;let _=swap(x0,3)}{x0}{}', 3),
    t(
        'block',
        '{let x = 1\n{let x = 2\n3}\nx}',
        `iffe{let x0=1;let _=iffe{let x1=2}{3}{}}{x0}{}`,
        1,
    ),
    // *** Assignments to local variables ***
    t(
        'assign local',
        `{
        let x = 1
        {
            let y = ~x
            y := 2
        }
        x
    }`,
        `iffe{
        let x0=1;
        let _=iffe{let y1=x0}{swap(y1,2)}{swap(x0,y1)}}{x0}{}`,
        2,
    ),
    t(
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
    ),
    t(
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
    ),
    // *** Function calls with lenses ***
    t(
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
    ),
    t(
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
    ),
    // *** Tuples of lenses
    t(
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
    ),
    t(
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
    ),
    t(
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
    ),
    t(
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
    ),
    t(
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
    ),
    t(
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
    ),
    t(
        'lensfn no args',
        `{let m = 2
          newlens() := 4
          m}`,
        `iffe{
            let m0=2;
            let _=iffe{
                let (t1,c2)=newlens()
            }{swap(t1,4)}{swap((),c2(t1))}
        }{m0}{}`,
        2,
    ),
    t(
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
    ),
    t(
        'lens fn res',
        `{
            let fst2 = fn (~(a, b)) { ~a }
            let m = (3,5)
            inc(~fst2(~m))
            m
        }`,
        `iffe{
            let fst20 = ((a6,b7))=>(a6,(back8)=>iffe{swap(a6,back8)}{(a6,b7)}{});
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
    ),
    t(
        'lens fn res 2',
        `{
            let fst2 = fn (~(a,b)) { ~fst(~a) }
            let m = ((3,5),6)
            inc(~fst2(~m))
            m
        }`,
        `iffe{
        let fst20 = ((a6,b7))=>iffe{let (t8,c9) = fst(a6)}{(t8,(back10)=>iffe{swap(t8,back10);
        swap(a6,c9(t8))}{(a6,b7)}{})}{};
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
    ),
    t('list nil', `[]`, `[]`, []),
    t('list numbers', `[1,2,3]`, `[1,2,3]`, [1, 2, 3]),
    t('list spread', `[1,2,...[4,5]]`, `[1,2,...[4,5]]`, [1, 2, 4, 5]),
    t(
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
    ),
    t(
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
    ),
    t(
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
    ),
    t(
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
            let _ = iffe{
                let (t1,c2) = (match x0 {
                    [h3,..._4] -> (h3,(back5)=>iffe{swap(h3,back5)}{[h3, ..._4]}{})
                })
            }{swap(t1,5)}{swap(x0,c2(t1))}
        }{x0}{}`,
        [5, 2, 3],
    ),
    t(
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
        `iffe{let snd0 = (x6)=>iffe{let (t7,c8) = (match x6 {[_9,h10,..._11] -> (h10,(back12)=>iffe{swap(h10,back12)}{[_9, h10, ..._11]}{})})}{(t7,(back13)=>iffe{swap(t7,back13);
        swap(x6,c8(t7))}{x6}{})}{};
        let x1=[1, 3];
        let _=iffe{let (t2,c3)=snd0(x1);
        let (r4,l5)=inc(t2)}{r4}{swap(t2,l5);
        swap(x1,c3(t2))}}{x1}{}`,
        [1, 4],
    ),
    t(
        `some optionals`,
        `{
            let x = Some(2)
            x := None
            x
        }`,
        `iffe{let x0=Some(2);
        let _=swap(x0,None())}{x0}{}`,
        { type: 'None' },
    ),
    t(
        `lens unpacking`,
        `{
            let x = Some(2)
            {
                let Some(n) = ~x
                n := 4
            }
            x
        }`,
        `iffe{let x0 = Some(2);
        let _=iffe{let Some(n1) = x0}{swap(n1,4)}{swap(x0,Some(n1))}}{x0}{}`,
        { type: 'Some', args: [4] },
    ),
    {
        name: 'case as lens fn body',
        defns: {
            source: `
            fn head(~x) ~{
                match ~x {
                    [h, ...rest] -> @(Some(h), fn (opt) (match opt { None -> [];Some(h) -> [h, ...rest]}))
                    h -> @(None, fn (opt) (match opt { None -> h;Some(h) -> [h]}))
                }
            }
            fn apply(f, ~x) {
                match ~x {
                    Some(v) -> f(~v)
                    None -> ()
                }
            }
            `,
            ir: {
                head: `(x0)=>iffe{let (t1,c2) = (match x0 {[h3,...rest4] -> (Some(h3),(opt5)=>(match opt5 {None() -> []
                Some(h6) -> [h6, ...rest4]}))
                h7 -> (None(),(opt8)=>(match opt8 {None() -> h7
                Some(h9) -> [h9]}))})}{(t1,(back10)=>iffe{swap(t1,back10);
                swap(x0,c2(t1))}{x0}{})}{}`,
                apply: `(f11,x12)=>((match x12 {Some(v13) -> iffe{let (r14,l15) = f11(v13)}{r14}{swap(v13,l15);
                swap(x12,Some(v13))}
                None() -> iffe{}{()}{swap(x12,None())}}),x12)`,
            },
        },
        source: `{
            let x = [1,3,5]
            apply(inc, ~head(~x))
            x
        }`,
        ir: `iffe{let x16 = [1, 3, 5];
        let _ = iffe{let (t17,c18) = head(x16);
        let (r19,l20) = apply(inc,t17)}{r19}{swap(t17,l20);
        swap(x16,c18(t17))}}{x16}{}`,
        result: [2, 3, 5],
    },
    {
        name: 'case as lens fn body 2',
        defns: {
            source: `
                fn head(~x) ~{
                    match ~x {
                        [h, ...rest] -> @(Some(h), fn (opt) (match opt { None -> rest;Some(h) -> [h, ...rest]}))
                        [] -> @(None, fn (opt) (match opt { None -> [];Some(h) -> [h]}))
                    }
                }`,
            ir: {
                head: `(x0)=>iffe{
                    let (t1,c2) = (match x0 {
                        [h3,...rest4] -> (Some(h3),(opt5)=>(
                            match opt5 {None() -> rest4
                            Some(h6) -> [h6, ...rest4]
                        }))
                        [] -> (None(),(opt7)=>(match opt7 {None() -> []
                        Some(h8) -> [h8]}))})}{(t1,(back9)=>iffe{swap(t1,back9);
                            swap(x0,c2(t1))}{x0}{})}{}`,
            },
        },
        source: `{
            let x = [1,3,5]
            head(~x) := Some(3)
            let y = []
            head(~y) := Some(4)
            (x,y)
        }`,
        ir: `iffe{let x10 = [1, 3, 5];
        let _ = iffe{let (t14,c15) = head(x10)}{swap(t14,Some(3))}{swap(x10,c15(t14))};
        let y11 = [];
        let _ = iffe{let (t12,c13) = head(y11)}{swap(t12,Some(4))}{swap(y11,c13(t12))}}{(x10,y11)}{}`,
        result: [[3, 3, 5], [4]],
    },
    // NEXT: manual lensing in fn bodies
    {
        name: 'manual fn body',
        defns: {
            source: `
            fn leftShifted(~x) ~(@(x + 2, fn (x) { x - 2 }))
            `,
            ir: {
                leftShifted: `(x0)=>(+(x0,2),(x1)=>(-(x1,2)))`,
            },
        },
        source: `{
            let x = 4
            leftShifted(~x) := 5
            let y = 10
            inc(~leftShifted(~y))
            (x, y)
        }`,
        ir: `iffe{let x2 = 4;
        let _ = iffe{let (t8,c9) = leftShifted(x2)}{swap(t8,5)}{swap(x2,c9(t8))};
        let y3 = 10;
        let _ = iffe{let (t4,c5) = leftShifted(y3);
        let (r6,l7) = inc(t4)}{r6}{swap(t4,l7);
        swap(y3,c5(t4))}}{(x2,y3)}{}`,
        result: [3, 11],
    },
    {
        name: 'lens match with linear value',
        defns: {
            source: `
            fn f(side, ~(a, b)) ~(match side {
                Left -> a
                Right -> b
            })
            `,
            ir: {
                f: `(side0,(a1,b2))=>iffe{
                        let (t3,c4) = (match side0 {
                            Left() -> (a1,(back5)=>iffe{swap(a1,back5)}{Left()}{})
                            Right() -> (b2,(back6)=>iffe{swap(b2,back6)}{Right()}{})
                        })
                    }{
                        (t3,(back7)=>iffe{
                                swap(t3,back7);
                                swap(_,c4(t3))
                            }{(a1,b2)}{})
                    }{}`,
            },
        },
        source: `{
            let x = (1,5)
            f(Left, ~x) := 10
            f(Right, ~x) := 20
            x
        }`,
        ir: `iffe{let x8 = (1,5);
        let _ = iffe{let (t11,c12) = f(Left(),x8)}{swap(t11,10)}{swap(x8,c12(t11))};
        let _ = iffe{let (t9,c10) = f(Right(),x8)}{swap(t9,20)}{swap(x8,c10(t9))}}{x8}{}`,
        result: [10, 20],
    },
];

const l = (raw: string, builtins: string[], counter: { current: number }) => {
    const node = readLine(raw + '\n');
    const lin = grammar.parse<Linear>('Linear', node);
    if (lin.type !== 'success') {
        const pos = locLines(raw.split('\n'));
        const deepest = findDeepest(lin.failure);
        console.log(showDeepest(deepest!, grammar, raw, (n) => showPos(pos(n))));
        expect(lin.failure.reason).toEqual('');
        throw 1;
    }
    return linearToExpr(
        {
            scope: Object.fromEntries(builtins.map((name) => [name, -1])),
            counter,
        },
        lin.value,
    );
};

let log: any[] = [];
const builtins = {
    '+': (a: number, b: number) => a + b,
    '-': (a: number, b: number) => a - b,
    fst: ([a, b]: [any, any]) => {
        return [a, (a: any) => [a, b]];
    },
    inc: (v: number) => [null, v + 1],
    log: (v: any) => {
        log.push(v);
    },
    Some: (v: number) => ({ type: 'Some', args: [v] }),
    None: () => ({ type: 'None' }),
    newlens: () => [5, () => void 0],
};

it.each(pairs)('input / output $name', ({ source, ir: irSource, defns, result }) => {
    const globals: Record<string, any> = { ...builtins };
    const counter = { current: 0 };
    if (defns) {
        const file = readFile(defns.source);
        const result = grammar.parse<File>('File', file.node);
        if (result.type === 'failure') {
            const deepest = findDeepest(result.failure);
            console.log(showDeepest(deepest!, ir, irSource, (n) => showPos(file.pos(n))));
            expect(result.failure.reason).toEqual('');
            return;
        }
        const defnIR: Record<string, string> = {};
        const existingIR: Record<string, string> = {};

        result.value.forEach((item) => {
            if (item.type !== 'fn') {
                throw new Error(`defns should only contain function declarations`);
            }
            if (!item.name) throw new Error('defn functions must be named');
            const expr = linearToExpr(
                {
                    counter,
                    scope: Object.fromEntries(Object.keys(globals).map((name) => [name, -1])),
                },
                item,
            );
            {
                const ot = ir.parse<Expr>('Expr', readLine(defns.ir[item.name] + '\n'));
                if (ot.type !== 'success') {
                    const pos = locLines(irSource.split('\n'));
                    const deepest = findDeepest(ot.failure);
                    console.log(showDeepest(deepest!, ir, irSource, (n) => showPos(pos(n))));
                    expect(ot.failure.reason).toEqual('');
                    return;
                }
                // expect(sexpr(expr)).toEqual();
                existingIR[item.name] = sexpr(ot.value);
            }
            defnIR[item.name] = sexpr(expr);
            globals[item.name] = evalExpr({ builtins, scopes: [{}] }, expr);
        });
        expect(defnIR).toEqual(existingIR);
    }

    const oneExpr = l(source, Object.keys(globals), counter);

    let outText = '';

    if (irSource != '') {
        const ot = ir.parse<Expr>('Expr', readLine(irSource + '\n'));
        if (ot.type !== 'success') {
            const pos = locLines(irSource.split('\n'));
            const deepest = findDeepest(ot.failure);
            console.log(showDeepest(deepest!, ir, irSource, (n) => showPos(pos(n))));
            expect(ot.failure.reason).toEqual('');
            return;
        }
        outText = sexpr(ot.value);
    }
    // expect(sexpr(oneExpr)).toEqual(outText);

    log = [];
    if (result === Function) {
        expect(evalExpr({ scopes: [{}], builtins: globals }, oneExpr)).toBeInstanceOf(Function);
        expect(sexpr(oneExpr)).toEqual(outText);
    } else {
        const got = evalExpr({ scopes: [{}], builtins: globals }, oneExpr);
        const myText = sexpr(oneExpr);
        if (myText !== outText) {
            console.log('----');
            console.log(myText);
            console.log('----');
        }
        expect({
            result: log.length ? [got, log] : got,
            text: myText,
        }).toEqual({ result, text: outText });
    }
});
