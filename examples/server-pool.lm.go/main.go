package main

import (
	"fmt"
	"math"
	"net"
	"strconv"
	"sync"
	"time"
)

type Environment_float64_1d1d36f0ff struct {
	capture0 float64
}

type Callable_Value_28c65e294d struct {
	environment any
	dispose Func_to_Unit_90e61a078a
}

type Unit struct{}

const List_String_nil uint32 = 0

const List_String_cons uint32 = 1

type List_String struct {
	tag uint32
	v0 Unit
	v1 *Tuple_String_List_String
}

type Tuple_String_List_String struct {
	item0 string
	item1 List_String
}

const Conn_Conn uint32 = 0

type Conn struct {
	tag uint32
	v0 float64
}

type Environment_float64_float64_8a48597dc5 struct {
	capture0 float64
	capture1 float64
}

type Tuple_String_String struct {
	item0 string
	item1 string
}

type Lens_Conn struct {
	read *Conn
	restore Func_Conn_to_Unit_cc9287054e
	context any
}

type Func_to_Unit_90e61a078a func(environment any) Unit

type Func_Conn_to_Unit_cc9287054e func(environment any, arg0 Conn) Unit

var hostMu sync.Mutex

var hostObjects = map[float64]any{}

var hostNext float64

func sendTo(text string, conn Lens_Conn) Unit {
	v2 := *conn.read
	switch v2.tag {
	case Conn_Conn:
		v5 := v2.v0
		hostSend(v5, text)
		v23 := Conn{tag: Conn_Conn, v0: v5}
		*conn.read = v23
	}
	return Unit{}
}

func connection(listener float64) Lens_Conn {
	v6 := hostAccept(listener)
	v8 := Conn{tag: Conn_Conn, v0: v6}
	v10 := v8
	v11 := Lens_Conn{read: &v10}
	v11.restore = func(_ any, replacement Conn) Unit {
		conn := replacement
		switch conn.tag {
		case Conn_Conn:
			v14 := conn.v0
			hostClose(v14)
		}
		return Unit{}
	}
	return v11
}

func closure(environment any) Unit {
	v0 := environment.(*Environment_float64_1d1d36f0ff).capture0
	counter(v0, 0.0)
	return Unit{}
}

func workers(n float64, listener float64, requests float64) Unit {
	for {
		if (n == 0.0) {
		} else {
			v26 := Callable_Value_28c65e294d{environment: &Environment_float64_float64_8a48597dc5{capture0: requests, capture1: listener }}
			go func() { workers_closure(v26.environment) }()
			n = n - 1.0
			continue
		}
		return Unit{}
	}
}

func page(path string, requests float64) Tuple_String_String {
	var v5 string
	var v6 string
	switch path {
	case "/":
		v5 = "200 OK"
		v6 = "hello from laminar\x0a"
	case "/count":
		v19 := nextRequest(requests)
		v5 = "200 OK"
		v6 = "request number " + formatNumber(v19) + "\x0a"
	case "/mandelbrot":
		v30 := art(0.0)
		v5 = "200 OK"
		v6 = v30
	case "/slow":
		hostSleep(1000.0)
		v5 = "200 OK"
		v6 = "that took a second, and nobody waited for it\x0a"
	default:
		v5 = "404 Not Found"
		v6 = "no page at " + path + "\x0a"
	}
	return Tuple_String_String{item0: v5, item1: v6}
}

func counter(requests float64, count float64) Unit {
	for {
		reply := hostChanRecv(requests)
		hostChanSend(reply, count + 1.0)
		count = count + 1.0
		continue
		return Unit{}
	}
}

func afterMethod(chars List_String) List_String {
	for {
		var v5 List_String
		if chars.tag == List_String_nil {
			v5 = List_String{tag: List_String_nil, v0: Unit{}}
		} else if chars.tag == List_String_cons && (*chars.v1).item0 == " " {
			v8 := *chars.v1
			v5 = v8.item1
		} else if chars.tag == List_String_cons {
			v13 := *chars.v1
			rest_2 := v13.item1
			chars = rest_2
			continue
		} else {
			panic("unmatched case")
		}
		return v5
	}
}

func art(y float64) string {
	var v11 string
	if y >= 24.0 {
		v11 = ""
	} else {
		v22 := artRow(0.0, y)
		v35 := art(y + 1.0)
		v11 = v22 + "\x0a" + v35
	}
	return v11
}

func recvFrom(conn Lens_Conn) string {
	v2 := *conn.read
	var v4 string
	switch v2.tag {
	case Conn_Conn:
		v5 := v2.v0
		v15 := hostRecv(v5)
		v19 := Conn{tag: Conn_Conn, v0: v5}
		v4 = v15
		*conn.read = v19
	}
	return v4
}

func serveOne(listener float64, requests float64) Unit {
	v6 := connection(listener)
	v14 := recvFrom(Lens_Conn{read: v6.read})
	v17 := pathOf(v14)
	v24 := page(v17, requests)
	status := v24.item0
	body := v24.item1
	sendTo("HTTP/1.1 " + status + "\x0d\x0aContent-Type: text/plain\x0d\x0aConnection: close\x0d\x0a\x0d\x0a" + body, Lens_Conn{read: v6.read})
	v42 := *v6.read
	if v6.restore != nil {
		v6.restore(v6.context, v42)
	} else {
	}
	return Unit{}
}

func artRow(x float64, y float64) string {
	var v11 string
	if x >= 64.0 {
		v11 = ""
	} else {
		steps := escape(x * 0.046875 - 2.2, 1.2 - y * 0.1, 0.0, 0.0, 0.0)
		v66 := glyph(steps)
		v83 := artRow(x + 1.0, y)
		v11 = v66 + v83
	}
	return v11
}

