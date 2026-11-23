import { expect, it } from 'bun:test';
import { CompileError, checkSource } from '../src/compiler.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';

const run = (source: string) => executeTypedProgram(checkSource(source, { mode: 'dual' }), {});
const code = (source: string, mode: 'pure' | 'dual' = 'dual') => {
    try {
        checkSource(source, { mode });
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
    return 'ok';
};

it('reads a plain binding any number of times, whatever its type', () => {
    expect(run('fn double(x) {x + x}\ndouble(2)')).toBe(4);
    expect(run('{let p = (1, 2)\n (p, p)}')).toEqual([
        [1, 2],
        [1, 2],
    ]);
    expect(run('{let s = "a"\n (s, s)}')).toEqual(['a', 'a']);
});

it('consumes a mut binding on read, as in pure mode', () => {
    expect(code('{let mut x = (1, 2)\n (x, x)}')).toBe('use-after-move');
    expect(run('{let mut x = (1, 2)\n x}')).toEqual([1, 2]);
});

it('borrows and assigns only mut bindings', () => {
    const inc = 'fn inc(~x) {x := x + 1}\n';
    expect(code(`${inc}{let n = 1\n inc(~n)\n n}`)).toBe('plain-lens');
    expect(run(`${inc}{let mut n = 1\n inc(~n)\n n}`)).toBe(2);
    expect(code('{let n = 1\n n := 2\n n}')).toBe('plain-lens');
});

it('takes parameters plain unless they are mut or lenses', () => {
    expect(code('fn f(x) {(x, x)}\nf(1)')).toBe('ok');
    expect(code('fn f(mut x) {(x, x)}\nf(1)')).toBe('use-after-move');
    expect(run('fn f(mut x) {x}\nf((1, 2))')).toEqual([1, 2]);
});

it('allows an explicit dup of a plain binding', () => {
    expect(run('{let p = (1, 2)\n (!p, p)}')).toEqual([
        [1, 2],
        [1, 2],
    ]);
});

it('freezes a mut binding into a plain one only through an explicit dup', () => {
    expect(code('{let mut m = (1, 2)\n let p = m\n (p, p)}')).toBe('mut-to-plain');
    expect(code('{let mut n = 1\n let p = n\n p}')).toBe('mut-to-plain');
    expect(code('{let mut m = (1, 2)\n let p = (m, 3)\n p}')).toBe('mut-to-plain');
    expect(code('{let mut m = (1, 2)\n match m {\n p -> p\n }}')).toBe('mut-to-plain');
    expect(run('{let mut m = (1, 2)\n let p = dup(~m)\n (p, p, m)}')).toEqual([
        [1, 2],
        [1, 2],
        [1, 2],
    ]);
    // Staying mut, borrowing, or discarding is not a freeze.
    expect(run('{let mut m = (1, 2)\n let mut q = m\n q}')).toEqual([1, 2]);
    expect(code('{let mut m = (1, 2)\n let _ = m\n 0}')).toBe('ok');
    // Taking a mut value apart leaves owned, mut parts.
    expect(run('{let mut m = (1, 2)\n match m {\n (a, b) -> (b, a)\n }}')).toEqual([2, 1]);
    expect(code('{let mut m = (1, 2)\n let (a, b) = m\n (a, a)}')).toBe('use-after-move');
    expect(code('{let mut n = 1\n let p = n + 1\n p}')).toBe('ok');
});

it('copies a plain binding into a closure', () => {
    expect(run('{let n = 3\n let f = fn (x) {x + n + n}\n f(1)}')).toBe(7);
});

it('rejects mut in pure mode', () => {
    expect(code('{let mut n = 1\n n}', 'pure')).toBe('dual-only');
    expect(code('fn f(mut x) {x}\nf(1)', 'pure')).toBe('dual-only');
});

it('rejects a linear value in a plain binding', () => {
    const fd = 'type linear Fd {\n    Fd(Number)\n}\n';
    expect(code(`${fd}{let f = Fd(1)\n f}`)).toBe('linear-plain');
    expect(code(`${fd}{let mut f = Fd(1)\n f}`)).toBe('ok');
});

it('runs a borrowed match over a mut owner', () => {
    const bump = `fn bump(~xs) {
    match ~xs {
        [] -> ()
        [head, ...tail] -> {
            head := head + 1
            bump(~tail)
        }
    }
}
`;
    expect(run(`${bump}{let mut x = [1,2,3]\n bump(~x)\n x}`)).toEqual([2, 3, 4]);
});

it('keeps a linear value out of generic functions that copy their arguments', () => {
    const own = 'type linear Fd {\n    Fd(Number)\n}\ntype Own(a) {\n    Own(a)\n}\n';
    // `wrap` takes x plain, so it copies x.
    expect(code(`${own}fn wrap(x) {Own(x)}\n{let mut f = Fd(1)\n wrap(f)}`)).toBe('dup-linear');
    expect(code(`${own}fn wrap(x) {Own(x)}\n{let n = 1\n wrap(n)}`)).toBe('ok');
    // The bound carries through a generic caller.
    const twice = `${own}fn wrap(x) {Own(x)}\nfn twice(y) {wrap(y)}\n`;
    expect(code(`${twice}{let mut f = Fd(1)\n twice(f)}`)).toBe('dup-linear');
    // A mut parameter moves instead of copying, so it can take a linear value.
    expect(
        code(`${own}fn wrap(mut x) {Own(x)}\n{let mut f = Fd(1)\n let mut w = wrap(f)\n w}`),
    ).toBe('ok');
    expect(code(`${own}fn dupe(mut x) {(!x, x)}\n{let mut f = Fd(1)\n dupe(f)}`)).toBe(
        'dup-linear',
    );
});
