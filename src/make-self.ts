/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';
import { showFailure, toFile, toSyntax } from './grammar-lexer.ts';
import { readLines } from './lexer.ts';
import { grammar as self } from './self-lexer.ts';

writeFileSync(import.meta.dirname + '/self-back.cst', toSyntax(self));
