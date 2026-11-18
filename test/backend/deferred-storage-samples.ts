/** Selected deferred cleanup consumes original typed storage before normalization. */
export const deferredStorageSamples = (['true', 'false'] as const).flatMap((condition) => [
    {
        name: `deferred storage descriptor transition ${condition}`,
        source: `{let x = 1
 let seen = 0
 let v = 3
 let f = fn () v
 {let focus = ~{@(x, {let old = f := fn () 9
 seen := old()
 fn () ()})}
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
 {let focus = ~{@(x, {let (old, n) = packed := (fn () 9, 6)
 seen := old() + n
 fn () ()})}
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
 @(x, {seen := f()
 fn () ()})}; false -> x}}
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
 @(x, {f()
 fn () ()})}; false -> x}}
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
 @(x, {let ((f, n), _) = packed
 seen := f() + n
 fn () ()})}; false -> x}}
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
 @(x, fn () f)}; false -> x}}
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
 @(x, {seen := f()
 fn () ()})}; false -> x}}
 ()}
 (seen, x)}`,
        expected: [condition === 'true' ? 5 : 0, 1],
    },
    {
        name: `deferred storage returned backing ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 @(x, {f()
 fn () ()})}; false -> x}}
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
 @(x, {seen := f()
 fn () ()})}; false -> {let old = f := fn () z
 @(x, {seen := f()
 fn () ()})}}}; false -> x}}
 focus := true}
 (seen, x)}`,
        expected: [condition === 'true' ? 7 : 0, true],
    },
    {
        name: `deferred storage staged outer cleanup ${condition}`,
        source: `{let x = 1
 let seen = 0
 let count = 0
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{@({match ${condition} {true -> {let old = f := fn () y
 @(x, {seen := f() + dup(~count)
 fn () ()})}; false -> x}}, fn () {count := 10})}
 focus := true}
 (seen, count, x)}`,
        expected: [condition === 'true' ? 15 : 0, 10, true],
    },
    {
        name: `deferred storage returned staged backing ${condition}`,
        source: `fn select(flag, first, second, ~x) ~{let f = first
 @({match flag {true -> {let old = f := second
 @(x, {f()
 fn () ()})}; false -> x}}, fn () ())}
{let a = 3
 let b = 5
 let x = 1
 let old = select(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `deferred storage continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{@(x, {let old = f := fn () 9
 old()
 fn () ()})}
 focus := ${condition}}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred aggregate continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let packed = (fn () v, 4)
 {let focus = ~{@(x, {let (old, n) = packed := (fn () 9, 6)
 old() + n
 fn () ()})}
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
 {let focus = ~{@(x, {let old = f := fn () 9
 old()
 fn () ()})}
 ()}
 (f(), x, ${condition})}`,
        expected: [9, 1, condition === 'true'],
    },
    {
        name: `deferred storage immediate continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {@(x, {let old = f := fn () 9
 old()
 fn () ()})} := ${condition}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred nested continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let g = fn () 4
 {let focus = ~{@(@(x, {let old = f := fn () 9
 old()
 fn () ()}), {let old = g := fn () 8
 old()
 fn () ()})}
 focus := ${condition}}
 (f() + g(), x)}`,
        expected: [17, condition === 'true'],
    },
    {
        name: `deferred repeated continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{@(x, {let old = f := fn () 9
 old()
 fn () ()})}
 focus := ${condition}}
 {let focus = ~{@(x, {let old = f := fn () 12
 old()
 fn () ()})}
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
 {let focus = ~(@(x, {let old = f := fn () 9
 old()
 fn () ()}), @(y, {let old = g := fn () 8
 old()
 fn () ()}))
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
 {let focus = ~(x, @(y, {let old = f := fn () 9
 old()
 fn () ()}))
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
 (x, @(y, {let old = f := fn () 9
 old()
 fn () ()})) := (${condition}, 7)
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
 {let focus = ~(x, (@(y, {let old = f := fn () 9
 old()
 fn () ()}), @(z, {let old = g := fn () 8
 old()
 fn () ()})))
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
 {let focus = ~(@(x, {let (old, n) = packed := (fn () 9, 6)
 old() + n
 fn () ()}), y)
 focus := (${condition}, 7)}
 let (f, n) = packed
 (f() + n, x, y)}`,
        expected: [15, condition === 'true', 7],
    },
    {
        name: `deferred manual scattered continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 let g = fn () 4
 {let focus = ~{@((@(x, {let old = f := fn () 9
 old()
 fn () ()}), y), {let old = g := fn () 8
 old()
 fn () ()})}
 focus := (${condition}, 7)}
 (f() + g(), x, y)}`,
        expected: [17, condition === 'true', 7],
    },
    {
        name: `deferred plain call continuation ${condition}`,
        source: `fn read(~x) dup(~x)
{let x = 1
 let v = 3
 let f = fn () v
 let result = read(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})
 (result, f(), x, ${condition})}`,
        expected: [1, 9, 1, condition === 'true'],
    },
    {
        name: `deferred returned call continuation ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{pass(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})}
 focus := ${condition}}
 (f(), x)}`,
        expected: [9, condition === 'true'],
    },
    {
        name: `deferred native dup continuation ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let result = dup(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})
 (result, f(), x, ${condition})}`,
        expected: [1, 9, 1, condition === 'true'],
    },
    {
        name: `deferred native fst continuation ${condition}`,
        source: `{let x = 1
 let y = 2
 let v = 3
 let f = fn () v
 {let focus = ~{fst(~(@(x, {let old = f := fn () 9
 old()
 fn () ()}), y))}
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
 let result = read(~(@(x, {let old = f := fn () 9
 old()
 fn () ()}), y))
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
 {let focus = ~{pass(~(@(x, {let old = f := fn () 9
 old()
 fn () ()}), y))}
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
 {let focus = ~{pass(~{pass(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})})}
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
 {let focus = ~{pass(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})}
 ()}
 (f(), x, ${condition})}`,
        expected: [9, 1, condition === 'true'],
    },
    {
        name: `deferred staged returned call continuation ${condition}`,
        source: `fn pass(~x) ~x
{let x = 1
 let count = 0
 let seen = 0
 let v = 3
 let f = fn () v
 {let focus = ~{@({pass(~{@(x, {let old = f := fn () 9
 seen := old()
 fn () ()})})}, fn () {count := 10})}
 focus := ${condition}}
 (f(), seen, count, x)}`,
        expected: [9, 3, 10, condition === 'true'],
    },
    {
        name: `deferred dynamic plain call continuation ${condition}`,
        source: `fn first(~x) dup(~x)
fn second(~x) {dup(~x) + 1}
{let x = 1
 let v = 3
 let f = fn () v
 let call = match ${condition} {true -> first; false -> second}
 let result = call(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})
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
 {let focus = ~{call(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})})}
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
 {let focus = ~{pass(~{@(x, {let (old, n) = packed := (fn () 9, 6)
 old() + n
 fn () ()})})}
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
 true -> @(x, {let old = f := replacement
 old()
 fn () ()});
 false -> @(x, {let old = f := replacement
 old()
 fn () ()})}}
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
 true -> @(x, {let (old, n) = packed := (replacement, 6)
 old() + n
 fn () ()});
 false -> @(x, {let (old, n) = packed := (replacement, 6)
 old() + n
 fn () ()})}}
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
 true -> @(x, {let old = f := replacement
 old()
 fn () ()});
 false -> @(x, {let old = f := replacement
 old()
 fn () ()})}}
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
 true -> @(x, {let old = f := replacement
 old()
 fn () ()});
 false -> @(x, {let old = f := replacement
 old()
 fn () ()})}};
 false -> @(x, {let old = f := replacement
 old()
 fn () ()})}}
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
 true -> pass(~{@(x, {let old = f := replacement
 old()
 fn () ()})});
 false -> pass(~{@(x, {let old = f := replacement
 old()
 fn () ()})})}}
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `deferred selected staged continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let count = 0
 let v = 3
 let f = fn () v
 {let focus = ~{@({match ${condition} {
 true -> @(x, {let old = f := replacement
 old()
 fn () ()});
 false -> @(x, {let old = f := replacement
 old()
 fn () ()})}}, fn () {count := 10})}
 focus := true}
 (f(), count, x)}`,
        expected: [9, 10, true],
    },
    {
        name: `deferred selected divergent continuation ${condition}`,
        source: `fn replacement() 9
{let x = 1
 let v = 3
 let f = fn () v
 {let focus = ~{match ${condition} {
 true -> @(x, {let old = f := replacement
 old()
 fn () ()}); false -> x}}
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
 true -> @(x, {let old = f := fn () 9
 old()
 fn () ()}); false -> @(x, {let old = f := fn () 8
 old()
 fn () ()})}}
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
 true -> @(x, {let ((old, n), _) = packed := ((fn () 9, 6), false)
 old() + n
 fn () ()}); false -> x}}
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
 true -> @(x, {let old = f := fn () y
 old()
 fn () ()}); false -> @(x, {let old = f := fn () z
 old()
 fn () ()})}}
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
 true -> {match false {true -> @(x, {let old = f := fn () 9
 old()
 fn () ()}); false -> @(x, {let old = f := fn () 8
 old()
 fn () ()})}}; false -> x}}
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
 true -> pass(~{@(x, {let old = f := fn () 9
 old()
 fn () ()})}); false -> pass(~x)}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 9 : 3, true],
    },
    {
        name: `deferred selected divergent staged ${condition}`,
        source: `{let x = 1
 let count = 0
 let v = 3
 let f = fn () v
 {let focus = ~{@({match ${condition} {
 true -> @(x, {let old = f := fn () 9
 old()
 fn () ()}); false -> x}}, fn () {count := 10})}
 focus := true}
 (f(), count, x)}`,
        expected: [condition === 'true' ? 9 : 3, 10, true],
    },
    {
        name: `deferred selected divergent unused ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 9
 {let focus = ~{match ${condition} {
 true -> @(x, {let old = f := fn () y
 old()
 fn () ()}); false -> x}}
 ()}
 x}`,
        expected: 1,
    },
]);
