package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
)

type Unit struct{}

const Outcome_Won uint32 = 0

const Outcome_Draw uint32 = 1

type Outcome struct {
	tag uint32
	v0 *Cell
	v1 Unit
}

type Vector_Cell []Cell

const Square_C0 uint32 = 0

const Square_C1 uint32 = 1

const Square_C2 uint32 = 2

const Square_C3 uint32 = 3

const Square_C4 uint32 = 4

const Square_C5 uint32 = 5

const Square_C6 uint32 = 6

const Square_C7 uint32 = 7

const Square_C8 uint32 = 8

type Square struct {
	tag uint32
	v0 Unit
	v1 Unit
	v2 Unit
	v3 Unit
	v4 Unit
	v5 Unit
	v6 Unit
	v7 Unit
	v8 Unit
}

type Tuple_Square_Square_Square struct {
	item0 Square
	item1 Square
	item2 Square
}

const List_Tuple_Square_Square_Square_nil uint32 = 0

const List_Tuple_Square_Square_Square_cons uint32 = 1

type List_Tuple_Square_Square_Square struct {
	tag uint32
	v0 Unit
	v1 *Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square
}

type Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square struct {
	item0 Tuple_Square_Square_Square
	item1 List_Tuple_Square_Square_Square
}

const Option_Square_Some uint32 = 0

const Option_Square_None uint32 = 1

type Option_Square struct {
	tag uint32
	v0 Square
	v1 Unit
}

type Lens_Vector_Cell struct {
	read *Vector_Cell
	restore Func_Vector_Cell_to_Unit_669b43a981
	context any
}

const Cell_Empty uint32 = 0

const Cell_X uint32 = 1

const Cell_O uint32 = 2

type Cell struct {
	tag uint32
	v0 Unit
	v1 Unit
	v2 Unit
}

type Func_Vector_Cell_to_Unit_669b43a981 func(environment any, arg0 Vector_Cell) Unit

var stdin *bufio.Reader

type Backing_Vector_Cell_97128138cf struct {
	read0 Vector_Cell
}

func takeTurn(player Cell, board Lens_Vector_Cell) Unit {
	v7 := symbol(player)
	input := hostInput(v7 + ", pick a square (1-9): ")
	v20 := parseSquare(input)
	switch v20.tag {
	case Option_Square_None:
		hostPrint_Unit("Please pick a number from 1 to 9.")
		takeTurn(player, board)
	case Option_Square_Some:
		v42 := v20.v0
		v52 := cellAt(v42, board)
		v53 := Cell{tag: Cell_Empty, v0: Unit{}}
		if (!vector_equal_Cell(v52, v53)) {
			hostPrint_Unit("That square is taken.")
			takeTurn(player, board)
		} else {
			v85 := slot(v42)
			v90 := vector_at_Vector_Cell(*board.read, v85)
			*v90 = player
		}
	}
	return Unit{}
}

func render(board Lens_Vector_Cell) Unit {
	v3 := Square{tag: Square_C0, v0: Unit{}}
	v4 := Square{tag: Square_C1, v1: Unit{}}
	v5 := Square{tag: Square_C2, v2: Unit{}}
	v8 := row(v3, v4, v5, board)
	hostPrint_Unit(v8)
	v17 := Square{tag: Square_C3, v3: Unit{}}
	v18 := Square{tag: Square_C4, v4: Unit{}}
	v19 := Square{tag: Square_C5, v5: Unit{}}
	v22 := row(v17, v18, v19, board)
	hostPrint_Unit(v22)
	v31 := Square{tag: Square_C6, v6: Unit{}}
	v32 := Square{tag: Square_C7, v7: Unit{}}
	v33 := Square{tag: Square_C8, v8: Unit{}}
	v36 := row(v31, v32, v33, board)
	hostPrint_Unit(v36)
	return Unit{}
}

func play(player Cell, turns float64, board Lens_Vector_Cell) Outcome {
	render(board)
	v11 := winner(board)
	var v14 Outcome
	switch v11.tag {
	case Cell_Empty:
		var v27 Outcome
		if (turns == 9.0) {
			v27 = Outcome{tag: Outcome_Draw, v1: Unit{}}
		} else {
			takeTurn(player, board)
			v48 := other(player)
			v27 = play(v48, turns + 1.0, board)
		}
		v14 = v27
	default:
		v71 := new(Cell)
		*v71 = v11
		v14 = Outcome{tag: Outcome_Won, v0: v71}
	}
	return v14
}

func row(a Square, b Square, c Square, board Lens_Vector_Cell) string {
	v9 := cellAt(a, board)
	v12 := symbol(v9)
	v22 := cellAt(b, board)
	v25 := symbol(v22)
	v35 := cellAt(c, board)
	v38 := symbol(v35)
	return v12 + " " + v25 + " " + v38
}

