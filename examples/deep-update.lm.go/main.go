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

type Fields_Option_Number struct {
	tag uint32
	v0 *float64
	restore Func_Option_Number_to_Unit_bdd0c6f556
	context any
}

const Option_Number_Some uint32 = 0

const Option_Number_None uint32 = 1

type Option_Number struct {
	tag uint32
	v0 float64
	v1 Unit
}

type Lens_List_Number struct {
	read *List_Number
	restore Func_List_Number_to_Unit_d9c2c8d6b2
	context any
}

type Func_Option_Number_to_Unit_bdd0c6f556 func(environment any, arg0 Option_Number) Unit

type Func_List_Number_to_Unit_d9c2c8d6b2 func(environment any, arg0 List_Number) Unit

type Backing_List_Number_946144c3f6 struct {
	read0 List_Number
}

func find(needle float64, lst Lens_List_Number) Fields_Option_Number {
	v2 := *lst.read
	v48 := Fields_Option_Number{}
	switch v2.tag {
	case List_Number_cons:
		v6 := v2.v1
		one := ((*v6)).item0
		v36 := Fields_Option_Number{}
		if one == needle {
			v36 = Fields_Option_Number{tag: Option_Number_Some, v0: &(*v6).item0}
		} else {
			v36 = find(needle, Lens_List_Number{read: &(*v6).item1})
		}
		v48 = v36
	case List_Number_nil:
		v49 := Option_Number{tag: Option_Number_None, v1: Unit{}}
		v50 := Fields_Option_Number{tag: v49.tag, v0: &v49.v0}
		v50.restore = func(_ any, replacement Option_Number) Unit {
			if replacement.tag != Option_Number_None {
				panic("constructor lens tag mismatch")
			}
			v53 := List_Number{tag: List_Number_nil, v0: Unit{}}
			*lst.read = v53
			return Unit{}
		}
		v48 = v50
	}
	return v48
}

func replace(needle float64, repl float64, lst Lens_List_Number) Unit {
	v2 := *lst.read
	switch v2.tag {
	case List_Number_cons:
		v5 := v2.v1
		one := ((*v5)).item0
		if one == needle {
			(*v5).item0 = repl
		} else {
			replace(needle, repl, Lens_List_Number{read: &(*v5).item1})
		}
	case List_Number_nil:
		v44 := List_Number{tag: List_Number_nil, v0: Unit{}}
		*lst.read = v44
	}
	return Unit{}
}

func entry() List_Number {
	v4 := List_Number{tag: List_Number_nil, v0: Unit{}}
	v22 := new(Tuple_Number_List_Number)
	*v22 = Tuple_Number_List_Number{item0: 4.0, item1: v4}
	v6 := List_Number{tag: List_Number_cons, v1: v22}
	v23 := new(Tuple_Number_List_Number)
	*v23 = Tuple_Number_List_Number{item0: 3.0, item1: v6}
	v8 := List_Number{tag: List_Number_cons, v1: v23}
	v24 := new(Tuple_Number_List_Number)
	*v24 = Tuple_Number_List_Number{item0: 2.0, item1: v8}
	v10 := List_Number{tag: List_Number_cons, v1: v24}
	v25 := new(Tuple_Number_List_Number)
	*v25 = Tuple_Number_List_Number{item0: 1.0, item1: v10}
	x := List_Number{tag: List_Number_cons, v1: v25}
	var back2 Backing_List_Number_946144c3f6
	back2.read0 = x
	replace(2.0, 5.0, Lens_List_Number{read: &back2.read0})
	back3 := new(Backing_List_Number_946144c3f6)
	back3.read0 = back2.read0
	v35 := Lens_List_Number{read: &back3.read0}
	v34 := find(3.0, v35)
	switch v34.tag {
	case Option_Number_Some:
		*v34.v0 = 3.0
	case Option_Number_None:
	}
	if v34.restore != nil {
		var v65 Option_Number
		switch v34.tag {
		case Option_Number_Some:
			v65 = Option_Number{tag: Option_Number_Some, v0: *v34.v0}
		case Option_Number_None:
			v65 = Option_Number{tag: Option_Number_None, v1: Unit{}}
		}
		v34.restore(v34.context, v65)
	}
	return *v35.read
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
