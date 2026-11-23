import { expect, it } from 'bun:test';
import { CompileError, checkSource } from '../src/compiler.ts';

/** `mut` marks an owned position, `shared` a plain one. */
const modes = (source: string, name: string, mode: 'pure' | 'dual' = 'dual') => {
    const unit = checkSource(source, { mode }).units.find(
        (u) => u.definition === `unit/definition/${name}`,
    )!;
    const type = unit.signature.type;
    if (type.tag !== 'fn') throw new Error('not a function');
    const show = (f: (typeof type.args)[number]) =>
        f.tag === 'plain' ? (f.mode === 'shared' ? 'shared' : 'mut') : 'lens';
    return `(${type.args.map(show).join(', ')}) -> ${show(type.result)}`;
};

it('makes plain parameters shared and mut parameters owned', () => {
    expect(modes('fn f(x) {x}', 'f')).toBe('(shared) -> shared');
    expect(modes('fn f(mut x) {x}', 'f')).toBe('(mut) -> mut');
    expect(modes('fn f(x, mut y) {y}', 'f')).toBe('(shared, mut) -> mut');
});

it('makes a result shared when it is a plain read or holds one', () => {
    expect(modes('fn f(x) {(x, 1)}', 'f')).toBe('(shared) -> shared');
    expect(modes('fn f(x) {{let y = x\n y}}', 'f')).toBe('(shared) -> shared');
    expect(modes('fn f(mut x) {(x, 1)}', 'f')).toBe('(mut) -> mut');
});

it('makes a fresh result owned, and a call yield its callee result mode', () => {
    expect(modes('fn f(x) {x + 1}', 'f')).toBe('(shared) -> mut');
    expect(modes('fn f(x) {x}\nfn g(y) {f(y)}', 'g')).toBe('(shared) -> shared');
    expect(modes('fn f(mut x) {x}\nfn g(y) {f(dup(~y))}', 'g')).toBe('(shared) -> mut');
});

it('leaves an explicit dup owned', () => {
    expect(modes('fn f(x) {!x}', 'f')).toBe('(shared) -> mut');
});

it('keeps every position owned in pure mode', () => {
    expect(modes('fn f(x) {x}', 'f', 'pure')).toBe('(mut) -> mut');
});

const errorCode = (source: string): string => {
    try {
        checkSource(source, { mode: 'dual' });
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
    return 'ok';
};

it('needs a dup to pass a plain value to a mut parameter', () => {
    const own = 'fn own(mut x) {x}\n';
    expect(errorCode(`${own}{let p = (1, 2)\n own(p)}`)).toBe('shared-into-mut');
    expect(errorCode(`${own}{let p = (1, 2)\n own(dup(~p))}`)).toBe('ok');
    expect(errorCode(`${own}{let mut m = (1, 2)\n own(m)}`)).toBe('ok');
    expect(errorCode(`${own}own((1, 2))`)).toBe('ok');
});

it('lets owned and shared values into plain parameters', () => {
    const read = 'fn read(x) {x}\n';
    expect(errorCode(`${read}{let p = (1, 2)\n read(p)}`)).toBe('ok');
    expect(errorCode(`${read}{let mut m = (1, 2)\n read(m)}`)).toBe('ok');
});

it('needs a dup to initialize a mut binding from a plain value', () => {
    expect(errorCode('{let p = (1, 2)\n let mut m = p\n m}')).toBe('shared-into-mut');
    expect(errorCode('{let p = (1, 2)\n let mut m = dup(~p)\n m}')).toBe('ok');
    expect(errorCode('{let mut a = (1, 2)\n let mut m = a\n m}')).toBe('ok');
    expect(errorCode('{let mut m = (1, 2)\n m}')).toBe('ok');
});

it('settles an open parameter mode from a shared argument', () => {
    const own = 'fn own(mut x) {x}\nfn app(f, v) {f(v)}\n';
    expect(errorCode(`${own}{let p = (1, 2)\n app(own, p)}`)).toBe('mode-mismatch');
    expect(modes('fn app(f, v) {f(v)}', 'app')).toContain('shared');
});

it('makes a call whose callee is not known yet owned when it goes into mut storage', () => {
    const run = 'fn run(f, mut v) {let mut x = f(v)\n x}\n';
    expect(errorCode(`${run}fn g(mut p) {p}\n{run(g, (1, 2))}`)).toBe('ok');
    expect(errorCode(`${run}fn g(p) {p}\n{run(g, (1, 2))}`)).toBe('mode-mismatch');
});

it('prints shared positions with & in function types', () => {
    expect(() => checkSource('fn f(x) {x + 1}\n{f(f)}', { mode: 'dual' })).toThrow(
        '(&Number) => Number',
    );
});
