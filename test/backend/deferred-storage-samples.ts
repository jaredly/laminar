/** Selected deferred cleanup consumes original typed storage before normalization. */
export const deferredStorageSamples = (['true', 'false'] as const).flatMap((condition) => [
    {
        name: `deferred storage descriptor transition ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let f = fn () v
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 seen := old()
 ()}}}
 focus := ${condition}}
 (seen, x)}`,
        expected: [3, condition === 'true'],
    },
    {
        name: `deferred aggregate descriptor transition ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let packed = (fn () v, 4)
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (fn () 9, 6)
 seen := old() + n
 ()}}}
 focus := ${condition}}
 (seen, x)}`,
        expected: [7, condition === 'true'],
    },
    {
        name: `deferred storage consume ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{seen := f()
 ()}}}; false -> x}}
 focus := 2}
 (seen, x)}`,
        expected: [condition === 'true' ? 5 : 0, 2],
    },
    {
        name: `deferred storage refill ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{f()
 ()}}}; false -> x}}
 focus := true}
 f := fn () 9
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred storage aggregate ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let packed = ((fn () v, 4), true)
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = packed := ((fn () y, 6), false)
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let ((f, n), _) = packed
 seen := f() + n
 ()}}}; false -> x}}
 focus := true}
 (seen, x)}`,
        expected: [condition === 'true' ? 11 : 0, true],
    },
    {
        name: `deferred storage returned owned cleanup result ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\nf}}; false -> x}}
 focus := true}
 x}`,
        expected: true,
    },
    {
        name: `deferred storage unused alias ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{seen := f()
 ()}}}; false -> x}}
 ()}
 (seen, x)}`,
        expected: [condition === 'true' ? 5 : 0, 1],
    },
    {
        name: `deferred storage returned backing ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{f()
 ()}}}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `deferred storage nested selection ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let f = fn () v
 let y = 5
 let z = 7
 {let focus = ~{match ${condition} {true -> {match false {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{seen := f()
 ()}}}; false -> {let old = f := fn () z
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{seen := f()
 ()}}}}}; false -> x}}
 focus := true}
 (seen, x)}`,
        expected: [condition === 'true' ? 7 : 0, true],
    },
    {
        name: `deferred storage continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}
 focus := ${condition}}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred aggregate continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let packed = (fn () v, 4)
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (fn () 9, 6)
 old() + n
 ()}}}
 focus := ${condition}}
 let (f, n) = packed
 (f() + n, x)}`,
        expected: [15, condition === 'true'],
    },
    {
        name: `deferred storage unused continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}
 ()}
 (f(), x, ${condition})}`,
        expected: [9, 1, condition === 'true'],
    },
    {
        name: `deferred storage immediate continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}} := ${condition}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred repeated continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}
 focus := ${condition}}
 {let focus = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 12
 old()
 ()}}}
 ()}
 (f(), x)}`,
        expected: [12, condition === 'true'],
    },
    {
        name: `deferred scattered continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 let g = fn () 4
 {let focus = ~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}, {lens finalFocus <- y\ny := finalFocus\n{let old = g := fn () 8
 old()
 ()}})
 focus := (${condition}, 7)}
 (f() + g(), x, y)}`,
        expected: [17, condition === 'true', 7],
    },
    {
        name: `deferred scattered unused continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 {let focus = ~(x, {lens finalFocus <- y\ny := finalFocus\n{let old = f := fn () 9
 old()
 ()}})
 ()}
 (f(), x, y, ${condition})}`,
        expected: [9, 1, 2, condition === 'true'],
    },
    {
        name: `deferred scattered immediate continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 (x, {lens finalFocus <- y\ny := finalFocus\n{let old = f := fn () 9
 old()
 ()}}) := (${condition}, 7)
 (f(), x, y)}`,
        expected: [9, condition === 'true', 7],
    },
    {
        name: `deferred nested scattered continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let z = 3
 let v = 4
 let f = fn () v
 let g = fn () 5
 {let focus = ~(x, ({lens finalFocus <- y\ny := finalFocus\n{let old = f := fn () 9
 old()
 ()}}, {lens finalFocus <- z\nz := finalFocus\n{let old = g := fn () 8
 old()
 ()}}))
 focus := (${condition}, (6, 7))}
 (f() + g(), x, y, z)}`,
        expected: [17, condition === 'true', 6, 7],
    },
    {
        name: `deferred scattered aggregate continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let packed = (fn () v, 4)
 {let focus = ~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (fn () 9, 6)
 old() + n
 ()}}, y)
 focus := (${condition}, 7)}
 let (f, n) = packed
 (f() + n, x, y)}`,
        expected: [15, condition === 'true', 7],
    },
    {
        name: `deferred plain call continuation ${condition}`,
        source: `fn read(~x) dup(~x)
{let x = 1
 let v = 3
 let f = fn () v
 let result = read(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})
 (result, f(), x, ${condition})}`,
        expected: [1, 9, 1, condition === 'true'],
    },
    {
        name: `deferred returned call continuation ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})}
 focus := ${condition}}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred native dup continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let result = dup(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})
 (result, f(), x, ${condition})}`,
        expected: [1, 9, 1, condition === 'true'],
    },
    {
        name: `deferred native fst continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 {let focus = ~{fst(~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}, y))}
 focus := ${condition}}
 (f(), x, y)}`,
        expected: [9, condition === 'true', 2],
    },
    {
        name: `deferred plain scattered call continuation ${condition}`,
        source: `fn read(~p) dup(~p)
{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 let result = read(~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}, y))
 (result, f(), x, y, ${condition})}`,
        expected: [[1, 2], 9, 1, 2, condition === 'true'],
    },
    {
        name: `deferred returned scattered call continuation ${condition}`,
        source: `fn pass(~p) ~p
{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 {let focus = ~{pass(~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}, y))}
 focus := (${condition}, 7)}
 (f(), x, y)}`,
        expected: [9, condition === 'true', 7],
    },
    {
        name: `deferred forwarded call continuation ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{pass(~{pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})})}
 focus := ${condition}}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred unused returned call continuation ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})}
 ()}
 (f(), x, ${condition})}`,
        expected: [9, 1, condition === 'true'],
    },
    {
        name: `deferred dynamic plain call continuation ${condition}`,
        source: `fn first(~x) dup(~x)
