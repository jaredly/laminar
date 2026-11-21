#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
typedef struct L0 L0;
typedef struct L1 L1;
typedef struct L2 L2;
typedef double L3;
typedef struct L4 L4;
typedef L4 (*A0)(void *, L4, L3);
typedef L1 (*A1)(void *);
typedef L4 (*A2)(void *);
struct L0 { void *environment; A1 dispose; };
struct L1 { unsigned char inhabitant; };
struct L2 { unsigned char inhabitant; };
struct L4 { L3 *elements; size_t length; size_t capacity; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
L4 fn0(void *environment);
L4 vector_push_L4(L4 value, L3 item);
void print_number(double x);
void vector_drop_L4(L4 value);
L4 fn0(void *environment) {
    (void)environment;
    L4 v11 = (L4){0};
    (void)v11;
    L3 v12 = 0;
    (void)v12;
    L4 v13 = vector_push_L4(v11, v12);
    (void)v13;
    L3 v14 = 1;
    (void)v14;
    L4 v15 = vector_push_L4(v13, v14);
    (void)v15;
    L3 v16 = 2;
    (void)v16;
    L4 v17 = vector_push_L4(v15, v16);
    (void)v17;
    L3 v18 = 3;
    (void)v18;
    L4 v19 = vector_push_L4(v17, v18);
    (void)v19;
    L3 v20 = 4;
    (void)v20;
    L4 v21 = vector_push_L4(v19, v20);
    (void)v21;
    L3 v22 = 5;
    (void)v22;
    L4 v23 = vector_push_L4(v21, v22);
    (void)v23;
    L3 v24 = 6;
    (void)v24;
    L4 v25 = vector_push_L4(v23, v24);
    (void)v25;
    L3 v26 = 7;
    (void)v26;
    L4 v27 = vector_push_L4(v25, v26);
    (void)v27;
    L3 v28 = 8;
    (void)v28;
    L4 v29 = vector_push_L4(v27, v28);
    (void)v29;
    L3 v30 = 9;
    (void)v30;
    L4 v31 = vector_push_L4(v29, v30);
    (void)v31;
    return v31;
}
L4 vector_push_L4(L4 value, L3 item) {
    if (value.length == value.capacity) {
        size_t capacity = value.capacity ? value.capacity * 2 : 4;
        L3 *elements = allocate_context(capacity * sizeof *elements);
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
    L4 result0 = fn0(NULL);
    (void)result0;
    putchar(91);
    for (size_t i0 = 0; i0 < (result0).length; i0++) {
        if (i0) {
            putchar(44);
        }
        print_number((result0).elements[i0]);
    }
    putchar(93);
    putchar(10);
    vector_drop_L4(result0);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
void vector_drop_L4(L4 value) {
    if (value.elements) {
        release_context(value.elements);
    }
}
