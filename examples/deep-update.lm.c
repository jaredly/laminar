#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Lens_bool_to_double Lens_bool_to_double;
typedef struct Unit Unit;
typedef struct List_Number List_Number;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Tuple_Number_List_Number Tuple_Number_List_Number;
typedef struct Lens_List_Number Lens_List_Number;
typedef Unit (*Func_double_to_Unit_19aa1fe566)(void *, double);
typedef Unit (*Func_List_Number_to_Unit_42173f7df5)(void *, List_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Lens_bool_to_double { bool *read; double *replacement; Func_double_to_Unit_19aa1fe566 restore; void *context; };
struct Unit { unsigned char inhabitant; };
enum { List_Number_nil = 0, List_Number_cons = 1 };
struct List_Number { uint32_t tag; union { Unit v0; Tuple_Number_List_Number *v1; } as; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Tuple_Number_List_Number { double item0; List_Number item1; };
struct Lens_List_Number { List_Number *read; Func_List_Number_to_Unit_42173f7df5 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Unit replace(void *environment, double needle, double repl, Lens_List_Number lst);
Lens_bool_to_double find(void *environment, double needle, Lens_List_Number lst);
List_Number entry(void *environment);
typedef struct { List_Number read0; } Backing0;
typedef struct { Lens_List_Number lst; int v4; Tuple_Number_List_Number v9; int v19; Backing0 * back0; Lens_List_Number v26; Lens_bool_to_double v25; bool focus; double focusout; } Restore1;
Unit restore1(void *opaque, double replacement);
typedef struct { List_Number read0; } Backing2;
typedef struct { List_Number read0; } Backing3;
void print_number(double x);
void print_List_Number(List_Number value);
Unit drop_List_Number(List_Number value);
Unit replace(void *environment, double needle, double repl, Lens_List_Number lst) {
    (void)environment;
    List_Number v2 = *(lst).read;
    Unit v3 = {0};
    List_Number v33 = {0};
    if ((v2).tag == List_Number_cons) {
        Tuple_Number_List_Number * v4 = (v2).as.v1;
        double one = ((*v4)).item0;
        bool v15 = (one == needle);
        Unit v16 = {0};
        if (v15 == 1) {
            double v18 = ((*v4)).item0;
            (void)v18;
            (*v4).item0 = repl;
            v16 = (Unit){0};
        }
        else if (v15 == 0) {
            Lens_List_Number v24 = (Lens_List_Number){.read=&(*v4).item1};
            v16 = replace(((Callable_Value_196fc0868a){0}).environment, needle, repl, v24);
        }
        else {
            abort();
        }
        v3 = v16;
        v33 = *(lst).read;
    }
    else if ((v2).tag == List_Number_nil) {
        Unit v28 = {0};
        List_Number v31 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
        Unit v32 = {0};
        (void)v32;
        v3 = v28;
        v33 = v31;
    }
    else {
        abort();
    }
    Unit v1 = v3;
    *(lst).read = v33;
    return v1;
}
Lens_bool_to_double find(void *environment, double needle, Lens_List_Number lst) {
    (void)environment;
    List_Number v2 = *(lst).read;
    int v4 = 0;
    bool v5 = {0};
    Tuple_Number_List_Number v9 = {0};
    int v19 = {0};
    Backing0 * back0 = {0};
    Lens_List_Number v26 = {0};
    Lens_bool_to_double v25 = {0};
    if ((v2).tag == List_Number_cons) {
        Tuple_Number_List_Number v6 = (*(v2).as.v1);
        release_context((v2).as.v1);
        double v7 = (v6).item0;
        List_Number v8 = (v6).item1;
        v9 = (Tuple_Number_List_Number){v7, v8};
        double one = (v9).item0;
        bool v17 = (one == needle);
        v19 = 0;
        bool v20 = {0};
        if (v17 == 1) {
            v19 = 0;
            v20 = 1;
        }
        else if (v17 == 0) {
            back0 = allocate_context(sizeof *back0);
            if (!back0) {
                abort();
            }
            back0->read0 = (v9).item1;
            v26 = (Lens_List_Number){.read=&back0->read0};
            v25 = find(((Callable_Value_196fc0868a){0}).environment, needle, v26);
            v19 = 1;
            v20 = *(v25).read;
        }
        else {
            abort();
        }
        v4 = 0;
        v5 = v20;
    }
    else if ((v2).tag == List_Number_nil) {
        v4 = 1;
        v5 = 0;
    }
    else {
        abort();
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
    Lens_bool_to_double v53 = (Lens_bool_to_double){.read=&ctx->focus, .replacement=&ctx->focusout};
    v53.restore = restore1;
    v53.context = ctx;
    return v53;
}
List_Number entry(void *environment) {
    (void)environment;
    List_Number v4 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
    Tuple_Number_List_Number * v6 = allocate_context(sizeof *v6);
    *v6 = (Tuple_Number_List_Number){4, v4};
    List_Number v5 = (List_Number){.tag=List_Number_cons, .as.v1=v6};
    Tuple_Number_List_Number * v8 = allocate_context(sizeof *v8);
    *v8 = (Tuple_Number_List_Number){3, v5};
    List_Number v7 = (List_Number){.tag=List_Number_cons, .as.v1=v8};
    Tuple_Number_List_Number * v10 = allocate_context(sizeof *v10);
    *v10 = (Tuple_Number_List_Number){2, v7};
    List_Number v9 = (List_Number){.tag=List_Number_cons, .as.v1=v10};
    Tuple_Number_List_Number * v11 = allocate_context(sizeof *v11);
    *v11 = (Tuple_Number_List_Number){1, v9};
    List_Number x = (List_Number){.tag=List_Number_cons, .as.v1=v11};
    Backing2 back2 = {0};
    back2.read0 = x;
    Lens_List_Number v18 = (Lens_List_Number){.read=&back2.read0};
    Unit v17 = replace(((Callable_Value_196fc0868a){0}).environment, 2, 5, v18);
    (void)v17;
    List_Number v19 = *(v18).read;
    Backing3 * back3 = allocate_context(sizeof *back3);
    if (!back3) {
        abort();
    }
    back3->read0 = v19;
    Lens_List_Number v25 = (Lens_List_Number){.read=&back3->read0};
    Lens_bool_to_double v24 = find(((Callable_Value_196fc0868a){0}).environment, 3, v25);
    double v26 = 10;
    bool v27 = *(v24).read;
    (void)v27;
    if ((v24).restore) {
        (v24).restore((v24).context, v26);
    }
    else {
        *(v24).replacement = v26;
    }
    List_Number v29 = *(v25).read;
    release_context(back3);
    return v29;
}
Unit restore1(void *opaque, double replacement) {
    Restore1 *ctx = opaque;
    (void)replacement;
    List_Number v52 = (List_Number){0};
    if (ctx->v4 == 0) {
        double v38 = (double){0};
        List_Number v39 = (List_Number){0};
        if (ctx->v19 == 0) {
            double res = replacement;
            double res_3 = res;
            double v33 = (ctx->v9).item0;
            (void)v33;
            Unit v35 = (Unit){0};
            Unit v34 = v35;
            (void)v34;
            v38 = res_3;
            v39 = (ctx->v9).item1;
        }
        else if (ctx->v19 == 1) {
            double v36 = replacement;
            if ((ctx->v25).restore) {
                (ctx->v25).restore((ctx->v25).context, v36);
            }
            else {
                *(ctx->v25).replacement = replacement;
            }
            List_Number v37 = *(ctx->v26).read;
            release_context(ctx->back0);
            v38 = (ctx->v9).item0;
            v39 = v37;
        }
        else {
            abort();
        }
        Tuple_Number_List_Number v40 = (Tuple_Number_List_Number){v38, v39};
        double v42 = (v40).item0;
        List_Number v43 = (v40).item1;
        Tuple_Number_List_Number * v45 = allocate_context(sizeof *v45);
        *v45 = (Tuple_Number_List_Number){v42, v43};
        List_Number v44 = (List_Number){.tag=List_Number_cons, .as.v1=v45};
        Unit v46 = (Unit){0};
        (void)v46;
        v52 = v44;
    }
    else if (ctx->v4 == 1) {
        double res_2 = replacement;
        (void)res_2;
        Unit v47 = (Unit){0};
        (void)v47;
        Unit v48 = (Unit){0};
        (void)v48;
        List_Number v50 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
        Unit v51 = (Unit){0};
        (void)v51;
        v52 = v50;
    }
    else {
        abort();
    }
    *(ctx->lst).read = v52;
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
    putchar(10);
    drop_List_Number(result0);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
void print_List_Number(List_Number value) {
    (void)value;
    int first = 1;
    putchar(91);
    while (value.tag == List_Number_cons) {
        if (!first) {
            putchar(44);
        }
        first = 0;
        print_number(((*(value).as.v1)).item0);
        value = ((*(value).as.v1)).item1;
    }
    putchar(93);
}
Unit drop_List_Number(List_Number value) {
    (void)value;
    if (value.tag == List_Number_cons) {
        drop_List_Number(((*(value).as.v1)).item1);
        release_context(value.as.v1);
    }
    return (Unit){0};
}
