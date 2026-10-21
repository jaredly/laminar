/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';
import { showFailure, toFile } from './grammar-lexer.ts';
import { readLines } from './lexer.ts';
import { grammar as self } from './self-lexer-back.ts';

const [_, __, infile, outfile, types, lib = './grammar-lexer.ts'] = process.argv;

if (!infile || !outfile || !types) {
    console.error(`Usage: make.ts infile outfile types`);
    process.exit(1);
}

const text = readFileSync(infile, 'utf-8');
const parsed = readLines(text);

const file = self.parse('File', { type: 'list', kind: '\n', children: parsed.nodes, loc: 0 });
if (file.type === 'failure') {
    throw new Error(
        `Failed to parse. ${showFailure(file.failure, (loc) => {
            const { line, char } = parsed.pos(loc);
            return `${line + 1}:${char}`;
        })}`,
    );
}
const full = toFile(
    file.value,
    // parsed.nodes.map((node) => {
    //     const result = self.parse('RawRule', node);
    //     if (result.type === 'failure') {
    //         throw new Error(`failed to parse rule at ${result.loc}: ` + result.reason);
    //     }
    //     return result.value;
    // }),
    { lib, types },
);
writeFileSync(outfile, full);
