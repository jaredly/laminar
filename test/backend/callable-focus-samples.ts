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
 @(x, {let old = a := fn () 7
 old()
 fn () ()})}
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
        name: 'manual callable swap direct',
        source: `{let v = 3
 let f = fn () v
 let old = @(f, fn () ()) := fn () 7
 (old(), f())}`,
        expected: [3, 7],
    },
    {
        name: 'manual callable swap cleanup replacement',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 let old = @(f, {let installed = f := fn () 9
 seen := installed()
 fn () ()}) := fn () 7
 (old(), seen, f())}`,
        expected: [3, 7, 9],
    },
    {
        name: 'manual callable swap nested cleanup order',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 let old = @(@(f, {let installed = f := fn () 9
 seen := seen * 10 + installed()
 fn () ()}), {let installed = f := fn () 8
 seen := installed()
 fn () ()}) := fn () 7
 (old(), seen, f())}`,
        expected: [3, 78, 9],
    },
    {
        name: 'manual callable swap aggregate',
        source: `{let v = 3
 let p = (fn () v, 4)
 let old = @(p, fn () ()) := (fn () 7, true)
 let (f, n) = old
 let (g, b) = p
 (f(), n, g(), b)}`,
        expected: [3, 4, 7, true],
    },
    {
        name: 'manual callable swap projected',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~p
 let old = @(a, fn () ()) := fn () 7
 old()}
 let (f, n) = p
 (f(), n)}`,
        expected: [7, 4],
    },
    {
        name: 'manual callable swap unused',
        source: `{let v = 3
 let f = fn () v
 let w = 7
 let old = @(f, fn () ()) := fn () w
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
        name: 'forwarded callable focus manual cleanup',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 let old = {let marker = ()
 @(f, {let installed = f := fn () 9
 seen := installed()
 fn () ()})} := fn () 7
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
 @(f, fn () ())} := fn () w
 9}`,
        expected: 9,
    },
    {
        name: 'computed callable alias manual replacement',
        source: `{let v = 3
 let f = fn () v
 {let a = ~{@(f, fn () ())}
 let old = a := fn () 7
 old()}
 f()}`,
        expected: 7,
    },
    {
        name: 'computed callable alias unused',
        source: `{let v = 3
 let f = fn () v
 {let a = ~{@(f, fn () ())}
 ()}
 f()}`,
        expected: 3,
    },
    {
        name: 'computed callable alias cleanup replacement',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 {let a = ~{@(f, {let installed = f := fn () 9
 seen := installed()
 fn () ()})}
 let old = a := fn () 7
 old()}
 (seen, f())}`,
        expected: [7, 9],
    },
    {
        name: 'computed callable alias nested manual order',
        source: `{let v = 3
 let f = fn () v
 let seen = 0
 {let a = ~{@(@(f, {let installed = f := fn () 9
 seen := seen * 10 + installed()
 fn () ()}), {let installed = f := fn () 8
 seen := installed()
 fn () ()})}
 let old = a := fn () 7
 old()}
 (seen, f())}`,
        expected: [78, 9],
    },
    {
        name: 'computed callable alias aggregate projected contents',
        source: `{let v = 3
 let p = (fn () v, 4)
 {let (a, b) = ~{@(p, fn () ())}
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
 {let c = ~{@(a, fn () ())}
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
 {let a = ~{@(f, fn () ())}
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
 {let a = ~{@(f, fn () ())}
 let old = a := fn () w
 ()}
 9}`,
        expected: 9,
    },
    {
        name: 'computed callable alias cleanup consumes installed value',
        source: '{let x = 1\n {let f = ~{@(x, fn () {x()})}\n f := fn () 2}\n ()}',
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
        name: 'scattered callable manual wrapper replacement',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = @((f, n), {let installed = f := fn () 9
 seen := installed()
 fn () ()}) := (fn () 7, true)
 (old(), before, seen, f(), n)}`,
        expected: [3, 4, 7, 9, true],
    },
    {
        name: 'scattered callable manual nested wrappers',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = @(@((f, n), {let installed = f := fn () 9
 seen := seen * 10 + installed()
 fn () ()}), {let installed = f := fn () 8
 seen := installed()
 fn () ()}) := (fn () 7, true)
 (old(), before, seen, f(), n)}`,
        expected: [3, 4, 78, 9, true],
    },
    {
        name: 'scattered callable manual member completion',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = (@(f, {let installed = f := fn () 9
 seen := installed()
 fn () ()}), @(n, fn () ())) := (fn () 7, true)
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
        name: 'scattered callable forwarded manual completion',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 let (old, before) = {let marker = ()
 @((f, n), {let installed = f := fn () 9
 seen := installed()
 fn () ()})} := (fn () 7, true)
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
        name: 'scattered callable persistent manual cleanup',
        source: `{let f = fn () 3
 let n = 4
 let seen = 0
 {let (a, b) = ~{@((f, n), {let installed = f := fn () 9
 seen := installed()
 fn () ()})}
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
        name: 'callable fst completion manual result',
        source: `{let p = (fn () 3, 4)
 let seen = 0
 let old = @(fst(~p), {seen := 9
 fn () ()}) := fn () 7
 let (f, n) = p
 (old(), seen, f(), n)}`,
        expected: [3, 9, 7, 4],
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
        name: 'private callable backing manual cleanup',
        source: `fn make() {fn () 3}
{let seen = 0
 let old = {let f = make()
 @(f, {let installed = f := fn () 9
 seen := installed()
 fn () ()})} := fn () 7
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
        name: 'private scattered backing manual cleanup',
        source: `fn make(v) {fn () v}
{let seen = 0
 let (old, before) = {let f = make(3)
 {let n = 4
 @((f, n), {let installed = f := fn () 9
 seen := installed()
 fn () ()})}} := (fn () 7, true)
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
];
