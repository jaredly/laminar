import { expect, it } from 'bun:test';
import { checkSource } from '../src/compiler.ts';

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
