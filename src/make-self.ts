/**
 * Yey make a new one
 */

import { readFileSync, writeFileSync } from 'fs';
import { toSyntax } from './grammar-lexer.ts';
import { toFile } from './toFile.ts';
import { showFailure } from './debugFailures.ts';
import { readLines } from './lexer.ts';
import { grammar as self } from './self-lexer-back.ts';

writeFileSync(import.meta.dirname + '/self-back.cst', toSyntax(self));
