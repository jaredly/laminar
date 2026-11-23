package main

import (
	"fmt"
	"math"
	"strconv"
)

type Unit struct{}

type Lens_Vector_Number struct {
	read *Vector_Number
	restore Func_Vector_Number_to_Unit_d5da9e60ce
	context any
}

type Vector_Number []float64

type Tuple_Number_Number struct {
	item0 float64
	item1 float64
}

type Tuple_Vector_Number_Vector_Number_Tuple_Number_Number struct {
	item0 Vector_Number
	item1 Vector_Number
	item2 Tuple_Number_Number
}

type Func_Vector_Number_to_Unit_d5da9e60ce func(environment any, arg0 Vector_Number) Unit

type Backing_Vector_Number_1264850431 struct {
	read0 Vector_Number
}

func range_2(n float64) Vector_Number {
	arr := vector_array_Vector_Number(n, 0.0)
	var back0 Backing_Vector_Number_1264850431
	back0.read0 = arr
	fillRange(0.0, n, Lens_Vector_Number{read: &back0.read0})
	return back0.read0
}

func fillRange(n float64, end float64, arr Lens_Vector_Number) Unit {
	if n >= end {
	} else {
		v25 := vector_at_Vector_Number(*arr.read, n)
		*v25 = n
		fillRange(n + 1.0, end, arr)
	}
	return Unit{}
}

func entry() Tuple_Vector_Number_Vector_Number_Tuple_Number_Number {
	v4 := range_2(10.0)
	return Tuple_Vector_Number_Vector_Number_Tuple_Number_Number{item0: v4, item1: append(append(append(append(append(append(append(append(append(append(Vector_Number{}, 0.0), 1.0), 2.0), 3.0), 4.0), 5.0), 6.0), 7.0), 8.0), 9.0), item2: Tuple_Number_Number{item0: 10.0, item1: 123.0}}
}

func vector_array_Vector_Number(length float64, init float64) Vector_Number {
	if !(length >= 0) || length != math.Floor(length) || length > float64(math.MaxInt32) {
		panic("array length must be a non-negative integer")
	}
	out := make(Vector_Number, int(length))
	for i := range out {
		if i+1 == len(out) {
			out[i] = init
		} else {
			out[i] = init
		}
	}
	return out
}

func vector_at_Vector_Number(value Vector_Number, index float64) *float64 {
	if !(index >= 0) || index != math.Floor(index) || index >= float64(len(value)) {
		panic("vector index out of bounds")
	}
	return &value[int(index)]
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
	fmt.Print("[")
	for i0 := range result0.item0 {
		if i0 > 0 {
			fmt.Print(",")
		}
		printNumber((result0.item0)[i0])
	}
	fmt.Print("]")
	fmt.Print(",")
	fmt.Print("[")
	for i1 := range result0.item1 {
		if i1 > 0 {
			fmt.Print(",")
		}
		printNumber((result0.item1)[i1])
	}
	fmt.Print("]")
	fmt.Print(",")
	fmt.Print("[")
	printNumber(result0.item2.item0)
	fmt.Print(",")
	printNumber(result0.item2.item1)
	fmt.Print("]")
	fmt.Print("]")
	fmt.Println()
}
