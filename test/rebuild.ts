import { execSync } from 'child_process';
import { runFile } from './runl.ts';

const names = [
    runFile(import.meta.dirname + '/basic.errors.fl'),
    runFile(import.meta.dirname + '/lens.fl'),
    runFile(import.meta.dirname + '/flow.fl'),
];

execSync(`pnpm oxfmt ${names.join(' ')}`);
