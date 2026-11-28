import createPrompt from 'prompt-sync';
import { readSync, writeFileSync } from 'node:fs';
import type { ReferenceOptions } from './eval-typed.ts';

/** One byte of stdin as a string, "" at end of input. Blocks: the timeout is ignored. */
const readKey = (): string => {
    const byte = Buffer.alloc(1);
    try {
        return readSync(0, byte, 0, 1, null) === 1 ? String.fromCharCode(byte[0]!) : '';
    } catch {
        return '';
    }
};

/**
 * The reference evaluator's host services on a Node or Bun process: its stdout, an interactive
 * prompt, the filesystem, and a `random` seed from LAMINAR_SEED when set.
 */
export function nodeHost(): ReferenceOptions {
    const seed = process.env.LAMINAR_SEED;
    return {
        stdout: (text) => process.stdout.write(text),
        stdin: () => createPrompt()('') ?? '',
        key: readKey,
        writeFileSync,
        seed: seed === undefined ? undefined : Number(seed),
    };
}
