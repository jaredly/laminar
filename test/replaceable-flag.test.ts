import { describe, expect, it } from 'bun:test';
import {
    FIXED,
    REPLACEABLE,
    Solver,
    TypeDiagnostic,
    con,
    flow,
    fn,
    plain,
    printType,
    type FlowTy,
} from '../src/types.ts';

// Step 2 of docs/scattered-constructor-lenses.md: the `replaceable` flag on lens types.
// Nothing sets it to FIXED yet (constructor lenses are step 3), so these tests drive the
// solver directly.

const number = con('Number');
const code = (f: () => void): string => {
    try {
        f();
    } catch (e) {
        if (e instanceof TypeDiagnostic) return e.code;
        throw e;
    }
    throw new Error('Expected a diagnostic');
};
const lens = (t: FlowTy): FlowTy & { tag: 'flow' } => {
    if (t.tag !== 'flow') throw new Error('Expected a lens');
    return t;
};

describe('replaceable flag', () => {
    it('defaults to replaceable', () => {
        const s = new Solver();
        expect(lens(flow(number, number)).replaceable).toBe(REPLACEABLE);
        expect(s.replaceability(lens(flow(number, number)))).toBe('replaceable');
        expect(s.replaceability(lens(flow(number, number, FIXED)))).toBe('fixed');
        expect(s.replaceability(lens(flow(number, number, s.fresh())))).toBe('unknown');
    });
    it('unifies equal flags', () => {
        const s = new Solver();
        s.unifyFlow(flow(number, number), flow(number, number), 0);
        s.unifyFlow(flow(number, number, FIXED), flow(number, number, FIXED), 0);
    });
    it('rejects a replaceable lens against a fixed one in either order', () => {
        const s = new Solver();
        expect(code(() => s.unifyFlow(flow(number, number), flow(number, number, FIXED), 0))).toBe(
            'replaceable-mismatch',
        );
        expect(code(() => s.unifyFlow(flow(number, number, FIXED), flow(number, number), 0))).toBe(
            'replaceable-mismatch',
        );
    });
    it('does not mask other mismatches', () => {
        const s = new Solver();
        expect(code(() => s.unifyFlow(flow(number, number), flow(con('Bool'), number), 0))).toBe(
            'type-mismatch',
        );
        expect(code(() => s.unifyFlow(plain(number), flow(number, number), 0))).toBe(
            'mode-mismatch',
        );
    });
    it('resolves a flag meta by unification', () => {
        const s = new Solver();
        const flag = s.fresh();
        const open = flow(number, number, flag);
        expect(s.replaceability(lens(open))).toBe('unknown');
        s.unifyFlow(open, flow(number, number, FIXED), 0);
        expect(s.replaceability(lens(open))).toBe('fixed');
        expect(code(() => s.unifyFlow(open, flow(number, number), 0))).toBe('replaceable-mismatch');
    });
    it('shares a flag meta between lenses', () => {
        const s = new Solver();
        const flag = s.fresh();
        s.unifyFlow(flow(number, number, flag), flow(number, number, flag), 0);
        s.unify(flag, FIXED, 0);
        expect(s.replaceability(lens(flow(number, number, flag)))).toBe('fixed');
    });
    it('flows through function types', () => {
        const s = new Solver();
        const flag = s.fresh();
        const callee = fn([plain(number)], flow(number, number, flag));
        s.unify(callee, fn([plain(number)], flow(number, number, FIXED)), 0);
        const resolved = s.resolve(callee);
        if (resolved.tag !== 'fn') throw new Error('Expected a function');
        expect(s.replaceability(lens(resolved.result))).toBe('fixed');
        expect(code(() => s.unify(callee, fn([plain(number)], flow(number, number)), 0))).toBe(
            'replaceable-mismatch',
        );
    });
    it('generalizes and instantiates an unresolved flag', () => {
        const s = new Solver();
        const flag = s.fresh();
        const scheme = s.generalize(fn([flow(number, number, flag)], plain(number)), []);
        expect(scheme.quantified.length).toBe(1);
        const one = s.instantiate(scheme);
        const two = s.instantiate(scheme);
        if (one.tag !== 'fn' || two.tag !== 'fn') throw new Error('Expected functions');
        // Each instantiation gets its own flag: one fixed, one replaceable.
        s.unifyFlow(one.args[0], flow(number, number, FIXED), 0);
        s.unifyFlow(two.args[0], flow(number, number), 0);
        expect(s.replaceability(lens(one.args[0]))).toBe('fixed');
        expect(s.replaceability(lens(two.args[0]))).toBe('replaceable');
    });
    it('keeps a resolved flag when generalizing', () => {
        const s = new Solver();
        const flag = s.fresh();
        s.unify(flag, FIXED, 0);
        const scheme = s.generalize(fn([plain(number)], flow(number, number, flag)), []);
        expect(scheme.quantified.length).toBe(0);
        const t = s.instantiate(scheme);
        if (t.tag !== 'fn') throw new Error('Expected a function');
        expect(s.replaceability(lens(t.result))).toBe('fixed');
    });
    it('prints a fixed lens with the /= syntax and leaves other lenses unchanged', () => {
        expect(printType(fn([flow(number, number)], flow(number, number)))).toBe(
            '(Number/Number) => Number/Number',
        );
        expect(printType(fn([plain(number)], flow(number, con('Bool'), FIXED)))).toBe(
            '(Number) => Number/=Bool',
        );
    });
    it('cannot collide with a user-declared type name', () => {
        expect(REPLACEABLE).not.toEqual(con('Replaceable'));
        expect(FIXED).not.toEqual(con('Fixed'));
    });
});
