#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct List_Number List_Number;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Tuple_Number_List_Number Tuple_Number_List_Number;
typedef struct Tuple_Number_Number_Number Tuple_Number_Number_Number;
typedef struct Lens_List_Number Lens_List_Number;
typedef Unit (*Func_List_Number_to_Unit_42173f7df5)(void *, List_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Unit { unsigned char inhabitant; };
enum { List_Number_nil = 0, List_Number_cons = 1 };
struct List_Number { uint32_t tag; union { Unit v0; Tuple_Number_List_Number *v1; } as; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Tuple_Number_List_Number { double item0; List_Number item1; };
struct Tuple_Number_Number_Number { double item0; double item1; double item2; };
struct Lens_List_Number { List_Number *read; Func_List_Number_to_Unit_42173f7df5 restore; void *context; };
typedef struct { List_Number read0; } Backing_List_Number;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
void retain_context(void *context);
_Bool unique_context(void *context);
double sum(void *environment, List_Number xs);
Unit bump(void *environment, Lens_List_Number xs);
Tuple_Number_Number_Number entry(void *environment);
List_Number share_List_Number(List_Number value);
Unit drop_List_Number(List_Number value);
List_Number dup_List_Number(List_Number value);
void print_number(double x);
double sum(void *environment, List_Number xs) {
    (void)environment;
    List_Number xs_2 = share_List_Number(xs);
    double v2 = 0;
    switch (xs_2.tag) {
        case List_Number_nil:
        {
            v2 = 0;
            break;
        }
        case List_Number_cons:
        {
            Tuple_Number_List_Number v4 = (unique_context(xs_2.as.v1) ? *xs_2.as.v1 : (Tuple_Number_List_Number){(*xs_2.as.v1).item0, share_List_Number((*xs_2.as.v1).item1)});
            release_context(xs_2.as.v1);
            double head = v4.item0;
            List_Number tail = share_List_Number(v4.item1);
            double v11 = sum(NULL, tail);
            drop_List_Number(v4.item1);
            v2 = head + v11;
            break;
        }
    }
    drop_List_Number(xs);
    return v2;
}
Unit bump(void *environment, Lens_List_Number xs) {
    (void)environment;
    List_Number v2 = *xs.read;
    Unit v3 = {0};
    List_Number v28 = {0};
    switch (v2.tag) {
        case List_Number_nil:
        {
            Unit v7 = {0};
            List_Number v10 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
            v3 = v7;
            v28 = v10;
            break;
        }
        case List_Number_cons:
        {
            Tuple_Number_List_Number *v12 = v2.as.v1;
            double head = ((*v12)).item0;
            (*v12).item0 = head + 1;
            Lens_List_Number v27 = (Lens_List_Number){.read=&(*v12).item1};
            v3 = bump(NULL, v27);
            v28 = *xs.read;
            break;
        }
    }
    Unit v1 = v3;
    *xs.read = v28;
    return v1;
}
Tuple_Number_Number_Number entry(void *environment) {
    (void)environment;
    List_Number v3 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
    Tuple_Number_List_Number *v5 = allocate_context(sizeof *v5);
    *v5 = (Tuple_Number_List_Number){3, v3};
    List_Number v4 = (List_Number){.tag=List_Number_cons, .as.v1=v5};
    Tuple_Number_List_Number *v7 = allocate_context(sizeof *v7);
    *v7 = (Tuple_Number_List_Number){2, v4};
    List_Number v6 = (List_Number){.tag=List_Number_cons, .as.v1=v7};
    Tuple_Number_List_Number *v8 = allocate_context(sizeof *v8);
    *v8 = (Tuple_Number_List_Number){1, v6};
    List_Number xs = (List_Number){.tag=List_Number_cons, .as.v1=v8};
    List_Number copy = dup_List_Number(xs);
    Backing_List_Number back0 = {0};
    back0.read0 = copy;
    Lens_List_Number v16 = (Lens_List_Number){.read=&back0.read0};
    bump(NULL, v16);
    List_Number xs_2 = share_List_Number(xs);
    double v21 = sum(NULL, xs_2);
    List_Number copy_2 = back0.read0;
    double v23 = sum(NULL, copy_2);
    List_Number xs_3 = share_List_Number(xs);
    double v27 = sum(NULL, xs_3);
    Tuple_Number_Number_Number v28 = (Tuple_Number_Number_Number){v21, v23, v27};
    drop_List_Number(xs);
    return v28;
}
List_Number share_List_Number(List_Number value) {
    (void)value;
    if (value.tag == List_Number_cons) {
        retain_context(value.as.v1);
    }
    return value;
}
Unit drop_List_Number(List_Number value) {
    (void)value;
    if (value.tag == List_Number_cons) {
        if (unique_context(value.as.v1)) {
            drop_List_Number((*value.as.v1).item1);
        }
        release_context(value.as.v1);
    }
    return (Unit){0};
}
List_Number dup_List_Number(List_Number value) {
    (void)value;
    List_Number copy = value;
    if (value.tag == List_Number_nil) {
        copy.as.v0 = value.as.v0;
    }
    else if (value.tag == List_Number_cons) {
        copy.as.v1 = allocate_context(sizeof *copy.as.v1);
        *copy.as.v1 = (Tuple_Number_List_Number){(*value.as.v1).item0, dup_List_Number((*value.as.v1).item1)};
    }
    return copy;
}
void *allocate_context(size_t size) {
    size_t *context = malloc(size + 2 * sizeof *context);
    if (!context) {
        abort();
    }
    ++live_contexts;
    *context = 1;
    return context + 2;
}
void retain_context(void *context) {
    ++((size_t *)context)[-2];
}
_Bool unique_context(void *context) {
    return ((size_t *)context)[-2] == 1;
}
void release_context(void *context) {
    if (!context || live_contexts == 0) {
        abort();
    }
    size_t *refs = (size_t *)context - 2;
    if (--*refs) {
        return;
    }
    --live_contexts;
    free(refs);
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
    Tuple_Number_Number_Number result0 = entry(NULL);
    (void)result0;
    putchar('[');
    print_number(result0.item0);
    putchar(',');
    print_number(result0.item1);
    putchar(',');
    print_number(result0.item2);
    putchar(']');
    putchar('\n');
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
