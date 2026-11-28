/** The typed IR verifier refuses a function used with ownership it was not checked for. */
import { describe, expect, it } from 'bun:test';
import { checkSource } from '../src/compiler.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import type { SemanticType } from '../src/elaborated.ts';
import type { TypedProgram } from '../src/typed-ir.ts';

const check = (source: string) => checkSource(`// laminar: dual\n${source}`);

/** A copy of the program with the signature of `definition`'s function edited. */
const claiming = (
    program: TypedProgram,
    edit: (type: SemanticType & { tag: 'fn' }) => void,
): TypedProgram => {
    const copy = structuredClone(program) as TypedProgram;
    const unit = copy.units.find((u) => u.definition)!;
    edit(unit.signature.type as SemanticType & { tag: 'fn' });
    return copy;
};
const shared = (position: { tag: string; mode?: 'shared' }, on: boolean) => {
    if (on) position.mode = 'shared';
    else delete position.mode;
};

describe('ownership in function types, in the IR', () => {
    const owns = check('fn f(mut v) { v }\n0');
    const reads = check('fn f(v) { v }\n0');
    const makes = check('fn f(n) { n + 1 }\n0');

    it('accepts what the checker produced', () => {
        for (const program of [owns, reads, makes])
            expect(() => verifyTypedProgram(program)).not.toThrow();
    });
    it('accepts an owned result published as shared', () => {
        const frozen = claiming(makes, (t) => shared(t.result as never, true));
        expect(() => verifyTypedProgram(frozen)).not.toThrow();
    });
    it('rejects a parameter the function owns published as shared', () => {
        const bad = claiming(owns, (t) => shared(t.args[0] as never, true));
        expect(() => verifyTypedProgram(bad)).toThrow('wrong ownership');
    });
    it('rejects a shared result published as owned', () => {
        const bad = claiming(reads, (t) => shared(t.result as never, false));
        expect(() => verifyTypedProgram(bad)).toThrow('wrong ownership');
    });
});
