#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
typedef struct laminar_string { size_t length; unsigned char bytes[]; } laminar_string;
typedef struct { unsigned char *bytes; size_t length; size_t capacity; } string_builder;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Lens_Vector_Number Lens_Vector_Number;
typedef struct Unit Unit;
typedef laminar_string *String;
typedef struct Tuple_Number_Number_Number Tuple_Number_Number_Number;
typedef struct Vector_Number Vector_Number;
typedef Unit (*Func_Vector_Number_to_Unit_3a319c4be1)(void *, Vector_Number);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Lens_Vector_Number { Vector_Number *read; Func_Vector_Number_to_Unit_3a319c4be1 restore; void *context; };
struct Unit { unsigned char inhabitant; };
struct Tuple_Number_Number_Number { double item0; double item1; double item2; };
struct Vector_Number { double *elements; size_t length; size_t capacity; };
typedef struct { Vector_Number read0; } Backing_Vector_Number;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
laminar_string *string_new(const char *bytes, size_t length);
void string_drop(laminar_string *s);
void builder_bytes(string_builder *b, const char *bytes, size_t length);
void builder_number(string_builder *b, double x);
laminar_string *builder_finish(string_builder *b);
double height(void *environment);
Unit paintRows(void *environment, double y, Lens_Vector_Number bytes);
Unit paintRow(void *environment, double x, double y, Lens_Vector_Number bytes);
Unit putLE(void *environment, double at, double n, double count, Lens_Vector_Number bytes);
double width(void *environment);
Tuple_Number_Number_Number shade(void *environment, double n);
double headerBytes(void *environment);
Unit render(void *environment);
double pixelBytes(void *environment);
Unit header(void *environment, Lens_Vector_Number bytes);
double rowBytes(void *environment);
double limit(void *environment);
double paint(void *environment, double x, double y, Lens_Vector_Number bytes);
double escape(void *environment, double cr, double ci, double zr, double zi, double n);
Unit entry(void *environment);
double *vector_at_Vector_Number(Vector_Number value, double index);
double round_double(double value);
Vector_Number vector_array_Vector_Number(double length, double init);
Unit vector_writefile_Vector_Number(String path, Vector_Number value);
void vector_drop_Vector_Number(Vector_Number value);
Unit host_print_Unit(String value);
double height(void *environment) {
    (void)environment;
    return 120;
}
Unit paintRows(void *environment, double y, Lens_Vector_Number bytes) {
    (void)environment;
    double v4 = height(NULL);
    Unit v6 = {0};
    if (y >= v4) {
        v6 = (Unit){0};
    }
    else {
        paintRow(NULL, 0, y, bytes);
        v6 = paintRows(NULL, y + 1, bytes);
    }
    return v6;
}
Unit paintRow(void *environment, double x, double y, Lens_Vector_Number bytes) {
    (void)environment;
    double v4 = width(NULL);
    Unit v6 = {0};
    if (x >= v4) {
        v6 = (Unit){0};
    }
    else {
        paint(NULL, x, y, bytes);
        v6 = paintRow(NULL, x + 1, y, bytes);
    }
    return v6;
}
Unit putLE(void *environment, double at, double n, double count, Lens_Vector_Number bytes) {
    (void)environment;
    Unit v5 = {0};
    if (count == 0) {
        v5 = (Unit){0};
    }
    else {
        double *v12 = vector_at_Vector_Number(*bytes.read, at);
        *v12 = fmod(n, 256);
        v5 = putLE(NULL, at + 1, (n - (fmod(n, 256))) / 256, count - 1, bytes);
    }
    return v5;
}
double width(void *environment) {
    (void)environment;
    return 150;
}
Tuple_Number_Number_Number shade(void *environment, double n) {
    (void)environment;
    double v4 = limit(NULL);
    Tuple_Number_Number_Number v6 = {0};
    if (n >= v4) {
        v6 = (Tuple_Number_Number_Number){0, 0, 0};
    }
    else {
        double v15 = limit(NULL);
        double t = n / v15;
        double u = 1 - t;
        double v43 = round_double(8.5 * u * u * u * t * 255);
        double v65 = round_double(15 * u * u * t * t * 255);
        double v87 = round_double(9 * u * t * t * t * 255);
        v6 = (Tuple_Number_Number_Number){v43, v65, v87};
    }
    return v6;
}
double headerBytes(void *environment) {
    (void)environment;
    return 54;
}
Unit render(void *environment) {
    (void)environment;
    double v3 = headerBytes(NULL);
    double v5 = pixelBytes(NULL);
    Vector_Number bytes = vector_array_Vector_Number(v3 + v5, 0);
    Backing_Vector_Number back0 = {0};
    back0.read0 = bytes;
    Lens_Vector_Number v12 = (Lens_Vector_Number){.read=&back0.read0};
    header(NULL, v12);
    Lens_Vector_Number v18 = (Lens_Vector_Number){.read=&back0.read0};
    paintRows(NULL, 0, v18);
    String v21 = string_new("mandelbrot.bmp", 14);
    Vector_Number bytes_2 = back0.read0;
    vector_writefile_Vector_Number(v21, bytes_2);
    double v26 = width(NULL);
    double v28 = height(NULL);
    string_builder v30 = {0};
    builder_bytes(&v30, "wrote mandelbrot.bmp, ", 22);
    builder_number(&v30, v26);
    builder_bytes(&v30, " x ", 3);
    builder_number(&v30, v28);
    builder_bytes(&v30, "", 0);
    String v29 = builder_finish(&v30);
    return host_print_Unit(v29);
}
double pixelBytes(void *environment) {
    (void)environment;
    double v2 = rowBytes(NULL);
    double v4 = height(NULL);
    return v2 * v4;
}
Unit header(void *environment, Lens_Vector_Number bytes) {
    (void)environment;
    double *v4 = vector_at_Vector_Number(*bytes.read, 0);
    *v4 = 66;
    double *v12 = vector_at_Vector_Number(*bytes.read, 1);
    *v12 = 77;
    double v21 = headerBytes(NULL);
    double v23 = pixelBytes(NULL);
    putLE(NULL, 2, v21 + v23, 4, bytes);
    double v32 = headerBytes(NULL);
    putLE(NULL, 10, v32, 4, bytes);
    putLE(NULL, 14, 40, 4, bytes);
    double v47 = width(NULL);
    putLE(NULL, 18, v47, 4, bytes);
    double v55 = height(NULL);
    putLE(NULL, 22, v55, 4, bytes);
    putLE(NULL, 26, 1, 2, bytes);
    putLE(NULL, 28, 24, 2, bytes);
    double v77 = pixelBytes(NULL);
    putLE(NULL, 34, v77, 4, bytes);
    putLE(NULL, 38, 2835, 4, bytes);
    return putLE(NULL, 42, 2835, 4, bytes);
}
double rowBytes(void *environment) {
    (void)environment;
    double v3 = width(NULL);
    double v12 = width(NULL);
    return v3 * 3 + (fmod(4 - (fmod(v12 * 3, 4)), 4));
}
double limit(void *environment) {
    (void)environment;
    return 60;
}
double paint(void *environment, double x, double y, Lens_Vector_Number bytes) {
    (void)environment;
    double v7 = width(NULL);
    double v20 = height(NULL);
    double v33 = escape(NULL, x * (3 / v7) - 2.1, 1.2 - y * (2.4 / v20), 0, 0, 0);
    Tuple_Number_Number_Number v34 = shade(NULL, v33);
    double v39 = headerBytes(NULL);
    double v44 = height(NULL);
    double v51 = rowBytes(NULL);
    double at = v39 + (v44 - 1 - y) * v51 + x * 3;
    double *v65 = vector_at_Vector_Number(*bytes.read, at);
    double blue = v34.item0;
    *v65 = blue;
    double *v78 = vector_at_Vector_Number(*bytes.read, at + 1);
    double green = v34.item1;
    *v78 = green;
    double *v91 = vector_at_Vector_Number(*bytes.read, at + 2);
    double red = v34.item2;
    double v94 = (*v91);
    *v91 = red;
    return v94;
}
double escape(void *environment, double cr, double ci, double zr, double zi, double n) {
    (void)environment;
    double v4 = limit(NULL);
    bool v6 = false;
    if (n >= v4) {
        v6 = true;
    }
    else {
        v6 = zr * zr + zi * zi > 4;
    }
    double v25 = 0;
    if (v6) {
        v25 = n;
    }
    else {
        v25 = escape(NULL, cr, ci, zr * zr - zi * zi + cr, 2 * zr * zi + ci, n + 1);
    }
    return v25;
}
Unit entry(void *environment) {
    (void)environment;
    return render(NULL);
}
double *vector_at_Vector_Number(Vector_Number value, double index) {
    if (!(index >= 0) || index != floor(index) || index >= (double)value.length) {
        abort();
    }
    return &value.elements[(size_t)index];
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
void vector_drop_Vector_Number(Vector_Number value) {
    if (value.elements) {
        release_context(value.elements);
    }
}
Unit vector_writefile_Vector_Number(String path, Vector_Number value) {
    char name[4096];
    if (!path || path->length >= sizeof name) {
        abort();
    }
    memcpy(name, path->bytes, path->length);
    name[path->length] = 0;
    unsigned char *packed = malloc(value.length ? value.length : 1);
    if (!packed) {
        abort();
    }
    for (size_t i = 0; i < value.length; i++) {
        double byte = value.elements[i];
        if (!(byte >= 0 && byte < 256 && byte == floor(byte))) {
            abort();
        }
        packed[i] = (unsigned char)byte;
    }
    FILE *file = fopen(name, "wb");
    if (!file) {
        abort();
    }
    size_t written = fwrite(packed, 1, value.length, file);
    if (fclose(file) != 0 || written != value.length) {
        abort();
    }
    free(packed);
    string_drop(path);
    vector_drop_Vector_Number(value);
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
int main(void) {
    Unit result0 = entry(NULL);
    (void)result0;
    putchar('\x1e');
    fputs("null", stdout);
    putchar('\n');
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
