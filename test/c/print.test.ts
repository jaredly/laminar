import { it, expect } from 'bun:test';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { emitC } from '../../src/c/emit.ts';
function compile(source: string) {
    const p = typedProgram(source);
    return emitC(
        compileConcreteProgram(p, wasm32Emscripten('test'), [
            { unit: p.units.at(-1)!.id, arguments: [] },
        ]),
    );
}

it('prints complete tuple C', () => {
    expect(compile('(1, true, ())')).toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct L0 L0;
typedef _Bool L1;
typedef double L2;
typedef struct L3 L3;
typedef L3 (*A0)(void *);
struct L0 { unsigned char inhabitant; };
struct L3 { L2 item0; L1 item1; L0 item2; };
L3 fn0(void *environment);
void print_number(double x);
L3 fn0(void *environment) {
    (void)environment;
    L2 v0 = 1;
    (void)v0;
    L1 v1 = 1;
    (void)v1;
    L0 v2 = (L0){0};
    (void)v2;
    L3 v3 = (L3){v0, v1, v2};
    (void)v3;
    return v3;
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
    L3 result0 = fn0(NULL);
    (void)result0;
    putchar(91);
    print_number((result0).item0);
    putchar(44);
    fputs((result0).item1 ? "true" : "false", stdout);
    putchar(44);
    fputs("null", stdout);
    putchar(93);
    putchar(10);
    return 0;
}
`);
});

it('prints complete thin-update C', () => {
    expect(compile('fn inc(~x) {x := x + 1}\n{let x = 1\n inc(~x)\n x}')).toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct L0 L0;
typedef struct L1 L1;
typedef struct L2 L2;
typedef struct L3 L3;
typedef double L4;
typedef struct L5 L5;
typedef struct L6 L6;
typedef struct L7 L7;
typedef L2 (*A0)(void *, L4);
typedef L4 (*A1)(void *, L4, L4);
typedef L2 (*A2)(void *);
typedef L4 (*A3)(void *);
typedef L2 (*A4)(void *, L6);
struct L0 { L7 *environment; A2 dispose; A4 invoke0; };
struct L1 { unsigned char inhabitant; };
struct L2 { unsigned char inhabitant; };
struct L3 { L2 *read; L4 *replacement; A0 restore; void *context; };
struct L5 { L1 *environment; A2 dispose; A1 invoke0; };
struct L6 { L4 *read; A0 restore; void *context; };
struct L7 { unsigned char inhabitant; };
L2 fn0(void *environment, L6 arg0);
L4 fn1(void *environment);
void print_number(double x);
L2 fn0(void *environment, L6 arg0) {
    (void)environment;
    (void)arg0;
    L4 v2 = *(arg0).read;
    (void)v2;
    L4 v3 = 1;
    (void)v3;
    L4 v4 = (v2 + v3);
    (void)v4;
    L2 v5 = (L2){0};
    (void)v5;
    *(arg0).read = v4;
    return v5;
}
L4 fn1(void *environment) {
    (void)environment;
    L4 v0 = 1;
    (void)v0;
    L2 v4 = fn0(NULL, (L6){.read = &(v0)});
    (void)v4;
    L4 v6 = v0;
    (void)v6;
    L4 v5 = v6;
    (void)v5;
    L4 v1 = v5;
    (void)v1;
    return v1;
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
    L4 result0 = fn1(NULL);
    (void)result0;
    print_number(result0);
    putchar(10);
    return 0;
}
`);
});

it('prints complete scattered-update C', () => {
    expect(compile('fn inc(~(x, y)) {x := x + 1}\n{let a = 1\n let b = 2\n inc(~(a, b))\n (a, b)}'))
        .toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct L0 L0;
typedef struct L1 L1;
typedef struct L2 L2;
typedef struct L3 L3;
typedef struct L4 L4;
typedef double L5;
typedef struct L6 L6;
typedef struct L7 L7;
typedef struct L8 L8;
typedef struct L9 L9;
typedef L4 (*A0)(void *, L5);
typedef L5 (*A1)(void *, L5, L5);
typedef L6 (*A2)(void *);
typedef L4 (*A3)(void *, L6);
typedef L4 (*A4)(void *);
typedef L4 (*A5)(void *, L1);
struct L0 { L5 *read; A0 restore; void *context; };
struct L1 { L0 item0; L0 item1; A3 restore; void *context; };
struct L2 { L8 *environment; A4 dispose; A5 invoke0; };
struct L3 { unsigned char inhabitant; };
struct L4 { unsigned char inhabitant; };
struct L6 { L5 item0; L5 item1; };
struct L7 { L4 *read; L5 *replacement; A0 restore; void *context; };
struct L8 { unsigned char inhabitant; };
struct L9 { L3 *environment; A4 dispose; A1 invoke0; };
L4 fn0(void *environment, L1 arg0);
L6 fn1(void *environment);
void print_number(double x);
L4 fn0(void *environment, L1 arg0) {
    (void)environment;
    (void)arg0;
    L5 v2 = *((arg0).item0).read;
    (void)v2;
    L5 v3 = 1;
    (void)v3;
    L5 v4 = (v2 + v3);
    (void)v4;
    L4 v5 = (L4){0};
    (void)v5;
    *((arg0).item0).read = v4;
    return v5;
}
L6 fn1(void *environment) {
    (void)environment;
    L5 v0 = 1;
    (void)v0;
    L5 v2 = 2;
    (void)v2;
    L4 v8 = fn0(NULL, (L1){ .item0 = (L0){.read = &(v0)},  .item1 = (L0){.read = &(v2)}});
    (void)v8;
    L5 v10 = v0;
    (void)v10;
    L5 v11 = v2;
    (void)v11;
    L6 v12 = (L6){v10, v11};
    (void)v12;
    L6 v9 = v12;
    (void)v9;
    L6 v3 = v9;
    (void)v3;
    L6 v1 = v3;
    (void)v1;
    return v1;
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
    L6 result0 = fn1(NULL);
    (void)result0;
    putchar(91);
    print_number((result0).item0);
    putchar(44);
    print_number((result0).item1);
    putchar(93);
    putchar(10);
    return 0;
}
`);
});
