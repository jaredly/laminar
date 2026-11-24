#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
typedef struct laminar_string { size_t length; unsigned char bytes[]; } laminar_string;
typedef struct { unsigned char *bytes; size_t length; size_t capacity; } string_builder;
typedef struct Unit Unit;
typedef struct Cell Cell;
typedef struct Callable_Value_196fc0868a Callable_Value_196fc0868a;
typedef struct Vector_Cell Vector_Cell;
typedef struct Square Square;
typedef struct Tuple_Square_Square_Square Tuple_Square_Square_Square;
typedef struct List_Tuple_Square_Square_Square List_Tuple_Square_Square_Square;
typedef struct Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square;
typedef struct Lens_Vector_Cell Lens_Vector_Cell;
typedef laminar_string *String;
typedef struct Outcome Outcome;
typedef struct Option_Square Option_Square;
typedef Unit (*Func_to_Unit_67b7c9ce73)(void *);
typedef Unit (*Func_Vector_Cell_to_Unit_d0f5b84ae0)(void *, Vector_Cell);
struct Unit { unsigned char inhabitant; };
enum { Cell_Empty = 0, Cell_X = 1, Cell_O = 2 };
struct Cell { uint32_t tag; union { Unit v0; Unit v1; Unit v2; } as; };
struct Callable_Value_196fc0868a { void *environment; Func_to_Unit_67b7c9ce73 dispose; };
struct Vector_Cell { Cell *elements; size_t length; size_t capacity; };
enum { Square_C0 = 0, Square_C1 = 1, Square_C2 = 2, Square_C3 = 3, Square_C4 = 4, Square_C5 = 5, Square_C6 = 6, Square_C7 = 7, Square_C8 = 8 };
struct Square { uint32_t tag; union { Unit v0; Unit v1; Unit v2; Unit v3; Unit v4; Unit v5; Unit v6; Unit v7; Unit v8; } as; };
struct Tuple_Square_Square_Square { Square item0; Square item1; Square item2; };
enum { List_Tuple_Square_Square_Square_nil = 0, List_Tuple_Square_Square_Square_cons = 1 };
struct List_Tuple_Square_Square_Square { uint32_t tag; union { Unit v0; Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v1; } as; };
struct Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square { Tuple_Square_Square_Square item0; List_Tuple_Square_Square_Square item1; };
struct Lens_Vector_Cell { Vector_Cell *read; Func_Vector_Cell_to_Unit_d0f5b84ae0 restore; void *context; };
enum { Outcome_Won = 0, Outcome_Draw = 1 };
struct Outcome { uint32_t tag; union { Cell *v0; Unit v1; } as; };
enum { Option_Square_Some = 0, Option_Square_None = 1 };
struct Option_Square { uint32_t tag; union { Square v0; Unit v1; } as; };
typedef struct { Vector_Cell read0; } Backing_Vector_Cell;
static size_t live_contexts = 0;
void *allocate_context(size_t size);
void release_context(void *context);
void retain_context(void *context);
_Bool unique_context(void *context);
laminar_string *string_new(const char *bytes, size_t length);
void string_drop(laminar_string *s);
laminar_string *string_share(laminar_string *s);
_Bool string_equals(laminar_string *s, const char *bytes, size_t length);
void builder_bytes(string_builder *b, const char *bytes, size_t length);
void builder_string(string_builder *b, laminar_string *s);
laminar_string *builder_finish(string_builder *b);
String symbol(void *environment, Cell c);
double slot(void *environment, Square sq);
Unit render(void *environment, Lens_Vector_Cell board);
Outcome game(void *environment);
Cell winnerIn(void *environment, List_Tuple_Square_Square_Square lines, Lens_Vector_Cell board);
Outcome play(void *environment, Cell player, double turns, Lens_Vector_Cell board);
Cell cellAt(void *environment, Square sq, Lens_Vector_Cell board);
Cell lineOwner(void *environment, Square a, Square b, Square c, Lens_Vector_Cell board);
Cell other(void *environment, Cell player);
String row(void *environment, Square a, Square b, Square c, Lens_Vector_Cell board);
Option_Square parseSquare(void *environment, String input);
Cell winner(void *environment, Lens_Vector_Cell board);
Unit takeTurn(void *environment, Cell player, Lens_Vector_Cell board);
Outcome entry(void *environment);
Cell share_Cell(Cell value);
Unit drop_Cell(Cell value);
Square share_Square(Square value);
Unit drop_Square(Square value);
Unit host_print_Unit(String value);
Vector_Cell vector_array_Vector_Cell(double length, Cell init);
Cell dup_Cell(Cell value);
Outcome share_Outcome(Outcome value);
Unit drop_Outcome(Outcome value);
void vector_drop_Vector_Cell(Vector_Cell value);
List_Tuple_Square_Square_Square share_List_Tuple_Square_Square_Square(List_Tuple_Square_Square_Square value);
Unit drop_List_Tuple_Square_Square_Square(List_Tuple_Square_Square_Square value);
Cell *vector_at_Vector_Cell(Vector_Cell value, double index);
_Bool equals_Cell(Cell left, Cell right);
_Bool equal_Cell(Cell left, Cell right);
String host_input_String(String value);
void print_Outcome(Outcome value);
void print_Cell(Cell value);
String symbol(void *environment, Cell c) {
    (void)environment;
    Cell c_2 = share_Cell(c);
    String v2 = NULL;
    switch (c_2.tag) {
        case Cell_Empty:
        {
            v2 = string_new(".", 1);
            break;
        }
        case Cell_X:
        {
            v2 = string_new("X", 1);
            break;
        }
        case Cell_O:
        {
            v2 = string_new("O", 1);
            break;
        }
    }
    drop_Cell(c);
    return v2;
}
double slot(void *environment, Square sq) {
    (void)environment;
    Square sq_2 = share_Square(sq);
    double v2 = 0;
    switch (sq_2.tag) {
        case Square_C0:
        {
            v2 = 0;
            break;
        }
        case Square_C1:
        {
            v2 = 1;
            break;
        }
        case Square_C2:
        {
            v2 = 2;
            break;
        }
        case Square_C3:
        {
            v2 = 3;
            break;
        }
        case Square_C4:
        {
            v2 = 4;
            break;
        }
        case Square_C5:
        {
            v2 = 5;
            break;
        }
        case Square_C6:
        {
            v2 = 6;
            break;
        }
        case Square_C7:
        {
            v2 = 7;
            break;
        }
        case Square_C8:
        {
            v2 = 8;
            break;
        }
    }
    drop_Square(sq);
    return v2;
}
Unit render(void *environment, Lens_Vector_Cell board) {
    (void)environment;
    Square v3 = (Square){.tag=Square_C0, .as.v0=(Unit){0}};
    Square v4 = (Square){.tag=Square_C1, .as.v1=(Unit){0}};
    Square v5 = (Square){.tag=Square_C2, .as.v2=(Unit){0}};
    String v6 = row(NULL, v3, v4, v5, board);
    host_print_Unit(v6);
    Square v12 = (Square){.tag=Square_C3, .as.v3=(Unit){0}};
    Square v13 = (Square){.tag=Square_C4, .as.v4=(Unit){0}};
    Square v14 = (Square){.tag=Square_C5, .as.v5=(Unit){0}};
    String v15 = row(NULL, v12, v13, v14, board);
    host_print_Unit(v15);
    Square v21 = (Square){.tag=Square_C6, .as.v6=(Unit){0}};
    Square v22 = (Square){.tag=Square_C7, .as.v7=(Unit){0}};
    Square v23 = (Square){.tag=Square_C8, .as.v8=(Unit){0}};
    String v24 = row(NULL, v21, v22, v23, board);
    return host_print_Unit(v24);
}
Outcome game(void *environment) {
    (void)environment;
    Cell v2 = (Cell){.tag=Cell_Empty, .as.v0=(Unit){0}};
    Vector_Cell board = vector_array_Vector_Cell(9, v2);
    Cell v6 = (Cell){.tag=Cell_X, .as.v1=(Unit){0}};
    Backing_Vector_Cell back0 = {0};
    back0.read0 = board;
    Lens_Vector_Cell v8 = (Lens_Vector_Cell){.read=&back0.read0};
    Outcome result_2 = play(NULL, v6, 0, v8);
    Outcome result_2_2 = share_Outcome(result_2);
    Unit v12 = {0};
    (void)v12;
    switch (result_2_2.tag) {
        case Outcome_Won:
        {
            Cell v13 = (unique_context(result_2_2.as.v0) ? *result_2_2.as.v0 : share_Cell(*result_2_2.as.v0));
            release_context(result_2_2.as.v0);
            Cell who = share_Cell(v13);
            String v18 = symbol(NULL, who);
            string_builder v20 = {0};
            builder_bytes(&v20, "", 0);
            builder_string(&v20, v18);
            builder_bytes(&v20, " wins!", 6);
            String v19 = builder_finish(&v20);
            Unit v21 = host_print_Unit(v19);
            drop_Cell(v13);
            v12 = v21;
            break;
        }
        case Outcome_Draw:
        {
            String v23 = string_new("It's a draw.", 12);
            v12 = host_print_Unit(v23);
            break;
        }
    }
    Outcome result_2_3 = share_Outcome(result_2);
    drop_Outcome(result_2);
    vector_drop_Vector_Cell(back0.read0);
    return result_2_3;
}
Cell winnerIn(void *environment, List_Tuple_Square_Square_Square lines, Lens_Vector_Cell board) {
    (void)environment;
    List_Tuple_Square_Square_Square lines_2 = share_List_Tuple_Square_Square_Square(lines);
    Cell v2 = {0};
    switch (lines_2.tag) {
        case List_Tuple_Square_Square_Square_nil:
        {
            v2 = (Cell){.tag=Cell_Empty, .as.v0=(Unit){0}};
            break;
        }
        case List_Tuple_Square_Square_Square_cons:
        {
            Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square v4 = (unique_context(lines_2.as.v1) ? *lines_2.as.v1 : (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){(Tuple_Square_Square_Square){share_Square((*lines_2.as.v1).item0.item0), share_Square((*lines_2.as.v1).item0.item1), share_Square((*lines_2.as.v1).item0.item2)}, share_List_Tuple_Square_Square_Square((*lines_2.as.v1).item1)});
            release_context(lines_2.as.v1);
            Square a = share_Square(v4.item0.item0);
            Square b = share_Square(v4.item0.item1);
            Square c = share_Square(v4.item0.item2);
            Cell v13 = lineOwner(NULL, a, b, c, board);
            Cell v14 = {0};
            switch (v13.tag) {
                case Cell_Empty:
                {
                    List_Tuple_Square_Square_Square rest = share_List_Tuple_Square_Square_Square(v4.item1);
                    v14 = winnerIn(NULL, rest, board);
                    break;
                }
                default:
                {
                    Cell owner = share_Cell(v13);
                    drop_Cell(v13);
                    v14 = owner;
                    break;
                }
            }
            drop_Square(v4.item0.item0);
            drop_Square(v4.item0.item1);
            drop_Square(v4.item0.item2);
            drop_List_Tuple_Square_Square_Square(v4.item1);
            v2 = v14;
            break;
        }
    }
    drop_List_Tuple_Square_Square_Square(lines);
    return v2;
}
Outcome play(void *environment, Cell player, double turns, Lens_Vector_Cell board) {
    (void)environment;
    render(NULL, board);
    Cell v6 = winner(NULL, board);
    Outcome v7 = {0};
    switch (v6.tag) {
        case Cell_Empty:
        {
            Outcome v13 = {0};
            if (turns == 9) {
                v13 = (Outcome){.tag=Outcome_Draw, .as.v1=(Unit){0}};
            }
            else {
                Cell player_2 = share_Cell(player);
                takeTurn(NULL, player_2, board);
                Cell player_3 = share_Cell(player);
                Cell v26 = other(NULL, player_3);
                v13 = play(NULL, v26, turns + 1, board);
            }
            v7 = v13;
            break;
        }
        default:
        {
            Cell owner = share_Cell(v6);
            Cell *v36 = allocate_context(sizeof *v36);
            *v36 = owner;
            Outcome v35 = (Outcome){.tag=Outcome_Won, .as.v0=v36};
            drop_Cell(v6);
            v7 = v35;
            break;
        }
    }
    Outcome v3 = v7;
    drop_Cell(player);
    return v3;
}
Cell cellAt(void *environment, Square sq, Lens_Vector_Cell board) {
    (void)environment;
    Square sq_2 = share_Square(sq);
    double v5 = slot(NULL, sq_2);
    Cell *v7 = vector_at_Vector_Cell(*board.read, v5);
    Cell v9 = dup_Cell((*v7));
    drop_Square(sq);
    return v9;
}
Cell lineOwner(void *environment, Square a, Square b, Square c, Lens_Vector_Cell board) {
    (void)environment;
    Square a_2 = share_Square(a);
    Cell first = cellAt(NULL, a_2, board);
    Cell first_2 = share_Cell(first);
    Cell v8 = (Cell){.tag=Cell_Empty, .as.v0=(Unit){0}};
    bool v9 = (!equals_Cell(first_2, v8));
    bool v10 = false;
    if (v9) {
        Cell first_3 = share_Cell(first);
        Square b_2 = share_Square(b);
        Cell v18 = cellAt(NULL, b_2, board);
        v10 = equals_Cell(first_3, v18);
    }
    else {
        v10 = false;
    }
    bool v21 = false;
    if (v10) {
        Cell first_4 = share_Cell(first);
        Square c_2 = share_Square(c);
        Cell v29 = cellAt(NULL, c_2, board);
        v21 = equals_Cell(first_4, v29);
    }
    else {
        v21 = false;
    }
    Cell v32 = {0};
    if (v21) {
        v32 = share_Cell(first);
    }
    else {
        v32 = (Cell){.tag=Cell_Empty, .as.v0=(Unit){0}};
    }
    drop_Cell(first);
    Cell v4 = v32;
    drop_Square(a);
    drop_Square(b);
    drop_Square(c);
    return v4;
}
Cell other(void *environment, Cell player) {
    (void)environment;
    Cell player_2 = share_Cell(player);
    Cell v2 = {0};
    switch (player_2.tag) {
        case Cell_X:
        {
            v2 = (Cell){.tag=Cell_O, .as.v2=(Unit){0}};
            break;
        }
        default:
        {
            drop_Cell(player_2);
            v2 = (Cell){.tag=Cell_X, .as.v1=(Unit){0}};
            break;
        }
    }
    drop_Cell(player);
    return v2;
}
String row(void *environment, Square a, Square b, Square c, Lens_Vector_Cell board) {
    (void)environment;
    Square a_2 = share_Square(a);
    Cell v5 = cellAt(NULL, a_2, board);
    String v6 = symbol(NULL, v5);
    Square b_2 = share_Square(b);
    Cell v12 = cellAt(NULL, b_2, board);
    String v13 = symbol(NULL, v12);
    Square c_2 = share_Square(c);
    Cell v19 = cellAt(NULL, c_2, board);
    String v20 = symbol(NULL, v19);
    string_builder v22 = {0};
    builder_bytes(&v22, "", 0);
    builder_string(&v22, v6);
    builder_bytes(&v22, " ", 1);
    builder_string(&v22, v13);
    builder_bytes(&v22, " ", 1);
    builder_string(&v22, v20);
    builder_bytes(&v22, "", 0);
    String v21 = builder_finish(&v22);
    drop_Square(a);
    drop_Square(b);
    drop_Square(c);
    return v21;
}
Option_Square parseSquare(void *environment, String input) {
    (void)environment;
    String input_2 = string_share(input);
    Option_Square v2 = {0};
    if (string_equals(input_2, "1", 1)) {
        string_drop(input_2);
        Square v3 = (Square){.tag=Square_C0, .as.v0=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v3};
    }
    else if (string_equals(input_2, "2", 1)) {
        string_drop(input_2);
        Square v5 = (Square){.tag=Square_C1, .as.v1=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v5};
    }
    else if (string_equals(input_2, "3", 1)) {
        string_drop(input_2);
        Square v7 = (Square){.tag=Square_C2, .as.v2=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v7};
    }
    else if (string_equals(input_2, "4", 1)) {
        string_drop(input_2);
        Square v9 = (Square){.tag=Square_C3, .as.v3=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v9};
    }
    else if (string_equals(input_2, "5", 1)) {
        string_drop(input_2);
        Square v11 = (Square){.tag=Square_C4, .as.v4=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v11};
    }
    else if (string_equals(input_2, "6", 1)) {
        string_drop(input_2);
        Square v13 = (Square){.tag=Square_C5, .as.v5=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v13};
    }
    else if (string_equals(input_2, "7", 1)) {
        string_drop(input_2);
        Square v15 = (Square){.tag=Square_C6, .as.v6=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v15};
    }
    else if (string_equals(input_2, "8", 1)) {
        string_drop(input_2);
        Square v17 = (Square){.tag=Square_C7, .as.v7=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v17};
    }
    else if (string_equals(input_2, "9", 1)) {
        string_drop(input_2);
        Square v19 = (Square){.tag=Square_C8, .as.v8=(Unit){0}};
        v2 = (Option_Square){.tag=Option_Square_Some, .as.v0=v19};
    }
    else {
        string_drop(input_2);
        v2 = (Option_Square){.tag=Option_Square_None, .as.v1=(Unit){0}};
    }
    string_drop(input);
    return v2;
}
Cell winner(void *environment, Lens_Vector_Cell board) {
    (void)environment;
    Square v2 = (Square){.tag=Square_C0, .as.v0=(Unit){0}};
    Square v3 = (Square){.tag=Square_C1, .as.v1=(Unit){0}};
    Square v4 = (Square){.tag=Square_C2, .as.v2=(Unit){0}};
    Tuple_Square_Square_Square v5 = (Tuple_Square_Square_Square){v2, v3, v4};
    Square v6 = (Square){.tag=Square_C3, .as.v3=(Unit){0}};
    Square v7 = (Square){.tag=Square_C4, .as.v4=(Unit){0}};
    Square v8 = (Square){.tag=Square_C5, .as.v5=(Unit){0}};
    Tuple_Square_Square_Square v9 = (Tuple_Square_Square_Square){v6, v7, v8};
    Square v10 = (Square){.tag=Square_C6, .as.v6=(Unit){0}};
    Square v11 = (Square){.tag=Square_C7, .as.v7=(Unit){0}};
    Square v12 = (Square){.tag=Square_C8, .as.v8=(Unit){0}};
    Tuple_Square_Square_Square v13 = (Tuple_Square_Square_Square){v10, v11, v12};
    Square v14 = (Square){.tag=Square_C0, .as.v0=(Unit){0}};
    Square v15 = (Square){.tag=Square_C3, .as.v3=(Unit){0}};
    Square v16 = (Square){.tag=Square_C6, .as.v6=(Unit){0}};
    Tuple_Square_Square_Square v17 = (Tuple_Square_Square_Square){v14, v15, v16};
    Square v18 = (Square){.tag=Square_C1, .as.v1=(Unit){0}};
    Square v19 = (Square){.tag=Square_C4, .as.v4=(Unit){0}};
    Square v20 = (Square){.tag=Square_C7, .as.v7=(Unit){0}};
    Tuple_Square_Square_Square v21 = (Tuple_Square_Square_Square){v18, v19, v20};
    Square v22 = (Square){.tag=Square_C2, .as.v2=(Unit){0}};
    Square v23 = (Square){.tag=Square_C5, .as.v5=(Unit){0}};
    Square v24 = (Square){.tag=Square_C8, .as.v8=(Unit){0}};
    Tuple_Square_Square_Square v25 = (Tuple_Square_Square_Square){v22, v23, v24};
    Square v26 = (Square){.tag=Square_C0, .as.v0=(Unit){0}};
    Square v27 = (Square){.tag=Square_C4, .as.v4=(Unit){0}};
    Square v28 = (Square){.tag=Square_C8, .as.v8=(Unit){0}};
    Tuple_Square_Square_Square v29 = (Tuple_Square_Square_Square){v26, v27, v28};
    Square v30 = (Square){.tag=Square_C2, .as.v2=(Unit){0}};
    Square v31 = (Square){.tag=Square_C4, .as.v4=(Unit){0}};
    Square v32 = (Square){.tag=Square_C6, .as.v6=(Unit){0}};
    Tuple_Square_Square_Square v33 = (Tuple_Square_Square_Square){v30, v31, v32};
    List_Tuple_Square_Square_Square v34 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_nil, .as.v0=(Unit){0}};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v36 = allocate_context(sizeof *v36);
    *v36 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v33, v34};
    List_Tuple_Square_Square_Square v35 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v36};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v38 = allocate_context(sizeof *v38);
    *v38 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v29, v35};
    List_Tuple_Square_Square_Square v37 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v38};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v40 = allocate_context(sizeof *v40);
    *v40 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v25, v37};
    List_Tuple_Square_Square_Square v39 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v40};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v42 = allocate_context(sizeof *v42);
    *v42 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v21, v39};
    List_Tuple_Square_Square_Square v41 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v42};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v44 = allocate_context(sizeof *v44);
    *v44 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v17, v41};
    List_Tuple_Square_Square_Square v43 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v44};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v46 = allocate_context(sizeof *v46);
    *v46 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v13, v43};
    List_Tuple_Square_Square_Square v45 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v46};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v48 = allocate_context(sizeof *v48);
    *v48 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v9, v45};
    List_Tuple_Square_Square_Square v47 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v48};
    Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square *v50 = allocate_context(sizeof *v50);
    *v50 = (Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square){v5, v47};
    List_Tuple_Square_Square_Square v49 = (List_Tuple_Square_Square_Square){.tag=List_Tuple_Square_Square_Square_cons, .as.v1=v50};
    return winnerIn(NULL, v49, board);
}
Unit takeTurn(void *environment, Cell player, Lens_Vector_Cell board) {
    (void)environment;
    Cell player_2 = share_Cell(player);
    String v4 = symbol(NULL, player_2);
    string_builder v6 = {0};
    builder_bytes(&v6, "", 0);
    builder_string(&v6, v4);
    builder_bytes(&v6, ", pick a square (1-9): ", 23);
    String v5 = builder_finish(&v6);
    String input = host_input_String(v5);
    String input_2 = string_share(input);
    Option_Square v11 = parseSquare(NULL, input_2);
    Unit v12 = {0};
    switch (v11.tag) {
        case Option_Square_None:
        {
            String v14 = string_new("Please pick a number from 1 to 9.", 33);
            host_print_Unit(v14);
            Cell player_3 = share_Cell(player);
            v12 = takeTurn(NULL, player_3, board);
            break;
        }
        case Option_Square_Some:
        {
            Square square = share_Square(v11.as.v0);
            Cell v27 = cellAt(NULL, square, board);
            Cell v28 = (Cell){.tag=Cell_Empty, .as.v0=(Unit){0}};
            bool v29 = (!equals_Cell(v27, v28));
            Unit v30 = {0};
            if (v29) {
                String v32 = string_new("That square is taken.", 21);
                host_print_Unit(v32);
                Cell player_4 = share_Cell(player);
                v30 = takeTurn(NULL, player_4, board);
            }
            else {
                Square square_2 = share_Square(v11.as.v0);
                double v45 = slot(NULL, square_2);
                Cell *v47 = vector_at_Vector_Cell(*board.read, v45);
                Cell player_5 = dup_Cell(player);
                Cell v50 = (*v47);
                *v47 = player_5;
                drop_Cell(v50);
                v30 = (Unit){0};
            }
            drop_Square(v11.as.v0);
            v12 = v30;
            break;
        }
    }
    string_drop(input);
    Unit v7 = v12;
    drop_Cell(player);
    return v7;
}
Outcome entry(void *environment) {
    (void)environment;
    return game(NULL);
}
Cell share_Cell(Cell value) {
    (void)value;
    return value;
}
Unit drop_Cell(Cell value) {
    (void)value;
    return (Unit){0};
}
Square share_Square(Square value) {
    (void)value;
    return value;
}
Unit drop_Square(Square value) {
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
Cell dup_Cell(Cell value) {
    (void)value;
    Cell copy = value;
    if (value.tag == Cell_Empty) {
        copy.as.v0 = value.as.v0;
    }
    else if (value.tag == Cell_X) {
        copy.as.v1 = value.as.v1;
    }
    else if (value.tag == Cell_O) {
        copy.as.v2 = value.as.v2;
    }
    return copy;
}
Vector_Cell vector_array_Vector_Cell(double length, Cell init) {
    if (!(length >= 0) || length != floor(length) || length > (double)(SIZE_MAX / sizeof init)) {
        abort();
    }
    Vector_Cell value = {0};
    if (length == 0) {
        drop_Cell(init);
        return value;
    }
    value.length = value.capacity = (size_t)length;
    value.elements = allocate_context(value.length * sizeof *value.elements);
    for (size_t i = 0; i + 1 < value.length; i++) {
        value.elements[i] = dup_Cell(init);
    }
    value.elements[value.length - 1] = init;
    return value;
}
Outcome share_Outcome(Outcome value) {
    (void)value;
    if (value.tag == Outcome_Won) {
        retain_context(value.as.v0);
    }
    return value;
}
Unit drop_Outcome(Outcome value) {
    (void)value;
    if (value.tag == Outcome_Won) {
        if (unique_context(value.as.v0)) {
            drop_Cell(*value.as.v0);
        }
        release_context(value.as.v0);
    }
    return (Unit){0};
}
void vector_drop_Vector_Cell(Vector_Cell value) {
    if (value.elements && unique_context(value.elements)) {
        for (size_t i = 0; i < value.length; i++) {
            drop_Cell(value.elements[i]);
        }
    }
    if (value.elements) {
        release_context(value.elements);
    }
}
List_Tuple_Square_Square_Square share_List_Tuple_Square_Square_Square(List_Tuple_Square_Square_Square value) {
    (void)value;
    if (value.tag == List_Tuple_Square_Square_Square_cons) {
        retain_context(value.as.v1);
    }
    return value;
}
Unit drop_List_Tuple_Square_Square_Square(List_Tuple_Square_Square_Square value) {
    (void)value;
    if (value.tag == List_Tuple_Square_Square_Square_cons) {
        if (unique_context(value.as.v1)) {
            drop_Square((*value.as.v1).item0.item0);
            drop_Square((*value.as.v1).item0.item1);
            drop_Square((*value.as.v1).item0.item2);
            drop_List_Tuple_Square_Square_Square((*value.as.v1).item1);
        }
        release_context(value.as.v1);
    }
    return (Unit){0};
}
Cell *vector_at_Vector_Cell(Vector_Cell value, double index) {
    if (!(index >= 0) || index != floor(index) || index >= (double)value.length) {
        abort();
    }
    return &value.elements[(size_t)index];
}
_Bool equal_Cell(Cell left, Cell right) {
    (void)left;
    (void)right;
    if (left.tag != right.tag) {
        return 0;
    }
    if (left.tag == Cell_Empty) {
        return 1;
    }
    if (left.tag == Cell_X) {
        return 1;
    }
    if (left.tag == Cell_O) {
        return 1;
    }
    return 1;
}
_Bool equals_Cell(Cell left, Cell right) {
    (void)left;
    (void)right;
    _Bool same = equal_Cell(left, right);
    drop_Cell(left);
    drop_Cell(right);
    return same;
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
    Outcome result0 = entry(NULL);
    (void)result0;
    putchar('\x1e');
    print_Outcome(result0);
    putchar('\n');
    drop_Outcome(result0);
    if (live_contexts != 0) {
        abort();
    }
    return 0;
}
void print_Cell(Cell value) {
    (void)value;
    if (value.tag == Cell_Empty) {
        fputs("{\"kind\":\"variant\",\"name\":\"Empty\",\"items\":[", stdout);
        fputs("]}", stdout);
    }
    else if (value.tag == Cell_X) {
        fputs("{\"kind\":\"variant\",\"name\":\"X\",\"items\":[", stdout);
        fputs("]}", stdout);
    }
    else if (value.tag == Cell_O) {
        fputs("{\"kind\":\"variant\",\"name\":\"O\",\"items\":[", stdout);
        fputs("]}", stdout);
    }
}
void print_Outcome(Outcome value) {
    (void)value;
    if (value.tag == Outcome_Won) {
        fputs("{\"kind\":\"variant\",\"name\":\"Won\",\"items\":[", stdout);
        print_Cell(*value.as.v0);
        fputs("]}", stdout);
    }
    else if (value.tag == Outcome_Draw) {
        fputs("{\"kind\":\"variant\",\"name\":\"Draw\",\"items\":[", stdout);
        fputs("]}", stdout);
    }
}
