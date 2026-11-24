package main

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Unit struct{}

const Direction_Up uint32 = 0

const Direction_Down uint32 = 1

const Direction_Left uint32 = 2

const Direction_Right uint32 = 3

type Direction struct {
	tag uint32
	v0 Unit
	v1 Unit
	v2 Unit
	v3 Unit
}

type Tuple_Number_Number struct {
	item0 float64
	item1 float64
}

const List_Tuple_Number_Number_nil uint32 = 0

const List_Tuple_Number_Number_cons uint32 = 1

type List_Tuple_Number_Number struct {
	tag uint32
	v0 Unit
	v1 *Tuple_Tuple_Number_Number_List_Tuple_Number_Number
}

type Tuple_Tuple_Number_Number_List_Tuple_Number_Number struct {
	item0 Tuple_Number_Number
	item1 List_Tuple_Number_Number
}

var hostKeys chan byte

var hostKeysOnce sync.Once

var hostRandomState uint32

func width() float64 {
	return 20.0
}

func step(spot Tuple_Number_Number, dir Direction) Tuple_Number_Number {
	var v10 float64
	var v11 float64
	switch dir.tag {
	case Direction_Up:
		x := spot.item0
		y := spot.item1
		v10 = x
		v11 = y - 1.0
	case Direction_Down:
		x_2 := spot.item0
		y_2 := spot.item1
		v10 = x_2
		v11 = y_2 + 1.0
	case Direction_Left:
		x_3 := spot.item0
		y_3 := spot.item1
		v10 = x_3 - 1.0
		v11 = y_3
	case Direction_Right:
		x_4 := spot.item0
		y_4 := spot.item1
		v10 = x_4 + 1.0
		v11 = y_4
	}
	return Tuple_Number_Number{item0: v10, item1: v11}
}

func height() float64 {
	return 10.0
}

func game() float64 {
	v15 := List_Tuple_Number_Number{tag: List_Tuple_Number_Number_nil, v0: Unit{}}
	v64 := new(Tuple_Tuple_Number_Number_List_Tuple_Number_Number)
	*v64 = Tuple_Tuple_Number_Number_List_Tuple_Number_Number{item0: Tuple_Number_Number{item0: 3.0, item1: 5.0}, item1: v15}
	v16 := List_Tuple_Number_Number{tag: List_Tuple_Number_Number_cons, v1: v64}
	v65 := new(Tuple_Tuple_Number_Number_List_Tuple_Number_Number)
	*v65 = Tuple_Tuple_Number_Number_List_Tuple_Number_Number{item0: Tuple_Number_Number{item0: 4.0, item1: 5.0}, item1: v16}
	v17 := List_Tuple_Number_Number{tag: List_Tuple_Number_Number_cons, v1: v65}
	v66 := new(Tuple_Tuple_Number_Number_List_Tuple_Number_Number)
	*v66 = Tuple_Tuple_Number_Number_List_Tuple_Number_Number{item0: Tuple_Number_Number{item0: 5.0, item1: 5.0}, item1: v17}
	body := List_Tuple_Number_Number{tag: List_Tuple_Number_Number_cons, v1: v66}
	v40 := Direction{tag: Direction_Right, v3: Unit{}}
	v63 := placeFood(body)
	score := play(body, v40, v63, 0.0)
	hostPrint_Unit("game over, score " + formatNumber(score))
	return score
}

func dropLast(body List_Tuple_Number_Number) List_Tuple_Number_Number {
	var v5 List_Tuple_Number_Number
	if body.tag == List_Tuple_Number_Number_nil {
		v5 = List_Tuple_Number_Number{tag: List_Tuple_Number_Number_nil, v0: Unit{}}
	} else if body.tag == List_Tuple_Number_Number_cons && (*body.v1).item1.tag == List_Tuple_Number_Number_nil {
		v5 = List_Tuple_Number_Number{tag: List_Tuple_Number_Number_nil, v0: Unit{}}
	} else if body.tag == List_Tuple_Number_Number_cons {
		v11 := *body.v1
		segment := v11.item0
		rest := v11.item1
		v22 := dropLast(rest)
		v25 := new(Tuple_Tuple_Number_Number_List_Tuple_Number_Number)
		*v25 = Tuple_Tuple_Number_Number_List_Tuple_Number_Number{item0: segment, item1: v22}
		v5 = List_Tuple_Number_Number{tag: List_Tuple_Number_Number_cons, v1: v25}
	} else {
		panic("unmatched case")
	}
	return v5
}

