package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
)

type Unit struct{}

type Tuple_Number_Number_Number struct {
	item0 float64
	item1 float64
	item2 float64
}

const List_Tuple_Number_Number_Number_nil uint32 = 0

const List_Tuple_Number_Number_Number_cons uint32 = 1

type List_Tuple_Number_Number_Number struct {
	tag uint32
	v0 Unit
	v1 *Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number
}

type Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number struct {
	item0 Tuple_Number_Number_Number
	item1 List_Tuple_Number_Number_Number
}

type Lens_Vector_Number struct {
	read *Vector_Number
	restore Func_Vector_Number_to_Unit_d5da9e60ce
	context any
}

type Vector_Number []float64

type Func_Vector_Number_to_Unit_d5da9e60ce func(environment any, arg0 Vector_Number) Unit

var stdin *bufio.Reader

type Backing_Vector_Number_1264850431 struct {
	read0 Vector_Number
}

func symbol(cell float64) string {
	var v5 string
	if cell == 1.0 {
		v5 = "X"
	} else if cell == 4.0 {
		v5 = "O"
	} else {
		v5 = "."
	}
	return v5
}

func render(board Lens_Vector_Number) Unit {
	v7 := row(0.0, board)
	hostPrint_Unit(v7)
	v20 := row(3.0, board)
	hostPrint_Unit(v20)
	v33 := row(6.0, board)
	hostPrint_Unit(v33)
	return Unit{}
}

func takeTurn(player float64, board Lens_Vector_Number) Unit {
	v7 := symbol(player)
	input := hostInput(v7 + ", pick a square (1-9): ")
	square := parseSquare(input)
	if square == 9.0 {
		hostPrint_Unit("Please pick a number from 1 to 9.")
		takeTurn(player, board)
	} else {
		v60 := at(square, board)
		if v60 == 0.0 {
			v78 := vector_at_Vector_Number(*board.read, square)
			*v78 = player
		} else {
			hostPrint_Unit("That square is taken.")
			takeTurn(player, board)
		}
	}
	return Unit{}
}

func at(i float64, board Lens_Vector_Number) float64 {
	v9 := vector_at_Vector_Number(*board.read, i)
	return *v9
}

func other(player float64) float64 {
	var v5 float64
	if player == 1.0 {
		v5 = 4.0
	} else {
		v5 = 1.0
	}
	return v5
}

func game() string {
	board := vector_array_Vector_Number(9.0, 0.0)
	var back0 Backing_Vector_Number_1264850431
	back0.read0 = board
	return play(1.0, 0.0, Lens_Vector_Number{read: &back0.read0})
}

func row(a float64, board Lens_Vector_Number) string {
	v9 := at(a, board)
	v12 := symbol(v9)
	v28 := at(a + 1.0, board)
	v32 := symbol(v28)
	v48 := at(a + 2.0, board)
	v52 := symbol(v48)
	return v12 + " " + v32 + " " + v52
}

func winner(board Lens_Vector_Number) float64 {
	v58 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_nil, v0: Unit{}}
	v70 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v70 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 2.0, item1: 4.0, item2: 6.0}, item1: v58}
	v59 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v70}
	v71 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v71 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 0.0, item1: 4.0, item2: 8.0}, item1: v59}
	v60 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v71}
	v72 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v72 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 2.0, item1: 5.0, item2: 8.0}, item1: v60}
	v61 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v72}
	v73 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v73 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 1.0, item1: 4.0, item2: 7.0}, item1: v61}
	v62 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v73}
	v74 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v74 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 0.0, item1: 3.0, item2: 6.0}, item1: v62}
	v63 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v74}
	v75 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v75 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 6.0, item1: 7.0, item2: 8.0}, item1: v63}
	v64 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v75}
	v76 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v76 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 3.0, item1: 4.0, item2: 5.0}, item1: v64}
	v65 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v76}
	v77 := new(Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number)
	*v77 = Tuple_Tuple_Number_Number_Number_List_Tuple_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: 0.0, item1: 1.0, item2: 2.0}, item1: v65}
	v66 := List_Tuple_Number_Number_Number{tag: List_Tuple_Number_Number_Number_cons, v1: v77}
	return winnerIn(v66, board)
}

func parseSquare(input string) float64 {
	var v5 float64
	switch input {
	case "1":
		v5 = 0.0
	case "2":
		v5 = 1.0
	case "3":
		v5 = 2.0
	case "4":
		v5 = 3.0
	case "5":
		v5 = 4.0
	case "6":
		v5 = 5.0
	case "7":
		v5 = 6.0
	case "8":
		v5 = 7.0
	case "9":
		v5 = 8.0
	default:
		v5 = 9.0
	}
	return v5
}

func play(player float64, turns float64, board Lens_Vector_Number) string {
	render(board)
	v11 := winner(board)
	var v14 string
	if v11 == 0.0 {
		var v26 string
		if turns == 9.0 {
			v26 = "draw"
		} else {
			takeTurn(player, board)
			v48 := other(player)
			v26 = play(v48, turns + 1.0, board)
		}
		v14 = v26
	} else {
		v14 = symbol(v11)
	}
	return v14
}

func lineOwner(a float64, b float64, c float64, board Lens_Vector_Number) float64 {
	v10 := at(a, board)
	v19 := at(b, board)
	v32 := at(c, board)
	v36 := v10 + v19 + v32
	var v39 float64
	if v36 == 3.0 {
		v39 = 1.0
	} else if v36 == 12.0 {
		v39 = 4.0
	} else {
		v39 = 0.0
	}
	return v39
}

func winnerIn(lines List_Tuple_Number_Number_Number, board Lens_Vector_Number) float64 {
	var v5 float64
	switch lines.tag {
	case List_Tuple_Number_Number_Number_nil:
		v5 = 0.0
	case List_Tuple_Number_Number_Number_cons:
		v9 := *lines.v1
		a := v9.item0.item0
		b := v9.item0.item1
		c := v9.item0.item2
		v26 := lineOwner(a, b, c, board)
		var v29 float64
		if v26 == 0.0 {
			rest := v9.item1
			v29 = winnerIn(rest, board)
		} else {
			v29 = v26
		}
		v5 = v29
	}
	return v5
}

func entry() string {
	return game()
}

func hostPrint_Unit(value string) Unit {
	fmt.Print(value + "\n")
	return Unit{}
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

func vector_at_Vector_Number(value Vector_Number, index float64) *float64 {
	if !(index >= 0) || index != math.Floor(index) || index >= float64(len(value)) {
		panic("vector index out of bounds")
	}
	return &value[int(index)]
}

func vector_array_Vector_Number(length float64, init float64) Vector_Number {
	if !(length >= 0) || length != math.Floor(length) || length > float64(math.MaxInt32) {
		panic("array length must be a non-negative integer")
	}
	out := make(Vector_Number, int(length))
	for i := range out {
		if i+1 == len(out) {
			out[i] = init
		} else {
			out[i] = init
		}
	}
	return out
}

func printString(s string) {
	out := []byte{'"'}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '"' || c == '\\' {
			out = append(out, '\\', c)
		} else if c < 32 {
			out = append(out, fmt.Sprintf("\\u%04x", c)...)
		} else {
			out = append(out, c)
		}
	}
	out = append(out, '"')
	fmt.Print(string(out))
}

func main() {
	result0 := entry()
	fmt.Print("\x1e")
	printString(result0)
	fmt.Println()
}
