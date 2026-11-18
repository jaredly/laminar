/** Selected deferred cleanup consumes original typed storage before normalization. */
export const deferredStorageSamples = (['true', 'false'] as const).flatMap((condition) => [
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
]);
