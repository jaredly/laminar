/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';

const [_, __, grammar, infile, outfile, types, lib = './grammar.ts'] = process.argv;

if (!grammar || !infile || !outfile || !types) {
    console.error(`Usage: make.ts grammar infile outfile types`);
    process.exit(1);
}

const self = require(grammar).grammar;
const text = readFileSync(infile, 'utf-8');

const file = self.parse('File', self.readFile(text));
if (file.type === 'failure') {
    throw new Error(`Failed to parse at ${file.loc}: ${file.reason}`);
}
const full = self.toFile(
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
