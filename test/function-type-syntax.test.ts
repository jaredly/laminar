import { describe, expect, it } from 'bun:test';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from '../src/laminar-parser.ts';
import type { FileItem, Type } from '../src/ast.ts';

/** A type as compact text, so the expected trees stay readable. */
const show = (t: Type): string => {
    const all = (items: Type[]) => items.map(show).join(', ');
    switch (t.type) {
        case 'id':
            return t.text;
        case 'mut':
            return `mut[${show(t.value)}]`;
        case 'lens':
            return `${t.owned ? 'owned' : 'borrowed'}-lens[${show(t.left)}${t.right ? `, ${show(t.right)}` : ''}${t.replaceable === false ? ', fixed' : ''}]`;
        case 'tuple':
            return `tuple[${all(t.items)}]`;
        case 'constr':
            return `${t.name.text}[${all(t.args ?? [])}]`;
        case 'record':
            return `record[${t.fields.map((f) => `${f.name}: ${show(f.type)}`).join(', ')}]`;
        case 'fn':
            return `${t.kind ? `${t.kind} ` : ''}fn[${all(t.args)}]${t.needs ? `={${t.needs.length}}` : ''}[${show(t.body)}]`;
    }
};

/** The same written type as a signature and as a type alias. */
const parsed = (written: string): string[] =>
    [`x :: ${written}`, `type X = ${written}`].map((source) => {
        const result = grammar.parse<FileItem>('FileItem', readLines(source).nodes[0]!);
        if (result.type === 'failure') return 'no parse';
        const item = result.value;
        return show(item.type === 'decl' ? item.ann : (item as { alias: Type }).alias);
    });

describe('written function types', () => {
    it.each([
        // Parameters and results.
        ['(a) => b', 'fn[a][b]'],
        ['(mut a) => mut b', 'fn[mut[a]][mut[b]]'],
        ['() => mut ()', 'fn[][mut[tuple[]]]'],
        ['(a) => mut (a, b)', 'fn[a][mut[tuple[a, b]]]'],
        ['(a) => (a, b)', 'fn[a][tuple[a, b]]'],
        ['(a) => mut Vector(b)', 'fn[a][mut[Vector[b]]]'],
        ['(a) => mut {x: b}', 'fn[a][mut[record[x: b]]]'],
        ['mut (a) => mut b', 'mut[fn[a][mut[b]]]'],
        ['(a, (b) => mut c) => d', 'fn[a, fn[b][mut[c]]][d]'],
        // Lenses.
        ['(~a) => ~b', 'fn[borrowed-lens[a]][borrowed-lens[b]]'],
        ['(mut ~a) => mut ~b', 'fn[owned-lens[a]][owned-lens[b]]'],
        ['(a) => =b', 'fn[a][borrowed-lens[b, fixed]]'],
        ['(a) => mut =b', 'fn[a][owned-lens[b, fixed]]'],
        ['(a) => a/b', 'fn[a][borrowed-lens[a, b]]'],
        ['(a) => mut a/b', 'fn[a][owned-lens[a, b]]'],
        ['(a) => a/=b', 'fn[a][borrowed-lens[a, b, fixed]]'],
        ['(a) => mut a/=b', 'fn[a][owned-lens[a, b, fixed]]'],
        // Needs.
        ['(a) ={}> mut b', 'fn[a]={0}[mut[b]]'],
        ['(a) ={e}> mut ~b', 'fn[a]={1}[owned-lens[b]]'],
        // Functions of functions, and grouping.
        ['(a) => (b) => c', 'fn[a][fn[b][c]]'],
        ['(a) => mut (b) => mut c', 'fn[a][mut[fn[b][mut[c]]]]'],
        ['((a) => b)', 'fn[a][b]'],
        ['(a)', 'a'],
        ['(a, b)', 'tuple[a, b]'],
        // Record fields.
        ['{f: (a) => mut b, g: mut a}', 'record[f: fn[a][mut[b]], g: mut[a]]'],
        ['{f: (a) => mut ~b}', 'record[f: fn[a][owned-lens[b]]]'],
        ['{f: (a) ={}> mut b}', 'record[f: fn[a]={0}[mut[b]]]'],
        ['{f: (a) => (b) => c}', 'record[f: fn[a][fn[b][c]]]'],
        ['{f: mut (a) => b}', 'record[f: mut[fn[a][b]]]'],
        // Kinds, wherever a function type can be.
        ['once (a) => b', 'once fn[a][b]'],
        ['linear () => mut b', 'linear fn[][mut[b]]'],
        ['linear (a) ={}> b', 'linear fn[a]={0}[b]'],
        ['(linear () => a) => once () => b', 'fn[linear fn[][a]][once fn[][b]]'],
        ['mut once () => a', 'mut[once fn[][a]]'],
        ['(linear () => a, Number)', 'tuple[linear fn[][a], Number]'],
        ['Vector(once () => a)', 'Vector[once fn[][a]]'],
        ['Chan(linear () => Number)', 'Chan[linear fn[][Number]]'],
        ['{f: once () => a, g: linear () => a}', 'record[f: once fn[][a], g: linear fn[][a]]'],
    ])('parses %s', (written, expected) => {
        expect(parsed(written)).toEqual([expected, expected]);
    });

    it.each(['linear Number', 'once linear () => a'])('rejects %s', (written) => {
        expect(() => parsed(written)).toThrow('before a function type');
    });

    it('takes a kind to mean the parameter is `mut`', () => {
        const result = grammar.parse<FileItem>('FileItem', readLines('fn ap(f: once () => a) { f() }').nodes[0]!);
        const item = (result as { value: FileItem }).value;
        expect(item.type === 'fn' && item.args[0]!.mut).toBe(true);
    });

    it.each([
        'fn ap(f: (String) => String) { f("a") }',
        'fn ap(f: ((String) => String)) { f("a") }',
        'fn ap(mut f: (String) => String) { f("a") }',
        'fn ap(f: (String) ={}> String) { f("a") }',
        'fn ap(mut f: (String) ={}> String) { f("a") }',
        'fn ap(f: once (String) => String) { f("a") }',
        'fn ap(mut f: linear (String) => String) { f("a") }',
    ])('annotates a parameter: %s', (source) => {
        const result = grammar.parse<FileItem>('FileItem', readLines(source).nodes[0]!);
        expect(result.type).toBe('success');
        const item = (result as { value: FileItem }).value;
        expect(item.type === 'fn' && item.args[0]!.typ?.type).toBe('fn');
    });
});
