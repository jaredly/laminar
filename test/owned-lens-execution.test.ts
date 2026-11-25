import { expect, it } from 'bun:test';
import { CompileError, checkSource, compileLibrary, compileSource } from '../src/compiler.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { backendAvailable, expectRun, selectedBackends } from './backend/backends.ts';
import { net, ownedLensSamples } from './backend/owned-lens-samples.ts';

for (const sample of ownedLensSamples)
    it(`emits C for wasm: ${sample.name}`, () => {
        expect(() =>
            compileSource(sample.source, { target: wasm32Emscripten('test') }),
        ).not.toThrow();
    });

// The reference runs the typed IR directly, so it does not share the backends' lowering.
for (const backend of selectedBackends())
    for (const sample of ownedLensSamples)
        (backendAvailable(backend) ? it : it.skip)(
            `${backend} ends each lens in order: ${sample.name}`,
            async () => {
                await expectRun(backend, sample.source, { expected: null, output: sample.output });
            },
        );

it('does not hand a host a closure it could drop instead of calling', () => {
    const library = (body: string) => () =>
        compileLibrary(`${net}fn make(mut n) {${body}}`, {
            target: wasm32Emscripten('test'),
            exports: [{ name: 'make' }],
        });
    expect(library('let c = ~connection(n)\n fn () {handle("a", ~c)}')).toThrow(
        'which a host could drop',
    );
    expect(library('(fn () {n}, 1)')).not.toThrow('which a host could drop');
});

it('still cannot spawn in C', () => {
    const source = `${net}{let c = ~connection(1)\n spawn(fn () {handle("a", ~c)})}`;
    try {
        compileSource(source, { target: wasm32Emscripten('test') });
        throw new Error('expected a rejection');
    } catch (error) {
        expect((error as CompileError).message).toBe('spawn has no C implementation');
    }
});
