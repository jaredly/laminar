import { expect, it } from 'bun:test';
import { capturedCleanupSamples } from './backend/captured-cleanup-samples.ts';
import { typedProgram } from './backend/typed-program.ts';
import { legacyReference } from './backend/legacy-reference.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { verifyTypedProgram } from '../src/verify-ir.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { verifyConcreteProgram } from '../src/verify-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { emitC } from '../src/c/emit.ts';
import { specializeProgram } from '../src/specialize.ts';

for (const sample of capturedCleanupSamples)
    it(`retains captured cleanup: ${sample.name}`, () => {
        const p = JSON.parse(JSON.stringify(typedProgram(sample.source)));
        verifyTypedProgram(p);
        expect<unknown>(executeTypedProgram(p)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        const roots = [{ unit: p.units.at(-1)!.id, arguments: [] }];
        const specialized = JSON.parse(
            JSON.stringify(specializeProgram(p, wasm32Emscripten('test'), roots).program),
        );
        verifyTypedProgram(specialized);
        expect<unknown>(executeTypedProgram(specialized)).toEqual(sample.expected);
        const c = JSON.parse(
            JSON.stringify(compileConcreteProgram(p, wasm32Emscripten('test'), roots)),
        );
        verifyConcreteProgram(c);
        expect(() => emitC(c)).not.toThrow();
    });

it('rejects corrupted captured invocation and disposal contracts before C lowering', () => {
    const p = typedProgram(capturedCleanupSamples[0]!.source);
    const original = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    for (const mutation of ['capture', 'environment', 'ownership', 'disposal'] as const) {
        const c = structuredClone(original);
        const code = c.code.find((code) => code.captures.length)!;
        const callable = c.callables.find((callable) => callable.environment === code.environment)!;
        if (mutation === 'capture') code.captures[0]!.layout = 'forged';
        if (mutation === 'environment') code.environment = 'forged';
        if (mutation === 'ownership') {
            const w = c.wrappers.find((w) => w.kind === 'invoke' && w.code === code.id)!;
            (w as any).ownership = 'no-environment';
        }
        if (mutation === 'disposal') {
            const w = c.wrappers.find((w) => w.id === callable.dispose)!;
            if (w.kind !== 'dispose') throw Error('Expected disposer');
            w.captures = [];
        }
        expect(() => emitC(c)).toThrow(
            {
                capture: 'Concrete function ABI/storage contract mismatch',
                environment: 'Invoke wrapper/code ABI mismatch',
                ownership: 'Invoke wrapper/code ABI mismatch',
                disposal: 'Disposer capture layout mismatch',
            }[mutation],
        );
    }
});

it('prints the complete captured callable environment lifecycle', () => {
    const p = typedProgram('{let resource = 2\n let cleanup = fn () resource\n cleanup()}');
    const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(emitC(c)).toMatchInlineSnapshot(`
      "#include <stdio.h>
      #include <stdlib.h>
      #include <math.h>
      #include <stdint.h>
      typedef struct L0 L0;
      typedef double L1;
      typedef struct L2 L2;
      typedef struct L3 L3;
      typedef L3 (*A0)(void *);
      typedef L1 (*A1)(void *);
      struct L0 { L2 *environment; A0 dispose; A1 invoke0; };
      struct L2 { L1 capture0; };
      struct L3 { unsigned char inhabitant; };
      static size_t live_contexts = 0;
      void *allocate_context(size_t size);
      void release_context(void *context);
      L1 fn0(void *environment);
      L1 fn1(void *environment);
      L3 dispose0(void *environment);
      void print_number(double x);
      L1 fn0(void *environment) {
          (void)environment;
          L1 v0 = ((L2 *)environment)->capture0;
          (void)v0;
          release_context(environment);
          L1 v1 = v0;
          (void)v1;
          return v1;
      }
      L1 fn1(void *environment) {
          (void)environment;
          L1 v0 = 2;
          (void)v0;
          L1 v2 = v0;
          (void)v2;
          L2 *v4 = allocate_context(sizeof *v4);
          v4->capture0 = v2;
          L0 v3 = (L0){.environment=v4, .dispose=dispose0, .invoke0=fn0};
          (void)v3;
          L0 v6 = v3;
          (void)v6;
          L1 v7 = fn0((v6).environment);
          (void)v7;
          L1 v5 = v7;
          (void)v5;
          L1 v1 = v5;
          (void)v1;
          return v1;
      }
      L3 dispose0(void *environment) {
          L2 *captured = environment;
          release_context(captured);
          return (L3){0};
      }
      void *allocate_context(size_t size) {
          void *context = malloc(size);
          if (!context) {
              abort();
          }
          ++live_contexts;
          return context;
      }
      void release_context(void *context) {
          if (!context || live_contexts == 0) {
              abort();
          }
          --live_contexts;
          free(context);
      }
      void print_number(double x) {
          if (isnan(x)) {
              fputs("{\\"number\\":\\"NaN\\"}", stdout);
          }
          else if (isinf(x)) {
              fputs(x < 0 ? "{\\"number\\":\\"-Infinity\\"}" : "{\\"number\\":\\"Infinity\\"}", stdout);
          }
          else if (x == 0 && signbit(x)) {
              fputs("{\\"number\\":\\"-0\\"}", stdout);
          }
          else {
              printf("%.17g", x);
          }
      }
      int main(void) {
          L1 result0 = fn1(NULL);
          (void)result0;
          print_number(result0);
          putchar(10);
          if (live_contexts != 0) {
              abort();
          }
          return 0;
      }
      "
    `);
});
