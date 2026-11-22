#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Unit Unit;
typedef struct List_Number List_Number;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Tuple_Number_List_Number Tuple_Number_List_Number;
typedef struct Lens_List_Number Lens_List_Number;
typedef Unit (*Func_List_Number_to_Unit_42173f7df5)(void *, List_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Unit { unsigned char inhabitant; };
enum { List_Number_nil = 0, List_Number_cons = 1 };
struct List_Number { uint32_t tag; union { Unit v0; Tuple_Number_List_Number *v1; } as; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Tuple_Number_List_Number { double item0; List_Number item1; };
struct Lens_List_Number { List_Number *read; Func_List_Number_to_Unit_42173f7df5 restore; void *context; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Unit bump(void *environment, Lens_List_Number xs);
List_Number entry(void *environment);
typedef struct { List_Number read0; } Backing0;
void print_number(double x);
void print_List_Number(List_Number value);
Unit drop_List_Number(List_Number value);
Unit bump(void *environment, Lens_List_Number xs) {
    (void)environment;
    List_Number v2 = *(xs).read;
    Unit v3 = {0};
    List_Number v28 = {0};
    if ((v2).tag == List_Number_nil) {
        Unit v7 = {0};
        List_Number v10 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
        Unit v11 = {0};
        (void)v11;
        v3 = v7;
        v28 = v10;
    }
    else if ((v2).tag == List_Number_cons) {
        Tuple_Number_List_Number * v12 = (v2).as.v1;
        double head = ((*v12)).item0;
        Unit v22 = {0};
        (void)v22;
        (*v12).item0 = (head + 1);
        Lens_List_Number v27 = (Lens_List_Number){.read=&(*v12).item1};
        v3 = bump(((Callable_Value_196fc0868a){0}).environment, v27);
        v28 = *(xs).read;
    }
    else {
        abort();
    }
    Unit v1 = v3;
    *(xs).read = v28;
    return v1;
}
List_Number entry(void *environment) {
    (void)environment;
    List_Number v3 = (List_Number){.tag=List_Number_nil, .as.v0=(Unit){0}};
    Tuple_Number_List_Number * v5 = allocate_context(sizeof *v5);
    *v5 = (Tuple_Number_List_Number){3, v3};
    List_Number v4 = (List_Number){.tag=List_Number_cons, .as.v1=v5};
    Tuple_Number_List_Number * v7 = allocate_context(sizeof *v7);
    *v7 = (Tuple_Number_List_Number){2, v4};
    List_Number v6 = (List_Number){.tag=List_Number_cons, .as.v1=v7};
    Tuple_Number_List_Number * v8 = allocate_context(sizeof *v8);
    *v8 = (Tuple_Number_List_Number){1, v6};
    List_Number x = (List_Number){.tag=List_Number_cons, .as.v1=v8};
    Backing0 back0 = {0};
    back0.read0 = x;
    Lens_List_Number v13 = (Lens_List_Number){.read=&back0.read0};
    Unit v12 = bump(((Callable_Value_196fc0868a){0}).environment, v13);
    (void)v12;
    return *(v13).read;
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
