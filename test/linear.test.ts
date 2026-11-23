import { expect, it } from 'bun:test';
import { CompileError, checkSource } from '../src/compiler.ts';

const fd = 'type linear Fd {\n    Fd(Number)\n}\n';
const code = (source: string, mode: 'pure' | 'dual' = 'dual') => {
    try {
        checkSource(source, { mode });
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
    return 'ok';
};

it('needs dual mode for `type linear`', () => {
    expect(code(`${fd}1`, 'pure')).toBe('dual-only');
    expect(code(`${fd}1`)).toBe('ok');
    expect(code(`// laminar: dual\n${fd}1`, 'dual')).toBe('ok');
});

it('declares generic linear unions', () => {
    expect(code('type linear Own(a) {\n    Own(a)\n}\n1')).toBe('ok');
});

it('rejects a linear alias, which would be transparent', () => {
    expect(code('type linear Fd = Number\n1')).toBe('linear-alias');
});

it('rejects dup of a linear value', () => {
    expect(code(`${fd}{let mut f = Fd(1)\n !f}`)).toBe('dup-linear');
    expect(code(`${fd}{let mut t = (Fd(1), 2)\n !t}`)).toBe('dup-linear');
    expect(code(`${fd}type Wrap(a) {\n    Wrap(a)\n}\n{let mut w = Wrap(Fd(1))\n !w}`)).toBe(
        'dup-linear',
    );
});

it('still allows dup of values that are not linear', () => {
    expect(code(`${fd}{let t = (1, 2)\n !t}`)).toBe('ok');
});

it('requires a union that holds a linear value to be linear too', () => {
    expect(code(`${fd}type Box {\n    Box(Fd)\n}\n1`)).toBe('linear-field');
    expect(code(`${fd}type linear Box {\n    Box(Fd)\n}\n1`)).toBe('ok');
    expect(code(`${fd}type Box(a) {\n    Box(a)\n}\n1`)).toBe('ok');
});

it('requires a linear local to be consumed', () => {
    expect(code(`${fd}{let mut f = Fd(1)\n 2}`)).toBe('linear-unconsumed');
    expect(code(`${fd}{let mut f = Fd(1)\n f}`)).toBe('ok');
    expect(code(`${fd}{let mut f = Fd(1)\n match f {\n mut Fd(n) -> n\n }}`)).toBe('ok');
});

it('treats what `lens p <- v` binds as linear by provenance', () => {
    const shifted = (cleanup: string) =>
        `fn shifted(~x) ~{lens v <- x + 2\n ${cleanup}}\n{let mut n = 1\n shifted(~n) := 5\n n}`;
    expect(code(shifted('x := v - 2'))).toBe('ok');
    expect(code(shifted('x := 0'))).toBe('linear-unconsumed');
    // A pure program may drop it.
    expect(code(shifted('x := 0').replace('let mut', 'let'), 'pure')).toBe('ok');
    const tail = (pattern: string) =>
        `fn tail(~xs) ~{lens [${pattern}, ...t] <- xs\n xs := t}\n{let mut xs = [1]\n tail(~xs) := [2, 3]\n xs}`;
    expect(code(tail('h'))).toBe('linear-unconsumed');
    expect(code(tail('_'))).toBe('ok');
});
