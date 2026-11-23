#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct List_Number List_Number;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Option_Number Option_Number;
typedef struct Tuple_Number_List_Number Tuple_Number_List_Number;
typedef struct Fields_Option_Number Fields_Option_Number;
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
struct Tuple_Number_List_Number { double item0; List_Number item1; };
struct Fields_Option_Number { uint32_t tag; double *v0; Func_Option_Number_to_Unit_a35f29301c restore; void *context; };
struct Lens_List_Number { List_Number *read; Func_List_Number_to_Unit_42173f7df5 restore; void *context; };
typedef struct { Lens_List_Number lst; Option_Number focus; } Restore0;
typedef struct { List_Number read0; } Backing_List_Number;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Fields_Option_Number find(void *environment, double needle, Lens_List_Number lst);
Unit replace(void *environment, double needle, double repl, Lens_List_Number lst);
List_Number entry(void *environment);
Unit restore0(void *opaque, Option_Number replacement);
void print_number(double x);
void print_List_Number(List_Number value);
Unit drop_List_Number(List_Number value);
Fields_Option_Number find(void *environment, double needle, Lens_List_Number lst) {
    (void)environment;
    List_Number v2 = *lst.read;
    int v4 = 0;
    (void)v4;
    Fields_Option_Number v38 = (Fields_Option_Number){0};
    switch (v2.tag) {
        case List_Number_cons:
        {
            Tuple_Number_List_Number *v6 = v2.as.v1;
            double one = ((*v6)).item0;
            int v19 = 0;
            (void)v19;
            Fields_Option_Number v28 = (Fields_Option_Number){0};
            if (one == needle) {
                v28 = (Fields_Option_Number){.tag=Option_Number_Some, .v0=&(*v6).item0};
            }
            else {
                Lens_List_Number v27 = (Lens_List_Number){.read=&(*v6).item1};
                v28 = find(NULL, needle, v27);
            }
            v38 = v28;
            break;
        }
        case List_Number_nil:
        {
            Restore0 *ctx = allocate_context(sizeof *ctx);
            if (!ctx) {
                abort();
            }
            ctx->lst = lst;
            ctx->focus = (Option_Number){.tag=Option_Number_None, .as.v1=(Unit){0}};
            Fields_Option_Number v43 = (Fields_Option_Number){.tag=ctx->focus.tag, .v0=&ctx->focus.as.v0};
            v43.restore = restore0;
            v43.context = ctx;
            v38 = v43;
            break;
        }
    }
    return v38;
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
    Backing_List_Number back1 = {0};
    back1.read0 = x;
    Lens_List_Number v18 = (Lens_List_Number){.read=&back1.read0};
    replace(NULL, 2, 5, v18);
    Backing_List_Number *back2 = allocate_context(sizeof *back2);
    if (!back2) {
        abort();
    }
    back2->read0 = back1.read0;
    Lens_List_Number v24 = (Lens_List_Number){.read=&back2->read0};
    Fields_Option_Number v23 = find(NULL, 3, v24);
    Unit v27 = {0};
    switch (v23.tag) {
        case Option_Number_Some:
        {
            double v32 = 3;
            Unit v35 = {0};
            *v23.v0 = v32;
            v27 = v35;
            break;
        }
        case Option_Number_None:
        {
            Unit v44 = {0};
            v27 = v44;
            break;
        }
    }
    if (v23.restore) {
        v23.restore(v23.context, (v23.tag == Option_Number_Some ? (Option_Number){.tag=Option_Number_Some, .as.v0=*v23.v0} : (Option_Number){.tag=Option_Number_None, .as.v1=(Unit){0}}));
    }
    List_Number v49 = *v24.read;
    release_context(back2);
    Unit v25 = v27;
    (void)v25;
    return v49;
}
Unit restore0(void *opaque, Option_Number replacement) {
    Restore0 *ctx = opaque;
    (void)replacement;
    if (replacement.tag != Option_Number_None) {
        abort();
    }
    Unit v39 = (Unit){0};
    (void)v39;
    List_Number v41 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
    Unit v42 = (Unit){0};
    (void)v42;
    *ctx->lst.read = v41;
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