func lineOwner(a Square, b Square, c Square, board Lens_Vector_Cell) Cell {
	first := cellAt(a, board)
	v15 := Cell{tag: Cell_Empty, v0: Unit{}}
	var v20 bool
	if (!vector_equal_Cell(first, v15)) {
		v34 := cellAt(b, board)
		v20 = vector_equal_Cell(first, v34)
	} else {
		v20 = false
	}
	var v42 bool
	if v20 {
		v56 := cellAt(c, board)
		v42 = vector_equal_Cell(first, v56)
	} else {
		v42 = false
	}
	var v64 Cell
	if v42 {
		v64 = first
	} else {
		v64 = Cell{tag: Cell_Empty, v0: Unit{}}
	}
	return v64
}

func game() Outcome {
	v2 := Cell{tag: Cell_Empty, v0: Unit{}}
	board := vector_array_Vector_Cell(9.0, v2)
	v9 := Cell{tag: Cell_X, v1: Unit{}}
	var back0 Backing_Vector_Cell_97128138cf
	back0.read0 = board
	result_2 := play(v9, 0.0, Lens_Vector_Cell{read: &back0.read0})
	switch result_2.tag {
	case Outcome_Won:
		v22 := *result_2.v0
		v30 := symbol(v22)
		hostPrint_Unit(v30 + " wins!")
	case Outcome_Draw:
		hostPrint_Unit("It's a draw.")
	}
	return result_2
}

func other(player Cell) Cell {
	var v5 Cell
	switch player.tag {
	case Cell_X:
		v5 = Cell{tag: Cell_O, v2: Unit{}}
	default:
		v5 = Cell{tag: Cell_X, v1: Unit{}}
	}
	return v5
}

func winner(board Lens_Vector_Cell) Cell {
	v2 := Square{tag: Square_C0, v0: Unit{}}
	v3 := Square{tag: Square_C1, v1: Unit{}}
	v4 := Square{tag: Square_C2, v2: Unit{}}
	v6 := Square{tag: Square_C3, v3: Unit{}}
	v7 := Square{tag: Square_C4, v4: Unit{}}
	v8 := Square{tag: Square_C5, v5: Unit{}}
	v10 := Square{tag: Square_C6, v6: Unit{}}
	v11 := Square{tag: Square_C7, v7: Unit{}}
	v12 := Square{tag: Square_C8, v8: Unit{}}
	v14 := Square{tag: Square_C0, v0: Unit{}}
	v15 := Square{tag: Square_C3, v3: Unit{}}
	v16 := Square{tag: Square_C6, v6: Unit{}}
	v18 := Square{tag: Square_C1, v1: Unit{}}
	v19 := Square{tag: Square_C4, v4: Unit{}}
	v20 := Square{tag: Square_C7, v7: Unit{}}
	v22 := Square{tag: Square_C2, v2: Unit{}}
	v23 := Square{tag: Square_C5, v5: Unit{}}
	v24 := Square{tag: Square_C8, v8: Unit{}}
	v26 := Square{tag: Square_C0, v0: Unit{}}
	v27 := Square{tag: Square_C4, v4: Unit{}}
	v28 := Square{tag: Square_C8, v8: Unit{}}
	v30 := Square{tag: Square_C2, v2: Unit{}}
	v31 := Square{tag: Square_C4, v4: Unit{}}
	v32 := Square{tag: Square_C6, v6: Unit{}}
	v34 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_nil, v0: Unit{}}
	v46 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v46 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v30, item1: v31, item2: v32}, item1: v34}
	v35 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v46}
	v47 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v47 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v26, item1: v27, item2: v28}, item1: v35}
	v36 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v47}
	v48 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v48 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v22, item1: v23, item2: v24}, item1: v36}
	v37 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v48}
	v49 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v49 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v18, item1: v19, item2: v20}, item1: v37}
	v38 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v49}
	v50 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v50 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v14, item1: v15, item2: v16}, item1: v38}
	v39 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v50}
	v51 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v51 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v10, item1: v11, item2: v12}, item1: v39}
	v40 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v51}
	v52 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v52 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v6, item1: v7, item2: v8}, item1: v40}
	v41 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v52}
	v53 := new(Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square)
	*v53 = Tuple_Tuple_Square_Square_Square_List_Tuple_Square_Square_Square{item0: Tuple_Square_Square_Square{item0: v2, item1: v3, item2: v4}, item1: v41}
	v42 := List_Tuple_Square_Square_Square{tag: List_Tuple_Square_Square_Square_cons, v1: v53}
	return winnerIn(v42, board)
}

func cellAt(sq Square, board Lens_Vector_Cell) Cell {
	v8 := slot(sq)
	v13 := vector_at_Vector_Cell(*board.read, v8)
	return *v13
}

