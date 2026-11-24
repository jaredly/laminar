#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
typedef struct laminar_string { size_t length; unsigned char bytes[]; } laminar_string;
typedef struct { unsigned char *bytes; size_t length; size_t capacity; } string_builder;
typedef struct Tuple_Number_Number_Number Tuple_Number_Number_Number;
typedef struct Unit Unit;
typedef struct List_Tuple_Number_Number_Number List_Tuple_Number_Number_Number;
typedef struct Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef laminar_string *String;
typedef struct Lens_Vector_String Lens_Vector_String;
typedef struct Vector_String Vector_String;
typedef Unit (*Func_Vector_String_to_Unit_09e3a1fcde)(void *, Vector_String);
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Tuple_Number_Number_Number { double item0; double item1; double item2; };
struct Unit { unsigned char inhabitant; };
enum { List_Tuple_Number_Number_Number_nil = 0, List_Tuple_Number_Number_Number_cons = 1 };
struct List_Tuple_Number_Number_Number { uint32_t tag; union { Unit v0; Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v1; } as; };
struct Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number { Tuple_Number_Number_Number item0; List_Tuple_Number_Number_Number item1; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Lens_Vector_String { Vector_String *read; Func_Vector_String_to_Unit_09e3a1fcde restore; void *context; };
struct Vector_String { String *elements; size_t length; size_t capacity; };
typedef struct { Vector_String read0; } Backing_Vector_String;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
void retain_context(void *context);
_Bool unique_context(void *context);
laminar_string *string_new(const char *bytes, size_t length);
void string_drop(laminar_string *s);
laminar_string *string_share(laminar_string *s);
laminar_string *string_dup(laminar_string *s);
_Bool string_same(laminar_string *a, laminar_string *b);
_Bool string_equals(laminar_string *s, const char *bytes, size_t length);
void builder_bytes(string_builder *b, const char *bytes, size_t length);
void builder_string(string_builder *b, laminar_string *s);
laminar_string *builder_finish(string_builder *b);
void print_string(laminar_string *s);
String row(void *environment, double a, Lens_Vector_String board);
String lineOwner(void *environment, double a, double b, double c, Lens_Vector_String board);
Unit render(void *environment, Lens_Vector_String board);
String winner(void *environment, Lens_Vector_String board);
double parseSquare(void *environment, String input);
String game(void *environment);
String other(void *environment, String player);
String play(void *environment, String player, double turns, Lens_Vector_String board);
String winnerIn(void *environment, List_Tuple_Number_Number_Number lines, Lens_Vector_String board);
Unit takeTurn(void *environment, String player, Lens_Vector_String board);
String entry(void *environment);
String *vector_at_Vector_String(Vector_String value, double index);
_Bool equals_String(String left, String right);
Unit host_print_Unit(String value);
Vector_String vector_array_Vector_String(double length, String init);
void vector_drop_Vector_String(Vector_String value);
List_Tuple_Number_Number_Number share_List_Tuple_Number_Number_Number(List_Tuple_Number_Number_Number value);
Unit drop_List_Tuple_Number_Number_Number(List_Tuple_Number_Number_Number value);
String host_input_String(String value);
String row(void *environment, double a, Lens_Vector_String board) {
    (void)environment;
    String *v5 = vector_at_Vector_String(*board.read, a);
    String v7 = string_dup((*v5));
    String *v16 = vector_at_Vector_String(*board.read, a + 1);
    String v18 = string_dup((*v16));
    String *v27 = vector_at_Vector_String(*board.read, a + 2);
    String v29 = string_dup((*v27));
    string_builder v31 = {0};
    builder_bytes(&v31, "", 0);
    builder_string(&v31, v7);
    builder_bytes(&v31, " ", 1);
    builder_string(&v31, v18);
    builder_bytes(&v31, " ", 1);
    builder_string(&v31, v29);
    builder_bytes(&v31, "", 0);
    return builder_finish(&v31);
}
String lineOwner(void *environment, double a, double b, double c, Lens_Vector_String board) {
    (void)environment;
    String *v5 = vector_at_Vector_String(*board.read, a);
    String first = string_dup((*v5));
    String first_2 = string_share(first);
    String v11 = string_new(".", 1);
    bool v12 = (!equals_String(first_2, v11));
    bool v13 = false;
    if (v12) {
        String first_3 = string_share(first);
        String *v22 = vector_at_Vector_String(*board.read, b);
        String v24 = string_dup((*v22));
        v13 = equals_String(first_3, v24);
    }
    else {
        v13 = false;
    }
    bool v27 = false;
    if (v13) {
        String first_4 = string_share(first);
        String *v36 = vector_at_Vector_String(*board.read, c);
        String v38 = string_dup((*v36));
        v27 = equals_String(first_4, v38);
    }
    else {
        v27 = false;
    }
    String v41 = NULL;
    if (v27) {
        v41 = string_share(first);
    }
    else {
        v41 = string_new(".", 1);
    }
    string_drop(first);
    return v41;
}
Unit render(void *environment, Lens_Vector_String board) {
    (void)environment;
    String v4 = row(NULL, 0, board);
    host_print_Unit(v4);
    String v11 = row(NULL, 3, board);
    host_print_Unit(v11);
    String v18 = row(NULL, 6, board);
    return host_print_Unit(v18);
}
String winner(void *environment, Lens_Vector_String board) {
    (void)environment;
    Tuple_Number_Number_Number v5 = (Tuple_Number_Number_Number){0, 1, 2};
    Tuple_Number_Number_Number v9 = (Tuple_Number_Number_Number){3, 4, 5};
    Tuple_Number_Number_Number v13 = (Tuple_Number_Number_Number){6, 7, 8};
    Tuple_Number_Number_Number v17 = (Tuple_Number_Number_Number){0, 3, 6};
    Tuple_Number_Number_Number v21 = (Tuple_Number_Number_Number){1, 4, 7};
    Tuple_Number_Number_Number v25 = (Tuple_Number_Number_Number){2, 5, 8};
    Tuple_Number_Number_Number v29 = (Tuple_Number_Number_Number){0, 4, 8};
    Tuple_Number_Number_Number v33 = (Tuple_Number_Number_Number){2, 4, 6};
    List_Tuple_Number_Number_Number v34 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_nil, .as.v0=(Unit){0}};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v36 = allocate_context(sizeof *v36);
    *v36 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v33, v34};
    List_Tuple_Number_Number_Number v35 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v36};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v38 = allocate_context(sizeof *v38);
    *v38 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v29, v35};
    List_Tuple_Number_Number_Number v37 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v38};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v40 = allocate_context(sizeof *v40);
    *v40 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v25, v37};
    List_Tuple_Number_Number_Number v39 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v40};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v42 = allocate_context(sizeof *v42);
    *v42 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v21, v39};
    List_Tuple_Number_Number_Number v41 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v42};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v44 = allocate_context(sizeof *v44);
    *v44 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v17, v41};
    List_Tuple_Number_Number_Number v43 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v44};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v46 = allocate_context(sizeof *v46);
    *v46 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v13, v43};
    List_Tuple_Number_Number_Number v45 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v46};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v48 = allocate_context(sizeof *v48);
    *v48 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v9, v45};
    List_Tuple_Number_Number_Number v47 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v48};
    Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number *v50 = allocate_context(sizeof *v50);
    *v50 = (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){v5, v47};
    List_Tuple_Number_Number_Number v49 = (List_Tuple_Number_Number_Number){.tag=List_Tuple_Number_Number_Number_cons, .as.v1=v50};
    return winnerIn(NULL, v49, board);
}
double parseSquare(void *environment, String input) {
    (void)environment;
    String input_2 = string_share(input);
    double v2 = 0;
    if (string_equals(input_2, "1", 1)) {
        string_drop(input_2);
        v2 = 0;
    }
    else if (string_equals(input_2, "2", 1)) {
        string_drop(input_2);
        v2 = 1;
    }
    else if (string_equals(input_2, "3", 1)) {
        string_drop(input_2);
        v2 = 2;
    }
    else if (string_equals(input_2, "4", 1)) {
        string_drop(input_2);
        v2 = 3;
    }
    else if (string_equals(input_2, "5", 1)) {
        string_drop(input_2);
        v2 = 4;
    }
    else if (string_equals(input_2, "6", 1)) {
        string_drop(input_2);
        v2 = 5;
    }
    else if (string_equals(input_2, "7", 1)) {
        string_drop(input_2);
        v2 = 6;
    }
    else if (string_equals(input_2, "8", 1)) {
        string_drop(input_2);
        v2 = 7;
    }
    else if (string_equals(input_2, "9", 1)) {
        string_drop(input_2);
        v2 = 8;
    }
    else {
        string_drop(input_2);
        v2 = 9;
    }
    string_drop(input);
    return v2;
}
String game(void *environment) {
    (void)environment;
    String v2 = string_new(".", 1);
    Vector_String board = vector_array_Vector_String(9, v2);
    String v6 = string_new("X", 1);
    Backing_Vector_String back0 = {0};
    back0.read0 = board;
    Lens_Vector_String v9 = (Lens_Vector_String){.read=&back0.read0};
    String v8 = play(NULL, v6, 0, v9);
    vector_drop_Vector_String(back0.read0);
    return v8;
}
String other(void *environment, String player) {
    (void)environment;
    String player_2 = string_share(player);
    String v3 = string_new("X", 1);
    bool v4 = equals_String(player_2, v3);
    String v5 = NULL;
    if (v4) {
        v5 = string_new("O", 1);
    }
    else {
        v5 = string_new("X", 1);
    }
    string_drop(player);
    return v5;
}
String play(void *environment, String player, double turns, Lens_Vector_String board) {
    (void)environment;
    render(NULL, board);
    String v6 = winner(NULL, board);
    String v7 = NULL;
    if (string_equals(v6, ".", 1)) {
        string_drop(v6);
        String v13 = NULL;
        if (turns == 9) {
            v13 = string_new("draw", 4);
        }
        else {
            String player_2 = string_share(player);
            takeTurn(NULL, player_2, board);
            String player_3 = string_share(player);
            String v26 = other(NULL, player_3);
            v13 = play(NULL, v26, turns + 1, board);
        }
        v7 = v13;
    }
    else {
        String owner = string_share(v6);
        string_drop(v6);
        v7 = owner;
    }
    String v3 = v7;
    string_drop(player);
    return v3;
}
String winnerIn(void *environment, List_Tuple_Number_Number_Number lines, Lens_Vector_String board) {
    (void)environment;
    List_Tuple_Number_Number_Number lines_2 = share_List_Tuple_Number_Number_Number(lines);
    String v2 = NULL;
    switch (lines_2.tag) {
        case List_Tuple_Number_Number_Number_nil:
        {
            v2 = string_new(".", 1);
            break;
        }
        case List_Tuple_Number_Number_Number_cons:
        {
            Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number v4 = (unique_context(lines_2.as.v1) ? *lines_2.as.v1 : (Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number){(*lines_2.as.v1).item0, share_List_Tuple_Number_Number_Number((*lines_2.as.v1).item1)});
            release_context(lines_2.as.v1);
            double a = v4.item0.item0;
            double b = v4.item0.item1;
            double c = v4.item0.item2;
            String v13 = lineOwner(NULL, a, b, c, board);
            String v14 = NULL;
            if (string_equals(v13, ".", 1)) {
                string_drop(v13);
                List_Tuple_Number_Number_Number rest = share_List_Tuple_Number_Number_Number(v4.item1);
                v14 = winnerIn(NULL, rest, board);
            }
            else {
                String owner = string_share(v13);
                string_drop(v13);
                v14 = owner;
            }
            drop_List_Tuple_Number_Number_Number(v4.item1);
            v2 = v14;
            break;
        }
    }
    drop_List_Tuple_Number_Number_Number(lines);
    return v2;
}
Unit takeTurn(void *environment, String player, Lens_Vector_String board) {
    (void)environment;
    String player_2 = string_share(player);
    string_builder v4 = {0};
    builder_bytes(&v4, "", 0);
    builder_string(&v4, player_2);
    builder_bytes(&v4, ", pick a square (1-9): ", 23);
    String v3 = builder_finish(&v4);
    String input = host_input_String(v3);
    String input_2 = string_share(input);
    double square = parseSquare(NULL, input_2);
    Unit v15 = {0};
    if (square == 9) {
        String v17 = string_new("Please pick a number from 1 to 9.", 33);
        host_print_Unit(v17);
        String player_3 = string_share(player);
        v15 = takeTurn(NULL, player_3, board);
    }
    else {
        String *v31 = vector_at_Vector_String(*board.read, square);
        String v33 = string_dup((*v31));
        String v34 = string_new(".", 1);
        bool v35 = (!equals_String(v33, v34));
        Unit v36 = {0};
        if (v35) {
            String v38 = string_new("That square is taken.", 21);
            host_print_Unit(v38);
            String player_4 = string_share(player);
            v36 = takeTurn(NULL, player_4, board);
        }
        else {
            String *v51 = vector_at_Vector_String(*board.read, square);
            String player_5 = string_dup(player);
            String v54 = (*v51);
            *v51 = player_5;
            string_drop(v54);
            v36 = (Unit){0};
        }
        v15 = v36;
    }
    Unit v9 = v15;
    string_drop(input);
    string_drop(player);
    return v9;
}
String entry(void *environment) {
    (void)environment;
    return game(NULL);
}
String *vector_at_Vector_String(Vector_String value, double index) {
    if (!(index >= 0) || index != floor(index) || index >= (double)value.length) {
        abort();
    }
    return &value.elements[(size_t)index];
}
_Bool equals_String(String left, String right) {
    (void)left;
    (void)right;
    _Bool same = string_same(left, right);
    string_drop(left);
    string_drop(right);
    return same;
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
Vector_String vector_array_Vector_String(double length, String init) {
    if (!(length >= 0) || length != floor(length) || length > (double)(SIZE_MAX / sizeof init)) {
        abort();
    }
    Vector_String value = {0};
    if (length == 0) {
        string_drop(init);
        return value;
    }
    value.length = value.capacity = (size_t)length;
    value.elements = allocate_context(value.length * sizeof *value.elements);
    for (size_t i = 0; i + 1 < value.length; i++) {
        value.elements[i] = string_dup(init);
    }
    value.elements[value.length - 1] = init;
    return value;
}
void vector_drop_Vector_String(Vector_String value) {
    if (value.elements && unique_context(value.elements)) {
        for (size_t i = 0; i < value.length; i++) {
            string_drop(value.elements[i]);
        }
    }
    if (value.elements) {
        release_context(value.elements);
    }
}
List_Tuple_Number_Number_Number share_List_Tuple_Number_Number_Number(List_Tuple_Number_Number_Number value) {
    (void)value;
    if (value.tag == List_Tuple_Number_Number_Number_cons) {
        retain_context(value.as.v1);
    }
    return value;
}
Unit drop_List_Tuple_Number_Number_Number(List_Tuple_Number_Number_Number value) {
    (void)value;
    if (value.tag == List_Tuple_Number_Number_Number_cons) {
        if (unique_context(value.as.v1)) {
            drop_List_Tuple_Number_Number_Number((*value.as.v1).item1);
        }
        release_context(value.as.v1);
    }
    return (Unit){0};
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
laminar_string *string_dup(laminar_string *s) {
    return s ? string_new((const char *)s->bytes, s->length) : NULL;
}
_Bool string_same(laminar_string *a, laminar_string *b) {
    size_t n = a ? a->length : 0;
    return n == (b ? b->length : 0) && (!n || memcmp(a->bytes, b->bytes, n) == 0);
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
laminar_string *builder_finish(string_builder *b) {
    laminar_string *s = string_new((const char *)b->bytes, b->length);
    free(b->bytes);
    return s;
}
void print_string(laminar_string *s) {
    putchar('"');
    size_t n = s ? s->length : 0;
    for (size_t i = 0; i < n; i++) {
        unsigned char c = s->bytes[i];
        if (c == '"' || c == '\\') {
            putchar('\\');
            putchar(c);
        }
        else if (c < 32) {
            printf("\\u%04x", c);
        }
        else {
            putchar(c);
        }
    }
    putchar('"');
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
int main(void) {
    String result0 = entry(NULL);
    (void)result0;
    putchar('\x1e');
    print_string(result0);
    putchar('\n');
    string_drop(result0);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
