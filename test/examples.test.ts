import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
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
