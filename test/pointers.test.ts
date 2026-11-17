import { readFileSync } from 'fs';
import { join } from 'path';
import { runSnapshot } from './fixtures.ts';

import { it, expect } from 'bun:test';

const filesToTest = ['src/systematic.test.lm', 'test/flow.test.lm'];

filesToTest.forEach((path) => {
    const full = join(import.meta.dir, '..', path);
    const raw = readFileSync(full, 'utf-8');
    const { testResults } = runSnapshot(raw, path);
    testResults.forEach((result) => {
        it(result.title, () => {
            if (result.failure) {
                if (result.failure instanceof Error) {
                    console.error(result.failure);
                    throw result.failure;
                } else if (Array.isArray(result.failure)) {
                    expect(result.failure[0]).toEqual(result.failure[1]);
                } else {
                    console.error(result.failure);
                    throw result.failure;
                }
            }
        });
    });
});
