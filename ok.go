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
	input := hostInput("My guess is " + formatNumber(lastGuess) + " (higher/lower/match): ")
	next := handleResponse(nil, input, L10{item0: L9{read: ((min_max_lastGuess).item0).read}, item1: L9{read: ((min_max_lastGuess).item1).read}, item2: L9{read: ((min_max_lastGuess).item2).read}})
	v20 := 0.0
	if next == true {
		v20 = steps
	} else if next == false {
		v20 = step_scattered(nil, (steps + 1.0), L10{item0: L9{read: ((min_max_lastGuess).item0).read}, item1: L9{read: ((min_max_lastGuess).item1).read}, item2: L9{read: ((min_max_lastGuess).item2).read}})
	} else {
		panic("unmatched case")
	}
	*((min_max_lastGuess).item0).read = *((min_max_lastGuess).item0).read
	*((min_max_lastGuess).item1).read = *((min_max_lastGuess).item1).read
	*((min_max_lastGuess).item2).read = *((min_max_lastGuess).item2).read
	return v20
}

func handleResponse(environment any, response L6, state L10) L8 {
	v1 := false
	v47 := 0.0
	v48 := 0.0
	v49 := 0.0
	if response == "higher" {
		v4 := L11{tag: 0, v0: L7{}}
		next := nextGuess(nil, v4, L10{item0: L9{read: ((state).item0).read}, item1: L9{read: ((state).item1).read}, item2: L9{read: ((state).item2).read}})
		v47 = *((state).item2).read
		v48 = *((state).item1).read
		v49 = next
		v1 = false
	} else if response == "lower" {
		v21 := L11{tag: 1, v1: L7{}}
		next_2 := nextGuess(nil, v21, L10{item0: L9{read: ((state).item0).read}, item1: L9{read: ((state).item1).read}, item2: L9{read: ((state).item2).read}})
		last_2 := *((state).item2).read
		v47 = *((state).item0).read
		v48 = last_2
		v49 = next_2
		v1 = false
	} else if response == "match" {
		v47 = *((state).item0).read
		v48 = *((state).item1).read
		v49 = *((state).item2).read
		v1 = true
	} else if true {
		hostPrint_L7("I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'")
		v47 = *((state).item0).read
		v48 = *((state).item1).read
		v49 = *((state).item2).read
		v1 = false
	} else {
		panic("unmatched case")
	}
	*((state).item0).read = v47
	*((state).item1).read = v48
	*((state).item2).read = v49
	return v1
}

func step_thin(environment any, steps L0, min_max_lastGuess L5) L0 {
	lastGuess := (*(min_max_lastGuess).read).item2
	input := hostInput("My guess is " + formatNumber(lastGuess) + " (higher/lower/match): ")
	next := handleResponse(nil, input, L10{item0: L9{read: &(*(min_max_lastGuess).read).item0}, item1: L9{read: &(*(min_max_lastGuess).read).item1}, item2: L9{read: &(*(min_max_lastGuess).read).item2}})
	v20 := 0.0
	if next == true {
		v20 = steps
	} else if next == false {
		v20 = step_scattered(nil, (steps + 1.0), L10{item0: L9{read: &(*(min_max_lastGuess).read).item0}, item1: L9{read: &(*(min_max_lastGuess).read).item1}, item2: L9{read: &(*(min_max_lastGuess).read).item2}})
	} else {
		panic("unmatched case")
	}
	*(min_max_lastGuess).read = *(min_max_lastGuess).read
	return v20
}

func game(environment any) L2 {
	back6 := Backing6{}
	back6.read0 = L1{item0: 0.0, item1: 100.0, item2: 50.0}
	v13 := L5{read: &back6.read0}
	steps := step_thin(nil, 0.0, v13)
	v14 := *(v13).read
	return L2{item0: v14, item1: steps}
}

func nextGuess(environment any, direction L11, min_max_lastGuess L10) L0 {
	v2 := 0.0
	if (direction).tag == 0 {
		max := *((min_max_lastGuess).item1).read
		lastGuess := *((min_max_lastGuess).item2).read
		v2 = ((max + lastGuess) / 2.0)
	} else if (direction).tag == 1 {
		lastGuess_2 := *((min_max_lastGuess).item2).read
		min := *((min_max_lastGuess).item0).read
		v2 = ((lastGuess_2 + min) / 2.0)
	} else {
		panic("unmatched case")
	}
	v42 := laminarRound(v2)
	*((min_max_lastGuess).item0).read = *((min_max_lastGuess).item0).read
	*((min_max_lastGuess).item1).read = *((min_max_lastGuess).item1).read
	*((min_max_lastGuess).item2).read = *((min_max_lastGuess).item2).read
	return v42
}

func entry(environment any) L2 {
	return game(nil)
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
