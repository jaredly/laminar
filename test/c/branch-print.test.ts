import { it, expect } from 'bun:test';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { emitC } from '../../src/c/emit.ts';
import { printConcreteProgram } from '../../src/print-concrete.ts';
function program() {
    const p = typedProgram(
        '{let x = 1\n let spare = 2\n {let f = ~{match false {true -> {spare\n x}; false -> x}}\n f := true}\n spare := 3\n (x, spare)}',
    );
    return compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
}

it('prints complete selected-branch C', () => {
    expect(emitC(program())).toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef _Bool L0;
typedef double L1;
typedef struct L2 L2;
typedef struct L3 L3;
typedef struct L4 L4;
typedef struct L5 L5;
typedef L3 (*A0)(void *, L1);
typedef L2 (*A1)(void *);
typedef L3 (*A2)(void *, L0);
struct L2 { L0 item0; L1 item1; };
struct L3 { unsigned char inhabitant; };
struct L4 { L3 *read; L1 *replacement; A0 restore; void *context; };
struct L5 { L1 *read; L0 *replacement; A2 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L2 fn0(void *environment);
void print_number(double x);
L2 fn0(void *environment) {
    (void)environment;
    L1 v0 = 1;
    (void)v0;
    L1 v2 = 2;
    (void)v2;
    L0 v4 = 0;
    (void)v4;
    int v6 = 0;
    (void)v6;
    L1 v7 = (L1){0};
    (void)v7;
    L1 v8 = {0};
    (void)v8;
    if (v4 == 1) {
        v8 = v2;
        (void)v8;
        v6 = 0;
        v7 = v0;
    }
    else if (v4 == 0) {
        v6 = 1;
        v7 = v0;
    }
    else {
        abort();
    }
    L0 v14 = 1;
    (void)v14;
    L1 v15 = v7;
    (void)v15;
    if (v6 == 0) {
    }
    else if (v6 == 1) {
    }
    else {
        abort();
    }
    L1 v12 = v15;
    (void)v12;
    L1 v18 = 3;
    (void)v18;
    L3 v19 = (L3){0};
    (void)v19;
    L0 v21 = v14;
    (void)v21;
    L1 v22 = v18;
    (void)v22;
    L2 v23 = (L2){v21, v22};
    (void)v23;
    L2 v20 = v23;
    (void)v20;
    L2 v16 = v20;
    (void)v16;
    L2 v3 = v16;
    (void)v3;
    L2 v1 = v3;
    (void)v1;
    return v1;
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
    L2 result0 = fn0(NULL);
    (void)result0;
    putchar(91);
    fputs((result0).item0 ? "true" : "false", stdout);
    putchar(44);
    print_number((result0).item1);
    putchar(93);
    putchar(10);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
`);
});

it('prints complete selected-branch concrete IR', () => {
    expect(printConcreteProgram(program())).toBe(`concrete-ir 1
target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
toolchain emscripten "test" features ()
entries (entry0)
forward {
    layouts (L2, L3, L0, L4, L1, L5)
    abis (abi0, abi1, abi2)
    code (entry0)
}
layouts {
    L0 = bool
    L1 = f64
    L2 = record {
        item0: L0
        item1: L1
    }
    L3 = unit
    L4 = record thin {
        read: ptr<L3>
        replacement: ptr<L1>
        restore: code<abi0>
        context: ptr<void>
    }
    L5 = record thin {
        read: ptr<L1>
        replacement: ptr<L0>
        restore: code<abi2>
        context: ptr<void>
    }
}
abis {
    abi0 = (env: ptr<void>, L1) -> L3
    abi1 = (env: ptr<void>) -> L2
    abi2 = (env: ptr<void>, L0) -> L3
}
wrappers {}
callables {}
fn entry0() : abi1 env L3 {
    %0: L1 = 1
    %1: L2 = scope {
        bind $x = %0
        %2: L1 = 2
        %3: L2 = scope {
            bind $spare = %2
            %4: L0 = false
            %5: L5 = match %4 selected-focus(thin, thin) -> thin {
                true -> {
                    %6: L1 = move $spare
                    %7: L5 = scope {
                        bind _ = %6
                        %8: L5 = acquire $x
                        return %8 : L5
                    }
                    return %7 : L5
                }
                false -> setup {drop $spare} {
                    %9: L5 = acquire $x
                    return %9 : L5
                }
            }
            %10: L1 = scope {
                borrow loan0 = %5
                %11: L5 = acquire $p0@loan0
                %12: L0 = true
                %13: L1 = swap(%11, %12)
                return %13 : L1
                cleanup {release loan0}
            }
            %14: L2 = scope {
                bind _ = %10
                %15: L4 = acquire $spare
                %16: L1 = 3
                %17: L3 = swap(%15, %16)
                %18: L2 = scope {
                    bind _ = %17
                    %19: L0 = move $x
                    %20: L1 = move $spare
                    %21: L2 = (%19, %20)
                    return %21 : L2
                }
                return %18 : L2
            }
            return %14 : L2
            cleanup {drop $spare}
        }
        return %3 : L2
        cleanup {drop $x}
    }
    return %1 : L2
}`);
});

it('prints complete manual staging around a selected branch', () => {
    const p = typedProgram(
        '{let x = 1\n {let f = ~{@({match true {true -> x; false -> x}}, fn () {x := x + 1})}\n f := 4}\n x}',
    );
    const concrete = compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
    expect(emitC(concrete)).toMatchInlineSnapshot(`
      "#include <stdio.h>
      #include <stdlib.h>
      #include <math.h>
      #include <stdint.h>
      typedef struct L0 L0;
      typedef _Bool L1;
      typedef struct L2 L2;
      typedef struct L3 L3;
      typedef double L4;
      typedef struct L5 L5;
      typedef struct L6 L6;
      typedef L0 (*A0)(void *, L4);
      typedef L4 (*A1)(void *, L4, L4);
      typedef L0 (*A2)(void *);
      typedef L4 (*A3)(void *);
      struct L0 { unsigned char inhabitant; };
      struct L2 { unsigned char inhabitant; };
      struct L3 { L0 *read; L4 *replacement; A0 restore; void *context; };
      struct L5 { void *environment; A2 dispose; A1 invoke0; };
      struct L6 { L4 *read; A0 restore; void *context; };
      static size_t live_contexts = 0;
      void *allocate_context(size_t size);
      void release_context(void *context);
      L4 fn0(void *environment);
      void print_number(double x);
      L4 fn0(void *environment) {
          (void)environment;
          L4 v0 = 1;
          (void)v0;
          L1 v2 = 1;
          (void)v2;
          int v4 = 0;
          (void)v4;
          L4 v5 = (L4){0};
          (void)v5;
          if (v2 == 1) {
              v4 = 0;
              v5 = v0;
          }
          else if (v2 == 0) {
              v4 = 1;
              v5 = v0;
          }
          else {
              abort();
          }
          L4 v11 = 4;
          (void)v11;
          L4 v12 = v5;
          (void)v12;
          if (v4 == 0) {
          }
          else if (v4 == 1) {
          }
          else {
              abort();
          }
          L4 v15 = v11;
          (void)v15;
          L4 v16 = 1;
          (void)v16;
          L4 v17 = (v15 + v16);
          (void)v17;
          L0 v18 = (L0){0};
          (void)v18;
          if (v4 == 0) {
          }
          else if (v4 == 1) {
          }
          else {
              abort();
          }
          L4 v9 = v12;
          (void)v9;
          L4 v20 = v17;
          (void)v20;
          L4 v19 = v20;
          (void)v19;
          L4 v1 = v19;
          (void)v1;
          return v1;
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
          L4 result0 = fn0(NULL);
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
