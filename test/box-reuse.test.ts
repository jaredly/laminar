import { expect, it } from 'bun:test';
import { typedProgram } from './backend/typed-program.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { emitC } from '../src/c/emit.ts';
import { emitGo } from '../src/go/emit.ts';
import { printConcreteProgram } from '../src/print-concrete.ts';

const target = wasm32Emscripten('test');
const compile = (source: string) => {
    const p = typedProgram(source);
    return compileConcreteProgram(p, target, [{ unit: p.units.at(-1)!.id, arguments: [] }]);
};
const bump =
    'fn bump(~xs) {\n match ~xs {\n [] -> ()\n [h, ...t] -> {\n h := h + 1\n bump(~t)\n }\n }\n}\n';
/** The text of the C function whose definition starts with `signature`. */
const fn = (c: string, signature: string): string => {
    const start = c.indexOf(signature + ' {');
    return c.slice(start, c.indexOf('\n}\n', start));
};

it('a same-layout borrowed update reuses the box without allocating or freeing', () => {
    const concrete = compile(`${bump}{let x = [1, 2]\n bump(~x)\n x}`);
    verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
    expect(printConcreteProgram(concrete)).toMatch(/retains/);
    const body = fn(emitC(concrete), 'Unit bump(void *environment, Lens_List_Number xs)');
    expect(body).not.toBe('');
    expect(body).not.toContain('allocate_context');
    expect(body).not.toContain('release_context');
});

it('Go writes the retained box in place instead of allocating a new one', () => {
    const go = emitGo(compile(`${bump}{let x = [1, 2]\n bump(~x)\n x}`));
    const start = go.indexOf('func bump(');
    const body = go.slice(start, go.indexOf('\n}\n', start));
    expect(body).not.toBe('');
    expect(body).not.toContain('new(');
});

it('a lens-valued match keeps allocating its box', () => {
    const concrete = compile(
        'fn first(~xs) ~{match ~xs {[h, ...t] -> h}}\n{let x = [1, 2]\n first(~x) := 5\n x}',
    );
    verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
    expect(printConcreteProgram(concrete)).not.toMatch(/retains/);
});

it('the verifier rejects a retained box that nothing reuses', () => {
    const concrete = JSON.parse(JSON.stringify(compile(`${bump}{let x = [1]\n bump(~x)\n x}`)));
    const strip = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(strip);
        else if (v && typeof v === 'object') {
            delete (v as { reuses?: string }).reuses;
            Object.values(v).forEach(strip);
        }
    };
    strip(concrete.code);
    expect(() => verifyConcreteProgram(concrete)).toThrow('Retained box is not reused');
});

it('a same-layout borrowed update projects its fields into the box', () => {
    const concrete = compile(`${bump}{let x = [1, 2]\n bump(~x)\n x}`);
    verifyConcreteProgram(JSON.parse(JSON.stringify(concrete)));
    expect(printConcreteProgram(concrete)).toMatch(/aslens in-place/);
    const c = fn(emitC(concrete), 'Unit bump(void *environment, Lens_List_Number xs)');
    // No payload copy and no backing for the tail: it is lent by address.
    expect(c).not.toContain('Backing');
    expect(c).toMatch(/\.read=&\(\*v\d+\)\.item1/);
    expect(c).toMatch(/\(\*v\d+\)\.item0 = h \+ 1;/);
    // The write happens where the source writes it: before the recursive call.
    expect(c.indexOf('.item0 = h + 1')).toBeLessThan(c.indexOf('= bump('));
    const go = emitGo(concrete);
    const body = go.slice(go.indexOf('func bump('), go.indexOf('\n}\n', go.indexOf('func bump(')));
    expect(body).not.toContain('Backing');
    expect(body).toMatch(/read: &\(\*v\d+\)\.item1/);
    expect(body).toMatch(/\(\*v\d+\)\.item0 = h \+ 1\.0/);
    expect(body.indexOf('.item0 = h + 1.0')).toBeLessThan(body.indexOf('\tbump('));
});

it('the verifier rejects an in-place mark without box reuse', () => {
    const concrete = JSON.parse(JSON.stringify(compile(`${bump}{let x = [1]\n bump(~x)\n x}`)));
    const strip = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(strip);
        else if (v && typeof v === 'object') {
            delete (v as { reuses?: string; retains?: string }).reuses;
            delete (v as { retains?: string }).retains;
            Object.values(v).forEach(strip);
        }
    };
    strip(concrete.code);
    expect(() => verifyConcreteProgram(concrete)).toThrow('Invalid in-place temporary');
});
