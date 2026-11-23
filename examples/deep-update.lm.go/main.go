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

type Lens_Option_Number struct {
	read *Option_Number
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

func find(needle float64, lst Lens_List_Number) Lens_Option_Number {
	v2 := *lst.read
	v4 := 0
	var v5 Option_Number
	var v7 float64
	var v8 List_Number
	var v25 int
	var v34 Lens_List_Number
	var v33 Lens_Option_Number
	switch v2.tag {
	case List_Number_cons:
		v6 := *v2.v1
		v7 = v6.item0
		v8 = v6.item1
		v25 = 0
		var v26 Option_Number
		if v7 == needle {
			v25 = 0
			v26 = Option_Number{tag: Option_Number_Some, v0: v7}
		} else {
			back0 := new(Backing_List_Number_946144c3f6)
			back0.read0 = v8
			v34 = Lens_List_Number{read: &back0.read0}
			v33 = find(needle, v34)
			v25 = 1
			v26 = *v33.read
		}
		v4 = 0
		v5 = v26
	case List_Number_nil:
		v4 = 1
		v5 = Option_Number{tag: Option_Number_None, v1: Unit{}}
	}
	v41 := v5
	v42 := Lens_Option_Number{read: &v41}
	v42.restore = func(_ any, replacement Option_Number) Unit {
		var v59 List_Number
		if (v4 == 0) {
			var v45 float64
			var v46 List_Number
			if (v25 == 0) {
				if replacement.tag != Option_Number_Some {
					panic("constructor lens tag mismatch")
				}
				v45 = replacement.v0
				v46 = v8
			} else if (v25 == 1) {
				v43 := replacement
				if v33.restore != nil {
					v33.restore(v33.context, v43)
				} else {
					*v33.read = replacement
				}
				v44 := *v34.read
				v45 = v7
				v46 = v44
			} else {
				panic("unmatched case")
			}
			v48 := v45
			v49 := v46
			v60 := new(Tuple_Number_List_Number)
			*v60 = Tuple_Number_List_Number{item0: v48, item1: v49}
			v59 = List_Number{tag: List_Number_cons, v1: v60}
		} else if (v4 == 1) {
			if replacement.tag != Option_Number_None {
				panic("constructor lens tag mismatch")
			}
			v59 = List_Number{tag: List_Number_nil, v0: Unit{}}
		} else {
			panic("unmatched case")
		}
		*lst.read = v59
		return Unit{}
	}
	return v42
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
	v37 := *v34.read
	var v67 Option_Number
	switch v37.tag {
	case Option_Number_Some:
		v67 = Option_Number{tag: Option_Number_Some, v0: 3.0}
	case Option_Number_None:
		v67 = Option_Number{tag: Option_Number_None, v1: Unit{}}
	}
	v68 := v67
	if v34.restore != nil {
		v34.restore(v34.context, v68)
	} else {
		*v34.read = v67
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
