import { expect, it } from 'bun:test';
import { CompileError, checkSource } from '../src/compiler.ts';
import { declaredMode } from '../src/mode.ts';

const failure = (work: () => unknown): CompileError => {
    try {
        work();
    } catch (error) {
        if (error instanceof CompileError) return error;
        throw error;
    }
    throw Error('Expected a compile error');
};

const program = 'fn inc(x) {x + 1}\ninc(2)';

it('compiles in pure mode by default, requested or declared', () => {
    const units = (source: string, mode?: 'pure' | 'dual') =>
        checkSource(source, { mode }).units.length;
    expect(units(program)).toBe(2);
    expect(units(program, 'pure')).toBe(2);
    expect(units(`// laminar: pure\n${program}`)).toBe(2);
    expect(units(`\n  // laminar: pure\n${program}`, 'pure')).toBe(2);
});

it('reads the mode pragma only from the first non-blank line', () => {
    expect(declaredMode(program)).toBeUndefined();
    expect(declaredMode(`// laminar: dual\n${program}`)).toBe('dual');
    expect(declaredMode(`// a comment\n// laminar: dual\n${program}`)).toBeUndefined();
    expect(declaredMode(`// laminar: wat\n${program}`)).toEqual({ invalid: 'wat' });
});

it('rejects an unknown pragma mode', () => {
    const error = failure(() => checkSource(`// laminar: wat\n${program}`));
    expect([error.stage, error.code]).toEqual(['usage', 'unknown-mode']);
});

it('never mixes languages: a pragma must agree with the requested mode', () => {
    const error = failure(() => checkSource(`// laminar: pure\n${program}`, { mode: 'dual' }));
    expect([error.stage, error.code]).toEqual(['usage', 'mode-mismatch']);
});

it('reports dual mode as not implemented yet', () => {
    for (const run of [
        () => checkSource(program, { mode: 'dual' }),
        () => checkSource(`// laminar: dual\n${program}`),
    ])
        expect(failure(run).code).toBe('unimplemented-mode');
});

it('reserves mut and linear in every mode', () => {
    for (const word of ['mut', 'linear']) {
        const error = failure(() => checkSource(`fn f(${word}) ${word}\nf(1)`));
        expect([error.stage, error.code]).toEqual(['parse', 'syntax']);
    }
});
