#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
typedef struct laminar_string { size_t length; unsigned char bytes[]; } laminar_string;
typedef struct { unsigned char *bytes; size_t length; size_t capacity; } string_builder;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Lens_double Lens_double;
typedef struct Unit Unit;
typedef struct Lens_Tuple_Number_Number_Number Lens_Tuple_Number_Number_Number;
typedef struct Environment_Empty_74f5f28086 Environment_Empty_74f5f28086;
typedef struct Scattered_Lens_double_Lens_double_Lens_double Scattered_Lens_double_Lens_double_Lens_double;
typedef laminar_string *String;
typedef struct Tuple_Number_Number_Number Tuple_Number_Number_Number;
typedef struct Tuple_Tuple_Number_Number_Number_Number Tuple_Tuple_Number_Number_Number_Number;
typedef struct Lens_Unit_to_double Lens_Unit_to_double;
typedef struct Direction Direction;
typedef Unit (*Func_double_to_Unit_19aa1fe566)(void *, double);
typedef Unit (*Func_Tuple_Number_Number_Number_to_Unit_29d831fc54)(void *, Tuple_Number_Number_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
typedef String (*Func_String_to_String_99bd3030ba)(void *, String);
typedef double (*Func_Direction_Scattered_Lens_double_Lens_double_Lens_double_to_double_9b3b8049c1)(void *, Direction, Scattered_Lens_double_Lens_double_Lens_double);
typedef double (*Func_double_to_double_a0f1ef8045)(void *, double);
typedef Unit (*Func_String_to_Unit_b25b30ea0f)(void *, String);
typedef double (*Func_double_double_to_double_c4a74b6cb8)(void *, double, double);
typedef double (*Func_Lens_double_to_double_d0c43c87b3)(void *, Lens_double);
typedef bool (*Func_String_Scattered_Lens_double_Lens_double_Lens_double_to_bool_d9b8427e43)(void *, String, Scattered_Lens_double_Lens_double_Lens_double);
typedef Tuple_Tuple_Number_Number_Number_Number (*Func_to_Tuple_Tuple_Number_Number_Number_Number_ec56a17ec7)(void *);
typedef double (*Func_double_Scattered_Lens_double_Lens_double_Lens_double_to_double_ef93641c08)(void *, double, Scattered_Lens_double_Lens_double_Lens_double);
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Lens_double { double *read; Func_double_to_Unit_19aa1fe566 restore; void *context; };
struct Unit { unsigned char inhabitant; };
struct Lens_Tuple_Number_Number_Number { Tuple_Number_Number_Number *read; Func_Tuple_Number_Number_Number_to_Unit_29d831fc54 restore; void *context; };
struct Environment_Empty_74f5f28086 { unsigned char inhabitant; };
struct Scattered_Lens_double_Lens_double_Lens_double { Lens_double item0; Lens_double item1; Lens_double item2; Func_Tuple_Number_Number_Number_to_Unit_29d831fc54 restore; void *context; };
struct Tuple_Number_Number_Number { double item0; double item1; double item2; };
struct Tuple_Tuple_Number_Number_Number_Number { Tuple_Number_Number_Number item0; double item1; };
struct Lens_Unit_to_double { Unit *read; double *replacement; Func_double_to_Unit_19aa1fe566 restore; void *context; };
struct Direction { uint32_t tag; union { Unit v0; Unit v1; } as; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
laminar_string *string_new(const char *bytes, size_t length);
void string_drop(laminar_string *s);
laminar_string *string_dup(laminar_string *s);
_Bool string_equals(laminar_string *s, const char *bytes, size_t length);
void builder_bytes(string_builder *b, const char *bytes, size_t length);
void builder_string(string_builder *b, laminar_string *s);
void builder_bool(string_builder *b, _Bool value);
void builder_number(string_builder *b, double x);
laminar_string *builder_finish(string_builder *b);
void print_string(laminar_string *s);
double step(void *environment, double arg0, Scattered_Lens_double_Lens_double_Lens_double arg1);
Tuple_Tuple_Number_Number_Number_Number game(void *environment);
double nextGuess(void *environment, Direction arg0, Scattered_Lens_double_Lens_double_Lens_double arg1);
bool handleResponse(void *environment, String arg0, Scattered_Lens_double_Lens_double_Lens_double arg1);
Tuple_Tuple_Number_Number_Number_Number entry(void *environment);
String host_input_String(String value);
typedef struct { double read0; double read1; double read2; } Backing0;
typedef struct { double read0; double read1; double read2; } Backing1;
typedef struct { double read0; double read1; double read2; } Backing2;
double round_double(double value);
typedef struct { double read0; double read1; double read2; } Backing3;
typedef struct { double read0; double read1; double read2; } Backing4;
Unit host_print_Unit(String value);
void print_number(double x);
double step(void *environment, double arg0, Scattered_Lens_double_Lens_double_Lens_double arg1) {
    (void)environment;
    double v3 = *((arg1).item2).read;
    string_builder v5 = {0};
    builder_bytes(&v5, "My guess is ", 12);
    builder_number(&v5, v3);
    builder_bytes(&v5, " (higher/lower/match): ", 23);
    String v4 = builder_finish(&v5);
    String v6 = host_input_String(v4);
    Backing0 back0 = {0};
    back0.read0 = *((arg1).item0).read;
    back0.read1 = *((arg1).item1).read;
    back0.read2 = *((arg1).item2).read;
    Scattered_Lens_double_Lens_double_Lens_double v15 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back0.read0}, .item1=(Lens_double){.read=&back0.read1}, .item2=(Lens_double){.read=&back0.read2}};
    bool v14 = handleResponse(((Callable_Value_196fc0868a){0}).environment, v6, v15);
    Tuple_Number_Number_Number v16 = (Tuple_Number_Number_Number){*((v15).item0).read, *((v15).item1).read, *((v15).item2).read};
    double v19 = {0};
    double v33 = {0};
    double v34 = {0};
    double v35 = {0};
    if (v14 == 1) {
        v19 = arg0;
        v33 = (v16).item0;
        v34 = (v16).item1;
        v35 = (v16).item2;
    }
    else if (v14 == 0) {
        Backing1 back1 = {0};
        back1.read0 = (v16).item0;
        back1.read1 = (v16).item1;
        back1.read2 = (v16).item2;
        Scattered_Lens_double_Lens_double_Lens_double v31 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back1.read0}, .item1=(Lens_double){.read=&back1.read1}, .item2=(Lens_double){.read=&back1.read2}};
        double v30 = step(((Callable_Value_196fc0868a){0}).environment, (arg0 + 1), v31);
        Tuple_Number_Number_Number v32 = (Tuple_Number_Number_Number){*((v31).item0).read, *((v31).item1).read, *((v31).item2).read};
        v19 = v30;
        v33 = (v32).item0;
        v34 = (v32).item1;
        v35 = (v32).item2;
    }
    else {
        abort();
    }
    double v17 = v19;
    *((arg1).item0).read = v33;
    *((arg1).item1).read = v34;
    *((arg1).item2).read = v35;
    return v17;
}
Tuple_Tuple_Number_Number_Number_Number game(void *environment) {
    (void)environment;
    Tuple_Number_Number_Number v3 = (Tuple_Number_Number_Number){0, 100, 50};
    Backing2 back2 = {0};
    back2.read0 = (v3).item0;
    back2.read1 = (v3).item1;
    back2.read2 = (v3).item2;
    Scattered_Lens_double_Lens_double_Lens_double v9 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back2.read0}, .item1=(Lens_double){.read=&back2.read1}, .item2=(Lens_double){.read=&back2.read2}};
    double v8 = step(((Callable_Value_196fc0868a){0}).environment, 0, v9);
    Tuple_Number_Number_Number v10 = (Tuple_Number_Number_Number){*((v9).item0).read, *((v9).item1).read, *((v9).item2).read};
    return (Tuple_Tuple_Number_Number_Number_Number){v10, v8};
}
double nextGuess(void *environment, Direction arg0, Scattered_Lens_double_Lens_double_Lens_double arg1) {
    (void)environment;
    double v2 = {0};
    if ((arg0).tag == 0) {
        double v7 = *((arg1).item1).read;
        double v10 = *((arg1).item2).read;
        v2 = ((v7 + v10) / 2);
    }
    else if ((arg0).tag == 1) {
        double v18 = *((arg1).item2).read;
        double v21 = *((arg1).item0).read;
        v2 = ((v18 + v21) / 2);
    }
    else {
        abort();
    }
    double v25 = round_double(v2);
    *((arg1).item0).read = *((arg1).item0).read;
    *((arg1).item1).read = *((arg1).item1).read;
    *((arg1).item2).read = *((arg1).item2).read;
    return v25;
}
bool handleResponse(void *environment, String arg0, Scattered_Lens_double_Lens_double_Lens_double arg1) {
    (void)environment;
    bool v1 = {0};
    double v44 = {0};
    double v45 = {0};
    double v46 = {0};
    if (string_equals(arg0, "higher", 6)) {
        string_drop(arg0);
        Direction v4 = (Direction){.tag=0, .as.v0=(Unit){0}};
        Backing3 back3 = {0};
        back3.read0 = *((arg1).item0).read;
        back3.read1 = *((arg1).item1).read;
        back3.read2 = *((arg1).item2).read;
        Scattered_Lens_double_Lens_double_Lens_double v6 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back3.read0}, .item1=(Lens_double){.read=&back3.read1}, .item2=(Lens_double){.read=&back3.read2}};
        double v5 = nextGuess(((Callable_Value_196fc0868a){0}).environment, v4, v6);
        Tuple_Number_Number_Number v7 = (Tuple_Number_Number_Number){*((v6).item0).read, *((v6).item1).read, *((v6).item2).read};
        double v12 = (v7).item2;
        double v13 = (v7).item0;
        (void)v13;
        Unit v17 = {0};
        (void)v17;
        v1 = 0;
        v44 = v12;
        v45 = (v7).item1;
        v46 = v5;
    }
    else if (string_equals(arg0, "lower", 5)) {
        string_drop(arg0);
        Direction v22 = (Direction){.tag=1, .as.v1=(Unit){0}};
        Backing4 back4 = {0};
        back4.read0 = *((arg1).item0).read;
        back4.read1 = *((arg1).item1).read;
        back4.read2 = *((arg1).item2).read;
        Scattered_Lens_double_Lens_double_Lens_double v24 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back4.read0}, .item1=(Lens_double){.read=&back4.read1}, .item2=(Lens_double){.read=&back4.read2}};
        double v23 = nextGuess(((Callable_Value_196fc0868a){0}).environment, v22, v24);
        Tuple_Number_Number_Number v25 = (Tuple_Number_Number_Number){*((v24).item0).read, *((v24).item1).read, *((v24).item2).read};
        double v30 = (v25).item2;
        double v31 = (v25).item1;
        (void)v31;
        Unit v35 = {0};
        (void)v35;
        v1 = 0;
        v44 = (v25).item0;
        v45 = v30;
        v46 = v23;
    }
    else if (string_equals(arg0, "match", 5)) {
        string_drop(arg0);
        v1 = 1;
        v44 = *((arg1).item0).read;
        v45 = *((arg1).item1).read;
        v46 = *((arg1).item2).read;
    }
    else if (1) {
        string_drop(arg0);
        String v40 = string_new("I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'", 77);
        Unit v41 = host_print_Unit(v40);
        (void)v41;
        v1 = 0;
        v44 = *((arg1).item0).read;
        v45 = *((arg1).item1).read;
        v46 = *((arg1).item2).read;
    }
    else {
        abort();
    }
    *((arg1).item0).read = v44;
    *((arg1).item1).read = v45;
    *((arg1).item2).read = v46;
    return v1;
}
Tuple_Tuple_Number_Number_Number_Number entry(void *environment) {
    (void)environment;
    return game(((Callable_Value_196fc0868a){0}).environment);
}
String host_input_String(String value) {
    (void)value;
    if (value) {
        fwrite(value->bytes, 1, value->length, stdout);
    }
    fflush(stdout);
    string_drop(value);
    string_builder line = {0};
    int c;
    while ((c = getchar()) != EOF && c != 10) {
        char byte = (char)c;
        builder_bytes(&line, &byte, 1);
    }
    return builder_finish(&line);
}
double round_double(double value) {
    (void)value;
    double rounded = floor(value);
    if (value - rounded >= 0.5) {
        rounded += 1;
    }
    if (rounded == 0) {
        rounded = copysign(0.0, value);
    }
    return rounded;
}
Unit host_print_Unit(String value) {
    (void)value;
    if (value) {
        fwrite(value->bytes, 1, value->length, stdout);
    }
    putchar(10);
    string_drop(value);
    return (Unit){0};
}
laminar_string *string_new(const char *bytes, size_t length) {
    if (!length) {
        return NULL;
    }
    laminar_string *s = allocate_context(sizeof *s + length);
    s->length = length;
    memcpy(s->bytes, bytes, length);
    return s;
}
void string_drop(laminar_string *s) {
    if (s) {
        release_context(s);
    }
}
laminar_string *string_dup(laminar_string *s) {
    return s ? string_new((const char *)s->bytes, s->length) : NULL;
}
_Bool string_equals(laminar_string *s, const char *bytes, size_t length) {
    size_t n = s ? s->length : 0;
    return n == length && (!length || memcmp(s->bytes, bytes, length) == 0);
}
void builder_bytes(string_builder *b, const char *bytes, size_t length) {
    if (!length) {
        return;
    }
    if (b->length + length > b->capacity) {
        size_t capacity = b->capacity ? b->capacity : 16;
        while (capacity < b->length + length) {
            capacity *= 2;
        }
        unsigned char *grown = realloc(b->bytes, capacity);
        if (!grown) {
            abort();
        }
        b->bytes = grown;
        b->capacity = capacity;
    }
    memcpy(b->bytes + b->length, bytes, length);
    b->length += length;
}
void builder_string(string_builder *b, laminar_string *s) {
    if (s) {
        builder_bytes(b, (const char *)s->bytes, s->length);
        string_drop(s);
    }
}
void builder_bool(string_builder *b, _Bool value) {
    if (value) {
        builder_bytes(b, "true", 4);
    }
    else {
        builder_bytes(b, "false", 5);
    }
}
void builder_number(string_builder *b, double x) {
    if (isnan(x)) {
        builder_bytes(b, "NaN", 3);
        return;
    }
    if (x == 0) {
        builder_bytes(b, "0", 1);
        return;
    }
    if (x < 0) {
        builder_bytes(b, "-", 1);
        x = -x;
    }
    if (isinf(x)) {
        builder_bytes(b, "Infinity", 8);
        return;
    }
    char scientific[40];
    int precision = 1;
    for (; precision <= 17; precision++) {
        snprintf(scientific, sizeof scientific, "%.*e", precision - 1, x);
        if (strtod(scientific, NULL) == x) {
            break;
        }
    }
    char digits[20];
    int count = 0;
    const char *p = scientific;
    for (; *p && *p != 'e'; p++) {
        if (*p != '.') {
            digits[count++] = *p;
        }
    }
    int point = atoi(p + 1) + 1;
    while (count > 1 && digits[count - 1] == '0') {
        count--;
    }
    if (count <= point && point <= 21) {
        builder_bytes(b, digits, (size_t)count);
        for (int i = count; i < point; i++) {
            builder_bytes(b, "0", 1);
        }
    }
    else if (0 < point && point <= 21) {
        builder_bytes(b, digits, (size_t)point);
        builder_bytes(b, ".", 1);
        builder_bytes(b, digits + point, (size_t)(count - point));
    }
    else if (-6 < point && point <= 0) {
        builder_bytes(b, "0.", 2);
        for (int i = point; i < 0; i++) {
            builder_bytes(b, "0", 1);
        }
        builder_bytes(b, digits, (size_t)count);
    }
    else {
        builder_bytes(b, digits, 1);
        if (count > 1) {
            builder_bytes(b, ".", 1);
            builder_bytes(b, digits + 1, (size_t)(count - 1));
        }
        char exponent[16];
        int written = snprintf(exponent, sizeof exponent, "e%c%d", point > 0 ? 43 : 45, abs(point - 1));
        builder_bytes(b, exponent, (size_t)written);
    }
}
laminar_string *builder_finish(string_builder *b) {
    laminar_string *s = string_new((const char *)b->bytes, b->length);
    free(b->bytes);
    return s;
}
void print_string(laminar_string *s) {
    putchar(34);
    size_t n = s ? s->length : 0;
    for (size_t i = 0; i < n; i++) {
        unsigned char c = s->bytes[i];
        if (c == 34 || c == 92) {
            putchar(92);
            putchar(c);
        }
        else if (c < 32) {
            printf("\\u%04x", c);
        }
        else {
            putchar(c);
        }
    }
    putchar(34);
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
    Tuple_Tuple_Number_Number_Number_Number result0 = entry(NULL);
    (void)result0;
    putchar(30);
    putchar(91);
    putchar(91);
    print_number(((result0).item0).item0);
    putchar(44);
    print_number(((result0).item0).item1);
    putchar(44);
    print_number(((result0).item0).item2);
    putchar(93);
    putchar(44);
    print_number((result0).item1);
    putchar(93);
    putchar(10);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
