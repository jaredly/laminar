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
typedef struct Scattered_Lens_double_Lens_double_Lens_double Scattered_Lens_double_Lens_double_Lens_double;
typedef laminar_string *String;
typedef struct Tuple_Number_Number_Number Tuple_Number_Number_Number;
typedef struct Tuple_Tuple_Number_Number_Number_Number Tuple_Tuple_Number_Number_Number_Number;
typedef struct Direction Direction;
typedef Unit (*Func_double_to_Unit_19aa1fe566)(void *, double);
typedef Unit (*Func_Tuple_Number_Number_Number_to_Unit_29d831fc54)(void *, Tuple_Number_Number_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Lens_double { double *read; Func_double_to_Unit_19aa1fe566 restore; void *context; };
struct Unit { unsigned char inhabitant; };
struct Scattered_Lens_double_Lens_double_Lens_double { Lens_double item0; Lens_double item1; Lens_double item2; Func_Tuple_Number_Number_Number_to_Unit_29d831fc54 restore; void *context; };
struct Tuple_Number_Number_Number { double item0; double item1; double item2; };
struct Tuple_Tuple_Number_Number_Number_Number { Tuple_Number_Number_Number item0; double item1; };
enum { Direction_Higher = 0, Direction_Lower = 1 };
struct Direction { uint32_t tag; union { Unit v0; Unit v1; } as; };
typedef struct { double read0; double read1; double read2; } Backing_double_double_double;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
void retain_context(void *context);
laminar_string *string_new(const char *bytes, size_t length);
void string_drop(laminar_string *s);
laminar_string *string_share(laminar_string *s);
_Bool string_equals(laminar_string *s, const char *bytes, size_t length);
void builder_bytes(string_builder *b, const char *bytes, size_t length);
void builder_number(string_builder *b, double x);
laminar_string *builder_finish(string_builder *b);
Tuple_Tuple_Number_Number_Number_Number game(void *environment);
double step(void *environment, double steps, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess);
double nextGuess(void *environment, Direction direction, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess);
bool handleResponse(void *environment, String response, Scattered_Lens_double_Lens_double_Lens_double state);
Tuple_Tuple_Number_Number_Number_Number entry(void *environment);
String host_input_String(String value);
Direction share_Direction(Direction value);
double round_double(double value);
Unit drop_Direction(Direction value);
Unit host_print_Unit(String value);
void print_number(double x);
Tuple_Tuple_Number_Number_Number_Number game(void *environment) {
    (void)environment;
    Tuple_Number_Number_Number state = (Tuple_Number_Number_Number){0, 100, 50};
    Backing_double_double_double back0 = {0};
    back0.read0 = state.item0;
    back0.read1 = state.item1;
    back0.read2 = state.item2;
    Scattered_Lens_double_Lens_double_Lens_double v7 = (Scattered_Lens_double_Lens_double_Lens_double){.item0=(Lens_double){.read=&back0.read0}, .item1=(Lens_double){.read=&back0.read1}, .item2=(Lens_double){.read=&back0.read2}};
    double steps = step(NULL, 0, v7);
    Tuple_Number_Number_Number state_2 = (Tuple_Number_Number_Number){back0.read0, back0.read1, back0.read2};
    return (Tuple_Tuple_Number_Number_Number_Number){state_2, steps};
}
double step(void *environment, double steps, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess) {
    (void)environment;
    double lastGuess = *min_max_lastGuess.item2.read;
    string_builder v4 = {0};
    builder_bytes(&v4, "My guess is ", 12);
    builder_number(&v4, lastGuess);
    builder_bytes(&v4, " (higher/lower/match): ", 23);
    String v3 = builder_finish(&v4);
    String input = host_input_String(v3);
    String input_2 = string_share(input);
    bool next = handleResponse(NULL, input_2, min_max_lastGuess);
    double v16 = 0;
    if (next) {
        v16 = steps;
    }
    else {
        v16 = step(NULL, steps + 1, min_max_lastGuess);
    }
    double v13 = v16;
    string_drop(input);
    return v13;
}
double nextGuess(void *environment, Direction direction, Scattered_Lens_double_Lens_double_Lens_double min_max_lastGuess) {
    (void)environment;
    Direction direction_2 = share_Direction(direction);
    double v3 = 0;
    switch (direction_2.tag) {
        case Direction_Higher:
        {
            double max = *min_max_lastGuess.item1.read;
            double lastGuess = *min_max_lastGuess.item2.read;
            v3 = (max + lastGuess) / 2;
            break;
        }
        case Direction_Lower:
        {
            double lastGuess_2 = *min_max_lastGuess.item2.read;
            double min = *min_max_lastGuess.item0.read;
            v3 = (lastGuess_2 + min) / 2;
            break;
        }
    }
    double v22 = round_double(v3);
    drop_Direction(direction);
    return v22;
}
bool handleResponse(void *environment, String response, Scattered_Lens_double_Lens_double_Lens_double state) {
    (void)environment;
    String response_2 = string_share(response);
    bool v2 = false;
    double v35 = 0;
    double v36 = 0;
    double v37 = 0;
    if (string_equals(response_2, "higher", 6)) {
        string_drop(response_2);
        Direction v5 = (Direction){.tag=Direction_Higher, .as.v0=(Unit){0}};
        double next = nextGuess(NULL, v5, state);
        double last = *state.item2.read;
        v2 = false;
        v35 = last;
        v36 = *state.item1.read;
        v37 = next;
    }
    else if (string_equals(response_2, "lower", 5)) {
        string_drop(response_2);
        Direction v18 = (Direction){.tag=Direction_Lower, .as.v1=(Unit){0}};
        double next_2 = nextGuess(NULL, v18, state);
        double last_2 = *state.item2.read;
        v2 = false;
        v35 = *state.item0.read;
        v36 = last_2;
        v37 = next_2;
    }
    else if (string_equals(response_2, "match", 5)) {
        string_drop(response_2);
        v2 = true;
        v35 = *state.item0.read;
        v36 = *state.item1.read;
        v37 = *state.item2.read;
    }
    else {
        string_drop(response_2);
        String v31 = string_new("I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'", 77);
        host_print_Unit(v31);
        v2 = false;
        v35 = *state.item0.read;
        v36 = *state.item1.read;
        v37 = *state.item2.read;
    }
    string_drop(response);
    *state.item0.read = v35;
    *state.item1.read = v36;
    *state.item2.read = v37;
    return v2;
}
Tuple_Tuple_Number_Number_Number_Number entry(void *environment) {
    (void)environment;
    return game(NULL);
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
Direction share_Direction(Direction value) {
    (void)value;
    return value;
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
Unit drop_Direction(Direction value) {
    (void)value;
    return (Unit){0};
}
Unit host_print_Unit(String value) {
    (void)value;
    if (value) {
        fwrite(value->bytes, 1, value->length, stdout);
    }
    putchar('\n');
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
laminar_string *string_share(laminar_string *s) {
    if (s) {
        retain_context(s);
    }
    return s;
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
    Tuple_Tuple_Number_Number_Number_Number result0 = entry(NULL);
    (void)result0;
    putchar('\x1e');
    putchar('[');
    putchar('[');
    print_number(result0.item0.item0);
    putchar(',');
    print_number(result0.item0.item1);
    putchar(',');
    print_number(result0.item0.item2);
    putchar(']');
    putchar(',');
    print_number(result0.item1);
    putchar(']');
    putchar('\n');
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
