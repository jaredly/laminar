/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';
import { toFile } from './grammar.ts';
import { readLines } from './nnodes.ts';
import { grammar as self } from './self-made.ts';

const [_, __, infile, outfile, types, lib = './grammar.ts'] = process.argv;

if (!infile || !outfile || !types) {
    console.error(`Usage: make.ts infile outfile types`);
    process.exit(1);
}

const text = readFileSync(infile, 'utf-8');
const parsed = readLines(text);

const file = self.parse('File', { type: 'list', kind: '\n', children: parsed.nodes, loc: 0 });
if (file.type === 'failure') {
    throw new Error(`Failed to parse at ${file.loc}: ${file.reason}`);
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
