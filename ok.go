package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"strconv"
)

type L0 = float64

type L1 struct {
	item0 L0
	item1 L0
	item2 L0
}

type L2 struct {
	item0 L1
	item1 L0
}

type L3 struct {
	environment any
	dispose A7
}

type L4 struct {

}

type L5 struct {
	read *L1
	restore A3
	context any
}

type L6 = string

type L7 struct{}

type L8 = bool

type L9 struct {
	read *L0
	restore A10
	context any
}

type L10 struct {
	item0 L9
	item1 L9
	item2 L9
	restore A3
	context any
}

type L11 struct {
	tag uint32
	v0 L7
	v1 L7
}

type L12 struct {
	read *L7
	replacement *L0
	restore A10
	context any
}

type A0 func(environment any, arg0 L0, arg1 L10) L0

type A1 func(environment any, arg0 L0) L0

type A2 func(environment any, arg0 L0, arg1 L5) L0

type A3 func(environment any, arg0 L1) L7

type A4 func(environment any, arg0 L6) L6

type A5 func(environment any, arg0 L11, arg1 L10) L0

type A6 func(environment any, arg0 L6) L7

type A7 func(environment any) L7

type A8 func(environment any) L2

type A9 func(environment any, arg0 L6, arg1 L10) L8

type A10 func(environment any, arg0 L0) L7

type A11 func(environment any, arg0 L0, arg1 L0) L0

type A12 func(environment any, arg0 L9) L0

var stdin *bufio.Reader

type Backing6 struct {
	read0 L1
}

func step_scattered(environment any, steps L0, min_max_lastGuess L10) L0 {
	lastGuess := *((min_max_lastGuess).item2).read
	v3 := "My guess is " + formatNumber(lastGuess) + " (higher/lower/match): "
	input := hostInput(v3)
	input_2 := input
	next := handleResponse(nil, input_2, L10{item0: L9{read: ((min_max_lastGuess).item0).read}, item1: L9{read: ((min_max_lastGuess).item1).read}, item2: L9{read: ((min_max_lastGuess).item2).read}})
	next_2 := next
	v14 := 0.0
	if next_2 == true {
		steps_2 := steps
		v14 = steps_2
	} else if next_2 == false {
		steps_3 := steps
		v26 := 1.0
		v24 := (steps_3 + v26)
		v25 := step_scattered(nil, v24, L10{item0: L9{read: ((min_max_lastGuess).item0).read}, item1: L9{read: ((min_max_lastGuess).item1).read}, item2: L9{read: ((min_max_lastGuess).item2).read}})
		v14 = v25
	} else {
		panic("unmatched case")
	}
	*((min_max_lastGuess).item0).read = *((min_max_lastGuess).item0).read
	*((min_max_lastGuess).item1).read = *((min_max_lastGuess).item1).read
	*((min_max_lastGuess).item2).read = *((min_max_lastGuess).item2).read
	return v14
}

func handleResponse(environment any, response L6, state L10) L8 {
	response_2 := response
	v1 := false
	v49 := 0.0
	v50 := 0.0
	v51 := 0.0
	if response_2 == "higher" {
		v5 := L11{tag: 0, v0: L7{}}
		next := nextGuess(nil, v5, L10{item0: L9{read: ((state).item0).read}, item1: L9{read: ((state).item1).read}, item2: L9{read: ((state).item2).read}})
		last := *((state).item2).read
		next_3 := next
		v49 = last
		v50 = *((state).item1).read
		v51 = next_3
		v1 = false
	} else if response_2 == "lower" {
		v24 := L11{tag: 1, v1: L7{}}
		next_2 := nextGuess(nil, v24, L10{item0: L9{read: ((state).item0).read}, item1: L9{read: ((state).item1).read}, item2: L9{read: ((state).item2).read}})
		last_2 := *((state).item2).read
		next_2_2 := next_2
		v49 = *((state).item0).read
		v50 = last_2
		v51 = next_2_2
		v1 = false
	} else if response_2 == "match" {
		v49 = *((state).item0).read
		v50 = *((state).item1).read
		v51 = *((state).item2).read
		v1 = true
	} else if true {
		v44 := "I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'"
		hostPrint_L7(v44)
		v49 = *((state).item0).read
		v50 = *((state).item1).read
		v51 = *((state).item2).read
		v1 = false
	} else {
		panic("unmatched case")
	}
	*((state).item0).read = v49
	*((state).item1).read = v50
	*((state).item2).read = v51
	return v1
}

