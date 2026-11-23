package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"strconv"
)

type Tuple_Number_Number_Number struct {
	item0 float64
	item1 float64
	item2 float64
}

type Tuple_Tuple_Number_Number_Number_Number struct {
	item0 Tuple_Number_Number_Number
	item1 float64
}

type Unit struct{}

type Lens_float64 struct {
	read *float64
	restore Func_float64_to_Unit_e8b5a11084
	context any
}

type Scattered_Lens_float64_Lens_float64_Lens_float64 struct {
	item0 Lens_float64
	item1 Lens_float64
	item2 Lens_float64
	restore Func_Tuple_Number_Number_Number_to_Unit_31b28240d9
	context any
}

const Direction_Higher uint32 = 0

const Direction_Lower uint32 = 1

type Direction struct {
	tag uint32
	v0 Unit
	v1 Unit
}

type Func_Tuple_Number_Number_Number_to_Unit_31b28240d9 func(environment any, arg0 Tuple_Number_Number_Number) Unit

type Func_float64_to_Unit_e8b5a11084 func(environment any, arg0 float64) Unit

type Backing_float64_float64_float64_104b591eaf struct {
	read0 float64
	read1 float64
	read2 float64
}

var stdin *bufio.Reader

func game() Tuple_Tuple_Number_Number_Number_Number {
	var back0 Backing_float64_float64_float64_104b591eaf
	back0.read1 = 100.0
	back0.read2 = 50.0
	steps := step(0.0, Scattered_Lens_float64_Lens_float64_Lens_float64{item0: Lens_float64{read: &back0.read0}, item1: Lens_float64{read: &back0.read1}, item2: Lens_float64{read: &back0.read2}})
	return Tuple_Tuple_Number_Number_Number_Number{item0: Tuple_Number_Number_Number{item0: back0.read0, item1: back0.read1, item2: back0.read2}, item1: steps}
}

func handleResponse(response string, state Scattered_Lens_float64_Lens_float64_Lens_float64) bool {
	var v1 bool
	switch response {
	case "higher":
		v4 := Direction{tag: Direction_Higher, v0: Unit{}}
		next := nextGuess(v4, state)
		last := *state.item2.read
		v1 = false
		*state.item0.read, *state.item1.read, *state.item2.read = last, *state.item1.read, next
	case "lower":
		v21 := Direction{tag: Direction_Lower, v1: Unit{}}
		next_2 := nextGuess(v21, state)
		last_2 := *state.item2.read
		v1 = false
		*state.item0.read, *state.item1.read, *state.item2.read = *state.item0.read, last_2, next_2
	case "match":
		v1 = true
	default:
		hostPrint_Unit("I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'")
		v1 = false
	}
	return v1
}

func step(steps float64, min_max_lastGuess Scattered_Lens_float64_Lens_float64_Lens_float64) float64 {
	lastGuess := *min_max_lastGuess.item2.read
	input := hostInput("My guess is " + formatNumber(lastGuess) + " (higher/lower/match): ")
	next := handleResponse(input, min_max_lastGuess)
	var v20 float64
	if next {
		v20 = steps
	} else {
		v20 = step(steps + 1.0, min_max_lastGuess)
	}
	return v20
}

func nextGuess(direction Direction, min_max_lastGuess Scattered_Lens_float64_Lens_float64_Lens_float64) float64 {
	var v2 float64
	switch direction.tag {
	case Direction_Higher:
		max := *min_max_lastGuess.item1.read
		lastGuess := *min_max_lastGuess.item2.read
		v2 = (max + lastGuess) / 2.0
	case Direction_Lower:
		lastGuess_2 := *min_max_lastGuess.item2.read
		min := *min_max_lastGuess.item0.read
		v2 = (lastGuess_2 + min) / 2.0
	}
	return laminarRound(v2)
}

func entry() Tuple_Tuple_Number_Number_Number_Number {
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

func laminarRound(x float64) float64 {
	rounded := math.Floor(x)
	if x-rounded >= 0.5 {
		rounded++
	}
	if rounded == 0 {
		rounded = math.Copysign(0, x)
	}
	return rounded
}

func printNumber(x float64) {
	if math.IsNaN(x) {
		fmt.Print("{\"number\":\"NaN\"}")
	} else if math.IsInf(x, 1) {
		fmt.Print("{\"number\":\"Infinity\"}")
	} else if math.IsInf(x, -1) {
		fmt.Print("{\"number\":\"-Infinity\"}")
	} else if x == 0 && math.Signbit(x) {
		fmt.Print("{\"number\":\"-0\"}")
	} else {
		fmt.Print(strconv.FormatFloat(x, 'g', -1, 64))
	}
}

func formatNumber(x float64) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if x == 0 {
		return "0"
	}
	sign := ""
	if x < 0 {
		sign = "-"
		x = -x
	}
	if math.IsInf(x, 1) {
		return sign + "Infinity"
	}
	scientific := strconv.FormatFloat(x, 'e', -1, 64)
	mark := 0
	for scientific[mark] != 'e' {
		mark++
	}
	digits := ""
	for _, c := range scientific[:mark] {
		if c != '.' {
			digits += string(c)
		}
	}
	exponent, _ := strconv.Atoi(scientific[mark+1:])
	point, count := exponent+1, len(digits)
	zeros := func(n int) string {
		out := ""
		for ; n > 0; n-- {
			out += "0"
		}
		return out
	}
	if count <= point && point <= 21 {
		return sign + digits + zeros(point-count)
	}
	if 0 < point && point <= 21 {
		return sign + digits[:point] + "." + digits[point:]
	}
	if -6 < point && point <= 0 {
		return sign + "0." + zeros(-point) + digits
	}
	out := sign + digits[:1]
	if count > 1 {
		out += "." + digits[1:]
	}
	if point > 0 {
		return out + "e+" + strconv.Itoa(point-1)
	}
	return out + "e-" + strconv.Itoa(1-point)
}

func main() {
	result0 := entry()
	fmt.Print("\x1e")
	fmt.Print("[")
	fmt.Print("[")
	printNumber(result0.item0.item0)
	fmt.Print(",")
	printNumber(result0.item0.item1)
	fmt.Print(",")
	printNumber(result0.item0.item2)
	fmt.Print("]")
	fmt.Print(",")
	printNumber(result0.item1)
	fmt.Print("]")
	fmt.Println()
}
