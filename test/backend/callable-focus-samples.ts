/** Direct whole-owned-local exchanges retain both physical storage versions. */
export const callableFocusSamples = [
    {
        name: 'callable focus different captures',
        source: '{let x = 3\n let f = fn () x\n let y = (4, 5)\n let old = f := fn () {let (a, b) = y\n a + b}\n (old(), f())}',
        expected: [3, 9],
    },
    {
        name: 'callable focus extraction to data',
        source: '{let x = 3\n let f = fn () x\n let old = f := true\n (old(), f)}',
        expected: [3, true],
    },
    {
        name: 'callable focus insertion from data',
        source: '{let f = 2\n let x = 3\n let old = f := fn () x\n (old, f())}',
        expected: [2, 3],
    },
    {
        name: 'callable focus refill empty',
        source: '{let x = 3\n let f = fn () x\n let first = f\n f := fn () 5\n (first(), f())}',
        expected: [3, 5],
    },
    {
        name: 'callable focus unused old and replacement',
        source: '{let x = 3\n let f = fn () x\n let y = 5\n let old = f := fn () y\n 7}',
        expected: 7,
    },
    {
        name: 'callable focus repeated replacement',
        source: '{let x = 3\n let f = fn () x\n let y = 5\n let first = f := fn () y\n let second = f := fn () 7\n (first(), second(), f())}',
        expected: [3, 5, 7],
    },
    {
        name: 'callable focus aggregate replacement',
        source: '{let x = 3\n let packed = (fn () x, 4)\n let y = 5\n let old = packed := (fn () y, true)\n let (f, n) = old\n let (g, b) = packed\n (f(), n, g(), b)}',
        expected: [3, 4, 5, true],
    },

    {
        name: 'callable focus nested scope version',
        source: '{let x = 3\n let f = fn () x\n {let y = 5\n let old = f := fn () y\n old()}\n f()}',
        expected: 5,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `callable focus joined replacement ${condition}`,
        source: `{let x = 3
 let f = fn () x
 let y = 5
 let old = f := match ${condition} {true -> fn () y; false -> fn () 7}
 (old(), f())}`,
        expected: [3, condition === 'true' ? 5 : 7],
    })),
    ...(['true', 'false'] as const).flatMap((condition) => [
        {
            name: `callable focus convergent branch data ${condition}`,
            source: `{let x = 3
 let f = fn () x
 match ${condition} {true -> {let old = f := 5
 old()}; false -> {let old = f := 7
 old()}}
 f}`,
            expected: condition === 'true' ? 5 : 7,
        },
        {
            name: `callable focus convergent branch callable ${condition}`,
            source: `fn make(x) {fn () x}
{let f = 2
 match ${condition} {true -> {f := make(5)
 ()}; false -> {f := make(7)
 ()}}
 f()}`,
            expected: condition === 'true' ? 5 : 7,
        },
    ]),
    {
        name: 'callable alias replacement and owner continuation',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let old = a := fn () 5\n old()}\n f()}',
        expected: 5,
    },
    {
        name: 'callable alias unused loan',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n ()}\n f()}',
        expected: 3,
    },
    {
        name: 'callable alias aggregate replacement',
        source: '{let x = 3\n let p = (fn () x, 4)\n {let a = ~p\n let old = a := (fn () 5, true)\n let (f, n) = old\n f() + n}\n let (g, b) = p\n (g(), b)}',
        expected: [5, true],
    },
    {
        name: 'callable alias nested loans and repeated replacement',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let first = a := fn () 5\n {let b = ~a\n let second = b := fn () 7\n (first(), second())}}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias temporary data and refill',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let old = a := true\n let b = a := fn () 7\n (old(), b)}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias extraction to data',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let old = a := true\n old()}\n f}',
        expected: true,
    },
    {
        name: 'callable alias insertion from data',
        source: '{let f = 3\n {let a = ~f\n let old = a := fn () 7\n old}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias consume and refill',
        source: '{let x = 3\n let f = fn () x\n {let a = ~f\n let first = a\n a := fn () 7\n first()}\n f()}',
        expected: 7,
    },
    {
        name: 'callable alias unused environments',
        source: '{let x = 3\n let f = fn () x\n let y = 5\n {let a = ~f\n let old = a := fn () y\n ()}\n 7}',
        expected: 7,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `callable alias divergent branch ${condition}`,
        source: `{let x = 3
 let f = fn () x
 {let a = ~f
 match ${condition} {true -> {let old = a := fn () 5
 old()}; false -> {let y = (6, 7)
 let old = a := fn () {let (u, v) = y
 u + v}
 old()}}}
 f()}`,
        expected: condition === 'true' ? 5 : 13,
    })),
    {
        name: 'callable alias deferred scalar completion',
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{let a = ~f
 {lens finalFocus <- x\nx := finalFocus\n{let old = a := fn () 7
 old()
 ()}}}
 focus := 5}
 (f(), x)}`,
        expected: [7, 5],
    },
    {
        name: 'callable alias returned replacement',
        source: `fn make() {let v = 3
 let f = fn () v
 {let a = ~f
 let old = a := fn () 7
 old()}
 f}
{let f = make()
 f()}`,
        expected: 7,
    },
    {
        name: 'projected callable swap preserves sibling',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 let old = a := fn () 7
 old()}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'projected callable swap nested owner',
        source: `{let v = 3
 let p = ((fn () v, true), 4)
 {let ((a, b), c) = ~p
 let old = a := fn () 7
 old()}
 let ((f, b), n) = p
 (f(), b, n)}`,
        expected: [7, true, 4],
    },
    {
        name: 'projected callable swap extraction to data',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 let old = a := true
 old()}
 p}`,
        expected: [true, 4],
    },
    {
        name: 'projected callable swap insertion from data',
        source: `{let p = (true, 4)
 {let (a, b) = ~p
 a := fn () 7}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'projected callable swap unused environments',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 let w = 7
 let old = a := fn () w
 ()}
 9}`,
        expected: 9,
    },
    {
        name: 'projected callable swap changes sibling layout',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 b := true
 let old = a := fn () 7
 old()}
 let (f, b) = p
 (f(), b)}`,
        expected: [7, true],
    },
    {
        name: 'projected callable loan nested replacement',
        source: `{let v = 3
 let p = ((fn () v, true), 4)
 {let ((a, b), c) = ~p
 {let d = ~a
 let old = d := fn () 7
 old()}}
 let ((f, b), n) = p
 (f(), b, n)}`,
        expected: [7, true, 4],
    },
    {
        name: 'projected callable loan unused',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 {let d = ~a
 ()}}
 let (f, n) = p
 (f(), n)}`,
        expected: [3, 4],
    },
    {
        name: 'projected callable loan consume refill and sibling',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 {let d = ~a
 let old = d
 d := fn () 7
 old()}
 b := true}
 let (f, b) = p
 (f(), b)}`,
        expected: [7, true],
    },
    {
        name: 'projected callable loan extraction',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 {let d = ~a
 let old = d := true
 old()}}
 p}`,
        expected: [true, 4],
    },
    {
        name: 'projected callable loan repeated subloans',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 {let d = ~a
 let old = d := fn () 7
 old()}
 {let e = ~a
 let old = e := fn () 9
 old()}}
 let (f, n) = p
 (f(), n)}`,
        expected: [9, 4],
    },
    {
        name: 'projected callable loan scalar backing regression',
        source: `{let p = (1, 2)
 {let (a, b) = ~p
 {let c = ~a
 c := 7}
 b := 9}
 p}`,
        expected: [7, 9],
    },
    {
        name: 'temporary callable swap direct',
        source: `{let v = 3
 let f = fn () v
 let old = {lens finalFocus <- f\nf := finalFocus\n()} := fn () 7
 (old(), f())}`,
        expected: [3, 7],
    },
    {
        name: 'temporary callable swap cleanup replacement',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 let old = {lens finalFocus <- f\nf := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}} := fn () 7
 (old(), seen, f())}`,
        expected: [3, 7, 9],
    },
    {
        name: 'temporary callable swap aggregate',
        source: `{let v = 3
 let p = (fn () v, 4)
 let old = {lens finalFocus <- p\np := finalFocus\n()} := (fn () 7, true)
 let (f, n) = old
 let (g, b) = p
 (f(), n, g(), b)}`,
        expected: [3, 4, 7, true],
    },
    {
        name: 'temporary callable swap projected',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 let old = {lens finalFocus <- a\na := finalFocus\n()} := fn () 7
 old()}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'temporary callable swap unused',
        source: `{let v = 3
 let f = fn () v
 let w = 7
 let old = {lens finalFocus <- f\nf := finalFocus\n()} := fn () w
 9}`,
        expected: 9,
    },
    {
        name: 'forwarded callable focus lexical swap',
        source: `{let v = 3
 let f = fn () v
 let old = {let marker = ()
 f} := fn () 7
 (old(), f())}`,
        expected: [3, 7],
    },
    {
        name: 'forwarded callable focus temporary cleanup',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 let old = {let marker = ()
 {lens finalFocus <- f\nf := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}} := fn () 7
 (old(), seen, f())}`,
        expected: [3, 7, 9],
    },
    {
        name: 'forwarded callable focus projected',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 let old = {let marker = ()
 a} := fn () 7
 old()}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'forwarded callable focus lexical loan release',
        source: `{let v = 3
 let f = fn () v
 let old = {let a = ~f
 a} := fn () 7
 (old(), f())}`,
        expected: [3, 7],
    },
    {
        name: 'forwarded callable focus nested aggregate',
        source: `{let v = 3
 let p = ((fn () v, 4), true)
 let old = {let marker = ()
 {let other = ()
 p}} := ((fn () 7, false), 9)
 let ((f, n), b) = old
 let ((g, c), z) = p
 (f(), n, b, g(), c, z)}`,
        expected: [3, 4, true, 7, false, 9],
    },
    {
        name: 'forwarded callable focus unused environments',
        source: `{let v = 3
 let f = fn () v
 let w = 7
 let old = {let marker = ()
 {lens finalFocus <- f\nf := finalFocus\n()}} := fn () w
 9}`,
        expected: 9,
    },
    {
        name: 'computed callable alias temporary replacement',
        source: `{let v = 3
 let f = fn () v
 {let a = ~{{lens finalFocus <- f\nf := finalFocus\n()}}
 let old = a := fn () 7
 old()}
 f()}`,
        expected: 7,
    },
    {
        name: 'computed callable alias unused',
        source: `{let v = 3
 let f = fn () v
 {let a = ~{{lens finalFocus <- f\nf := finalFocus\n()}}
 ()}
 f()}`,
        expected: 3,
    },
    {
        name: 'computed callable alias cleanup replacement',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 {let a = ~{{lens finalFocus <- f\nf := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}}
 let old = a := fn () 7
 old()}
 (seen, f())}`,
        expected: [7, 9],
    },
    {
        name: 'computed callable alias aggregate projected contents',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~{{lens finalFocus <- p\np := finalFocus\n()}}
 {let c = ~a
 let old = c := fn () 7
 old()}
 b := true}
 let (f, b) = p
 (f(), b)}`,
        expected: [7, true],
    },
    {
        name: 'computed callable alias projected frontend',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 {let c = ~{{lens finalFocus <- a\na := finalFocus\n()}}
 let old = c := fn () 7
 old()}}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'computed callable alias extraction to data',
        source: `{let v = 3
 let f = fn () v
 {let a = ~{{lens finalFocus <- f\nf := finalFocus\n()}}
 let old = a := true
 old()}
 f}`,
        expected: true,
    },
    {
        name: 'computed callable alias unused environments',
        source: `{let v = 3
 let f = fn () v
 let w = 7
 {let a = ~{{lens finalFocus <- f\nf := finalFocus\n()}}
 let old = a := fn () w
 ()}
 9}`,
        expected: 9,
    },
    {
        name: 'computed callable alias cleanup consumes installed value',
        source: '{let x = 1\n {let f = ~{{lens finalFocus <- x\nx := finalFocus\n{x()}}}\n f := fn () 2}\n ()}',
        expected: null,
    },
    {
        name: 'scattered callable flat swap',
        source: `{let v = 3
 let f = fn () v
 let w = 4
 let g = fn () w
 let (a, b) = (f, g) := (fn () 7, fn () 8)
 (a(), b(), f(), g())}`,
        expected: [3, 4, 7, 8],
    },
    {
        name: 'scattered callable flat data extraction',
        source: `{let f = fn () 3
 let g = fn () 4
 let (a, b) = (f, g) := (true, 9)
 (a(), b(), f, g)}`,
        expected: [3, 4, true, 9],
    },
    {
        name: 'scattered callable flat unused environments',
        source: `{let v = 3
 let f = fn () v
 let w = 4
 let g = fn () w
 let x = 7
 let y = 8
 let old = (f, g) := (fn () x, fn () y)
 9}`,
        expected: 9,
    },
    {
        name: 'scattered callable recursive mixed swap',
        source: `{let f = fn () 3
 let n = 4
 let g = fn () 5
 let b = true
 let ((a, old), (c, flag)) = ((f, n), (g, b)) := ((fn () 7, false), (fn () 8, 9))
 (a(), old, c(), flag, f(), n, g(), b)}`,
        expected: [3, 4, 5, true, 7, false, 8, 9],
    },
    {
        name: 'scattered callable recursive data subtree',
        source: `{let f = fn () 3
 let x = 4
 let y = 5
 let (a, (b, c)) = (f, (x, y)) := (fn () 7, (true, ()))
 (a(), b, c, f(), x, y)}`,
        expected: [3, 4, 5, 7, true, null],
    },
    {
        name: 'scattered callable recursive projected owners',
        source: `{let p = (fn () 3, 4)
 let q = (5, fn () 6)
 {let (a, b) = ~p
 let (c, d) = ~q
 let ((f, n), (m, g)) = ((a, c), (b, d)) := ((fn () 7, true), (false, fn () 8))
 (f(), n, m, g())}
 let (f, b) = p
 let (c, g) = q
 (f(), b, c, g())}`,
        expected: [7, false, true, 8],
    },
    {
        name: 'scattered callable temporary wrapper replacement',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = {lens finalFocus <- (f, n)\n(f, n) := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}} := (fn () 7, true)
 (old(), before, seen, f(), n)}`,
        expected: [3, 4, 7, 9, true],
    },
    {
        name: 'scattered callable temporary member completion',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = ({lens finalFocus <- f\nf := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}, {lens finalFocus <- n\nn := finalFocus\n()}) := (fn () 7, true)
 (old(), before, seen, f(), n)}`,
        expected: [3, 4, 7, 9, true],
    },
    {
        name: 'scattered callable forwarded mixed focus',
        source: `{let f = fn () 3
 let x = 4
 let y = 5
 let (old, (a, b)) = {let marker = ()
 (f, {let other = ()
 (x, y)})} := (fn () 7, (true, ()))
 (old(), a, b, f(), x, y)}`,
        expected: [3, 4, 5, 7, true, null],
    },
    {
        name: 'scattered callable forwarded temporary completion',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = {let marker = ()
 {lens finalFocus <- (f, n)\n(f, n) := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}} := (fn () 7, true)
 (old(), before, seen, f(), n)}`,
        expected: [3, 4, 7, 9, true],
    },
    {
        name: 'scattered callable forwarded lexical releases',
        source: `{let f = fn () 3
 let n = 4
 let (old, before) = {let a = ~f
 (a, n)} := (fn () 7, true)
 (old(), before, f(), n)}`,
        expected: [3, 4, 7, true],
    },
    {
        name: 'scattered callable persistent flat alias',
        source: `{let f = fn () 3
 let g = fn () 4
 {let (a, b) = ~(f, g)
 let old = a := fn () 7
 let other = b := fn () 8
 (old(), other())}
 (f(), g())}`,
        expected: [7, 8],
    },
    {
        name: 'scattered callable persistent nested mixed alias',
        source: `{let f = fn () 3
 let x = 4
 let y = 5
 {let (a, (b, c)) = ~(f, (x, y))
 {let d = ~a
 let old = d
 d := fn () 7
 old()}
 b := true
 c := ()}
 (f(), x, y)}`,
        expected: [7, true, null],
    },
    {
        name: 'scattered callable persistent temporary cleanup',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 {let (a, b) = ~{{lens finalFocus <- (f, n)\n(f, n) := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}}
 let old = a := fn () 7
 old()
 b := true}
 (seen, f(), n)}`,
        expected: [7, 9, true],
    },
    {
        name: 'scattered callable persistent unused alias',
        source: `{let v = 3
 let f = fn () v
 let n = 4
 {let (a, b) = ~(f, n)
 ()}
 (f(), n)}`,
        expected: [3, 4],
    },
    {
        name: 'scattered callable persistent unused environments',
        source: `{let v = 3
 let f = fn () v
 let n = 4
 let w = 7
 {let (a, b) = ~(f, n)
 let old = a := fn () w
 b := true}
 9}`,
        expected: 9,
    },
    {
        name: 'callable fst owned replacement',
        source: `{let v = 3
 let p = (fn () v, 4)
 let old = fst(~p) := fn () 7
 let (f, n) = p
 (old(), f(), n)}`,
        expected: [3, 7, 4],
    },
    {
        name: 'callable fst owned extraction',
        source: `{let p = (fn () 3, 4)
 let old = fst(~p) := true
 (old(), p)}`,
        expected: [3, [true, 4]],
    },
    {
        name: 'callable fst owned unused',
        source: `{let v = 3
 let p = (fn () v, 4)
 let w = 7
 let old = fst(~p) := fn () w
 9}`,
        expected: 9,
    },
    {
        name: 'callable fst scattered replacement',
        source: `{let f = fn () 3
 let n = 4
 let old = fst(~(f, n)) := fn () 7
 (old(), f(), n)}`,
        expected: [3, 7, 4],
    },
    {
        name: 'callable fst scattered subtree',
        source: `{let f = fn () 3
 let x = 4
 let y = 5
 let (old, n) = fst(~((f, x), y)) := (fn () 7, true)
 (old(), n, f(), x, y)}`,
        expected: [3, 4, 7, true, 5],
    },
    {
        name: 'callable fst scattered projected owners',
        source: `{let p = (fn () 3, 4)
 let n = 5
 {let (a, b) = ~p
 let old = fst(~(a, n)) := fn () 7
 old()}
 let (f, b) = p
 (f(), b, n)}`,
        expected: [7, 4, 5],
    },
    {
        name: 'callable fst completion persistent result',
        source: `{let p = (fn () 3, 4)
 {let a = ~{fst(~p)}
 let old = a := fn () 7
 old()}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'callable fst completion nested calls',
        source: `{let p = ((fn () 3, 4), 5)
 let old = fst(~fst(~p)) := fn () 7
 let ((f, n), z) = p
 (old(), f(), n, z)}`,
        expected: [3, 7, 4, 5],
    },
    {
        name: 'callable fst completion data focus',
        source: `{let p = (3, fn () 4)
 let old = fst(~p) := true
 let (b, f) = p
 (old, b, f())}`,
        expected: [3, true, 4],
    },
    {
        name: 'private callable backing whole scope',
        source: 'fn make() {fn () 3}\n{let w = 7\n let old = {let f = make()\n f} := fn () w\n old()}',
        expected: 3,
    },
    {
        name: 'private callable backing projected scope',
        source: `fn make() {(fn () 3, 4)}
{let old = {let p = make()
 fst(~p)} := fn () 7
 old()}`,
        expected: 3,
    },
    {
        name: 'private callable backing temporary cleanup',
        source: `fn make() {fn () 3}
{let seen = 0
 let old = {let f = make()
 {lens finalFocus <- f\nf := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}} := fn () 7
 (old(), seen)}`,
        expected: [3, 7],
    },
    {
        name: 'private scattered backing lexical swap',
        source: `fn make(v) {fn () v}
{let w = 7
 let (old, before) = {let f = make(3)
 {let n = 4
 (f, n)}} := (fn () w, true)
 (old(), before)}`,
        expected: [3, 4],
    },
    {
        name: 'private scattered backing temporary cleanup',
        source: `fn make(v) {fn () v}
{let seen = 0
 let (old, before) = {let f = make(3)
 {let n = 4
 {lens finalFocus <- (f, n)\n(f, n) := finalFocus\n{let installed = f := fn () 9
 seen := installed()
 ()}}}} := (fn () 7, true)
 (old(), before, seen)}`,
        expected: [3, 4, 7],
    },
    {
        name: 'private scattered backing mixed enclosing storage',
        source: `fn make(v) {fn () v}
{let f = make(3)
 let (old, before) = {let n = 4
 (f, n)} := (fn () 7, true)
 (old(), before, f())}`,
        expected: [3, 4, 7],
    },
    {
        name: 'proven native fst stored callee',
        source: '{let first = fst\n let p = (fn () 3, 4)\n let old = first(~p) := fn () 7\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'proven native fst returned callee',
        source: 'fn first() {fst}\n{let p = (fn () 3, 4)\n let get = first()\n let old = get(~p) := fn () 7\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'proven native fst forwarded callee',
        source: 'fn pass(f) {f}\n{let first = pass(fst)\n let f = fn () 3\n let n = 4\n let old = first(~(f, n)) := fn () 7\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'callable fst over temporary frontend',
        source: '{let p = (fn () 3, 4)\n let old = fst(~{{lens finalFocus <- p\np := finalFocus\n()}}) := fn () 7\n let (f, n) = p\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'callable fst cleanup observes projected replacement',
        source: '{let p = (fn () 3, 4)\n let seen = 0\n let old = fst(~{{lens finalFocus <- p\np := finalFocus\n{let (g, k) = p := (fn () 9, 5)\n seen := g() + k\n ()}}}) := fn () 7\n let (f, n) = p\n (old(), seen, f(), n)}',
        expected: [3, 11, 9, 5],
    },
    {
        name: 'callable fst over scattered temporary frontend',
        source: '{let f = fn () 3\n let n = 4\n let old = fst(~{{lens finalFocus <- (f, n)\n(f, n) := finalFocus\n()}}) := fn () 7\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'callable fst scattered temporary cleanup',
        source: '{let f = fn () 3\n let n = 4\n let seen = 0\n let old = fst(~{{lens finalFocus <- (f, n)\n(f, n) := finalFocus\n{let installed = f := fn () 9\n seen := installed()\n ()}}}) := fn () 7\n (old(), seen, f(), n)}',
        expected: [3, 7, 9, 4],
    },
    {
        name: 'callable fst over returned callable lens',
        source: 'fn first(~(x, y)) ~x\n{let p = ((fn () 3, 1), 4)\n let old = fst(~first(~p)) := fn () 7\n let ((f, m), n) = p\n (old(), f(), m, n)}',
        expected: [3, 7, 1, 4],
    },
    {
        name: 'callable fst data sibling of returned lens',
        source: 'fn first(~(x, y)) ~x\n{let p = ((1, fn () 3), 4)\n let old = fst(~first(~p)) := 9\n let ((a, f), n) = p\n (old, a, f(), n)}',
        expected: [1, 9, 3, 4],
    },
    {
        name: 'callable fst alias of returned lens',
        source: 'fn first(~(x, y)) ~x\n{let p = ((fn () 3, 1), 4)\n {let l = ~fst(~first(~p))\n let o = l := fn () 7\n ()}\n let ((f, m), n) = p\n (f(), m, n)}',
        expected: [7, 1, 4],
    },
    {
        name: 'callable fst over private returned backing',
        source: 'fn temp(~log) ~{lens v <- (fn () 1, 2)\n {let (g, n) = v\n let o = log := g\n ()}}\n{let log = fn () 0\n let old = fst(~temp(~log)) := fn () 8\n (old(), log())}',
        expected: [1, 8],
    },
    {
        name: 'selected callable alias true',
        source: '{let f = fn () 3\n let g = fn () 4\n let r = {let l = ~{match true {true -> f; false -> g}}\n let old = l := fn () 7\n old()}\n (r, f(), g())}',
        expected: [3, 7, 4],
    },
    {
        name: 'selected callable alias false',
        source: '{let f = fn () 3\n let g = fn () 4\n let r = {let l = ~{match false {true -> f; false -> g}}\n let old = l := fn () 7\n old()}\n (r, f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'selected callable captured arm',
        source: '{let f = fn () 3\n let k = 5\n let g = fn () k\n let r = {let l = ~{match false {true -> f; false -> g}}\n let old = l := fn () 7\n old()}\n (r, f(), g())}',
        expected: [5, 3, 7],
    },
    {
        name: 'selected callable projected arms',
        source: '{let p = (fn () 3, fn () 4)\n let r = {let l = ~{match false {true -> {let (x, y) = ~p\n x}; false -> {let (x, y) = ~p\n y}}}\n let old = l := fn () 7\n old()}\n let (f, g) = p\n (r, f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'selected callable unused alias',
        source: '{let f = fn () 3\n let g = fn () 4\n {let l = ~{match true {true -> f; false -> g}}\n ()}\n (f(), g())}',
        expected: [3, 4],
    },
    {
        name: 'selected callable aggregate focus',
        source: '{let p = (fn () 3, 1)\n let q = (fn () 4, 2)\n let r = {let l = ~{match false {true -> p; false -> q}}\n let (o, n) = l := (fn () 7, 9)\n (o(), n)}\n let (f, a) = p\n let (g, b) = q\n (r, f(), a, g(), b)}',
        expected: [[4, 2], 3, 1, 7, 9],
    },
    {
        name: 'selected callable converts entry tables',
        source: 'fn mk() {fn (h) h()}\n{let a = mk()\n let one = a(fn () 1)\n let f = mk()\n let g = fn (h) h()\n let r = {let l = ~{match true {true -> f; false -> g}}\n let old = l := fn (h) 7\n old(fn () 5)}\n (one, r, f(fn () 0), g(fn () 2))}',
        expected: [1, 5, 7, 2],
    },
    {
        name: 'selected callable same owner',
        source: '{let f = fn () 3\n let r = {let l = ~{match true {true -> f; false -> f}}\n let old = l := fn () 7\n old()}\n (r, f())}',
        expected: [3, 7],
    },
    {
        name: 'selected callable forwarded swap',
        source: '{let f = fn () 3\n let g = fn () 4\n let old = {let l = ~{match true {true -> f; false -> g}}\n l} := fn () 7\n (old(), f(), g())}',
        expected: [3, 7, 4],
    },
    {
        name: 'selected callable result true',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\n{let p = (fn () 3, fn () 4)\n let old = pick(true, ~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [3, 7, 4],
    },
    {
        name: 'selected callable result false',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\n{let p = (fn () 3, fn () 4)\n let old = pick(false, ~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'selected callable result scattered argument',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\n{let f = fn () 3\n let g = fn () 4\n let old = pick(false, ~(f, g)) := fn () 7\n (old(), f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'selected callable result alias',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\n{let p = (fn () 3, fn () 4)\n let r = {let l = ~pick(true, ~p)\n let o = l := fn () 7\n o()}\n let (f, g) = p\n (r, f(), g())}',
        expected: [3, 7, 4],
    },
    {
        name: 'selected callable result forwarded',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\nfn relay(c, ~p) ~pick(c, ~p)\n{let p = (fn () 3, fn () 4)\n let old = relay(false, ~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'selected callable result consumed by focus call',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\nfn ex(new, ~x) {x := new}\n{let p = (fn () 3, fn () 4)\n let old = ex(fn () 7, ~pick(true, ~p))\n let (f, g) = p\n (old(), f(), g())}',
        expected: [3, 7, 4],
    },
    {
        name: 'selected callable result captured arm',
        source: 'fn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\n{let k = 9\n let p = (fn () 3, fn () k)\n let old = pick(false, ~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [9, 3, 7],
    },
    {
        name: 'selected callable result private arm',
        source: 'fn tap(c, ~x) ~{match c {true -> x\n false -> {lens v <- fn () 0\n {let o = x := v\n ()}}}}\n{let f = fn () 3\n let old = tap(false, ~f) := fn () 7\n (old(), f())}',
        expected: [0, 7],
    },
    {
        name: 'selected callable result converts entry tables',
        source: 'fn mk() {fn (h) h()}\nfn pick(c, ~(x, y)) ~{match c {true -> x\n false -> y}}\n{let a = mk()\n let one = a(fn () 1)\n let p = (mk(), fn (h) h())\n let old = pick(true, ~p) := fn (h) 7\n let (f, g) = p\n (one, old(fn () 5), f(fn () 0), g(fn () 2))}',
        expected: [1, 5, 7, 2],
    },
    {
        name: 'dispatched callable result true',
        source: 'fn first(~(x, y)) ~x\nfn second(~(x, y)) ~y\n{let p = (fn () 3, fn () 4)\n let e = match true {true -> first\n false -> second}\n let old = e(~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [3, 7, 4],
    },
    {
        name: 'dispatched callable result false',
        source: 'fn first(~(x, y)) ~x\nfn second(~(x, y)) ~y\n{let p = (fn () 3, fn () 4)\n let e = match false {true -> first\n false -> second}\n let old = e(~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'dispatched callable result alias',
        source: 'fn first(~(x, y)) ~x\nfn second(~(x, y)) ~y\n{let p = (fn () 3, fn () 4)\n let e = match false {true -> first\n false -> second}\n let r = {let l = ~e(~p)\n let o = l := fn () 7\n o()}\n let (f, g) = p\n (r, f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'dispatched callable result private option',
        source: 'fn first(~(x, y)) ~x\nfn temp(~(x, y)) ~{lens v <- fn () 0\n {let o = x := v\n ()}}\n{let p = (fn () 3, fn () 4)\n let e = match false {true -> first\n false -> temp}\n let old = e(~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [0, 7, 4],
    },
    {
        name: 'dispatched callable result captured',
        source: 'fn first(~(x, y)) ~x\nfn second(~(x, y)) ~y\n{let k = 9\n let p = (fn () 3, fn () k)\n let e = match false {true -> first\n false -> second}\n let old = e(~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [9, 3, 7],
    },
    {
        name: 'dispatched callable result converts entry tables',
        source: 'fn mk() {fn (h) h()}\nfn first(~(x, y)) ~x\nfn second(~(x, y)) ~y\n{let a = mk()\n let one = a(fn () 1)\n let p = (mk(), fn (h) h())\n let e = match true {true -> first\n false -> second}\n let old = e(~p) := fn (h) 7\n let (f, g) = p\n (one, old(fn () 5), f(fn () 0), g(fn () 2))}',
        expected: [1, 5, 7, 2],
    },
    {
        name: 'recursive callable lens result',
        source: 'fn walk(k, ~x) ~{match k {0 -> x\n j -> walk(j - 1, ~x)}}\n{let f = fn () 3\n let old = walk(2, ~f) := fn () 7\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'recursive callable lens result alias',
        source: 'fn walk(k, ~x) ~{match k {0 -> x\n j -> walk(j - 1, ~x)}}\n{let f = fn () 3\n let r = {let l = ~walk(3, ~f)\n let o = l := fn () 7\n o()}\n (r, f())}',
        expected: [3, 7],
    },
    {
        name: 'recursive callable lens result selecting arms',
        source: 'fn seek(k, ~(x, y)) ~{match k {0 -> x\n 1 -> y\n j -> seek(j - 1, ~(x, y))}}\n{let p = (fn () 3, fn () 4)\n let old = seek(3, ~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [4, 3, 7],
    },
    {
        name: 'recursive callable lens result consumed by focus call',
        source: 'fn walk(k, ~x) ~{match k {0 -> x\n j -> walk(j - 1, ~x)}}\nfn ex(new, ~x) {x := new}\n{let f = fn () 3\n let old = ex(fn () 7, ~walk(2, ~f))\n (old(), f())}',
        expected: [3, 7],
    },
    {
        name: 'recursive callable lens result captured replacement',
        source: 'fn walk(k, ~x) ~{match k {0 -> x\n j -> walk(j - 1, ~x)}}\n{let f = fn () 3\n let k = 5\n let old = walk(0, ~f) := fn () k\n (old(), f())}',
        expected: [3, 5],
    },
    {
        name: 'selected callable call arms',
        source: 'fn first(~(x, y)) ~x\nfn second(~(x, y)) ~y\n{let p = (fn () 3, fn () 4)\n let r = {let l = ~{match false {true -> first(~p); false -> second(~p)}}\n let o = l := fn () 7\n o()}\n let (f, g) = p\n (r, f(), g())}',
        expected: [4, 3, 7],
    },
];
