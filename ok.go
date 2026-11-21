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

func fn0(environment any, arg0 L0, arg1 L10) L0 {
	var v3 L0
	var v4 L6
	var v5 L6
	var v13 L6
	var v29 L0
	var v33 L0
	var v31 L0
	var v14 L8
	var v17 L8
	var v21 L0
	var v32 L0
	var v19 L0
	v3 = *((arg1).item2).read
	v4 = "My guess is " + formatNumber(v3) + " (higher/lower/match): "
	v5 = hostInput(v4)
	v13 = v5
	v14 = fn1(nil, v13, L10{item0: L9{read: ((arg1).item0).read}, item1: L9{read: ((arg1).item1).read}, item2: L9{read: ((arg1).item2).read}})
	v17 = v14
	v19 = 0.0
	if v17 == true {
		v21 = arg0
		v19 = v21
	} else if v17 == false {
		v29 = arg0
		v33 = 1.0
		v31 = (v29 + v33)
		v32 = fn0(nil, v31, L10{item0: L9{read: ((arg1).item0).read}, item1: L9{read: ((arg1).item1).read}, item2: L9{read: ((arg1).item2).read}})
		v19 = v32
	} else {
		panic("unmatched case")
	}
	*((arg1).item0).read = *((arg1).item0).read
	*((arg1).item1).read = *((arg1).item1).read
	*((arg1).item2).read = *((arg1).item2).read
	return v19
}

func fn1(environment any, arg0 L6, arg1 L10) L8 {
	var v6 L11
	var v28 L11
	var v51 L6
	var v0 L6
	var v13 L0
	var v56 L0
	var v35 L0
	var v57 L0
	var v7 L0
	var v19 L0
	var v29 L0
	var v41 L0
	var v58 L0
	var v2 L8
	v0 = arg0
	v2 = false
	v56 = 0.0
	v57 = 0.0
	v58 = 0.0
	if v0 == "higher" {
		v6 = L11{tag: 0, v0: L7{}}
		v7 = fn4(nil, v6, L10{item0: L9{read: ((arg1).item0).read}, item1: L9{read: ((arg1).item1).read}, item2: L9{read: ((arg1).item2).read}})
		v13 = *((arg1).item2).read
		v19 = v7
		v56 = v13
		v57 = *((arg1).item1).read
		v58 = v19
		v2 = false
	} else if v0 == "lower" {
		v28 = L11{tag: 1, v1: L7{}}
		v29 = fn4(nil, v28, L10{item0: L9{read: ((arg1).item0).read}, item1: L9{read: ((arg1).item1).read}, item2: L9{read: ((arg1).item2).read}})
		v35 = *((arg1).item2).read
		v41 = v29
		v56 = *((arg1).item0).read
		v57 = v35
		v58 = v41
		v2 = false
	} else if v0 == "match" {
		v56 = *((arg1).item0).read
		v57 = *((arg1).item1).read
		v58 = *((arg1).item2).read
		v2 = true
	} else if true {
		v51 = "I'm sorry, I didn't understand that. Please say 'higher', 'lower', or 'match'"
		hostPrint_L7(v51)
		v56 = *((arg1).item0).read
		v57 = *((arg1).item1).read
		v58 = *((arg1).item2).read
		v2 = false
	} else {
		panic("unmatched case")
	}
	*((arg1).item0).read = v56
	*((arg1).item1).read = v57
	*((arg1).item2).read = v58
	return v2
}

func fn2(environment any, arg0 L0, arg1 L5) L0 {
	var v3 L0
	var v4 L6
	var v5 L6
	var v13 L6
	var v29 L0
	var v33 L0
	var v31 L0
	var v14 L8
	var v17 L8
	var v21 L0
	var v32 L0
	var v19 L0
	v3 = (*(arg1).read).item2
	v4 = "My guess is " + formatNumber(v3) + " (higher/lower/match): "
	v5 = hostInput(v4)
	v13 = v5
	v14 = fn1(nil, v13, L10{item0: L9{read: &(*(arg1).read).item0}, item1: L9{read: &(*(arg1).read).item1}, item2: L9{read: &(*(arg1).read).item2}})
	v17 = v14
	v19 = 0.0
	if v17 == true {
		v21 = arg0
		v19 = v21
	} else if v17 == false {
		v29 = arg0
		v33 = 1.0
		v31 = (v29 + v33)
		v32 = fn0(nil, v31, L10{item0: L9{read: &(*(arg1).read).item0}, item1: L9{read: &(*(arg1).read).item1}, item2: L9{read: &(*(arg1).read).item2}})
		v19 = v32
	} else {
		panic("unmatched case")
	}
	*(arg1).read = *(arg1).read
	return v19
}

func fn3(environment any) L2 {
	var v3 L1
	var back6 Backing6
	var v10 L5
	var v11 L1
	var v14 L1
	var v9 L0
	var v15 L0
	var v16 L2
	v3 = L1{item0: 0.0, item1: 100.0, item2: 50.0}
	back6 = Backing6{}
	back6.read0 = v3
	v10 = L5{read: &back6.read0}
	v9 = fn2(nil, 0.0, v10)
	v11 = *(v10).read
	v14 = v11
	v15 = v9
	v16 = L2{item0: v14, item1: v15}
	return v16
}

func fn4(environment any, arg0 L11, arg1 L10) L0 {
	var v1 L11
	var v10 L0
	var v13 L0
	var v14 L0
	var v31 L0
	var v16 L0
	var v23 L0
	var v26 L0
	var v27 L0
	var v32 L0
	var v29 L0
	var v3 L0
	var v30 L0
	v1 = arg0
	v3 = 0.0
	if (v1).tag == 0 {
		v10 = *((arg1).item1).read
		v13 = *((arg1).item2).read
		v14 = (v10 + v13)
		v31 = 2.0
		v16 = (v14 / v31)
		v3 = v16
	} else if (v1).tag == 1 {
		v23 = *((arg1).item2).read
		v26 = *((arg1).item0).read
		v27 = (v23 + v26)
		v32 = 2.0
		v29 = (v27 / v32)
		v3 = v29
	} else {
		panic("unmatched case")
	}
	v30 = laminarRound(v3)
	*((arg1).item0).read = *((arg1).item0).read
	*((arg1).item1).read = *((arg1).item1).read
	*((arg1).item2).read = *((arg1).item2).read
	return v30
}

func fn5(environment any) L2 {
	var v1 L2
	v1 = fn3(nil)
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
	var result0 L2 = fn5(nil)
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
