#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>
#include <time.h>
#include <string.h>
typedef struct laminar_string { size_t length; unsigned char bytes[]; } laminar_string;
typedef struct { unsigned char *bytes; size_t length; size_t capacity; } string_builder;
typedef struct Unit Unit;
typedef struct Direction Direction;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef laminar_string *String;
typedef struct Tuple_String_Direction Tuple_String_Direction;
typedef struct List_Tuple_Number_Number List_Tuple_Number_Number;
typedef struct Tuple_Number_Number Tuple_Number_Number;
typedef struct Tuple_Tuple_Number_Number_List_Tuple_Number_Number Tuple_Tuple_Number_Number_List_Tuple_Number_Number;
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
struct Unit { unsigned char inhabitant; };
enum { Direction_Up = 0, Direction_Down = 1, Direction_Left = 2, Direction_Right = 3 };
struct Direction { uint32_t tag; union { Unit v0; Unit v1; Unit v2; Unit v3; } as; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Tuple_String_Direction { String item0; Direction item1; };
enum { List_Tuple_Number_Number_nil = 0, List_Tuple_Number_Number_cons = 1 };
struct List_Tuple_Number_Number { uint32_t tag; union { Unit v0; Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v1; } as; };
struct Tuple_Number_Number { double item0; double item1; };
struct Tuple_Tuple_Number_Number_List_Tuple_Number_Number { Tuple_Number_Number item0; List_Tuple_Number_Number item1; };
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
void retain_context(void *context);
_Bool unique_context(void *context);
laminar_string *string_new(const char *bytes, size_t length);
void string_drop(laminar_string *s);
laminar_string *string_share(laminar_string *s);
_Bool string_same(laminar_string *a, laminar_string *b);
_Bool string_equals(laminar_string *s, const char *bytes, size_t length);
void builder_bytes(string_builder *b, const char *bytes, size_t length);
void builder_string(string_builder *b, laminar_string *s);
void builder_number(string_builder *b, double x);
laminar_string *builder_finish(string_builder *b);
double game(void *environment);
double height(void *environment);
Tuple_Number_Number placeFood(void *environment, List_Tuple_Number_Number body);
bool contains(void *environment, List_Tuple_Number_Number body, Tuple_Number_Number spot);
String rowText(void *environment, double x, double y, List_Tuple_Number_Number body, Tuple_Number_Number food);
double play(void *environment, List_Tuple_Number_Number body, Direction dir, Tuple_Number_Number food, double score);
Tuple_Number_Number step(void *environment, Tuple_Number_Number spot, Direction dir);
double width(void *environment);
List_Tuple_Number_Number dropLast(void *environment, List_Tuple_Number_Number body);
bool crashed(void *environment, Tuple_Number_Number head, List_Tuple_Number_Number body);
String cell_2(void *environment, Tuple_Number_Number spot, List_Tuple_Number_Number body, Tuple_Number_Number food);
Direction turn(void *environment, Direction dir, String key);
Unit render(void *environment, List_Tuple_Number_Number body, Tuple_Number_Number food, double score);
Unit drawRows(void *environment, double y, List_Tuple_Number_Number body, Tuple_Number_Number food);
double entry(void *environment);
List_Tuple_Number_Number share_List_Tuple_Number_Number(List_Tuple_Number_Number value);
Unit host_print_Unit(String value);
Unit drop_List_Tuple_Number_Number(List_Tuple_Number_Number value);
double host_random_double(double value);
_Bool equals_Tuple_Number_Number(Tuple_Number_Number left, Tuple_Number_Number right);
_Bool equal_Tuple_Number_Number(Tuple_Number_Number left, Tuple_Number_Number right);
String host_key_String(double value);
_Bool equals_String(String left, String right);
Direction share_Direction(Direction value);
Unit drop_Direction(Direction value);
Unit host_write_Unit(String value);
void print_number(double x);
double game(void *environment) {
    (void)environment;
    Tuple_Number_Number v2 = (Tuple_Number_Number){5, 5};
    Tuple_Number_Number v5 = (Tuple_Number_Number){4, 5};
    Tuple_Number_Number v8 = (Tuple_Number_Number){3, 5};
    List_Tuple_Number_Number v9 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_nil, .as.v0=(Unit){0}};
    Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v11 = allocate_context(sizeof *v11);
    *v11 = (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){v8, v9};
    List_Tuple_Number_Number v10 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_cons, .as.v1=v11};
    Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v13 = allocate_context(sizeof *v13);
    *v13 = (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){v5, v10};
    List_Tuple_Number_Number v12 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_cons, .as.v1=v13};
    Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v14 = allocate_context(sizeof *v14);
    *v14 = (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){v2, v12};
    List_Tuple_Number_Number body = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_cons, .as.v1=v14};
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    Direction v19 = (Direction){.tag=Direction_Right, .as.v3=(Unit){0}};
    List_Tuple_Number_Number body_3 = share_List_Tuple_Number_Number(body);
    Tuple_Number_Number v23 = placeFood(NULL, body_3);
    double score = play(NULL, body_2, v19, v23, 0);
    string_builder v30 = {0};
    builder_bytes(&v30, "game over, score ", 17);
    builder_number(&v30, score);
    builder_bytes(&v30, "", 0);
    String v29 = builder_finish(&v30);
    host_print_Unit(v29);
    drop_List_Tuple_Number_Number(body);
    return score;
}
double height(void *environment) {
    (void)environment;
    return 10;
}
Tuple_Number_Number placeFood(void *environment, List_Tuple_Number_Number body) {
    (void)environment;
    double v2 = width(NULL);
    double v3 = host_random_double(v2);
    double v6 = height(NULL);
    double v7 = host_random_double(v6);
    Tuple_Number_Number spot = (Tuple_Number_Number){v3, v7};
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    bool v14 = contains(NULL, body_2, spot);
    Tuple_Number_Number v15 = {0};
    if (v14) {
        List_Tuple_Number_Number body_3 = share_List_Tuple_Number_Number(body);
        v15 = placeFood(NULL, body_3);
    }
    else {
        v15 = spot;
    }
    Tuple_Number_Number v8 = v15;
    drop_List_Tuple_Number_Number(body);
    return v8;
}
bool contains(void *environment, List_Tuple_Number_Number body, Tuple_Number_Number spot) {
    (void)environment;
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    bool v2 = false;
    switch (body_2.tag) {
        case List_Tuple_Number_Number_nil:
        {
            v2 = false;
            break;
        }
        case List_Tuple_Number_Number_cons:
        {
            Tuple_Tuple_Number_Number_List_Tuple_Number_Number v4 = (unique_context(body_2.as.v1) ? *body_2.as.v1 : (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){(*body_2.as.v1).item0, share_List_Tuple_Number_Number((*body_2.as.v1).item1)});
            release_context(body_2.as.v1);
            Tuple_Number_Number segment = v4.item0;
            bool v10 = equals_Tuple_Number_Number(segment, spot);
            bool v11 = false;
            if (v10) {
                v11 = true;
            }
            else {
                List_Tuple_Number_Number rest = share_List_Tuple_Number_Number(v4.item1);
                v11 = contains(NULL, rest, spot);
            }
            drop_List_Tuple_Number_Number(v4.item1);
            v2 = v11;
            break;
        }
    }
    drop_List_Tuple_Number_Number(body);
    return v2;
}
String rowText(void *environment, double x, double y, List_Tuple_Number_Number body, Tuple_Number_Number food) {
    (void)environment;
    double v4 = width(NULL);
    String v6 = NULL;
    if (x >= v4) {
        v6 = string_new("", 0);
    }
    else {
        Tuple_Number_Number v13 = (Tuple_Number_Number){x, y};
        List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
        String v18 = cell_2(NULL, v13, body_2, food);
        List_Tuple_Number_Number body_3 = share_List_Tuple_Number_Number(body);
        String v31 = rowText(NULL, x + 1, y, body_3, food);
        string_builder v33 = {0};
        builder_bytes(&v33, "", 0);
        builder_string(&v33, v18);
        builder_bytes(&v33, "", 0);
        builder_string(&v33, v31);
        builder_bytes(&v33, "", 0);
        v6 = builder_finish(&v33);
    }
    drop_List_Tuple_Number_Number(body);
    return v6;
}
double play(void *environment, List_Tuple_Number_Number body, Direction dir, Tuple_Number_Number food, double score) {
    (void)environment;
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    render(NULL, body_2, food, score);
    String key = host_key_String(150);
    String key_2 = string_share(key);
    String v15 = string_new("q", 1);
    bool v16 = equals_String(key_2, v15);
    double v17 = 0;
    if (v16) {
        v17 = score;
    }
    else {
        Direction dir_3 = share_Direction(dir);
        String key_3 = string_share(key);
        Direction dir_2 = turn(NULL, dir_3, key_3);
        List_Tuple_Number_Number body_3 = share_List_Tuple_Number_Number(body);
        double v28 = 0;
        switch (body_3.tag) {
            case List_Tuple_Number_Number_nil:
            {
                v28 = score;
                break;
            }
            case List_Tuple_Number_Number_cons:
            {
                Tuple_Tuple_Number_Number_List_Tuple_Number_Number v31 = (unique_context(body_3.as.v1) ? *body_3.as.v1 : (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){(*body_3.as.v1).item0, share_List_Tuple_Number_Number((*body_3.as.v1).item1)});
                release_context(body_3.as.v1);
                drop_List_Tuple_Number_Number(v31.item1);
                Tuple_Number_Number head = v31.item0;
                Direction dir_2_2 = share_Direction(dir_2);
                Tuple_Number_Number next = step(NULL, head, dir_2_2);
                List_Tuple_Number_Number body_4 = share_List_Tuple_Number_Number(body);
                bool v43 = crashed(NULL, next, body_4);
                double v44 = 0;
                if (v43) {
                    v44 = score;
                }
                else {
                    bool v52 = equals_Tuple_Number_Number(next, food);
                    double v53 = 0;
                    if (v52) {
                        List_Tuple_Number_Number body_5 = share_List_Tuple_Number_Number(body);
                        Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v58 = allocate_context(sizeof *v58);
                        *v58 = (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){next, body_5};
                        List_Tuple_Number_Number grown = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_cons, .as.v1=v58};
                        List_Tuple_Number_Number grown_2 = share_List_Tuple_Number_Number(grown);
                        Direction dir_2_3 = share_Direction(dir_2);
                        List_Tuple_Number_Number grown_3 = share_List_Tuple_Number_Number(grown);
                        Tuple_Number_Number v68 = placeFood(NULL, grown_3);
                        double v74 = play(NULL, grown_2, dir_2_3, v68, score + 1);
                        drop_List_Tuple_Number_Number(grown);
                        v53 = v74;
                    }
                    else {
                        List_Tuple_Number_Number body_6 = share_List_Tuple_Number_Number(body);
                        List_Tuple_Number_Number v81 = dropLast(NULL, body_6);
                        Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v83 = allocate_context(sizeof *v83);
                        *v83 = (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){next, v81};
                        List_Tuple_Number_Number v82 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_cons, .as.v1=v83};
                        Direction dir_2_4 = share_Direction(dir_2);
                        v53 = play(NULL, v82, dir_2_4, food, score);
                    }
                    v44 = v53;
                }
                v28 = v44;
                break;
            }
        }
        drop_Direction(dir_2);
        v17 = v28;
    }
    string_drop(key);
    double v11 = v17;
    drop_List_Tuple_Number_Number(body);
    drop_Direction(dir);
    return v11;
}
Tuple_Number_Number step(void *environment, Tuple_Number_Number spot, Direction dir) {
    (void)environment;
    Direction dir_2 = share_Direction(dir);
    Tuple_Number_Number v5 = {0};
    switch (dir_2.tag) {
        case Direction_Up:
        {
            double x = spot.item0;
            double y = spot.item1;
            v5 = (Tuple_Number_Number){x, y - 1};
            break;
        }
        case Direction_Down:
        {
            double x_2 = spot.item0;
            double y_2 = spot.item1;
            v5 = (Tuple_Number_Number){x_2, y_2 + 1};
            break;
        }
        case Direction_Left:
        {
            double x_3 = spot.item0;
            double y_3 = spot.item1;
            v5 = (Tuple_Number_Number){x_3 - 1, y_3};
            break;
        }
        case Direction_Right:
        {
            double x_4 = spot.item0;
            double y_4 = spot.item1;
            v5 = (Tuple_Number_Number){x_4 + 1, y_4};
            break;
        }
    }
    Tuple_Number_Number v2 = v5;
    drop_Direction(dir);
    return v2;
}
double width(void *environment) {
    (void)environment;
    return 20;
}
List_Tuple_Number_Number dropLast(void *environment, List_Tuple_Number_Number body) {
    (void)environment;
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    List_Tuple_Number_Number v2 = {0};
    if (body_2.tag == List_Tuple_Number_Number_nil) {
        v2 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_nil, .as.v0=(Unit){0}};
    }
    else if (body_2.tag == List_Tuple_Number_Number_cons && (*body_2.as.v1).item1.tag == List_Tuple_Number_Number_nil) {
        Tuple_Tuple_Number_Number_List_Tuple_Number_Number v4 = (unique_context(body_2.as.v1) ? *body_2.as.v1 : (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){(*body_2.as.v1).item0, share_List_Tuple_Number_Number((*body_2.as.v1).item1)});
        (void)v4;
        release_context(body_2.as.v1);
        v2 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_nil, .as.v0=(Unit){0}};
    }
    else if (body_2.tag == List_Tuple_Number_Number_cons) {
        Tuple_Tuple_Number_Number_List_Tuple_Number_Number v6 = (unique_context(body_2.as.v1) ? *body_2.as.v1 : (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){(*body_2.as.v1).item0, share_List_Tuple_Number_Number((*body_2.as.v1).item1)});
        release_context(body_2.as.v1);
        Tuple_Number_Number segment = v6.item0;
        List_Tuple_Number_Number rest = share_List_Tuple_Number_Number(v6.item1);
        List_Tuple_Number_Number v12 = dropLast(NULL, rest);
        Tuple_Tuple_Number_Number_List_Tuple_Number_Number *v14 = allocate_context(sizeof *v14);
        *v14 = (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){segment, v12};
        List_Tuple_Number_Number v13 = (List_Tuple_Number_Number){.tag=List_Tuple_Number_Number_cons, .as.v1=v14};
        drop_List_Tuple_Number_Number(v6.item1);
        v2 = v13;
    }
    else {
        abort();
    }
    drop_List_Tuple_Number_Number(body);
    return v2;
}
bool crashed(void *environment, Tuple_Number_Number head, List_Tuple_Number_Number body) {
    (void)environment;
    double x = head.item0;
    bool v8 = false;
    if (x < 0) {
        v8 = true;
    }
    else {
        double x_2 = head.item0;
        double v14 = width(NULL);
        v8 = x_2 >= v14;
    }
    bool v16 = false;
    if (v8) {
        v16 = true;
    }
    else {
        double y = head.item1;
        v16 = y < 0;
    }
    bool v23 = false;
    if (v16) {
        v23 = true;
    }
    else {
        double y_2 = head.item1;
        double v29 = height(NULL);
        v23 = y_2 >= v29;
    }
    bool v31 = false;
    if (v23) {
        v31 = true;
    }
    else {
        List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
        v31 = contains(NULL, body_2, head);
    }
    bool v2 = v31;
    drop_List_Tuple_Number_Number(body);
    return v2;
}
String cell_2(void *environment, Tuple_Number_Number spot, List_Tuple_Number_Number body, Tuple_Number_Number food) {
    (void)environment;
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    String v2 = NULL;
    switch (body_2.tag) {
        case List_Tuple_Number_Number_cons:
        {
            Tuple_Tuple_Number_Number_List_Tuple_Number_Number v3 = (unique_context(body_2.as.v1) ? *body_2.as.v1 : (Tuple_Tuple_Number_Number_List_Tuple_Number_Number){(*body_2.as.v1).item0, share_List_Tuple_Number_Number((*body_2.as.v1).item1)});
            release_context(body_2.as.v1);
            drop_List_Tuple_Number_Number(v3.item1);
            Tuple_Number_Number head = v3.item0;
            bool v9 = equals_Tuple_Number_Number(spot, head);
            String v10 = NULL;
            if (v9) {
                v10 = string_new("O", 1);
            }
            else {
                List_Tuple_Number_Number body_3 = share_List_Tuple_Number_Number(body);
                bool v17 = contains(NULL, body_3, spot);
                String v18 = NULL;
                if (v17) {
                    v18 = string_new("o", 1);
                }
                else {
                    bool v25 = equals_Tuple_Number_Number(spot, food);
                    String v26 = NULL;
                    if (v25) {
                        v26 = string_new("*", 1);
                    }
                    else {
                        v26 = string_new(".", 1);
                    }
                    v18 = v26;
                }
                v10 = v18;
            }
            v2 = v10;
            break;
        }
        case List_Tuple_Number_Number_nil:
        {
            v2 = string_new(".", 1);
            break;
        }
    }
    drop_List_Tuple_Number_Number(body);
    return v2;
}
Direction turn(void *environment, Direction dir, String key) {
    (void)environment;
    String key_2 = string_share(key);
    Direction dir_2 = share_Direction(dir);
    Tuple_String_Direction v4 = (Tuple_String_Direction){key_2, dir_2};
    Direction v5 = {0};
    if (string_equals(v4.item0, "w", 1) && v4.item1.tag == Direction_Down) {
        string_drop(v4.item0);
        v5 = share_Direction(dir);
    }
    else if (string_equals(v4.item0, "s", 1) && v4.item1.tag == Direction_Up) {
        string_drop(v4.item0);
        v5 = share_Direction(dir);
    }
    else if (string_equals(v4.item0, "a", 1) && v4.item1.tag == Direction_Right) {
        string_drop(v4.item0);
        v5 = share_Direction(dir);
    }
    else if (string_equals(v4.item0, "d", 1) && v4.item1.tag == Direction_Left) {
        string_drop(v4.item0);
        v5 = share_Direction(dir);
    }
    else if (string_equals(v4.item0, "w", 1) && 1) {
        string_drop(v4.item0);
        drop_Direction(v4.item1);
        v5 = (Direction){.tag=Direction_Up, .as.v0=(Unit){0}};
    }
    else if (string_equals(v4.item0, "s", 1) && 1) {
        string_drop(v4.item0);
        drop_Direction(v4.item1);
        v5 = (Direction){.tag=Direction_Down, .as.v1=(Unit){0}};
    }
    else if (string_equals(v4.item0, "a", 1) && 1) {
        string_drop(v4.item0);
        drop_Direction(v4.item1);
        v5 = (Direction){.tag=Direction_Left, .as.v2=(Unit){0}};
    }
    else if (string_equals(v4.item0, "d", 1) && 1) {
        string_drop(v4.item0);
        drop_Direction(v4.item1);
        v5 = (Direction){.tag=Direction_Right, .as.v3=(Unit){0}};
    }
    else {
        string_drop(v4.item0);
        drop_Direction(v4.item1);
        v5 = share_Direction(dir);
    }
    drop_Direction(dir);
    string_drop(key);
    return v5;
}
Unit render(void *environment, List_Tuple_Number_Number body, Tuple_Number_Number food, double score) {
    (void)environment;
    String v1 = string_new("\033[H\033[2J", 7);
    host_write_Unit(v1);
    string_builder v8 = {0};
    builder_bytes(&v8, "score: ", 7);
    builder_number(&v8, score);
    builder_bytes(&v8, "   (w/a/s/d to steer, q to quit)", 32);
    String v7 = builder_finish(&v8);
    host_print_Unit(v7);
    List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
    Unit v17 = drawRows(NULL, 0, body_2, food);
    drop_List_Tuple_Number_Number(body);
    return v17;
}
Unit drawRows(void *environment, double y, List_Tuple_Number_Number body, Tuple_Number_Number food) {
    (void)environment;
    double v4 = height(NULL);
    Unit v6 = {0};
    if (y >= v4) {
        v6 = (Unit){0};
    }
    else {
        List_Tuple_Number_Number body_2 = share_List_Tuple_Number_Number(body);
        String v17 = rowText(NULL, 0, y, body_2, food);
        host_print_Unit(v17);
        List_Tuple_Number_Number body_3 = share_List_Tuple_Number_Number(body);
        v6 = drawRows(NULL, y + 1, body_3, food);
    }
    drop_List_Tuple_Number_Number(body);
    return v6;
}
double entry(void *environment) {
    (void)environment;
    return game(NULL);
}
List_Tuple_Number_Number share_List_Tuple_Number_Number(List_Tuple_Number_Number value) {
    (void)value;
    if (value.tag == List_Tuple_Number_Number_cons) {
        retain_context(value.as.v1);
    }
    return value;
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
Unit drop_List_Tuple_Number_Number(List_Tuple_Number_Number value) {
    (void)value;
    if (value.tag == List_Tuple_Number_Number_cons) {
        if (unique_context(value.as.v1)) {
            drop_List_Tuple_Number_Number((*value.as.v1).item1);
        }
        release_context(value.as.v1);
    }
    return (Unit){0};
}
double host_random_double(double value) {
    (void)value;
    static uint32_t state = 0;
    if (!(value >= 1 && value < 4294967296.0 && value == floor(value))) {
        abort();
    }
    if (state == 0) {
        const char *seed = getenv("LAMINAR_SEED");
        state = seed ? (uint32_t)strtoul(seed, NULL, 10) : (uint32_t)time(NULL);
        if (state == 0) {
            state = 2463534242u;
        }
    }
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (double)(state % (uint32_t)value);
}
_Bool equal_Tuple_Number_Number(Tuple_Number_Number left, Tuple_Number_Number right) {
    (void)left;
    (void)right;
    return (left.item0 == right.item0) && (left.item1 == right.item1);
}
_Bool equals_Tuple_Number_Number(Tuple_Number_Number left, Tuple_Number_Number right) {
    (void)left;
    (void)right;
    _Bool same = equal_Tuple_Number_Number(left, right);
    return same;
}
String host_key_String(double value) {
    (void)value;
    fflush(stdout);
    struct termios saved;
    int raw = 0;
    if (isatty(0) && tcgetattr(0, &saved) == 0) {
        struct termios unbuffered = saved;
        unbuffered.c_lflag &= (tcflag_t)~(ICANON | ECHO);
        unbuffered.c_cc[VMIN] = 1;
        unbuffered.c_cc[VTIME] = 0;
        tcsetattr(0, TCSANOW, &unbuffered);
        raw = 1;
    }
    int timeout = value < 0 ? 0 : value > 2147483647.0 ? 2147483647 : (int)value;
    struct pollfd ready = {0, POLLIN, 0};
    string_builder key = {0};
    if (poll(&ready, 1, timeout) > 0) {
        char byte;
        if (read(0, &byte, 1) == 1) {
            builder_bytes(&key, &byte, 1);
        }
    }
    if (raw) {
        tcsetattr(0, TCSANOW, &saved);
    }
    return builder_finish(&key);
}
_Bool equals_String(String left, String right) {
    (void)left;
    (void)right;
    _Bool same = string_same(left, right);
    string_drop(left);
    string_drop(right);
    return same;
}
Direction share_Direction(Direction value) {
    (void)value;
    return value;
}
Unit drop_Direction(Direction value) {
    (void)value;
    return (Unit){0};
}
Unit host_write_Unit(String value) {
    (void)value;
    if (value) {
        fwrite(value->bytes, 1, value->length, stdout);
    }
    fflush(stdout);
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
    double result0 = entry(NULL);
    (void)result0;
    putchar('\x1e');
    print_number(result0);
    putchar('\n');
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
