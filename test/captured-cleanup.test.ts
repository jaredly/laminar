import { indirectCallSamples } from './backend/indirect-call-samples.ts';
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
      #include <stdbool.h>
      typedef struct Unit Unit;
      typedef struct Environment_Empty_6db1d02aec Environment_Empty_6db1d02aec;
      typedef struct Environment_double_8f01c970ea Environment_double_8f01c970ea;
      typedef struct Callable_Value_d6f73c1cde Callable_Value_d6f73c1cde;
      typedef Unit (*Func_to_Unit_b3b0e12625)(void *);
      typedef double (*Func_to_double_f62d6b85c2)(void *);
      struct Unit { unsigned char inhabitant; };
      struct Environment_Empty_6db1d02aec { unsigned char inhabitant; };
      struct Environment_double_8f01c970ea { double capture0; };
      struct Callable_Value_d6f73c1cde { void *environment; Func_to_Unit_b3b0e12625 dispose; };
      static size_t live_contexts = 0;
      void *allocate_context(size_t size);
      void release_context(void *context);
      double cleanup(void *environment);
      double entry(void *environment);
      Unit dispose0(void *environment);
      void print_number(double x);
      double cleanup(void *environment) {
          double v0 = ((Environment_double_8f01c970ea *)environment)->capture0;
          release_context(environment);
          return v0;
      }
      double entry(void *environment) {
          (void)environment;
          Environment_double_8f01c970ea * v4 = allocate_context(sizeof *v4);
          v4->capture0 = 2;
          Callable_Value_d6f73c1cde v3 = (Callable_Value_d6f73c1cde){.environment=v4, .dispose=dispose0};
          return cleanup((v3).environment);
      }
      Unit dispose0(void *environment) {
          Environment_double_8f01c970ea *captured = environment;
          release_context(captured);
          return (Unit){0};
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
          double result0 = entry(NULL);
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

for (const sample of indirectCallSamples)
    it(`emits typed indirect calls: ${sample.name}`, () => {
        const p = typedProgram(sample.source);
        expect<unknown>(executeTypedProgram(p)).toEqual(sample.expected);
        expect(legacyReference(sample.source)).toEqual(sample.expected);
        const c = compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]);
        const source = emitC(c);
        // Calls through first-class values use their type record's typed entry;
        // direct calls of known code may name the code symbol.
        expect(source).toMatch(/\.invoke\d+\(\((?:v|arg)\d+\)\.environment/);
    });