func render(body List_Tuple_Number_Number, food Tuple_Number_Number, score float64) Unit {
	hostWrite_Unit("\x1b[H\x1b[2J")
	hostPrint_Unit("score: " + formatNumber(score) + "   (w/a/s/d to steer, q to quit)")
	drawRows(0.0, body, food)
	return Unit{}
}

func play(body List_Tuple_Number_Number, dir Direction, food Tuple_Number_Number, score float64) float64 {
	render(body, food, score)
	key := hostKey(150.0)
	var v34 float64
	if (key == "q") {
		v34 = score
	} else {
		dir_2 := turn(dir, key)
		var v56 float64
		switch body.tag {
		case List_Tuple_Number_Number_nil:
			v56 = score
		case List_Tuple_Number_Number_cons:
			v62 := *body.v1
			head := v62.item0
			next := step(head, dir_2)
			v85 := crashed(next, body)
			var v88 float64
			if v85 {
				v88 = score
			} else {
				var v106 float64
				if vector_equal_Tuple_Number_Number(next, food) {
					v138 := new(Tuple_Tuple_Number_Number_List_Tuple_Number_Number)
					*v138 = Tuple_Tuple_Number_Number_List_Tuple_Number_Number{item0: next, item1: body}
					grown := List_Tuple_Number_Number{tag: List_Tuple_Number_Number_cons, v1: v138}
					v137 := placeFood(grown)
					v106 = play(grown, dir_2, v137, score + 1.0)
				} else {
					v165 := dropLast(body)
					v182 := new(Tuple_Tuple_Number_Number_List_Tuple_Number_Number)
					*v182 = Tuple_Tuple_Number_Number_List_Tuple_Number_Number{item0: next, item1: v165}
					v167 := List_Tuple_Number_Number{tag: List_Tuple_Number_Number_cons, v1: v182}
					v106 = play(v167, dir_2, food, score)
				}
				v88 = v106
			}
			v56 = v88
		}
		v34 = v56
	}
	return v34
}

func crashed(head Tuple_Number_Number, body List_Tuple_Number_Number) bool {
	x := head.item0
	var v16 bool
	if x < 0.0 {
		v16 = true
	} else {
		x_2 := head.item0
		v26 := width()
		v16 = x_2 >= v26
	}
	var v33 bool
	if v16 {
		v33 = true
	} else {
		y := head.item1
		v33 = y < 0.0
	}
	var v47 bool
	if v33 {
		v47 = true
	} else {
		y_2 := head.item1
		v57 := height()
		v47 = y_2 >= v57
	}
	var v64 bool
	if v47 {
		v64 = true
	} else {
		v64 = contains(body, head)
	}
	return v64
}

func drawRows(y float64, body List_Tuple_Number_Number, food Tuple_Number_Number) Unit {
	v7 := height()
	if y >= v7 {
	} else {
		v33 := rowText(0.0, y, body, food)
		hostPrint_Unit(v33)
		drawRows(y + 1.0, body, food)
	}
	return Unit{}
}

func cell(spot Tuple_Number_Number, body List_Tuple_Number_Number, food Tuple_Number_Number) string {
	var v5 string
	switch body.tag {
	case List_Tuple_Number_Number_cons:
		v6 := *body.v1
		head := v6.item0
		var v20 string
		if vector_equal_Tuple_Number_Number(spot, head) {
			v20 = "O"
		} else {
			v33 := contains(body, spot)
			var v36 string
			if v33 {
				v36 = "o"
			} else {
				var v52 string
				if vector_equal_Tuple_Number_Number(spot, food) {
					v52 = "*"
				} else {
					v52 = "."
				}
				v36 = v52
			}
			v20 = v36
		}
		v5 = v20
	case List_Tuple_Number_Number_nil:
		v5 = "."
	}
	return v5
}

func placeFood(body List_Tuple_Number_Number) Tuple_Number_Number {
	v3 := width()
	v6 := hostRandom(v3)
	v10 := height()
	v13 := hostRandom(v10)
	v29 := contains(body, Tuple_Number_Number{item0: v6, item1: v13})
	var v32 float64
	var v33 float64
	if v29 {
		v40 := placeFood(body)
		v32 = v40.item0
		v33 = v40.item1
	} else {
		v32 = v6
		v33 = v13
	}
	return Tuple_Number_Number{item0: v32, item1: v33}
}

