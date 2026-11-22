/**
 * Expressions are spelled with the parentheses their structure needs and no more:
 * a member access or dereference parenthesizes an operand that binds more loosely,
 * and a binary parenthesizes an operand by rank without ever regrouping evaluation.
 * The rules apply when a pass substitutes an expression for a name, too.
 */
import { expect, it } from 'bun:test';
import { Locals } from '../src/backend/imperative/locals.ts';
import { cSyntax, printStatements as printC } from '../src/c/syntax.ts';
import { goSyntax, printGoStatements as printGo } from '../src/go/syntax.ts';
import type { Expr } from '../src/backend/imperative/code.ts';
import type { Statement } from '../src/backend/imperative/statements.ts';

const names = ['a', 'b', 'c', 'p', 'q'];
const fresh = (syntax = cSyntax) => {
    const l = new Locals(syntax);
    names.forEach((n) => l.reference(n));
    return l;
};
const f = (l: Locals) => l.literal('f');

it('spells a member access on a name, a chain and a call without parentheses', () => {
    const l = fresh();
    expect(String(l.access('p', '.', f(l)))).toBe('p.f');
    expect(String(l.access(l.access('p', '.', l.literal('g')), '.', f(l)))).toBe('p.g.f');
    expect(String(l.deref(l.access('p', '.', f(l))))).toBe('*p.f');
});

it('parenthesizes a member access base that binds more loosely', () => {
    const l = fresh();
    expect(String(l.access(l.deref('p'), '.', f(l)))).toBe('(*p).f');
    expect(String(l.access(l.binary('+', 'a', 'b'), '.', f(l)))).toBe('(a + b).f');
    // Spelling nothing declared is the loosest, so it is wrapped.
    expect(String(l.access(l.template`g(${'a'})`, '.', f(l)))).toBe('(g(a)).f');
    expect(String(l.deref(l.binary('+', 'a', 'b')))).toBe('*(a + b)');
    expect(String(l.deref(l.deref('p')))).toBe('**p');
});

it('parenthesizes a binary operand only when it binds more loosely', () => {
    const l = fresh();
    const mul = l.binary('*', 'b', 'c');
    const sum = l.binary('+', 'a', 'b');
    expect(String(l.binary('+', 'a', mul))).toBe('a + b * c');
    expect(String(l.binary('*', sum, 'c'))).toBe('(a + b) * c');
    expect(String(l.binary('*', 'a', sum))).toBe('a * (a + b)');
    expect(String(l.binary('==', sum, 'c'))).toBe('a + b == c');
});

it('never regroups operands of the same rank', () => {
    const l = fresh();
    // Left grouping is the default, so a left operand needs no parentheses; a right
    // operand at the same rank keeps them, so floating point rounding is unchanged.
    expect(String(l.binary('-', l.binary('-', 'a', 'b'), 'c'))).toBe('a - b - c');
    expect(String(l.binary('-', 'a', l.binary('-', 'b', 'c')))).toBe('a - (b - c)');
    expect(String(l.binary('+', 'a', l.binary('+', 'b', 'c')))).toBe('a + (b + c)');
    expect(String(l.binary('/', 'a', l.binary('*', 'b', 'c')))).toBe('a / (b * c)');
    expect(String(l.binary('/', l.binary('*', 'a', 'b'), 'c'))).toBe('a * b / c');
});

it('never nests a comparison in a comparison unparenthesized', () => {
    const l = fresh();
    const eq = l.binary('==', 'a', 'b');
    expect(String(l.binary('==', eq, 'c'))).toBe('(a == b) == c');
    expect(String(l.binary('==', 'c', eq))).toBe('c == (a == b)');
    expect(String(l.binary('>=', eq, 'c'))).toBe('(a == b) >= c');
});

it('spells the same in Go', () => {
    const l = fresh(goSyntax);
    expect(String(l.deref(l.access('p', '.', f(l))))).toBe('*p.f');
    expect(String(l.access(l.deref('p'), '.', f(l)))).toBe('(*p).f');
    expect(String(l.binary('*', l.binary('+', 'a', 'b'), 'c'))).toBe('(a + b) * c');
});

const printed = (l: Locals, body: Statement[], go = false) =>
    (go ? printGo : printC)(l.place(body)).join('\n');

it('parenthesizes when a pass puts an expression where a name was', () => {
    for (const go of [false, true]) {
        const l = fresh(go ? goSyntax : cSyntax);
        const t = l.reference('t');
        const body: Statement[] = [
            // `t` is a single-use arithmetic result, so it is inlined into its one use.
            l.declaration('t', 'double', l.binary('+', 'a', 'b'), { pure: true, inline: true }),
            l.template`use(${l.access(t, '.', f(l))})`,
            l.template`use(${l.binary('*', t, 'c')})`,
        ];
        // Two uses: no inlining happens, and the name stands in unchanged.
        expect(printed(l, body, go)).toContain('t.f');

        const m = fresh(go ? goSyntax : cSyntax);
        const u = m.reference('u');
        const once: Statement[] = [
            m.declaration('u', 'double', m.binary('+', 'a', 'b'), { pure: true, inline: true }),
            m.template`use(${m.access(u, '.', f(m))})`,
        ];
        expect(printed(m, once, go)).toBe('use((a + b).f)');

        const n = fresh(go ? goSyntax : cSyntax);
        const v = n.reference('v');
        const product: Statement[] = [
            n.declaration('v', 'double', n.binary('+', 'a', 'b'), { pure: true, inline: true }),
            n.template`use(${n.binary('*', v, 'c')})`,
        ];
        expect(printed(n, product, go)).toBe('use((a + b) * c)');

        const w = fresh(go ? goSyntax : cSyntax);
        const x = w.reference('x');
        const right: Statement[] = [
            w.declaration('x', 'double', w.binary('-', 'b', 'c'), { pure: true, inline: true }),
            w.template`use(${w.binary('-', 'a', x)})`,
        ];
        expect(printed(w, right, go)).toBe('use(a - (b - c))');
    }
});

it('keeps text it did not build parenthesized around a member access', () => {
    const l = fresh();
    const loose: Expr = l.template`${'a'} ? ${'b'} : ${'c'}`;
    expect(String(l.access(loose, '.', f(l)))).toBe('(a ? b : c).f');
});