func workers_closure(environment any) Unit {
	v0 := environment.(*Environment_float64_float64_8a48597dc5).capture0
	v1 := environment.(*Environment_float64_float64_8a48597dc5).capture1
	worker(v1, v0)
	return Unit{}
}

func nextRequest(requests float64) float64 {
	reply := hostChanNew()
	hostChanSend(requests, reply)
	return hostChanRecv(reply)
}

func worker(listener float64, requests float64) Unit {
	for {
		serveOne(listener, requests)
		continue
		return Unit{}
	}
}

func pathOf(request string) string {
	v11 := afterMethod(char_list_List_String(request))
	return untilSpace(v11)
}

func glyph(steps float64) string {
	var v11 string
	if steps >= 30.0 {
		v11 = "#"
	} else {
		var v25 string
		if steps >= 12.0 {
			v25 = "+"
		} else {
			var v39 string
			if steps >= 5.0 {
				v39 = "."
			} else {
				v39 = " "
			}
			v25 = v39
		}
		v11 = v25
	}
	return v11
}

func untilSpace(chars List_String) string {
	var v5 string
	if chars.tag == List_String_nil {
		v5 = ""
	} else if chars.tag == List_String_cons && (*chars.v1).item0 == " " {
		v5 = ""
	} else if chars.tag == List_String_cons && (*chars.v1).item0 == "\x0d" {
		v5 = ""
	} else if chars.tag == List_String_cons && (*chars.v1).item0 == "\x0a" {
		v5 = ""
	} else if chars.tag == List_String_cons {
		v18 := *chars.v1
		c := v18.item0
		rest := v18.item1
		v29 := untilSpace(rest)
		v5 = c + v29
	} else {
		panic("unmatched case")
	}
	return v5
}

func escape(cr float64, ci float64, zr float64, zi float64, n float64) float64 {
	for {
		var v11 bool
		if n >= 40.0 {
			v11 = true
		} else {
			v11 = zr * zr + zi * zi > 4.0
		}
		var v50 float64
		if v11 {
			v50 = n
		} else {
			zr, zi, n = zr * zr - zi * zi + cr, 2.0 * zr * zi + ci, n + 1.0
			continue
		}
		return v50
	}
}

func entry() float64 {
	listener := hostListen(8080.0)
	requests := hostChanNew()
	hostPrint_Unit("listening on http://localhost:8080 with 8 workers")
	v23 := Callable_Value_28c65e294d{environment: &Environment_float64_1d1d36f0ff{capture0: requests }}
	go func() { closure(v23.environment) }()
	workers(8.0, listener, requests)
	v50 := hostChanNew()
	return hostChanRecv(v50)
}

func hostRegister(object any) float64 {
	hostMu.Lock()
	defer hostMu.Unlock()
	hostNext++
	hostObjects[hostNext] = object
	return hostNext
}

func hostLookup(handle float64) any {
	hostMu.Lock()
	defer hostMu.Unlock()
	return hostObjects[handle]
}

func hostSend(handle float64, text string) Unit {
	connection, ok := hostLookup(handle).(net.Conn)
	if ok {
		connection.Write([]byte(text))
	}
	return Unit{}
}

func hostAccept(handle float64) float64 {
	listener, ok := hostLookup(handle).(net.Listener)
	if !ok {
		panic("not a listener handle")
	}
	connection, err := listener.Accept()
	if err != nil {
		panic(err)
	}
	return hostRegister(connection)
}

func hostClose(handle float64) Unit {
	hostMu.Lock()
	object := hostObjects[handle]
	delete(hostObjects, handle)
	hostMu.Unlock()
	switch object := object.(type) {
		case net.Conn:
			object.Close()
		case net.Listener:
			object.Close()
	}
	return Unit{}
}

func hostSleep(milliseconds float64) Unit {
	time.Sleep(time.Duration(milliseconds * float64(time.Millisecond)))
	return Unit{}
}

func hostChanRecv(handle float64) float64 {
	channel, ok := hostLookup(handle).(chan float64)
	if !ok {
		panic("not a channel handle")
	}
	return <-channel
}

func hostChanSend(handle float64, value float64) Unit {
	channel, ok := hostLookup(handle).(chan float64)
	if !ok {
		panic("not a channel handle")
	}
	channel <- value
	return Unit{}
}

func hostRecv(handle float64) string {
	connection, ok := hostLookup(handle).(net.Conn)
	if !ok {
		return ""
	}
	buffer := make([]byte, 8192)
	n, _ := connection.Read(buffer)
	return string(buffer[:n])
}

func hostChanNew() float64 {
	return hostRegister(make(chan float64))
}

func char_list_List_String(value string) List_String {
	starts := []int{}
	for i := range value {
		starts = append(starts, i)
	}
	out := List_String{tag: List_String_nil}
	end := len(value)
	for n := len(starts) - 1; n >= 0; n-- {
		cell := new(Tuple_String_List_String)
		*cell = Tuple_String_List_String{item0: value[starts[n]:end], item1: out}
		out = List_String{tag: List_String_cons, v1: cell}
		end = starts[n]
	}
	return out
}

func hostListen(port float64) float64 {
	if !(port >= 0 && port < 65536 && port == math.Floor(port)) {
		panic("listen needs a port from 0 to 65535")
	}
	listener, err := net.Listen("tcp", ":"+strconv.Itoa(int(port)))
	if err != nil {
		panic(err)
	}
	return hostRegister(listener)
}

func hostPrint_Unit(value string) Unit {
	fmt.Print(value + "\n")
	return Unit{}
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