fn second(~x) {dup(~x) + 1}
{let x = 1
 let v = 3
 let f = fn () v
 let call = match ${condition} {true -> first; false -> second}
 let result = call(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})
 (result, f(), x)}`,
        expected: [condition === 'true' ? 1 : 2, 9, 1],
    },
    {
        name: `deferred dynamic returned call continuation ${condition}`,
        source: `fn first(~x) ~x
fn second(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 let call = match ${condition} {true -> first; false -> second}
 {let focus = ~{call(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred returned aggregate call continuation ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let packed = (fn () v, 4)
 {let focus = ~{pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (fn () 9, 6)
 old() + n
 ()}}})}
 focus := ${condition}}
 let (f, n) = packed
 (f() + n, x)}`,
        expected: [15, condition === 'true'],
    },
    {
        name: `deferred selected convergent continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}};
 false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred selected aggregate continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let packed = (fn () v, 4)
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (replacement, 6)
 old() + n
 ()}};
 false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (replacement, 6)
 old() + n
 ()}}}}
 focus := true}
 let (f, n) = packed
 (f() + n, x)}`,
        expected: [15, true],
    },
    {
        name: `deferred selected unused continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}};
 false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}}
 ()}
 (f(), x)}`,
        expected: [9, 1],
    },
    {
        name: `deferred selected nested continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {match false {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}};
 false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}};
 false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred selected returned continuation ${condition}`,
        source: `fn replacement() 9
fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}});
 false -> pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}})}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred selected divergent continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `deferred selected different cleanup continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}; false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 8
 old()
 ()}}}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 8, true],
    },
    {
        name: `deferred selected divergent aggregate ${condition}`,
        source: `{let x = 1
 let v = 3
 let packed = ((fn () v, 4), true)
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let ((old, n), _) = packed := ((fn () 9, 6), false)
 old() + n
 ()}}; false -> x}}
 focus := true}
 let ((f, n), flag) = packed
 (f() + n, flag, x)}`,
        expected: [condition === 'true' ? 15 : 7, condition === 'false', true],
    },
    {
        name: `deferred selected divergent captured ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 9
 let z = 8
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () y
 old()
 ()}}; false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () z
 old()
 ()}}}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 8, true],
    },
    {
        name: `deferred selected divergent nested ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {match false {true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}; false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 8
 old()
 ()}}}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 8 : 3, true],
    },
    {
        name: `deferred selected divergent returned ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}); false -> pass(~x)}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `deferred selected divergent unused ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 9
 {let focus = ~{match ${condition} {
 true -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () y
 old()
 ()}}; false -> x}}
 ()}
 x}`,
        expected: 1,
    },
    {
        name: `deferred retained replacement ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 seen := old()
 ()}}}; false -> x}}
 focus := true}
 (f(), seen, x)}`,
        expected: [condition === 'true' ? 9 : 3, condition === 'true' ? 5 : 0, true],
    },
    {
        name: `deferred retained replacement convergent ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}; false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred retained replacement aggregate ${condition}`,
        source: `{let x = 1
 let v = 3
 let packed = (fn () v, 4)
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = packed := (fn () y, 6)
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (fn () 9, 7)
 old() + n
 ()}}}; false -> x}}
 focus := true}
 let (f, n) = packed
 (f() + n, x)}`,
        expected: [condition === 'true' ? 16 : 7, true],
    },
    {
        name: `deferred retained replacement unused ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 let z = 9
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () z
 old()
 ()}}}; false -> x}}
 ()}
 x}`,
        expected: 1,
    },
    {
        name: `deferred retained replacement returned ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 pass(~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}})}; false -> pass(~x)}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `deferred retained replacement nested ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 let z = 7
 {let focus = ~{match ${condition} {true -> {match false {
 true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}; false -> {let old = f := fn () z
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 8
 old()
 ()}}}}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 8 : 3, true],
    },
    {
        name: `deferred retained replacement refill ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{f()
 f := fn () 9
 ()}}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `deferred retained replacement owned result ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 let z = 9
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n({let old = f := fn () z
 fn () old})()}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `returned local replacement ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `returned local replacement unused ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 {let focus = ~{select(${condition}, fn () a, fn () b, ~x)}
 ()}
 x}`,
        expected: 1,
    },
    {
        name: `returned local replacement forwarded ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}; false -> x}}
fn forward(flag, first, second, ~x) ~{select(flag, first, second, ~x)}
{let a = 3
 let b = 5
 let x = 1
 let old = forward(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `returned local replacement aggregate ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let packed = (first, 4)
 match flag {true -> {let old = packed := (second, 6)
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let (old, n) = packed := (fn () 9, 7)
 old() + n
 ()}}}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `returned local replacement convergent ${condition}`,
        source: `fn replacement() 9
fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}; false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `returned local replacement owned result ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n({let old = f := fn () 9
 fn () old})()}}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `returned local replacement late capture ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 {let z = 9
 match flag {true -> {let old = f := second
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () z
 old()
 ()}}}; false -> x}}}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `selected arm local alias ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner};
 false -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner}}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `selected arm local alias divergent ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {
 true -> {let old = f := fn () y
 {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := fn () 9
 old()
 ()}}}
 inner}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `selected arm local alias unused ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner};
 false -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner}}}
 ()}
 (f(), x)}`,
        expected: [9, 1],
    },
    {
        name: `selected arm local alias nested ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 {let forwarded = ~inner
 forwarded}};
 false -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner}}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `selected arm local alias scattered ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> {let inner = ~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}, y)
 inner};
 false -> {let inner = ~({lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}, y)
 inner}}}
 focus := (true, 7)}
 (f(), x, y)}`,
        expected: [9, true, 7],
    },
    {
        name: `selected arm local alias returned ${condition}`,
        source: `fn replacement() 9
fn select(flag, first, ~x) ~{let f = first
 match flag {
 true -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner};
 false -> {let inner = ~{{lens finalFocus <- dup(~x)\nx := finalFocus\n{let old = f := replacement
 old()
 ()}}}
 inner}}}
{let a = 3
 let x = 1
 let old = select(${condition}, fn () a, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
]);
