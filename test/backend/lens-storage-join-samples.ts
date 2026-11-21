/** Setup-only divergent owners survive selected lens staging and restoration. */
export const lensStorageJoinSamples = (['true', 'false'] as const).flatMap((condition) => [
    {
        name: `lens storage join selected ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 x}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 5 : 3, true],
    },
    {
        name: `lens storage join aggregate ${condition}`,
        source: `{let x = 1
 let v = 3
 let packed = (fn () v, 4)
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = packed := (fn () y, 6)
 x}; false -> x}}
 focus := true}
 let (f, n) = packed
 (f(), n, x)}`,
        expected: [condition === 'true' ? 5 : 3, condition === 'true' ? 6 : 4, true],
    },
    {
        name: `lens storage join intervening replacement ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 x}; false -> x}}
 let old = f := fn () 9
 old()
 focus := true}
 (f(), x)}`,
        expected: [9, true],
    },
    {
        name: `lens storage join selected cleanup ${condition}`,
        source: `{let x = 1
 let count = 0
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 {lens finalFocus <- dup(~x)\nx := finalFocus\n{count := count + 1}}}; false -> {lens finalFocus <- dup(~x)\nx := finalFocus\n{count := count + 10}}}}
 focus := true}
 (f(), x, count)}`,
        expected: [condition === 'true' ? 5 : 3, true, condition === 'true' ? 1 : 10],
    },
    {
        name: `lens storage join returned backing ${condition}`,
        source: `fn choose(flag, first, second, ~x) ~{let f = first
 match flag {true -> {let old = f := second
 x}; false -> x}}
{let a = 3
 let b = 5
 let x = 1
 let old = choose(${condition}, fn () a, fn () b, ~x) := true
 (old, x)}`,
        expected: [1, true],
    },
    {
        name: `lens storage join unused focus ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 x}; false -> x}}
 ()}
 (f(), x)}`,
        expected: [condition === 'true' ? 5 : 3, 1],
    },
    {
        name: `lens storage join mixed focus ${condition}`,
        source: `{let pair = (1, 2)
 let a = 3
 let b = 4
 let v = 3
 let f = fn () v
 let y = 5
 {let focus = ~{match ${condition} {true -> {let old = f := fn () y
 pair}; false -> (a, b)}}
 focus := (9, 10)}
 (f(), pair, (a, b))}`,
        expected: condition === 'true' ? [5, [9, 10], [3, 4]] : [3, [1, 2], [9, 10]],
    },
    {
        name: `lens storage join nested selection ${condition}`,
        source: `{let x = 1
 let v = 3
 let f = fn () v
 let y = 5
 let z = 7
 {let focus = ~{match ${condition} {true -> {match false {true -> {let old = f := fn () y
 x}; false -> {let old = f := fn () z
 x}}}; false -> x}}
 focus := true}
 (f(), x)}`,
        expected: [condition === 'true' ? 7 : 3, true],
    },
]);