func step_thin(environment any, steps L0, min_max_lastGuess L5) L0 {
	lastGuess := (*(min_max_lastGuess).read).item2
	v3 := "My guess is " + formatNumber(lastGuess) + " (higher/lower/match): "
	input := hostInput(v3)
	input_2 := input
	next := handleResponse(nil, input_2, L10{item0: L9{read: &(*(min_max_lastGuess).read).item0}, item1: L9{read: &(*(min_max_lastGuess).read).item1}, item2: L9{read: &(*(min_max_lastGuess).read).item2}})
	next_2 := next
	v14 := 0.0
	if next_2 == true {
		steps_2 := steps
		v14 = steps_2
	} else if next_2 == false {
		steps_3 := steps
		v26 := 1.0
		v24 := (steps_3 + v26)
		v25 := step_scattered(nil, v24, L10{item0: L9{read: &(*(min_max_lastGuess).read).item0}, item1: L9{read: &(*(min_max_lastGuess).read).item1}, item2: L9{read: &(*(min_max_lastGuess).read).item2}})
		v14 = v25
	} else {
		panic("unmatched case")
	}
	*(min_max_lastGuess).read = *(min_max_lastGuess).read
	return v14
}

func game(environment any) L2 {
	state := L1{item0: 0.0, item1: 100.0, item2: 50.0}
	back6 := Backing6{}
	back6.read0 = state
	v8 := L5{read: &back6.read0}
	steps := step_thin(nil, 0.0, v8)
	v9 := *(v8).read
	state_2 := v9
	steps_2 := steps
	v12 := L2{item0: state_2, item1: steps_2}
	return v12
}

func nextGuess(environment any, direction L11, min_max_lastGuess L10) L0 {
	direction_2 := direction
	v2 := 0.0
	if (direction_2).tag == 0 {
		max := *((min_max_lastGuess).item1).read
		lastGuess := *((min_max_lastGuess).item2).read
		v11 := (max + lastGuess)
		v26 := 2.0
		v13 := (v11 / v26)
		v2 = v13
	} else if (direction_2).tag == 1 {
		lastGuess_2 := *((min_max_lastGuess).item2).read
		min := *((min_max_lastGuess).item0).read
		v22 := (lastGuess_2 + min)
		v27 := 2.0
		v24 := (v22 / v27)
		v2 = v24
	} else {
		panic("unmatched case")
	}
	v25 := laminarRound(v2)
	*((min_max_lastGuess).item0).read = *((min_max_lastGuess).item0).read
	*((min_max_lastGuess).item1).read = *((min_max_lastGuess).item1).read
	*((min_max_lastGuess).item2).read = *((min_max_lastGuess).item2).read
	return v25
}

func entry(environment any) L2 {
	v1 := game(nil)
	return v1
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

func hostPrint_L7(value string) L7 {
	fmt.Print(value + "\n")
	return L7{}
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
	result0 := entry(nil)
	fmt.Print("\x1e")
	fmt.Print("[")
	fmt.Print("[")
	printNumber(((result0).item0).item0)
	fmt.Print(",")
	printNumber(((result0).item0).item1)
	fmt.Print(",")
	printNumber(((result0).item0).item2)
	fmt.Print("]")
	fmt.Print(",")
	printNumber((result0).item1)
	fmt.Print("]")
	fmt.Println()
}
