import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { net } from '../backend/owned-lens-samples.ts';

it('keeps the restore with the lens in emitted Go', () => {
    const code = compileSource(
        `${net}{let conn = ~connection(1)\n spawn(fn () {handle("a", ~conn)})\n sleep(1)}`,
        { target: goTarget('test') },
    ).code;
    expect(code).toContain('go func()');
    expect(code).toContain('.restore = func(');
});
