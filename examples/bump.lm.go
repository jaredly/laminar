package main

import (
	"fmt"
	"math"
	"strconv"
)

type Unit struct{}

const List_Number_nil uint32 = 0

const List_Number_cons uint32 = 1

type List_Number struct {
	tag uint32
	v0 Unit
	v1 *Tuple_Number_List_Number
}

type Tuple_Number_List_Number struct {
	item0 float64
	item1 List_Number
}

type Lens_List_Number struct {
	read *List_Number
	restore Func_List_Number_to_Unit_d9c2c8d6b2
	context any
}

type Func_List_Number_to_Unit_d9c2c8d6b2 func(environment any, arg0 List_Number) Unit

type Backing_List_Number_946144c3f6 struct {
	read0 List_Number
}

func bump(xs Lens_List_Number) Unit {
	v2 := *(xs).read
	switch (v2).tag {
	case List_Number_nil:
		v13 := List_Number{tag: List_Number_nil, v0: Unit{}}
		*(xs).read = v13
	case List_Number_cons:
		v16 := (v2).v1
		head := ((*v16)).item0
		(*v16).item0 = (head + 1.0)
		bump(Lens_List_Number{read: &(*v16).item1})
	}
	return Unit{}
}

func entry() List_Number {
	v3 := List_Number{tag: List_Number_nil, v0: Unit{}}
	v15 := new(Tuple_Number_List_Number)
	*v15 = Tuple_Number_List_Number{item0: 3.0, item1: v3}
	v5 := List_Number{tag: List_Number_cons, v1: v15}
	v16 := new(Tuple_Number_List_Number)
	*v16 = Tuple_Number_List_Number{item0: 2.0, item1: v5}
	v7 := List_Number{tag: List_Number_cons, v1: v16}
	v17 := new(Tuple_Number_List_Number)
	*v17 = Tuple_Number_List_Number{item0: 1.0, item1: v7}
	x := List_Number{tag: List_Number_cons, v1: v17}
	var back1 Backing_List_Number_946144c3f6
	back1.read0 = x
	bump(Lens_List_Number{read: &back1.read0})
	return back1.read0
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

func print_List_Number(value List_Number) {
	first := true
	fmt.Print("[")
	for value.tag == List_Number_cons {
		if !first {
			fmt.Print(",")
		}
		first = false
		printNumber((*value.v1).item0)
		value = (*value.v1).item1
	}
	fmt.Print("]")
}

func main() {
	result0 := entry()
	print_List_Number(result0)
	fmt.Println()
}
