import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { emitC } from '../../src/c/emit.ts';
import { buildAndRun } from '../../src/c/build.ts';
import { verifyConcreteProgram } from '../../src/verify-concrete.ts';

const samples = [
    ['called', '{let u = ()\n let f = fn (x) {let v = u\n x + 1}\n f(2)}', 3],
    ['dropped', '{let u = ()\n let f = fn (x) {let v = u\n x + 1}\n 4}', 4],
    ['escaping', 'fn make(u) {fn (x) {let v = u\n x + 1}}\nmake(())(2)', 3],
    ['owned capture', '{let u = "owned"\n let f = fn (x) {let v = u\n x + 1}\n f(2)}', 3],
] as const;

for (const [name, source, expected] of samples) {
    it(`unit environment optimization: ${name}`, async () => {
        const { concrete } = compileSource(source, { target: wasm32Emscripten('test') });
        const before = JSON.stringify(concrete);
        const baseline = emitC(concrete);
        const optimized = emitC(concrete, { optimize: true });
        verifyConcreteProgram(concrete);
        expect(JSON.stringify(concrete)).toBe(before);
        if (name === 'owned capture') expect(optimized).toBe(baseline);
        else {
            expect(optimized.length).toBeLessThan(baseline.length);
            expect((optimized.match(/= allocate_context\(/g) ?? []).length).toBe(
                (baseline.match(/= allocate_context\(/g) ?? []).length - 1,
            );
        }
        if (!process.env.LAMINAR_EXEC) return;
        for (const code of [baseline, optimized]) {
            expect(await buildAndRun(code, { compiler: 'clang', sanitize: true })).toEqual([expected]);
            expect(await buildAndRun(code, { compiler: 'clang', optimize: true })).toEqual([expected]);
            expect(await buildAndRun(code, { compiler: 'emcc', wasm: true, optimize: true })).toEqual([expected]);
        }
    }, 60000);
}
