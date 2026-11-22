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
#include <stdbool.h>
typedef struct Tuple_Bool_Number Tuple_Bool_Number;
typedef struct Unit Unit;
struct Tuple_Bool_Number { bool item0; double item1; };
struct Unit { unsigned char inhabitant; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Tuple_Bool_Number entry(void *environment);
void print_number(double x);
Tuple_Bool_Number entry(void *environment) {
    (void)environment;
    double v0 = 1;
    bool v4 = 0;
    int v6 = 0;
    double v7 = {0};
    if (v4 == 1) {
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
    double v14 = v7;
    (void)v14;
    if (v6 == 0) {
    }
    else if (v6 == 1) {
    }
    else {
        abort();
    }
    Unit v18 = {0};
    (void)v18;
    return (Tuple_Bool_Number){1, 3};
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
    Tuple_Bool_Number result0 = entry(NULL);
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
