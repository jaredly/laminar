import { expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSource } from '../src/compiler.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';

/** Plays an example on the reference evaluator: one scripted key per `waitKey`, "" once spent. */
const play = (file: string, keys: string, seed = 3, lines: string[] = []) => {
    let output = '',
        next = 0,
        line = 0;
    const result = executeTypedProgram(
        checkSource(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8')),
        {
            stdout: (text) => (output += text),
            stdin: () => lines[line++] ?? '',
            key: () => keys[next++] ?? '',
            seed,
        },
    );
    return { result, output };
};

const frames = (output: string) => output.split('\x1b[H\x1b[2J').slice(1);

it('snake: eats the food, then runs into the wall', () => {
    // Seed 3 puts the first food at (7, 1); the snake starts at (5, 5) heading right.
    const { result, output } = play('snake.lm', 'wwwwdd');
    expect(result).toBe(1);
    expect(frames(output)[0]).toContain('score: 0');
    expect(output).toContain('game over, score 1\n');
    // the food shows until it is eaten
    expect(frames(output)[1]).toContain('*');
});

it('snake: q quits with the current score', () => {
    expect(play('snake.lm', 'wq').result).toBe(0);
});

it('snake: a turn onto the neck is ignored', () => {
    // 'a' while heading right would reverse; the snake keeps going right until it crashes.
    const { result, output } = play('snake.lm', 'aaaa');
    expect(result).toBe(0);
    expect(output).toContain('ooO');
});

it('tic-tac-toe: X wins down the left column', () => {
    const { result } = play('tic-tac-toe.lm', '', 3, ['1', '2', '4', '5', '7']);
    expect(JSON.stringify(result)).toContain('"Won"');
});

it('mandelbrot: writes a well-formed bmp', () => {
    // A small image keeps the reference evaluator inside its step limit. Ten pixels of 24-bit
    // colour are 30 bytes, so each row is padded to 32.
    const path = join(mkdtempSync(join(tmpdir(), 'laminar-')), 'out.bmp');
    const source = readFileSync(new URL('../examples/mandelbrot.lm', import.meta.url), 'utf8')
        .replace('fn width() { 150 }', 'fn width() { 10 }')
        .replace('fn height() { 120 }', 'fn height() { 8 }')
        .replace('"mandelbrot.bmp"', JSON.stringify(path));
    executeTypedProgram(checkSource(source), { stdout: () => {} });
    const bmp = readFileSync(path);
    expect(bmp.length).toBe(54 + 32 * 8);
    expect(bmp.subarray(0, 2).toString('latin1')).toBe('BM');
    expect(bmp.readUInt32LE(2)).toBe(bmp.length);
    expect(bmp.readUInt32LE(10)).toBe(54);
    expect(bmp.readUInt32LE(18)).toBe(10);
    expect(bmp.readUInt32LE(22)).toBe(8);
    expect(bmp.readUInt16LE(28)).toBe(24);
    expect(bmp.readUInt32LE(34)).toBe(32 * 8);
    // (0, 0) is in the set, at column 7 of file row 3 (rows run bottom to top): black
    const inside = 54 + 3 * 32 + 7 * 3;
    expect([...bmp.subarray(inside, inside + 3)]).toEqual([0, 0, 0]);
    // the top-left corner escapes at once, so it is coloured, and the row padding stays zero
    const corner = 54 + 7 * 32;
    expect([...bmp.subarray(corner, corner + 3)]).not.toEqual([0, 0, 0]);
    expect([...bmp.subarray(54 + 30, 54 + 32)]).toEqual([0, 0]);
});
