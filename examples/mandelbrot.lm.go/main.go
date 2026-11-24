package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

type Unit struct{}

type Tuple_Number_Number_Number struct {
	item0 float64
	item1 float64
	item2 float64
}

type Lens_Vector_Number struct {
	read *Vector_Number
	restore Func_Vector_Number_to_Unit_d5da9e60ce
	context any
}

type Vector_Number []float64

type Func_Vector_Number_to_Unit_d5da9e60ce func(environment any, arg0 Vector_Number) Unit

type Backing_Vector_Number_1264850431 struct {
	read0 Vector_Number
}

func paintRows(y float64, bytes Lens_Vector_Number) Unit {
	for {
		v7 := height()
		if y >= v7 {
		} else {
			paintRow(0.0, y, bytes)
			y = y + 1.0
			continue
		}
		return Unit{}
	}
}

func pixelBytes() float64 {
	v3 := rowBytes()
	v6 := height()
	return v3 * v6
}

func rowBytes() float64 {
	v4 := width()
	v17 := width()
	return v4 * 3.0 + (laminarMod(4.0 - (laminarMod(v17 * 3.0, 4.0)), 4.0))
}

func putLE(at float64, n float64, count float64, bytes Lens_Vector_Number) Unit {
	for {
		if (count == 0.0) {
		} else {
			v23 := vector_at_Vector_Number(*bytes.read, at)
			*v23 = laminarMod(n, 256.0)
			at, n, count = at + 1.0, (n - (laminarMod(n, 256.0))) / 256.0, count - 1.0
			continue
		}
		return Unit{}
	}
}

func header(bytes Lens_Vector_Number) Unit {
	v7 := vector_at_Vector_Number(*bytes.read, 0.0)
	*v7 = 66.0
	v19 := vector_at_Vector_Number(*bytes.read, 1.0)
	*v19 = 77.0
	v30 := headerBytes()
	v33 := pixelBytes()
	putLE(2.0, v30 + v33, 4.0, bytes)
	v52 := headerBytes()
	putLE(10.0, v52, 4.0, bytes)
	putLE(14.0, 40.0, 4.0, bytes)
	v80 := width()
	putLE(18.0, v80, 4.0, bytes)
	v95 := height()
	putLE(22.0, v95, 4.0, bytes)
	putLE(26.0, 1.0, 2.0, bytes)
	putLE(28.0, 24.0, 2.0, bytes)
	v136 := pixelBytes()
	putLE(34.0, v136, 4.0, bytes)
	putLE(38.0, 2835.0, 4.0, bytes)
	putLE(42.0, 2835.0, 4.0, bytes)
	return Unit{}
}

func escape(cr float64, ci float64, zr float64, zi float64, n float64) float64 {
	for {
		v7 := limit()
		var v13 bool
		if n >= v7 {
			v13 = true
		} else {
			v13 = zr * zr + zi * zi > 4.0
		}
		var v51 float64
		if v13 {
			v51 = n
		} else {
			zr, zi, n = zr * zr - zi * zi + cr, 2.0 * zr * zi + ci, n + 1.0
			continue
		}
		return v51
	}
}

func limit() float64 {
	return 60.0
}

func height() float64 {
	return 120.0
}

func headerBytes() float64 {
	return 54.0
}

func shade(n float64) Tuple_Number_Number_Number {
	v7 := limit()
	var v13 float64
	var v14 float64
	var v15 float64
	if n >= v7 {
		v13 = 0.0
		v14 = 0.0
		v15 = 0.0
	} else {
		v30 := limit()
		t := n / v30
		u := 1.0 - t
		v13 = laminarRound(8.5 * u * u * u * t * 255.0)
		v14 = laminarRound(15.0 * u * u * t * t * 255.0)
		v15 = laminarRound(9.0 * u * t * t * t * 255.0)
	}
	return Tuple_Number_Number_Number{item0: v13, item1: v14, item2: v15}
}

func width() float64 {
	return 150.0
}

func render() Unit {
	v4 := headerBytes()
	v7 := pixelBytes()
	bytes := vector_array_Vector_Number(v4 + v7, 0.0)
	var back0 Backing_Vector_Number_1264850431
	back0.read0 = bytes
	header(Lens_Vector_Number{read: &back0.read0})
	paintRows(0.0, Lens_Vector_Number{read: &back0.read0})
	bytes_2 := back0.read0
	hostWriteFile("mandelbrot.bmp", bytes_2)
	v44 := width()
	v47 := height()
	hostPrint_Unit("wrote mandelbrot.bmp, " + formatNumber(v44) + " x " + formatNumber(v47))
	return Unit{}
}

func paintRow(x float64, y float64, bytes Lens_Vector_Number) Unit {
	for {
		v7 := width()
		if x >= v7 {
		} else {
			paint(x, y, bytes)
			x = x + 1.0
			continue
		}
		return Unit{}
	}
}

func paint(x float64, y float64, bytes Lens_Vector_Number) float64 {
	v10 := width()
	cr := x * (3.0 / v10) - 2.1
	v35 := height()
	ci := 1.2 - y * (2.4 / v35)
	v65 := escape(cr, ci, 0.0, 0.0, 0.0)
	v72 := shade(v65)
	v79 := headerBytes()
	v85 := height()
	v100 := rowBytes()
	at := v79 + (v85 - 1.0 - y) * v100 + x * 3.0
	v132 := vector_at_Vector_Number(*bytes.read, at)
	blue := v72.item0
	*v132 = blue
	v156 := vector_at_Vector_Number(*bytes.read, at + 1.0)
	green := v72.item1
	*v156 = green
	v179 := vector_at_Vector_Number(*bytes.read, at + 2.0)
	red := v72.item2
	v185 := *v179
	*v179 = red
	return v185
}

func entry() Unit {
	render()
	return Unit{}
}

func laminarMod(a float64, b float64) float64 {
	if b != 0 && a == math.Trunc(a) && b == math.Trunc(b) && math.Abs(a) < 9007199254740992 && math.Abs(b) < 9007199254740992 {
		r := float64(int64(a) % int64(b))
		if r == 0 && math.Signbit(a) {
			return math.Copysign(0, -1)
		}
		return r
	}
	return math.Mod(a, b)
}

func vector_at_Vector_Number(value Vector_Number, index float64) *float64 {
	if !(index >= 0) || index != math.Floor(index) || index >= float64(len(value)) {
		panic("vector index out of bounds")
	}
	return &value[int(index)]
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

func hostWriteFile(path string, bytes Vector_Number) Unit {
	out := make([]byte, len(bytes))
	for i, b := range bytes {
		if !(b >= 0 && b < 256 && b == math.Floor(b)) {
			panic("writeFile bytes must be integers in [0, 255]")
		}
		out[i] = byte(b)
	}
	if err := os.WriteFile(path, out, 0o644); err != nil {
		panic(err)
	}
	return Unit{}
}

func hostPrint_Unit(value string) Unit {
	fmt.Print(value + "\n")
	return Unit{}
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
	entry()
	fmt.Print("\x1e")
	fmt.Print("null")
	fmt.Println()
}
