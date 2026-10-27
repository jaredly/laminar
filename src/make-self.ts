/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';
import { toFile, toSyntax } from './grammar-lexer.ts';
import { showFailure } from './debugFailures.ts';
import { readLines } from './lexer.ts';
import { grammar as self } from './self-lexer-back.ts';

writeFileSync(import.meta.dirname + '/self-back.cst', toSyntax(self));
