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

type Lens_bool_to_float64 struct {
	read *bool
	replacement *float64
	restore Func_float64_to_Unit_e8b5a11084
	context any
}

type Lens_List_Number struct {
	read *List_Number
	restore Func_List_Number_to_Unit_d9c2c8d6b2
	context any
}

type Func_List_Number_to_Unit_d9c2c8d6b2 func(environment any, arg0 List_Number) Unit

type Func_float64_to_Unit_e8b5a11084 func(environment any, arg0 float64) Unit

type Backing_List_Number_946144c3f6 struct {
	read0 List_Number
}

func replace(needle float64, repl float64, lst Lens_List_Number) Unit {
	v2 := *(lst).read
	switch (v2).tag {
	case List_Number_cons:
		v5 := (v2).v1
		one := ((*v5)).item0
		if (one == needle) {
			(*v5).item0 = repl
		} else {
			replace(needle, repl, Lens_List_Number{read: &(*v5).item1})
		}
	case List_Number_nil:
		v44 := List_Number{tag: List_Number_nil, v0: Unit{}}
		*(lst).read = v44
	}
	return Unit{}
}

func find(needle float64, lst Lens_List_Number) Lens_bool_to_float64 {
	v2 := *(lst).read
	v4 := 0
	var v5 bool
	var v7 float64
	var v8 List_Number
	var v25 int
	var v35 Lens_List_Number
	var v34 Lens_bool_to_float64
	switch (v2).tag {
	case List_Number_cons:
		v6 := (*(v2).v1)
		v7 = (v6).item0
		v8 = (v6).item1
		v25 = 0
		var v26 bool
		if (v7 == needle) {
			v25 = 0
			v26 = true
		} else {
			back1 := new(Backing_List_Number_946144c3f6)
			back1.read0 = v8
			v35 = Lens_List_Number{read: &back1.read0}
			v34 = find(needle, v35)
			v25 = 1
			v26 = *(v34).read
		}
		v4 = 0
		v5 = v26
	case List_Number_nil:
		v4 = 1
		v5 = false
	}
	v44 := v5
	var v45 float64
	v46 := Lens_bool_to_float64{read: &v44, replacement: &v45}
	v46.restore = func(_ any, replacement float64) Unit {
		var v68 List_Number
		if (v4 == 0) {
			var v53 float64
			var v54 List_Number
			if (v25 == 0) {
				v53 = replacement
				v54 = v8
			} else if (v25 == 1) {
				v51 := replacement
				if (v34).restore != nil {
					(v34).restore((v34).context, v51)
				} else {
					*(v34).replacement = replacement
				}
				v52 := *(v35).read
				v53 = v7
				v54 = v52
			} else {
				panic("unmatched case")
			}
			v56 := v53
			v57 := v54
			v69 := new(Tuple_Number_List_Number)
			*v69 = Tuple_Number_List_Number{item0: v56, item1: v57}
			v68 = List_Number{tag: List_Number_cons, v1: v69}
		} else if (v4 == 1) {
			v68 = List_Number{tag: List_Number_nil, v0: Unit{}}
		} else {
			panic("unmatched case")
		}
		*(lst).read = v68
		return Unit{}
	}
	return v46
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
	if (v34).restore != nil {
		(v34).restore((v34).context, 10.0)
	} else {
		*(v34).replacement = 10.0
	}
	return *(v35).read
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
