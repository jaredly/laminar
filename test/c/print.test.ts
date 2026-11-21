import { it, expect } from 'bun:test';
import { typedProgram } from '../backend/typed-program.ts';
import { compileConcreteProgram } from '../../src/lower-concrete.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { emitC } from '../../src/c/emit.ts';
function compile(source: string, specializeLenses?: readonly string[]) {
    const p = typedProgram(source);
    return emitC(
        compileConcreteProgram(
            p,
            wasm32Emscripten('test'),
            [{ unit: p.units.at(-1)!.id, arguments: [] }],
            { specializeLenses },
        ),
    );
}

it('prints complete tuple C', () => {
    expect(compile('(1, true, ())')).toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct Tuple_Number_Bool_Unit Tuple_Number_Bool_Unit;
typedef Tuple_Number_Bool_Unit (*Func_to_Tuple_Number_Bool_Unit_8fef721c6a)(void *);
struct Unit { unsigned char inhabitant; };
struct Tuple_Number_Bool_Unit { double item0; bool item1; Unit item2; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Tuple_Number_Bool_Unit entry(void *environment);
void print_number(double x);
Tuple_Number_Bool_Unit entry(void *environment) {
    (void)environment;
    double v0 = 1;
    (void)v0;
    bool v1 = 1;
    (void)v1;
    Unit v2 = (Unit){0};
    (void)v2;
    Tuple_Number_Bool_Unit v3 = (Tuple_Number_Bool_Unit){v0, v1, v2};
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
    Tuple_Number_Bool_Unit result0 = entry(NULL);
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
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct Environment_Empty_6db1d02aec Environment_Empty_6db1d02aec;
typedef struct Lens_Unit_to_double Lens_Unit_to_double;
typedef struct Lens_double Lens_double;
typedef struct Callable_Value_d6f73c1cde Callable_Value_d6f73c1cde;
typedef Unit (*Func_double_to_Unit_47414720dc)(void *, double);
typedef double (*Func_double_double_to_double_54ec76ea76)(void *, double, double);
typedef Unit (*Func_to_Unit_b3b0e12625)(void *);
typedef double (*Func_to_double_f62d6b85c2)(void *);
typedef Unit (*Func_Lens_double_to_Unit_fe77974aa6)(void *, Lens_double);
struct Unit { unsigned char inhabitant; };
struct Environment_Empty_6db1d02aec { unsigned char inhabitant; };
struct Lens_Unit_to_double { Unit *read; double *replacement; Func_double_to_Unit_47414720dc restore; void *context; };
struct Lens_double { double *read; Func_double_to_Unit_47414720dc restore; void *context; };
struct Callable_Value_d6f73c1cde { void *environment; Func_to_Unit_b3b0e12625 dispose; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Unit inc(void *environment, Lens_double arg0);
double entry(void *environment);
typedef struct { double read0; } Backing0;
void print_number(double x);
Unit inc(void *environment, Lens_double arg0) {
    (void)environment;
    (void)arg0;
    double v2 = *(arg0).read;
    (void)v2;
    double v3 = 1;
    (void)v3;
    double v4 = (v2 + v3);
    (void)v4;
    Unit v5 = (Unit){0};
    (void)v5;
    *(arg0).read = v4;
    return v5;
}
double entry(void *environment) {
    (void)environment;
    double v0 = 1;
    (void)v0;
    Backing0 back0 = {0};
    (void)back0;
    back0.read0 = v0;
    Lens_double v5 = (Lens_double){.read=&back0.read0};
    (void)v5;
    Unit v4 = inc(((Callable_Value_d6f73c1cde){0}).environment, v5);
    (void)v4;
    double v6 = *(v5).read;
    (void)v6;
    (void)back0;
    double v8 = v6;
    (void)v8;
    double v7 = v8;
    (void)v7;
    double v1 = v7;
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
    double result0 = entry(NULL);
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
#include <stdbool.h>
typedef struct Lens_double Lens_double;
typedef struct Scattered_Lens_double_Lens_double Scattered_Lens_double_Lens_double;
typedef struct Unit Unit;
typedef struct Tuple_Number_Number Tuple_Number_Number;
typedef struct Environment_Empty_6db1d02aec Environment_Empty_6db1d02aec;
typedef struct Lens_Unit_to_double Lens_Unit_to_double;
typedef struct Callable_Value_d6f73c1cde Callable_Value_d6f73c1cde;
typedef Unit (*Func_double_to_Unit_47414720dc)(void *, double);
typedef double (*Func_double_double_to_double_54ec76ea76)(void *, double, double);
typedef Tuple_Number_Number (*Func_to_Tuple_Number_Number_74ef73ee5c)(void *);
typedef Unit (*Func_Tuple_Number_Number_to_Unit_83f1272d34)(void *, Tuple_Number_Number);
typedef Unit (*Func_to_Unit_b3b0e12625)(void *);
typedef Unit (*Func_Scattered_Lens_double_Lens_double_to_Unit_db8a09e788)(void *, Scattered_Lens_double_Lens_double);
struct Lens_double { double *read; Func_double_to_Unit_47414720dc restore; void *context; };
struct Scattered_Lens_double_Lens_double { Lens_double item0; Lens_double item1; Func_Tuple_Number_Number_to_Unit_83f1272d34 restore; void *context; };
struct Unit { unsigned char inhabitant; };
struct Tuple_Number_Number { double item0; double item1; };
struct Environment_Empty_6db1d02aec { unsigned char inhabitant; };
struct Lens_Unit_to_double { Unit *read; double *replacement; Func_double_to_Unit_47414720dc restore; void *context; };
struct Callable_Value_d6f73c1cde { void *environment; Func_to_Unit_b3b0e12625 dispose; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Unit inc(void *environment, Scattered_Lens_double_Lens_double arg0);
Tuple_Number_Number entry(void *environment);
typedef struct { double read0; double read1; } Backing0;
void print_number(double x);
Unit inc(void *environment, Scattered_Lens_double_Lens_double arg0) {
    (void)environment;
    (void)arg0;
    double v2 = *((arg0).item0).read;
    (void)v2;
    double v3 = 1;
    (void)v3;
    double v4 = (v2 + v3);
    (void)v4;
    Unit v5 = (Unit){0};
    (void)v5;
    *((arg0).item0).read = v4;
    *((arg0).item1).read = *((arg0).item1).read;
    return v5;
}
Tuple_Number_Number entry(void *environment) {
    (void)environment;
    double v0 = 1;
    (void)v0;
    double v2 = 2;
    (void)v2;
    Backing0 back0 = {0};
    (void)back0;
    back0.read0 = v0;
    back0.read1 = v2;
    Scattered_Lens_double_Lens_double v9 = (Scattered_Lens_double_Lens_double){.item0=(Lens_double){.read=&back0.read0}, .item1=(Lens_double){.read=&back0.read1}};
    (void)v9;
    Unit v8 = inc(((Callable_Value_d6f73c1cde){0}).environment, v9);
    (void)v8;
    Tuple_Number_Number v10 = (Tuple_Number_Number){*((v9).item0).read, *((v9).item1).read};
    (void)v10;
    (void)back0;
    double v12 = (v10).item0;
    (void)v12;
    double v13 = (v10).item1;
    (void)v13;
    Tuple_Number_Number v14 = (Tuple_Number_Number){v12, v13};
    (void)v14;
    Tuple_Number_Number v11 = v14;
    (void)v11;
    Tuple_Number_Number v3 = v11;
    (void)v3;
    Tuple_Number_Number v1 = v3;
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
    Tuple_Number_Number result0 = entry(NULL);
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
#include <stdbool.h>
typedef struct Lens_double_to_bool Lens_double_to_bool;
typedef struct Lens_double_to_Tuple_Number_Number Lens_double_to_Tuple_Number_Number;
typedef struct Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number;
typedef struct Unit Unit;
typedef struct Tuple_Number_Number Tuple_Number_Number;
typedef struct Environment_Empty_6db1d02aec Environment_Empty_6db1d02aec;
typedef struct Tuple_Bool_Tuple_Number_Number Tuple_Bool_Tuple_Number_Number;
typedef struct Callable_Value_d6f73c1cde Callable_Value_d6f73c1cde;
typedef Unit (*Func_Tuple_Bool_Tuple_Number_Number_to_Unit_6e1c83c44a)(void *, Tuple_Bool_Tuple_Number_Number);
typedef Unit (*Func_Tuple_Number_Number_to_Unit_83f1272d34)(void *, Tuple_Number_Number);
typedef Tuple_Bool_Tuple_Number_Number (*Func_to_Tuple_Bool_Tuple_Number_Number_a9e303ecad)(void *);
typedef Unit (*Func_to_Unit_b3b0e12625)(void *);
typedef Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number (*Func_Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number__c978043f0d)(void *, Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number);
typedef Unit (*Func_bool_to_Unit_fe0e204ab7)(void *, bool);
struct Lens_double_to_bool { double *read; bool *replacement; Func_bool_to_Unit_fe0e204ab7 restore; void *context; };
struct Lens_double_to_Tuple_Number_Number { double *read; Tuple_Number_Number *replacement; Func_Tuple_Number_Number_to_Unit_83f1272d34 restore; void *context; };
struct Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number { Lens_double_to_bool item0; Lens_double_to_Tuple_Number_Number item1; Func_Tuple_Bool_Tuple_Number_Number_to_Unit_6e1c83c44a restore; void *context; };
struct Unit { unsigned char inhabitant; };
struct Tuple_Number_Number { double item0; double item1; };
struct Environment_Empty_6db1d02aec { unsigned char inhabitant; };
struct Tuple_Bool_Tuple_Number_Number { bool item0; Tuple_Number_Number item1; };
struct Callable_Value_d6f73c1cde { void *environment; Func_to_Unit_b3b0e12625 dispose; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number both(void *environment, Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number arg0);
Tuple_Bool_Tuple_Number_Number entry(void *environment);
typedef struct { Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number arg0; double focus_0; bool focus_0out; double focus_1; Tuple_Number_Number focus_1out; } Restore0;
Unit restore0(void *opaque, Tuple_Bool_Tuple_Number_Number replacement);
typedef struct { double read0; bool write0; double read2; Tuple_Number_Number write2; } Backing1;
void print_number(double x);
Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number both(void *environment, Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number arg0) {
    (void)environment;
    (void)arg0;
    Restore0 *ctx = allocate_context(sizeof *ctx);
    if (!ctx) {
        abort();
    }
    ctx->arg0 = arg0;
    ctx->focus_0 = *((arg0).item0).read;
    ctx->focus_1 = *((arg0).item1).read;
    Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number v3 = (Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number){.item0=(Lens_double_to_bool){.read=&ctx->focus_0, .replacement=&ctx->focus_0out}, .item1=(Lens_double_to_Tuple_Number_Number){.read=&ctx->focus_1, .replacement=&ctx->focus_1out}};
    v3.restore = restore0;
    v3.context = ctx;
    return v3;
}
Tuple_Bool_Tuple_Number_Number entry(void *environment) {
    (void)environment;
    double v0 = 1;
    (void)v0;
    double v2 = 2;
    (void)v2;
    Backing1 *back1 = allocate_context(sizeof *back1);
    (void)back1;
    if (!back1) {
        abort();
    }
    back1->read0 = v0;
    back1->write0 = (bool){0};
    back1->read2 = v2;
    back1->write2 = (Tuple_Number_Number){0};
    Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number v9 = (Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number){.item0=(Lens_double_to_bool){.read=&back1->read0, .replacement=&back1->write0}, .item1=(Lens_double_to_Tuple_Number_Number){.read=&back1->read2, .replacement=&back1->write2}};
    (void)v9;
    Scattered_Lens_double_to_bool_Lens_double_to_Tuple_Number_Number v8 = both(((Callable_Value_d6f73c1cde){0}).environment, v9);
    (void)v8;
    bool v10 = 1;
    (void)v10;
    double v11 = 3;
    (void)v11;
    double v12 = 4;
    (void)v12;
    Tuple_Number_Number v13 = (Tuple_Number_Number){v11, v12};
    (void)v13;
    Tuple_Bool_Tuple_Number_Number v14 = (Tuple_Bool_Tuple_Number_Number){v10, v13};
    (void)v14;
    Tuple_Number_Number v15 = (Tuple_Number_Number){*((v8).item0).read, *((v8).item1).read};
    (void)v15;
    Tuple_Bool_Tuple_Number_Number v16 = (Tuple_Bool_Tuple_Number_Number){(v14).item0, (v14).item1};
    (void)v16;
    if ((v8).restore) {
        (v8).restore((v8).context, v16);
    }
    else {
        *((v8).item0).replacement = (v14).item0;
        *((v8).item1).replacement = (v14).item1;
    }
    Tuple_Bool_Tuple_Number_Number v17 = (Tuple_Bool_Tuple_Number_Number){*((v9).item0).replacement, *((v9).item1).replacement};
    (void)v17;
    (void)back1;
    release_context(back1);
    bool v19 = (v17).item0;
    (void)v19;
    Tuple_Number_Number v20 = (v17).item1;
    (void)v20;
    Tuple_Bool_Tuple_Number_Number v21 = (Tuple_Bool_Tuple_Number_Number){v19, v20};
    (void)v21;
    Tuple_Bool_Tuple_Number_Number v18 = v21;
    (void)v18;
    Tuple_Bool_Tuple_Number_Number v3 = v18;
    (void)v3;
    Tuple_Bool_Tuple_Number_Number v1 = v3;
    (void)v1;
    return v1;
}
Unit restore0(void *opaque, Tuple_Bool_Tuple_Number_Number replacement) {
    Restore0 *ctx = opaque;
    (void)replacement;
    *((ctx->arg0).item0).replacement = (replacement).item0;
    *((ctx->arg0).item1).replacement = (replacement).item1;
    release_context(ctx);
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
    Tuple_Bool_Tuple_Number_Number result0 = entry(NULL);
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
    expect(compile('fn first(~(x, y)) ~x\n{let x = (1, 2)\n first(~x) := true\n x}', ['first']))
        .toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Tuple_Bool_Number Tuple_Bool_Number;
typedef struct Unit Unit;
typedef struct Tuple_Number_Number Tuple_Number_Number;
typedef struct Environment_Empty_6db1d02aec Environment_Empty_6db1d02aec;
typedef struct Lens_double_to_bool Lens_double_to_bool;
typedef struct Lens_Tuple_Number_Number_to_Tuple_Bool_Number Lens_Tuple_Number_Number_to_Tuple_Bool_Number;
typedef struct Callable_Value_d6f73c1cde Callable_Value_d6f73c1cde;
typedef Unit (*Func_Tuple_Bool_Number_to_Unit_6f13bfd866)(void *, Tuple_Bool_Number);
typedef Tuple_Bool_Number (*Func_to_Tuple_Bool_Number_a2de97117d)(void *);
typedef Unit (*Func_to_Unit_b3b0e12625)(void *);
typedef Lens_double_to_bool (*Func_Lens_Tuple_Number_Number_to_Tuple_Bool_Number_to_Lens_double_to_b_e7b006dbb1)(void *, Lens_Tuple_Number_Number_to_Tuple_Bool_Number);
typedef Unit (*Func_bool_to_Unit_fe0e204ab7)(void *, bool);
struct Tuple_Bool_Number { bool item0; double item1; };
struct Unit { unsigned char inhabitant; };
struct Tuple_Number_Number { double item0; double item1; };
struct Environment_Empty_6db1d02aec { unsigned char inhabitant; };
struct Lens_double_to_bool { double *read; bool *replacement; Func_bool_to_Unit_fe0e204ab7 restore; void *context; };
struct Lens_Tuple_Number_Number_to_Tuple_Bool_Number { Tuple_Number_Number *read; Tuple_Bool_Number *replacement; Func_Tuple_Bool_Number_to_Unit_6f13bfd866 restore; void *context; };
struct Callable_Value_d6f73c1cde { void *environment; Func_to_Unit_b3b0e12625 dispose; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Lens_double_to_bool first(void *environment, Lens_Tuple_Number_Number_to_Tuple_Bool_Number arg0);
Tuple_Bool_Number entry(void *environment);
typedef struct { Lens_Tuple_Number_Number_to_Tuple_Bool_Number arg0; double focus; bool focusout; } Restore0;
Unit restore0(void *opaque, bool replacement);
typedef struct { Tuple_Number_Number read0; Tuple_Bool_Number write0; } Backing1;
void print_number(double x);
Lens_double_to_bool first(void *environment, Lens_Tuple_Number_Number_to_Tuple_Bool_Number arg0) {
    (void)environment;
    (void)arg0;
    Restore0 *ctx = allocate_context(sizeof *ctx);
    if (!ctx) {
        abort();
    }
    ctx->arg0 = arg0;
    ctx->focus = (*(arg0).read).item0;
    Lens_double_to_bool v1 = (Lens_double_to_bool){.read=&ctx->focus, .replacement=&ctx->focusout};
    v1.restore = restore0;
    v1.context = ctx;
    return v1;
}
Tuple_Bool_Number entry(void *environment) {
    (void)environment;
    double v0 = 1;
    (void)v0;
    double v1 = 2;
    (void)v1;
    Tuple_Number_Number v2 = (Tuple_Number_Number){v0, v1};
    (void)v2;
    Backing1 *back1 = allocate_context(sizeof *back1);
    (void)back1;
    if (!back1) {
        abort();
    }
    back1->read0 = v2;
    back1->write0 = (Tuple_Bool_Number){0};
    Lens_Tuple_Number_Number_to_Tuple_Bool_Number v7 = (Lens_Tuple_Number_Number_to_Tuple_Bool_Number){.read=&back1->read0, .replacement=&back1->write0};
    (void)v7;
    Lens_double_to_bool v6 = first(((Callable_Value_d6f73c1cde){0}).environment, v7);
    (void)v6;
    bool v8 = 1;
    (void)v8;
    double v9 = *(v6).read;
    (void)v9;
    bool v10 = v8;
    (void)v10;
    if ((v6).restore) {
        (v6).restore((v6).context, v10);
    }
    else {
        *(v6).replacement = v8;
    }
    Tuple_Bool_Number v11 = *(v7).replacement;
    (void)v11;
    (void)back1;
    release_context(back1);
    Tuple_Bool_Number v13 = v11;
    (void)v13;
    Tuple_Bool_Number v12 = v13;
    (void)v12;
    Tuple_Bool_Number v3 = v12;
    (void)v3;
    return v3;
}
Unit restore0(void *opaque, bool replacement) {
    Restore0 *ctx = opaque;
    (void)replacement;
    *(ctx->arg0).replacement = (Tuple_Bool_Number){replacement, (*(ctx->arg0).read).item1};
    release_context(ctx);
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

it('prints complete branch-change C', () => {
    expect(compile('{let x = 1\n match true {true -> {x := true}; false -> {x := false}}\n x}'))
        .toBe(`#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct Lens_double_to_bool Lens_double_to_bool;
typedef bool (*Func_to_bool_c3f24419ed)(void *);
typedef Unit (*Func_bool_to_Unit_fe0e204ab7)(void *, bool);
struct Unit { unsigned char inhabitant; };
struct Lens_double_to_bool { double *read; bool *replacement; Func_bool_to_Unit_fe0e204ab7 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
bool entry(void *environment);
void print_number(double x);
bool entry(void *environment) {
    (void)environment;
    double v0 = 1;
    (void)v0;
    bool v2 = 1;
    (void)v2;
    double v3 = (double){0};
    (void)v3;
    bool v10 = (bool){0};
    (void)v10;
    if (v2 == 1) {
        bool v5 = 1;
        (void)v5;
        double v6 = v0;
        (void)v6;
        v3 = v6;
        v10 = v5;
    }
    else if (v2 == 0) {
        bool v8 = 0;
        (void)v8;
        double v9 = v0;
        (void)v9;
        v3 = v9;
        v10 = v8;
    }
    else {
        abort();
    }
    bool v12 = v10;
    (void)v12;
    bool v11 = v12;
    (void)v11;
    bool v1 = v11;
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
    bool result0 = entry(NULL);
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
