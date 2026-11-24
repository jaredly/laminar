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

type Tuple_Number_Number_Number struct {
	item0 float64
	item1 float64
	item2 float64
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
	for {
		v2 := *xs.read
		switch v2.tag {
		case List_Number_nil:
			v13 := List_Number{tag: List_Number_nil, v0: Unit{}}
			*xs.read = v13
		case List_Number_cons:
			v16 := v2.v1
			head := ((*v16)).item0
			(*v16).item0 = head + 1.0
			xs = Lens_List_Number{read: &(*v16).item1}
			continue
		}
		return Unit{}
	}
}

func sum(xs List_Number) float64 {
	var v5 float64
	switch xs.tag {
	case List_Number_nil:
		v5 = 0.0
	case List_Number_cons:
		v9 := *xs.v1
		head := v9.item0
		tail := v9.item1
		v21 := sum(tail)
		v5 = head + v21
	}
	return v5
}

func entry() Tuple_Number_Number_Number {
	v3 := List_Number{tag: List_Number_nil, v0: Unit{}}
	v31 := new(Tuple_Number_List_Number)
	*v31 = Tuple_Number_List_Number{item0: 3.0, item1: v3}
	v5 := List_Number{tag: List_Number_cons, v1: v31}
	v32 := new(Tuple_Number_List_Number)
	*v32 = Tuple_Number_List_Number{item0: 2.0, item1: v5}
	v7 := List_Number{tag: List_Number_cons, v1: v32}
	v33 := new(Tuple_Number_List_Number)
	*v33 = Tuple_Number_List_Number{item0: 1.0, item1: v7}
	xs := List_Number{tag: List_Number_cons, v1: v33}
	v24 := vector_dup_List_Number(xs)
	var back1 Backing_List_Number_946144c3f6
	back1.read0 = v24
	bump(Lens_List_Number{read: &back1.read0})
	v52 := sum(xs)
	copy_2 := back1.read0
	v55 := sum(copy_2)
	v72 := sum(xs)
	return Tuple_Number_Number_Number{item0: v52, item1: v55, item2: v72}
}

func vector_dup_List_Number(value List_Number) List_Number {
	if value.tag == List_Number_cons {
		box := new(Tuple_Number_List_Number)
		*box = Tuple_Number_List_Number{item0: ((*value.v1)).item0, item1: vector_dup_List_Number(((*value.v1)).item1)}
		value.v1 = box
	}
	return value
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

func main() {
	result0 := entry()
	fmt.Print("[")
	printNumber(result0.item0)
	fmt.Print(",")
	printNumber(result0.item1)
	fmt.Print(",")
	printNumber(result0.item2)
	fmt.Print("]")
	fmt.Println()
}