func parseSquare(input string) Option_Square {
	var v5 Option_Square
	switch input {
	case "1":
		v6 := Square{tag: Square_C0, v0: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v6}
	case "2":
		v8 := Square{tag: Square_C1, v1: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v8}
	case "3":
		v10 := Square{tag: Square_C2, v2: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v10}
	case "4":
		v12 := Square{tag: Square_C3, v3: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v12}
	case "5":
		v14 := Square{tag: Square_C4, v4: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v14}
	case "6":
		v16 := Square{tag: Square_C5, v5: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v16}
	case "7":
		v18 := Square{tag: Square_C6, v6: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v18}
	case "8":
		v20 := Square{tag: Square_C7, v7: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v20}
	case "9":
		v22 := Square{tag: Square_C8, v8: Unit{}}
		v5 = Option_Square{tag: Option_Square_Some, v0: v22}
	default:
		v5 = Option_Square{tag: Option_Square_None, v1: Unit{}}
	}
	return v5
}

func symbol(c Cell) string {
	var v5 string
	switch c.tag {
	case Cell_Empty:
		v5 = "."
	case Cell_X:
		v5 = "X"
	case Cell_O:
		v5 = "O"
	}
	return v5
}

func winnerIn(lines List_Tuple_Square_Square_Square, board Lens_Vector_Cell) Cell {
	var v5 Cell
	switch lines.tag {
	case List_Tuple_Square_Square_Square_nil:
		v5 = Cell{tag: Cell_Empty, v0: Unit{}}
	case List_Tuple_Square_Square_Square_cons:
		v8 := *lines.v1
		a := v8.item0.item0
		b := v8.item0.item1
		c := v8.item0.item2
		v25 := lineOwner(a, b, c, board)
		var v28 Cell
		switch v25.tag {
		case Cell_Empty:
			rest := v8.item1
			v28 = winnerIn(rest, board)
		default:
			v28 = v25
		}
		v5 = v28
	}
	return v5
}

func slot(sq Square) float64 {
	var v5 float64
	switch sq.tag {
	case Square_C0:
		v5 = 0.0
	case Square_C1:
		v5 = 1.0
	case Square_C2:
		v5 = 2.0
	case Square_C3:
		v5 = 3.0
	case Square_C4:
		v5 = 4.0
	case Square_C5:
		v5 = 5.0
	case Square_C6:
		v5 = 6.0
	case Square_C7:
		v5 = 7.0
	case Square_C8:
		v5 = 8.0
	}
	return v5
}

func entry() Outcome {
	return game()
}

func hostInput(prompt string) string {
	fmt.Print(prompt)
	if stdin == nil {
		stdin = bufio.NewReader(os.Stdin)
	}
	line, _ := stdin.ReadString('\n')
	if len(line) > 0 && line[len(line)-1] == '\n' {
		line = line[:len(line)-1]
	}
	return line
}

func hostPrint_Unit(value string) Unit {
	fmt.Print(value + "\n")
	return Unit{}
}

func vector_at_Vector_Cell(value Vector_Cell, index float64) *Cell {
	if !(index >= 0) || index != math.Floor(index) || index >= float64(len(value)) {
		panic("vector index out of bounds")
	}
	return &value[int(index)]
}

func vector_equal_Cell(left Cell, right Cell) bool {
	if left.tag != right.tag {
		return false
	}
	if left.tag == Cell_Empty {
		return (left.v0 == right.v0)
	}
	if left.tag == Cell_X {
		return (left.v1 == right.v1)
	}
	if left.tag == Cell_O {
		return (left.v2 == right.v2)
	}
	return true
}

func vector_array_Vector_Cell(length float64, init Cell) Vector_Cell {
	if !(length >= 0) || length != math.Floor(length) || length > float64(math.MaxInt32) {
		panic("array length must be a non-negative integer")
	}
	out := make(Vector_Cell, int(length))
	for i := range out {
		if i+1 == len(out) {
			out[i] = init
		} else {
			out[i] = init
		}
	}
	return out
}

func print_Cell(value Cell) {
	if value.tag == Cell_Empty {
		fmt.Print("{\"kind\":\"variant\",\"name\":\"Empty\",\"items\":[")
		fmt.Print("]}")
	} else if value.tag == Cell_X {
		fmt.Print("{\"kind\":\"variant\",\"name\":\"X\",\"items\":[")
		fmt.Print("]}")
	} else if value.tag == Cell_O {
		fmt.Print("{\"kind\":\"variant\",\"name\":\"O\",\"items\":[")
		fmt.Print("]}")
	}
}

func print_Outcome(value Outcome) {
	if value.tag == Outcome_Won {
		fmt.Print("{\"kind\":\"variant\",\"name\":\"Won\",\"items\":[")
		print_Cell(*value.v0)
		fmt.Print("]}")
	} else if value.tag == Outcome_Draw {
		fmt.Print("{\"kind\":\"variant\",\"name\":\"Draw\",\"items\":[")
		fmt.Print("]}")
	}
}

func main() {
	result0 := entry()
	fmt.Print("\x1e")
	print_Outcome(result0)
	fmt.Println()
}
