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
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
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
    if (live_contexts != 0) {
        abort();
    }
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
typedef L1 (*A0)(void *, L4);
typedef L4 (*A1)(void *, L4, L4);
typedef L1 (*A2)(void *);
typedef L4 (*A3)(void *);
typedef L1 (*A4)(void *, L6);
struct L0 { void *environment; A2 dispose; A4 invoke0; };
struct L1 { unsigned char inhabitant; };
struct L2 { unsigned char inhabitant; };
struct L3 { L1 *read; L4 *replacement; A0 restore; void *context; };
struct L5 { void *environment; A2 dispose; A1 invoke0; };
struct L6 { L4 *read; A0 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L1 fn0(void *environment, L6 arg0);
L4 fn1(void *environment);
typedef struct { L4 read0; } Backing0;
void print_number(double x);
L1 fn0(void *environment, L6 arg0) {
    (void)environment;
    (void)arg0;
    L4 v2 = *(arg0).read;
    (void)v2;
    L4 v3 = 1;
    (void)v3;
    L4 v4 = (v2 + v3);
    (void)v4;
    L1 v5 = (L1){0};
    (void)v5;
    *(arg0).read = v4;
    return v5;
}
L4 fn1(void *environment) {
    (void)environment;
    L4 v0 = 1;
    (void)v0;
    L0 v3 = (L0){.environment=NULL, .invoke0=fn0};
    (void)v3;
    Backing0 back0 = {0};
    (void)back0;
    back0.read0 = v0;
    L6 v5 = (L6){.read=&back0.read0};
    (void)v5;
    L1 v4 = (v3).invoke0((v3).environment, v5);
    (void)v4;
    L4 v6 = *(v5).read;
    (void)v6;
    (void)back0;
    L4 v8 = v6;
    (void)v8;
    L4 v7 = v8;
    (void)v7;
    L4 v1 = v7;
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
    L4 result0 = fn1(NULL);
    (void)result0;
    print_number(result0);
    putchar(10);
    if (live_contexts != 0) {
        abort();
    }
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
typedef double L3;
typedef struct L4 L4;
typedef struct L5 L5;
typedef struct L6 L6;
typedef struct L7 L7;
typedef struct L8 L8;
typedef L2 (*A0)(void *, L3);
typedef L3 (*A1)(void *, L3, L3);
typedef L4 (*A2)(void *);
typedef L2 (*A3)(void *, L4);
typedef L2 (*A4)(void *);
typedef L2 (*A5)(void *, L1);
struct L0 { L3 *read; A0 restore; void *context; };
struct L1 { L0 item0; L0 item1; A3 restore; void *context; };
struct L2 { unsigned char inhabitant; };
struct L4 { L3 item0; L3 item1; };
struct L5 { unsigned char inhabitant; };
struct L6 { L2 *read; L3 *replacement; A0 restore; void *context; };
struct L7 { void *environment; A4 dispose; A1 invoke0; };
struct L8 { void *environment; A4 dispose; A5 invoke0; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L2 fn0(void *environment, L1 arg0);
L4 fn1(void *environment);
typedef struct { L3 read0; L3 read1; } Backing0;
void print_number(double x);
L2 fn0(void *environment, L1 arg0) {
    (void)environment;
    (void)arg0;
    L3 v2 = *((arg0).item0).read;
    (void)v2;
    L3 v3 = 1;
    (void)v3;
    L3 v4 = (v2 + v3);
    (void)v4;
    L2 v5 = (L2){0};
    (void)v5;
    *((arg0).item0).read = v4;
    *((arg0).item1).read = *((arg0).item1).read;
    return v5;
}
L4 fn1(void *environment) {
    (void)environment;
    L3 v0 = 1;
    (void)v0;
    L3 v2 = 2;
    (void)v2;
    L8 v7 = (L8){.environment=NULL, .invoke0=fn0};
    (void)v7;
    Backing0 back0 = {0};
    (void)back0;
    back0.read0 = v0;
    back0.read1 = v2;
    L1 v9 = (L1){.item0=(L0){.read=&back0.read0}, .item1=(L0){.read=&back0.read1}};
    (void)v9;
    L2 v8 = (v7).invoke0((v7).environment, v9);
    (void)v8;
    L4 v10 = (L4){*((v9).item0).read, *((v9).item1).read};
    (void)v10;
    (void)back0;
    L3 v12 = (v10).item0;
    (void)v12;
    L3 v13 = (v10).item1;
    (void)v13;
    L4 v14 = (L4){v12, v13};
    (void)v14;
    L4 v11 = v14;
    (void)v11;
    L4 v3 = v11;
    (void)v3;
    L4 v1 = v3;
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
    L4 result0 = fn1(NULL);
    (void)result0;
    putchar(91);
    print_number((result0).item0);
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

it('prints complete returned-scattered C', () => {
    expect(
        compile(
            'fn both(~(x, y)) ~(x, y)\n{let x = 1\n let y = 2\n both(~(x, y)) := (true, (3, 4))\n (x, y)}',
        ),
    ).toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct L0 L0;
typedef struct L1 L1;
typedef struct L2 L2;
typedef struct L3 L3;
typedef double L4;
typedef struct L5 L5;
typedef _Bool L6;
typedef struct L7 L7;
typedef struct L8 L8;
typedef struct L9 L9;
typedef L3 (*A0)(void *, L8);
typedef L3 (*A1)(void *, L5);
typedef L8 (*A2)(void *);
typedef L3 (*A3)(void *);
typedef L2 (*A4)(void *, L2);
typedef L3 (*A5)(void *, L6);
struct L0 { L4 *read; L6 *replacement; A5 restore; void *context; };
struct L1 { L4 *read; L5 *replacement; A1 restore; void *context; };
struct L2 { L0 item0; L1 item1; A0 restore; void *context; };
struct L3 { unsigned char inhabitant; };
struct L5 { L4 item0; L4 item1; };
struct L7 { unsigned char inhabitant; };
struct L8 { L6 item0; L5 item1; };
struct L9 { void *environment; A3 dispose; A4 invoke0; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L2 fn0(void *environment, L2 arg0);
L8 fn1(void *environment);
typedef struct { L2 arg0; L4 focus_0; L6 focus_0out; L4 focus_1; L5 focus_1out; } Restore0;
L3 restore0(void *opaque, L8 replacement);
typedef struct { L4 read0; L6 write0; L4 read2; L5 write2; } Backing1;
void print_number(double x);
L2 fn0(void *environment, L2 arg0) {
    (void)environment;
    (void)arg0;
    Restore0 *ctx = allocate_context(sizeof *ctx);
    if (!ctx) {
        abort();
    }
    ctx->arg0 = arg0;
    ctx->focus_0 = *((arg0).item0).read;
    ctx->focus_1 = *((arg0).item1).read;
    L2 v3 = (L2){.item0=(L0){.read=&ctx->focus_0, .replacement=&ctx->focus_0out}, .item1=(L1){.read=&ctx->focus_1, .replacement=&ctx->focus_1out}};
    v3.restore = restore0;
    v3.context = ctx;
    return v3;
}
L8 fn1(void *environment) {
    (void)environment;
    L4 v0 = 1;
    (void)v0;
    L4 v2 = 2;
    (void)v2;
    L9 v7 = (L9){.environment=NULL, .invoke0=fn0};
    (void)v7;
    Backing1 *back1 = allocate_context(sizeof *back1);
    (void)back1;
    if (!back1) {
        abort();
    }
    back1->read0 = v0;
    back1->write0 = (L6){0};
    back1->read2 = v2;
    back1->write2 = (L5){0};
    L2 v9 = (L2){.item0=(L0){.read=&back1->read0, .replacement=&back1->write0}, .item1=(L1){.read=&back1->read2, .replacement=&back1->write2}};
    (void)v9;
    L2 v8 = (v7).invoke0((v7).environment, v9);
    (void)v8;
    L6 v10 = 1;
    (void)v10;
    L4 v11 = 3;
    (void)v11;
    L4 v12 = 4;
    (void)v12;
    L5 v13 = (L5){v11, v12};
    (void)v13;
    L8 v14 = (L8){v10, v13};
    (void)v14;
    L5 v15 = (L5){*((v8).item0).read, *((v8).item1).read};
    (void)v15;
    L8 v16 = (L8){(v14).item0, (v14).item1};
    (void)v16;
    if ((v8).restore) {
        (v8).restore((v8).context, v16);
    }
    else {
        *((v8).item0).replacement = (v14).item0;
        *((v8).item1).replacement = (v14).item1;
    }
    L8 v17 = (L8){*((v9).item0).replacement, *((v9).item1).replacement};
    (void)v17;
    (void)back1;
    release_context(back1);
    L6 v19 = (v17).item0;
    (void)v19;
    L5 v20 = (v17).item1;
    (void)v20;
    L8 v21 = (L8){v19, v20};
    (void)v21;
    L8 v18 = v21;
    (void)v18;
    L8 v3 = v18;
    (void)v3;
    L8 v1 = v3;
    (void)v1;
    return v1;
}
L3 restore0(void *opaque, L8 replacement) {
    Restore0 *ctx = opaque;
    (void)replacement;
    *((ctx->arg0).item0).replacement = (replacement).item0;
    *((ctx->arg0).item1).replacement = (replacement).item1;
    release_context(ctx);
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
    L8 result0 = fn1(NULL);
    (void)result0;
    putchar(91);
    fputs((result0).item0 ? "true" : "false", stdout);
    putchar(44);
    putchar(91);
    print_number(((result0).item1).item0);
    putchar(44);
    print_number(((result0).item1).item1);
    putchar(93);
    putchar(93);
    putchar(10);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
`);
});

it('prints complete user-focus-thin C', () => {
    expect(compile('fn first(~(x, y)) ~x\n{let x = (1, 2)\n first(~x) := true\n x}'))
        .toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef _Bool L0;
typedef double L1;
typedef struct L2 L2;
typedef struct L3 L3;
typedef struct L4 L4;
typedef struct L5 L5;
typedef struct L6 L6;
typedef struct L7 L7;
typedef struct L8 L8;
typedef L3 (*A0)(void *, L2);
typedef L2 (*A1)(void *);
typedef L3 (*A2)(void *);
typedef L7 (*A3)(void *, L8);
typedef L3 (*A4)(void *, L0);
struct L2 { L0 item0; L1 item1; };
struct L3 { unsigned char inhabitant; };
struct L4 { L1 item0; L1 item1; };
struct L5 { void *environment; A2 dispose; A3 invoke0; };
struct L6 { unsigned char inhabitant; };
struct L7 { L1 *read; L0 *replacement; A4 restore; void *context; };
struct L8 { L4 *read; L2 *replacement; A0 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L7 fn0(void *environment, L8 arg0);
L2 fn1(void *environment);
typedef struct { L8 arg0; L1 focus; L0 focusout; } Restore0;
L3 restore0(void *opaque, L0 replacement);
typedef struct { L4 read0; L2 write0; } Backing1;
void print_number(double x);
L7 fn0(void *environment, L8 arg0) {
    (void)environment;
    (void)arg0;
    Restore0 *ctx = allocate_context(sizeof *ctx);
    if (!ctx) {
        abort();
    }
    ctx->arg0 = arg0;
    ctx->focus = (*(arg0).read).item0;
    L7 v1 = (L7){.read=&ctx->focus, .replacement=&ctx->focusout};
    v1.restore = restore0;
    v1.context = ctx;
    return v1;
}
L2 fn1(void *environment) {
    (void)environment;
    L1 v0 = 1;
    (void)v0;
    L1 v1 = 2;
    (void)v1;
    L4 v2 = (L4){v0, v1};
    (void)v2;
    L5 v5 = (L5){.environment=NULL, .invoke0=fn0};
    (void)v5;
    Backing1 *back1 = allocate_context(sizeof *back1);
    (void)back1;
    if (!back1) {
        abort();
    }
    back1->read0 = v2;
    back1->write0 = (L2){0};
    L8 v7 = (L8){.read=&back1->read0, .replacement=&back1->write0};
    (void)v7;
    L7 v6 = (v5).invoke0((v5).environment, v7);
    (void)v6;
    L0 v8 = 1;
    (void)v8;
    L1 v9 = *(v6).read;
    (void)v9;
    L0 v10 = v8;
    (void)v10;
    if ((v6).restore) {
        (v6).restore((v6).context, v10);
    }
    else {
        *(v6).replacement = v8;
    }
    L2 v11 = *(v7).replacement;
    (void)v11;
    (void)back1;
    release_context(back1);
    L2 v13 = v11;
    (void)v13;
    L2 v12 = v13;
    (void)v12;
    L2 v3 = v12;
    (void)v3;
    return v3;
}
L3 restore0(void *opaque, L0 replacement) {
    Restore0 *ctx = opaque;
    (void)replacement;
    *(ctx->arg0).replacement = (L2){replacement, (*(ctx->arg0).read).item1};
    release_context(ctx);
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
    L2 result0 = fn1(NULL);
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

it('prints complete branch-change C', () => {
    expect(compile('{let x = 1\n match true {true -> {x := true}; false -> {x := false}}\n x}'))
        .toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct L0 L0;
typedef _Bool L1;
typedef double L2;
typedef struct L3 L3;
typedef L1 (*A0)(void *);
typedef L0 (*A1)(void *, L1);
struct L0 { unsigned char inhabitant; };
struct L3 { L2 *read; L1 *replacement; A1 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L1 fn0(void *environment);
void print_number(double x);
L1 fn0(void *environment) {
    (void)environment;
    L2 v0 = 1;
    (void)v0;
    L1 v2 = 1;
    (void)v2;
    L2 v3 = (L2){0};
    (void)v3;
    L1 v10 = (L1){0};
    (void)v10;
    if (v2 == 1) {
        L1 v5 = 1;
        (void)v5;
        L2 v6 = v0;
        (void)v6;
        v3 = v6;
        v10 = v5;
    }
    else if (v2 == 0) {
        L1 v8 = 0;
        (void)v8;
        L2 v9 = v0;
        (void)v9;
        v3 = v9;
        v10 = v8;
    }
    else {
        abort();
    }
    L1 v12 = v10;
    (void)v12;
    L1 v11 = v12;
    (void)v11;
    L1 v1 = v11;
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
    L1 result0 = fn0(NULL);
    (void)result0;
    fputs(result0 ? "true" : "false", stdout);
    putchar(10);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
`);
});
