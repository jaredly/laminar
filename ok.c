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
double step(void *environment, double steps, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess);
Tuple_Tuple_Number_Number_Number_Number game(void *environment);
double nextGuess(void *environment, Direction direction, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess);
bool handleResponse(void *environment, String response, Scattered_Lens_double_Lens_double_Lens_double state);
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
double step(void *environment, double steps, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess) {
    (void)environment;
    double lastGuess = *((min_max_lastGuess).item2).read;
    string_builder v4 = {0};
    builder_bytes(&v4, "My guess is ", 12);
    builder_number(&v4, lastGuess);
    builder_bytes(&v4, " (higher/lower/match): ", 23);
    String v3 = builder_finish(&v4);
    String input = host_input_String(v3);
    Backing0 back0 = {0};
    back0.read0 = *((min_max_lastGuess).item0).read;
    back0.read1 = *((min_max_lastGuess).item1).read;
    back0.read2 = *((min_max_lastGuess).item2).read;
    Scattered_Lens_double_Lens_double_Lens_double v11 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back0.read0}, .item1=(Lens_double){.read=&back0.read1}, .item2=(Lens_double){.read=&back0.read2}};
    bool next = handleResponse(((Callable_Value_196fc0868a){0}).environment, input, v11);
    Tuple_Number_Number_Number v12 = (Tuple_Number_Number_Number){*((v11).item0).read, *((v11).item1).read, *((v11).item2).read};
    double v14 = {0};
    double v26 = {0};
    double v27 = {0};
    double v28 = {0};
    if (next == 1) {
        v14 = steps;
        v26 = (v12).item0;
        v27 = (v12).item1;
        v28 = (v12).item2;
    }
    else if (next == 0) {
        Backing1 back1 = {0};
        back1.read0 = (v12).item0;
        back1.read1 = (v12).item1;
        back1.read2 = (v12).item2;
        Scattered_Lens_double_Lens_double_Lens_double v24 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back1.read0}, .item1=(Lens_double){.read=&back1.read1}, .item2=(Lens_double){.read=&back1.read2}};
        double v23 = step(((Callable_Value_196fc0868a){0}).environment, (steps + 1), v24);
        Tuple_Number_Number_Number v25 = (Tuple_Number_Number_Number){*((v24).item0).read, *((v24).item1).read, *((v24).item2).read};
        v14 = v23;
        v26 = (v25).item0;
        v27 = (v25).item1;
        v28 = (v25).item2;
    }
    else {
        abort();
    }
    double v13 = v14;
    *((min_max_lastGuess).item0).read = v26;
    *((min_max_lastGuess).item1).read = v27;
    *((min_max_lastGuess).item2).read = v28;
    return v13;
}
Tuple_Tuple_Number_Number_Number_Number game(void *environment) {
    (void)environment;
    Tuple_Number_Number_Number state = (Tuple_Number_Number_Number){0, 100, 50};
    Backing2 back2 = {0};
    back2.read0 = (state).item0;
    back2.read1 = (state).item1;
    back2.read2 = (state).item2;
    Scattered_Lens_double_Lens_double_Lens_double v7 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back2.read0}, .item1=(Lens_double){.read=&back2.read1}, .item2=(Lens_double){.read=&back2.read2}};
    double steps = step(((Callable_Value_196fc0868a){0}).environment, 0, v7);
    Tuple_Number_Number_Number v8 = (Tuple_Number_Number_Number){*((v7).item0).read, *((v7).item1).read, *((v7).item2).read};
    return (Tuple_Tuple_Number_Number_Number_Number){v8, steps};
}
double nextGuess(void *environment, Direction direction, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess) {
    (void)environment;
    double v1 = {0};
    if ((direction).tag == 0) {
        double max = *((min_max_lastGuess).item1).read;
        double lastGuess = *((min_max_lastGuess).item2).read;
        v1 = ((max + lastGuess) / 2);
    }
    else if ((direction).tag == 1) {
        double lastGuess_2 = *((min_max_lastGuess).item2).read;
        double min = *((min_max_lastGuess).item0).read;
        v1 = ((lastGuess_2 + min) / 2);
    }
    else {
        abort();
    }
    return round_double(v1);
}
bool handleResponse(void *environment, String response, Scattered_Lens_double_Lens_double_Lens_double state) {
    (void)environment;
    bool v0 = {0};
    double v37 = {0};
    double v38 = {0};
    double v39 = {0};
    if (string_equals(response, "higher", 6)) {
        string_drop(response);
        Direction v3 = (Direction){.tag=0, .as.v0=(Unit){0}};
        Backing3 back3 = {0};
        back3.read0 = *((state).item0).read;
        back3.read1 = *((state).item1).read;
        back3.read2 = *((state).item2).read;
        Scattered_Lens_double_Lens_double_Lens_double v4 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back3.read0}, .item1=(Lens_double){.read=&back3.read1}, .item2=(Lens_double){.read=&back3.read2}};
        double next = nextGuess(((Callable_Value_196fc0868a){0}).environment, v3, v4);
        Tuple_Number_Number_Number v5 = (Tuple_Number_Number_Number){*((v4).item0).read, *((v4).item1).read, *((v4).item2).read};
        double last = (v5).item2;
        double v10 = (v5).item0;
        (void)v10;
        Unit v13 = {0};
        (void)v13;
        v0 = 0;
        v37 = last;
        v38 = (v5).item1;
        v39 = next;
    }
    else if (string_equals(response, "lower", 5)) {
        string_drop(response);
        Direction v18 = (Direction){.tag=1, .as.v1=(Unit){0}};
        Backing4 back4 = {0};
        back4.read0 = *((state).item0).read;
        back4.read1 = *((state).item1).read;
        back4.read2 = *((state).item2).read;
        Scattered_Lens_double_Lens_double_Lens_double v19 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back4.read0}, .item1=(Lens_double){.read=&back4.read1}, .item2=(Lens_double){.read=&back4.read2}};
        double next_2 = nextGuess(((Callable_Value_196fc0868a){0}).environment, v18, v19);
        Tuple_Number_Number_Number v20 = (Tuple_Number_Number_Number){*((v19).item0).read, *((v19).item1).read, *((v19).item2).read};
        double last_2 = (v20).item2;
        double v25 = (v20).item1;
        (void)v25;
        Unit v28 = {0};
        (void)v28;
        v0 = 0;
        v37 = (v20).item0;
        v38 = last_2;
        v39 = next_2;
    }
    else if (string_equals(response, "match", 5)) {
        string_drop(response);
        v0 = 1;
        v37 = *((state).item0).read;
        v38 = *((state).item1).read;
        v39 = *((state).item2).read;
    }
    else if (1) {
        string_drop(response);
        String v33 = string_new("I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'", 77);
        Unit v34 = host_print_Unit(v33);
        (void)v34;
        v0 = 0;
        v37 = *((state).item0).read;
        v38 = *((state).item1).read;
        v39 = *((state).item2).read;
    }
    else {
        abort();
    }
    *((state).item0).read = v37;
    *((state).item1).read = v38;
    *((state).item2).read = v39;
    return v0;
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
