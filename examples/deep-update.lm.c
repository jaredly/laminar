#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct List_Number List_Number;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Option_Number Option_Number;
typedef struct Lens_Option_Number Lens_Option_Number;
typedef struct Tuple_Number_List_Number Tuple_Number_List_Number;
typedef struct Lens_List_Number Lens_List_Number;
typedef Unit (*Func_List_Number_to_Unit_42173f7df5)(void *, List_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
typedef Unit (*Func_Option_Number_to_Unit_a35f29301c)(void *, Option_Number);
struct Unit { unsigned char inhabitant; };
enum { List_Number_nil = 0, List_Number_cons = 1 };
struct List_Number { uint32_t tag; union { Unit v0; Tuple_Number_List_Number *v1; } as; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
enum { Option_Number_Some = 0, Option_Number_None = 1 };
struct Option_Number { uint32_t tag; union { double v0; Unit v1; } as; };
struct Lens_Option_Number { Option_Number *read; Func_Option_Number_to_Unit_a35f29301c restore; void *context; };
struct Tuple_Number_List_Number { double item0; List_Number item1; };
struct Lens_List_Number { List_Number *read; Func_List_Number_to_Unit_42173f7df5 restore; void *context; };
typedef struct { List_Number read0; } Backing_List_Number;
typedef struct { Lens_List_Number lst; int v4; Tuple_Number_List_Number v9; int v19; Backing_List_Number * back0; Lens_List_Number v26; Lens_Option_Number v25; Option_Number focus; } Restore1;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Lens_Option_Number find(void *environment, double needle, Lens_List_Number lst);
Unit replace(void *environment, double needle, double repl, Lens_List_Number lst);
List_Number entry(void *environment);
Unit restore1(void *opaque, Option_Number replacement);
void print_number(double x);
void print_List_Number(List_Number value);
Unit drop_List_Number(List_Number value);
Lens_Option_Number find(void *environment, double needle, Lens_List_Number lst) {
    (void)environment;
    List_Number v2 = *lst.read;
    int v4 = 0;
    Option_Number v5 = {0};
    Tuple_Number_List_Number v9 = {0};
    int v19 = 0;
    Backing_List_Number *back0 = NULL;
    Lens_List_Number v26 = {0};
    Lens_Option_Number v25 = {0};
    switch (v2.tag) {
        case List_Number_cons:
        {
            Tuple_Number_List_Number v6 = *v2.as.v1;
            release_context(v2.as.v1);
            double v7 = v6.item0;
            List_Number v8 = v6.item1;
            v9 = (Tuple_Number_List_Number){v7, v8};
            double one = v9.item0;
            v19 = 0;
            Option_Number v20 = {0};
            if (one == needle) {
                v19 = 0;
                v20 = (Option_Number){.tag=Option_Number_Some, .as.v0=v9.item0};
            }
            else {
                back0 = allocate_context(sizeof *back0);
                if (!back0) {
                    abort();
                }
                back0->read0 = v9.item1;
                v26 = (Lens_List_Number){.read=&back0->read0};
                v25 = find(NULL, needle, v26);
                v19 = 1;
                v20 = *v25.read;
            }
            v4 = 0;
            v5 = v20;
            break;
        }
        case List_Number_nil:
        {
            v4 = 1;
            v5 = (Option_Number){.tag=Option_Number_None, .as.v1=(Unit){0}};
            break;
        }
    }
    Restore1 *ctx = allocate_context(sizeof *ctx);
    if (!ctx) {
        abort();
    }
    ctx->lst = lst;
    ctx->v4 = v4;
    ctx->v9 = v9;
    ctx->v19 = v19;
    ctx->back0 = back0;
    ctx->v26 = v26;
    ctx->v25 = v25;
    ctx->focus = v5;
    Lens_Option_Number v47 = (Lens_Option_Number){.read=&ctx->focus};
    v47.restore = restore1;
    v47.context = ctx;
    return v47;
}
Unit replace(void *environment, double needle, double repl, Lens_List_Number lst) {
    (void)environment;
    List_Number v2 = *lst.read;
    Unit v3 = {0};
    List_Number v33 = {0};
    switch (v2.tag) {
        case List_Number_cons:
        {
            Tuple_Number_List_Number *v4 = v2.as.v1;
            double one = ((*v4)).item0;
            Unit v16 = {0};
            if (one == needle) {
                (*v4).item0 = repl;
                v16 = (Unit){0};
            }
            else {
                Lens_List_Number v24 = (Lens_List_Number){.read=&(*v4).item1};
                v16 = replace(NULL, needle, repl, v24);
            }
            v3 = v16;
            v33 = *lst.read;
            break;
        }
        case List_Number_nil:
        {
            Unit v28 = {0};
            List_Number v31 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
            v3 = v28;
            v33 = v31;
            break;
        }
    }
    Unit v1 = v3;
    *lst.read = v33;
    return v1;
}
List_Number entry(void *environment) {
    (void)environment;
    List_Number v4 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
    Tuple_Number_List_Number *v6 = allocate_context(sizeof *v6);
    *v6 = (Tuple_Number_List_Number){4, v4};
    List_Number v5 = (List_Number){.tag=List_Number_cons, .as.v1=v6};
    Tuple_Number_List_Number *v8 = allocate_context(sizeof *v8);
    *v8 = (Tuple_Number_List_Number){3, v5};
    List_Number v7 = (List_Number){.tag=List_Number_cons, .as.v1=v8};
    Tuple_Number_List_Number *v10 = allocate_context(sizeof *v10);
    *v10 = (Tuple_Number_List_Number){2, v7};
    List_Number v9 = (List_Number){.tag=List_Number_cons, .as.v1=v10};
    Tuple_Number_List_Number *v11 = allocate_context(sizeof *v11);
    *v11 = (Tuple_Number_List_Number){1, v9};
    List_Number x = (List_Number){.tag=List_Number_cons, .as.v1=v11};
    Backing_List_Number back2 = {0};
    back2.read0 = x;
    Lens_List_Number v18 = (Lens_List_Number){.read=&back2.read0};
    replace(NULL, 2, 5, v18);
    Backing_List_Number *back3 = allocate_context(sizeof *back3);
    if (!back3) {
        abort();
    }
    back3->read0 = back2.read0;
    Lens_List_Number v24 = (Lens_List_Number){.read=&back3->read0};
    Lens_Option_Number v23 = find(NULL, 3, v24);
    Option_Number v26 = *v23.read;
    Unit v27 = {0};
    Option_Number v49 = {0};
    switch (v26.tag) {
        case Option_Number_Some:
        {
            Unit v35 = {0};
            Option_Number v39 = (Option_Number){.tag=Option_Number_Some, .as.v0=3};
            v27 = v35;
            v49 = v39;
            break;
        }
        case Option_Number_None:
        {
            Unit v44 = {0};
            Option_Number v47 = (Option_Number){.tag=Option_Number_None, .as.v1=(Unit){0}};
            v27 = v44;
            v49 = v47;
            break;
        }
    }
    Option_Number v50 = v49;
    if (v23.restore) {
        v23.restore(v23.context, v50);
    }
    else {
        *v23.read = v49;
    }
    List_Number v51 = *v24.read;
    release_context(back3);
    Unit v25 = v27;
    (void)v25;
    return v51;
}
Unit restore1(void *opaque, Option_Number replacement) {
    Restore1 *ctx = opaque;
    (void)replacement;
    List_Number v46 = (List_Number){0};
    if (ctx->v4 == 0) {
        double v33 = (double){0};
        List_Number v34 = (List_Number){0};
        if (ctx->v19 == 0) {
            if (replacement.tag != Option_Number_Some) {
                abort();
            }
            v33 = replacement.as.v0;
            v34 = ctx->v9.item1;
        }
        else if (ctx->v19 == 1) {
            Option_Number v31 = replacement;
            if (ctx->v25.restore) {
                ctx->v25.restore(ctx->v25.context, v31);
            }
            else {
                *ctx->v25.read = replacement;
            }
            List_Number v32 = *ctx->v26.read;
            release_context(ctx->back0);
            v33 = ctx->v9.item0;
            v34 = v32;
        }
        else {
            abort();
        }
        Tuple_Number_List_Number v35 = (Tuple_Number_List_Number){v33, v34};
        double v37 = v35.item0;
        List_Number v38 = v35.item1;
        Tuple_Number_List_Number *v40 = allocate_context(sizeof *v40);
        *v40 = (Tuple_Number_List_Number){v37, v38};
        List_Number v39 = (List_Number){.tag=List_Number_cons, .as.v1=v40};
        Unit v41 = (Unit){0};
        (void)v41;
        v46 = v39;
    }
    else if (ctx->v4 == 1) {
        if (replacement.tag != Option_Number_None) {
            abort();
        }
        Unit v42 = (Unit){0};
        (void)v42;
        List_Number v44 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
        Unit v45 = (Unit){0};
        (void)v45;
        v46 = v44;
    }
    else {
        abort();
    }
    *ctx->lst.read = v46;
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
        fputs("{\"number\":\"NaN\"}", stdout);
    }
    else if (isinf(x)) {
        fputs(x < 0 ? "{\"number\":\"-Infinity\"}" : "{\"number\":\"Infinity\"}", stdout);
    }
    else if (x == 0 && signbit(x)) {
        fputs("{\"number\":\"-0\"}", stdout);
    }
    else {
        printf("%.17g", x);
    }
}
int main(void) {
    List_Number result0 = entry(NULL);
    (void)result0;
    print_List_Number(result0);
    putchar('\n');
    drop_List_Number(result0);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
void print_List_Number(List_Number value) {
    (void)value;
    int first = 1;
    putchar('[');
    while (value.tag == List_Number_cons) {
        if (!first) {
            putchar(',');
        }
        first = 0;
        print_number((*value.as.v1).item0);
        value = (*value.as.v1).item1;
    }
    putchar(']');
}
Unit drop_List_Number(List_Number value) {
    (void)value;
    if (value.tag == List_Number_cons) {
        drop_List_Number((*value.as.v1).item1);
        release_context(value.as.v1);
    }
    return (Unit){0};
}
