#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Lens_Vector_Number Lens_Vector_Number;
typedef struct Unit Unit;
typedef struct Tuple_Number_Number Tuple_Number_Number;
typedef struct Vector_Number Vector_Number;
typedef struct Tuple_Vector_Number_Vector_Number_Tuple_Number_Number Tuple_Vector_Number_Vector_Number_Tuple_Number_Number;
typedef Unit (*Func_Vector_Number_to_Unit_3a319c4be1)(void *, Vector_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Lens_Vector_Number { Vector_Number *read; Func_Vector_Number_to_Unit_3a319c4be1 restore; void *context; };
struct Unit { unsigned char inhabitant; };
struct Tuple_Number_Number { double item0; double item1; };
struct Vector_Number { double *elements; size_t length; size_t capacity; };
struct Tuple_Vector_Number_Vector_Number_Tuple_Number_Number { Vector_Number item0; Vector_Number item1; Tuple_Number_Number item2; };
typedef struct { Vector_Number read0; } Backing_Vector_Number;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
Unit fillRange(void *environment, double n, double end, Lens_Vector_Number arr);
Vector_Number range(void *environment, double n);
Tuple_Vector_Number_Vector_Number_Tuple_Number_Number entry(void *environment);
double *vector_at_Vector_Number(Vector_Number value, double index);
Vector_Number vector_array_Vector_Number(double length, double init);
Vector_Number vector_push_Vector_Number(Vector_Number value, double item);
void print_number(double x);
void vector_drop_Vector_Number(Vector_Number value);
Unit fillRange(void *environment, double n, double end, Lens_Vector_Number arr) {
    (void)environment;
    Unit v6 = {0};
    if (n >= end) {
        v6 = (Unit){0};
    }
    else {
        double *v13 = vector_at_Vector_Number(*arr.read, n);
        *v13 = n;
        v6 = fillRange(NULL, n + 1, end, arr);
    }
    return v6;
}
Vector_Number range(void *environment, double n) {
    (void)environment;
    Vector_Number arr = vector_array_Vector_Number(n, 0);
    Backing_Vector_Number back0 = {0};
    back0.read0 = arr;
    Lens_Vector_Number v9 = (Lens_Vector_Number){.read=&back0.read0};
    fillRange(NULL, 0, n, v9);
    return back0.read0;
}
Tuple_Vector_Number_Vector_Number_Tuple_Number_Number entry(void *environment) {
    (void)environment;
    Vector_Number v2 = range(NULL, 10);
    Vector_Number v14 = {0};
    Vector_Number v16 = vector_push_Vector_Number(v14, 0);
    Vector_Number v18 = vector_push_Vector_Number(v16, 1);
    Vector_Number v20 = vector_push_Vector_Number(v18, 2);
    Vector_Number v22 = vector_push_Vector_Number(v20, 3);
    Vector_Number v24 = vector_push_Vector_Number(v22, 4);
    Vector_Number v26 = vector_push_Vector_Number(v24, 5);
    Vector_Number v28 = vector_push_Vector_Number(v26, 6);
    Vector_Number v30 = vector_push_Vector_Number(v28, 7);
    Vector_Number v32 = vector_push_Vector_Number(v30, 8);
    Vector_Number v34 = vector_push_Vector_Number(v32, 9);
    Tuple_Number_Number v37 = (Tuple_Number_Number){10, 123};
    return (Tuple_Vector_Number_Vector_Number_Tuple_Number_Number){v2, v34, v37};
}
double *vector_at_Vector_Number(Vector_Number value, double index) {
    if (!(index >= 0) || index != floor(index) || index >= (double)value.length) {
        abort();
    }
    return &value.elements[(size_t)index];
}
Vector_Number vector_array_Vector_Number(double length, double init) {
    if (!(length >= 0) || length != floor(length) || length > (double)(SIZE_MAX / sizeof init)) {
        abort();
    }
    Vector_Number value = {0};
    if (length == 0) {
        return value;
    }
    value.length = value.capacity = (size_t)length;
    value.elements = allocate_context(value.length * sizeof *value.elements);
    for (size_t i = 0; i + 1 < value.length; i++) {
        value.elements[i] = init;
    }
    value.elements[value.length - 1] = init;
    return value;
}
Vector_Number vector_push_Vector_Number(Vector_Number value, double item) {
    if (value.length == value.capacity) {
        size_t capacity = value.capacity ? value.capacity * 2 : 4;
        double *elements = allocate_context(capacity * sizeof *elements);
        for (size_t i = 0; i < value.length; i++) {
            elements[i] = value.elements[i];
        }
        if (value.elements) {
            release_context(value.elements);
        }
        value.elements = elements;
        value.capacity = capacity;
    }
    value.elements[value.length++] = item;
    return value;
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
    Tuple_Vector_Number_Vector_Number_Tuple_Number_Number result0 = entry(NULL);
    (void)result0;
    putchar('[');
    putchar('[');
    for (size_t i0 = 0; i0 < result0.item0.length; i0++) {
        if (i0) {
            putchar(',');
        }
        print_number(result0.item0.elements[i0]);
    }
    putchar(']');
    putchar(',');
    putchar('[');
    for (size_t i1 = 0; i1 < result0.item1.length; i1++) {
        if (i1) {
            putchar(',');
        }
        print_number(result0.item1.elements[i1]);
    }
    putchar(']');
    putchar(',');
    putchar('[');
    print_number(result0.item2.item0);
    putchar(',');
    print_number(result0.item2.item1);
    putchar(']');
    putchar(']');
    putchar('\n');
    vector_drop_Vector_Number(result0.item0);
    vector_drop_Vector_Number(result0.item1);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
void vector_drop_Vector_Number(Vector_Number value) {
    if (value.elements) {
        release_context(value.elements);
    }
}
