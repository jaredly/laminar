/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';
import { File } from './grammar-lexer.ts';
import { toFile } from './toFile.ts';
import { findDeepest, showDeepest, showFailure } from './debugFailures.ts';
import { grammar as self } from './self-lexer.ts';
import { readFile } from './lexer.ts';

const [_, __, infile, outfile, types, lib = './grammar.ts'] = process.argv;

if (!infile || !outfile || !types) {
    console.error(`Usage: make.ts grammar infile outfile types`);
    process.exit(1);
}

const text = readFileSync(infile, 'utf-8');
const { node, pos } = readFile(text);

const file = self.parse<File>('File', node);
if (file.type === 'failure') {
    const locToPos = (loc: number) => {
        const { line, char } = pos(loc);
        return `${line + 1}:${char}`;
    };
    let text = `Failed to parse at ${showFailure(file.failure, locToPos)}`;
    const deepest = findDeepest(file.failure);
    if (deepest) {
        text += '\n' + showDeepest(deepest, self, text, locToPos);
    }
    throw new Error(text);
}
const full = toFile(file.value, { lib, types });
writeFileSync(outfile, full);
