import { it, expect } from 'bun:test';
import { compact, read, readLine } from './nnodes.ts';

const r = (text: string) => compact(read(text));
const rl = (text: string) => compact(readLine(text));

it('should basic id', () => {
    expect(r('hello')).toEqual('hello');
});

it('should string', () => {
    expect(r('"hello"')).toEqual(['"', 'hello']);
});

it('should string interpolate', () => {
    expect(r('"hello ${name}"')).toEqual(['"', 'hello ', 'name', '']);
});

it('should string interpolate spaced', () => {
    expect(r('"hello ${name + 2}"')).toEqual(['"', 'hello ', [' ', 'name', '+', '2'], '']);
});

it('should string interpolate smooshed', () => {
    expect(r('"hello ${name(2)}"')).toEqual(['"', 'hello ', ['', 'name', ['(', '2']], '']);
});

it('should string interpolate smooshed', () => {
    expect(r('"hello ${name.2}"')).toEqual(['"', 'hello ', ['', 'name', '.', '2'], '']);
});

it('should string interpolate a few and nested', () => {
    expect(r('"hello ${name("more")} and ${23}"')).toEqual([
        '"',
        'hello ',
        ['', 'name', ['(', ['"', 'more']]],
        ' and ',
        '23',
        '',
    ]);
});

it('should list', () => {
    expect(r('(1,2)')).toEqual(['(', '1', '2']);
});

it('should list with white', () => {
    expect(r('(1, 2)')).toEqual(['(', '1', '2']);
});

it('should spaced', () => {
    expect(r('(1 + 2, 3)')).toEqual(['(', [' ', '1', '+', '2'], '3']);
});

it('should newlines and mixed', () => {
    expect(r('{1\n2;3,4}')).toEqual(['{', '1', '2', '3', '4']);
});

it('should tight', () => {
    expect(r('(1+2)')).toEqual(['(', ['', '1', '+', '2']]);
});

it('should space then right', () => {
    expect(r('(1 1+2)')).toEqual(['(', [' ', '1', ['', '1', '+', '2']]]);
});

it('should tight then space', () => {
    expect(rl('1+2 3')).toEqual([' ', ['', '1', '+', '2'], '3']);
});

it('fn', () => {
    expect(r(`(fn inc(~x) {\n   x := x + 1\n})`)).toEqual([
        '(',
        [' ', 'fn', ['', 'inc', ['(', ['', '~', 'x']]], ['{', [' ', 'x', ':=', 'x', '+', '1']]],
    ]);
});

it('should colon', () => {
    expect(rl('x: 2')).toEqual([': ', 'x', '2']);
});

it('should colon space', () => {
    expect(rl('(x: a => b, y)')).toEqual([
        '(',
        [' ', [': ', 'x', 'a'], '=>', 'b'],
        // [": ", "x", [" ", "a", "=>", "b"]],
        'y',
    ]);
});

it('should colon nongreedy', () => {
    expect(rl('fn (x): y {z}')).toEqual([' ', 'fn', [': ', ['(', 'x'], 'y'], ['{', 'z']]);
});

it('should one line multiline comment', () => {
    expect(r('(1,/* ok folks */ 2 )')).toEqual(['(', '1', '2']);
});

it('should multiline comment', () => {
    expect(r('(1,/* ok\nfolks */ 2 )')).toEqual(['(', '1', '2']);
});

it('should space after list', () => {
    expect(r('(1, 2 )')).toEqual(['(', '1', '2']);
});

it('should full fn', () => {
    expect(
        rl(`fn fst(~(x, y): (a, b)/(a', b)): a/a' {
    ~x
}`),
    ).toEqual([
        ' ',
        'fn',
        [
            ': ',
            [
                '',
                'fst',
                [
                    '(',
                    [
                        ': ',
                        ['', '~', ['(', 'x', 'y']],
                        ['', ['(', 'a', 'b'], '/', ['(', "a'", 'b']],
                    ],
                ],
            ],
            ['', 'a', '/', "a'"],
        ],
        ['{', ['', '~', 'x']],
    ]);
});

it('should ignore comments', () => {
    expect(r(`[1,2// yes\n3]`)).toEqual(['[', '1', '2', '3']);
});
