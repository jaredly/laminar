import { describe, expect, it } from 'bun:test';
import { Solver, TypeDiagnostic, con, fn, needs, plain, printType, type Ty } from '../src/types.ts';

const int = con('Number'),
    bool = con('Bool');
const need = (name: string, type: Ty = int) => ({ name, type });
const code = (run: () => unknown) => {
    try {
        run();
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    return 'no error';
};
const show = (s: Solver, row: Ty) => printType(s.resolve(row));

describe('dependency rows', () => {
    it('lets names commute and shares a remainder', () => {
        const s = new Solver(),
            e = s.fresh(),
            f = s.fresh();
        const left = needs([need('console')], e),
            right = needs([need('state', bool)], f);
        s.unify(left, right, 0);
        expect(show(s, left)).toBe('{console: Number, state: Bool, ...a}');
        expect(show(s, right)).toBe(show(s, left));
    });
    it('keeps repeats, matched in order', () => {
        const s = new Solver();
        expect(code(() => s.unify(needs([need('a'), need('a')]), needs([need('a')]), 0))).toBe(
            'needs-mismatch',
        );
        expect(
            code(() =>
                s.unify(
                    needs([need('a', int), need('a', bool)]),
                    needs([need('a', bool), need('a', int)]),
                    0,
                ),
            ),
        ).toBe('type-mismatch');
        const e = s.fresh();
        s.unify(needs([need('a')], e), needs([need('a')]), 0);
        expect(show(s, e)).toBe('{}');
    });
    it('matches only the first of a repeated name against a single one', () => {
        const s = new Solver(),
            outer = s.fresh(),
            callee = s.fresh(),
            injected = s.fresh();
        // inject log = Bool over `outer`, calling something that needs log and whatever else.
        s.unify(needs([need('log', bool)], outer), needs([need('log', injected)], callee), 0);
        expect(show(s, injected)).toBe('Bool');
        expect(s.prune(callee)).toBe(s.prune(outer));
    });
    it('fails, without looping, on one remainder with two prefixes', () => {
        const s = new Solver(),
            e = s.fresh();
        expect(code(() => s.unify(needs([need('a')], e), needs([need('b')], e), 0))).toBe(
            'needs-mismatch',
        );
        expect(code(() => s.unify(e, needs([need('a')], e), 0))).toBe('infinite-type');
    });
    it('never gives a rigid remainder more entries', () => {
        const s = new Solver(),
            rigid = s.rigid();
        expect(code(() => s.requireEntry(rigid, 'a', 0))).toBe('missing-dependency');
        expect(
            code(() => s.unify(needs([need('a')], rigid), needs([need('b')], s.fresh()), 0)),
        ).toBe('needs-mismatch');
    });
    it('keeps a function stored as a dependency from needing any', () => {
        const s = new Solver(),
            row = s.fresh();
        const entry = s.requireEntry(row, 'log', 0);
        s.unify(entry, fn([plain(int)], plain(int), undefined, s.fresh()), 0);
        expect(printType(s.resolve(entry))).toBe('(Number) => Number');
        const other = s.requireEntry(row, 'now', 0);
        expect(
            code(() => s.unify(other, fn([], plain(int), undefined, needs([need('clock')])), 0)),
        ).toBe('needy-dependency');
    });
});
