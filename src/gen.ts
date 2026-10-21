import { readFileSync } from 'fs';
import { compact, read, readLine, readLines } from './nnodes.ts';

const file = readFileSync(import.meta.dirname + '/syntax.cst', 'utf-8');
const lines = readLines(file);
console.log(compact(lines.nodes[0]));
