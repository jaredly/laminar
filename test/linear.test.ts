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
    expect(code(`${fd}{let t = (1, 2)\n dup(t)}`)).toBe('ok');
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

it('binds `lens p <- v` names as ordinary mut values of their own type', () => {
    const shifted = (cleanup: string) =>
        `fn shifted(~x) ~{lens v <- x + 2\n ${cleanup}}\n{let mut n = 1\n shifted(~n) := 5\n n}`;
    expect(code(shifted('x := v - 2'))).toBe('ok');
    // A Number can be copied or dropped, as in the pure language.
    expect(code(shifted('x := dup(~v) - 2'))).toBe('ok');
    expect(code(shifted('x := 0'))).toBe('ok');
    // A linear value bound this way is linear by its type.
    const wrap = `${fd}fn open(~x) ~{lens Fd(n) <- Fd(x)\n LEAK}\n`;
    expect(code(wrap.replace('LEAK', 'x := n'))).toBe('ok');
});

it('requires a linear parameter to be consumed', () => {
    const conn = 'type linear Conn {\n    Conn(Number)\n}\n';
    // dropped: nothing consumes it
    expect(code(`${conn}fn forget(mut c) {match ~c {Conn(fd) -> dup(~fd)}}\n1`)).toBe('linear-unconsumed');
    // consumed by a match, by being returned, or by being passed on
    expect(code(`${conn}fn close(mut c) {match c {Conn(fd) -> fd}}\n1`)).toBe('ok');
    expect(code(`${conn}fn keep(mut c) {match ~c {Conn(fd) -> dup(~fd)}\n c}\n1`)).toBe('ok');
    expect(code(`${conn}fn close(mut c) {match c {Conn(fd) -> fd}}\nfn through(mut c) {close(c)}\n1`)).toBe('ok');
    // a lens parameter is borrowed, so the caller keeps the value
    expect(code(`${conn}fn peek(~c) {match ~c {Conn(fd) -> dup(~fd)}}\n1`)).toBe('ok');
});

it('rejects a linear argument for a function that drops its parameter', () => {
    const conn = 'type linear Conn {\n    Conn(Number)\n}\n';
    const ignore = 'fn ignore(mut x) {0}\n';
    expect(code(`${conn}${ignore}{let mut c = Conn(1)\n ignore(c)}`)).toBe('linear-unconsumed');
    // dropping a value that can be copied is fine
    expect(code(`${ignore}{let mut v = [:1:]\n ignore(v)}`)).toBe('ok');
    // a function that consumes its parameter takes a linear value
    expect(code(`${conn}fn take(mut x) {x}\n{let mut c = Conn(1)\n take(c)}`)).toBe('ok');
});

