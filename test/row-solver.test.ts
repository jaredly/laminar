import { describe, expect, it } from 'bun:test';
import {
    Solver,
    TypeDiagnostic,
    con,
    fn,
    plain,
    record,
    printScheme,
    type Ty,
} from '../src/types.ts';

const int = con('Number'),
    bool = con('Bool');
const field = (name: string, type: Ty) => ({ name, type });
const setup = () => {
    const s = new Solver();
    const row = () => s.fresh() as Ty & { tag: 'meta' };
    const open = (rest: Ty, ...fields: [string, Ty][]) =>
        s.row(
            fields.map(([n, t]) => field(n, t)),
            rest,
            0,
        );
    const show = (t: Ty) => printScheme(s.generalize(t, []));
    return { s, row, open, show };
};
const code = (run: () => unknown) => {
    try {
        run();
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    return 'no error';
};

describe('row unification', () => {
    it('ignores field order', () => {
        const { s } = setup();
        s.unify(
            record([field('a', int), field('b', bool)]),
            record([field('b', bool), field('a', int)]),
            0,
        );
    });
    it('shares a fresh remainder that lacks both prefixes', () => {
        const { s, row, open, show } = setup();
        const r = row(),
            t = row();
        const left = open(r, ['a', int]);
        s.unify(left, open(t, ['b', bool]), 0);
        expect(show(left)).toBe('{a: Number, b: Bool, ...a}');
        const tail = (s.prune(left) as Ty & { tag: 'record' }).rest as Ty & { tag: 'meta' };
        expect([...s.rowLacks(tail.id)!].sort()).toEqual(['a', 'b']);
    });
    it('rejects different fields on one shared remainder', () => {
        const { s, row, open } = setup();
        const r = row();
        expect(code(() => s.unify(open(r, ['a', int]), open(r, ['b', bool]), 0))).toBe(
            'type-mismatch',
        );
    });
    it('rejects infinite rows, directly and through a field', () => {
        const { s, row, open } = setup();
        const r = row();
        expect(code(() => s.unify(r, open(r, ['a', int]), 0))).toBe('infinite-type');
        const q = row();
        s.markRow(q);
        expect(code(() => s.unify(q, record([field('a', q)]), 0))).toBe('infinite-type');
    });
    it('propagates lacks constraints through remainders', () => {
        const { s, row, open } = setup();
        const r = row(),
            t = row();
        s.requireLacks(r, 'a', 0);
        s.unify(r, open(t, ['b', int]), 0);
        expect(code(() => s.unify(t, record([field('a', bool)]), 0))).toBe('row-lacks');
    });
    it('binds the open side to the surplus of a closed one', () => {
        const { s, row, open, show } = setup();
        const r = row();
        const left = open(r, ['a', int]);
        s.unify(left, record([field('a', int), field('b', bool)]), 0);
        expect(show(left)).toBe('{a: Number, b: Bool}');
        expect(code(() => s.unify(open(row(), ['z', int]), record([]), 0))).toBe('type-mismatch');
    });
    it('normalizes again when a payload settles a remainder', () => {
        const { s, row, open, show } = setup();
        const r = row();
        const left = open(r, ['a', record([], undefined)]);
        const right = record([field('a', record([])), field('b', int)]);
        s.unify(left, right, 0);
        expect(show(left)).toBe('{a: {}, b: Number}');
        const q = row(),
            payload = row();
        s.markRow(payload);
        const one = open(q, ['a', payload]),
            two = open(row(), ['a', q]);
        // `a`'s payload is the left remainder itself, so unifying it changes that remainder.
        expect(code(() => s.unify(one, two, 0))).toBe('no error');
    });
    it('never strengthens a rigid remainder into new fields', () => {
        const { s, row, open } = setup();
        const rigid = s.rigid();
        expect(code(() => s.unify(open(rigid, ['a', int]), open(row(), ['b', bool]), 0))).toBe(
            'type-mismatch',
        );
        const flexible = row();
        expect(code(() => s.unify(open(rigid, ['a', int]), flexible, 0))).toBe('no error');
        expect(code(() => s.unify(rigid, record([]), 0))).toBe('type-mismatch');
        expect(code(() => s.unify(s.rigid(), s.rigid(), 0))).toBe('type-mismatch');
    });
    it('keeps row variables apart from other types', () => {
        const { s, row } = setup();
        const r = row();
        s.markRow(r);
        expect(code(() => s.unify(r, int, 0))).toBe('type-mismatch');
    });
    it('instantiates schemes with independent remainders that keep their constraints', () => {
        const { s, row, open } = setup();
        const r = row();
        const m = open(r, ['name', int]);
        const scheme = s.generalize(fn([plain(m)], plain(r)), []);
        expect(scheme.rows).toEqual([{ parameter: 0, lacks: ['name'] }]);
        const use = () => (s.instantiate(scheme) as Ty & { tag: 'fn' }).result;
        const first = (use() as { tag: 'plain'; value: Ty }).value,
            second = (use() as { tag: 'plain'; value: Ty }).value;
        s.unify(first, record([field('x', int)]), 0);
        s.unify(second, record([field('y', int)]), 0);
        expect(
            code(() =>
                s.unify(
                    (use() as { tag: 'plain'; value: Ty }).value,
                    record([field('name', int)]),
                    0,
                ),
            ),
        ).toBe('row-lacks');
    });
});