func rowText(x float64, y float64, body List_Tuple_Number_Number, food Tuple_Number_Number) string {
	v7 := width()
	var v13 string
	if x >= v7 {
		v13 = ""
	} else {
		v35 := cell(Tuple_Number_Number{item0: x, item1: y}, body, food)
		v60 := rowText(x + 1.0, y, body, food)
		v13 = v35 + v60
	}
	return v13
}

func contains(body List_Tuple_Number_Number, spot Tuple_Number_Number) bool {
	var v5 bool
	switch body.tag {
	case List_Tuple_Number_Number_nil:
		v5 = false
	case List_Tuple_Number_Number_cons:
		v9 := *body.v1
		segment := v9.item0
		var v23 bool
		if vector_equal_Tuple_Number_Number(segment, spot) {
			v23 = true
		} else {
			rest := v9.item1
			v23 = contains(rest, spot)
		}
		v5 = v23
	}
	return v5
}

func turn(dir Direction, key string) Direction {
	var v10 Direction
	if key == "w" && dir.tag == Direction_Down {
		v10 = dir
	} else if key == "s" && dir.tag == Direction_Up {
		v10 = dir
	} else if key == "a" && dir.tag == Direction_Right {
		v10 = dir
	} else if key == "d" && dir.tag == Direction_Left {
		v10 = dir
	} else if key == "w" && true {
		v10 = Direction{tag: Direction_Up, v0: Unit{}}
	} else if key == "s" && true {
		v10 = Direction{tag: Direction_Down, v1: Unit{}}
	} else if key == "a" && true {
		v10 = Direction{tag: Direction_Left, v2: Unit{}}
	} else if key == "d" && true {
		v10 = Direction{tag: Direction_Right, v3: Unit{}}
	} else {
		v10 = dir
	}
	return v10
}

func entry() float64 {
	return game()
}

func hostPrint_Unit(value string) Unit {
	fmt.Print(value + "\n")
	return Unit{}
}

func hostWrite_Unit(value string) Unit {
	fmt.Print(value)
	return Unit{}
}

func hostKey(milliseconds float64) string {
	fmt.Print("")
	hostKeysOnce.Do(func() {
		hostKeys = make(chan byte, 64)
		go func() {
			defer close(hostKeys)
			one := make([]byte, 1)
			for {
				n, err := os.Stdin.Read(one)
				if n == 1 {
					hostKeys <- one[0]
				}
				if err != nil {
					return
				}
			}
		}()
	})
	restore := func() {}
	if info, err := os.Stdin.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
		query := exec.Command("stty", "-g")
		query.Stdin = os.Stdin
		if saved, err := query.Output(); err == nil {
			raw := exec.Command("stty", "-icanon", "-echo")
			raw.Stdin = os.Stdin
			raw.Run()
			restore = func() {
				back := exec.Command("stty", strings.TrimSpace(string(saved)))
				back.Stdin = os.Stdin
				back.Run()
			}
		}
	}
	defer restore()
	select {
	case b, ok := <-hostKeys:
		if !ok {
			return ""
		}
		return string([]byte{b})
	case <-time.After(time.Duration(milliseconds * float64(time.Millisecond))):
		return ""
	}
}

func vector_equal_Tuple_Number_Number(left Tuple_Number_Number, right Tuple_Number_Number) bool {
	return (left.item0 == right.item0) && (left.item1 == right.item1)
}

func hostRandom(bound float64) float64 {
	if !(bound >= 1 && bound < 4294967296 && bound == math.Floor(bound)) {
		panic("random bound must be an integer in [1, 2^32)")
	}
	if hostRandomState == 0 {
		hostRandomState = uint32(time.Now().UnixNano())
		if seed, ok := os.LookupEnv("LAMINAR_SEED"); ok {
			n, _ := strconv.ParseUint(seed, 10, 64)
			hostRandomState = uint32(n)
		}
		if hostRandomState == 0 {
			hostRandomState = 2463534242
		}
	}
	hostRandomState ^= hostRandomState << 13
	hostRandomState ^= hostRandomState >> 17
	hostRandomState ^= hostRandomState << 5
	return float64(hostRandomState % uint32(bound))
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
	printNumber(result0)
	fmt.Println()
}
