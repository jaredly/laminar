// Shared reference acceptance corpus for the deferred-cleanup backend adapter.
export const manualRestorationSamples = [
    {
        name: 'deferred no-op',
        source: '{let x = 1\n {let f = ~{@(x, fn () ())}\n f := true}\n x}',
        expected: true,
    },
    {
        name: 'shifted temporary',
        source: 'fn shifted(~x) ~{let v = x + 2\n @(v, fn () {x := v - 2})}\n{let x = 1\n shifted(~x) := 10\n x}',
        expected: 8,
    },
    {
        name: 'cleanup sees final type',
        source: '{let x = 1\n {let f = ~{@(x, fn () {x := 3})}\n f := true}\n x}',
        expected: 3,
    },
    {
        name: 'owned cleanup parameter',
        source: 'fn restore(f, ~x) ~{@(x, f)}\n{let x = 1\n restore(fn () 4, ~x) := true\n x}',
        expected: true,
    },
    {
        name: 'nested cleanup order',
        source: '{let x = 1\n {let f = ~{@(@(x, fn () {x := x + 1}), fn () {x := x * 2})}\n f := 10}\n x}',
        expected: 21,
    },
    {
        name: 'nested owned callbacks',
        source: 'fn nest(f, g, ~x) ~{@(@(x, g), f)}\n{let x = 1\n nest(fn () 1, fn () 2, ~x) := true\n x}',
        expected: true,
    },
    {
        name: 'tuple focus before cleanup',
        source: '{let x = 1\n let y = 2\n {let f = ~{@((x, y), fn () {x := x + dup(~y)})}\n f := (3, 4)}\n (x, y)}',
        expected: [7, 4],
    },
    {
        name: 'branch cleanup',
        source: '{let x = 1\n {let f = ~{match false {true -> @(x, fn () {x := x + 1}); false -> @(x, fn () {x := x + 10})}}\n f := 3}\n x}',
        expected: 13,
    },
    {
        name: 'explicit owned lifetime',
        source: 'fn own() ~{let v = 1\n @(v, fn () ())}\nown() := true',
        expected: 1,
    },
    {
        name: 'manual around branch',
        source: '{let x = 1\n {let f = ~{@({match true {true -> x; false -> x}}, fn () {x := x + 1})}\n f := 4}\n x}',
        expected: 5,
    },
    ...(['true', 'false'] as const).map((condition) => ({
        name: `manual around selected tuple branch ${condition}`,
        source: `{let x = 1
 let y = 2
 {let f = ~{@({match ${condition} {true -> (x, y); false -> (x, y)}}, fn () {x := x + dup(~y)})}
 f := (3, 4)}
 (x, y)}`,
        expected: [7, 4],
    })),
    ...(['true', 'false'] as const).map((condition) => ({
        name: `only selected cleanup ${condition}`,
        source: `{let x = 1
 let count = 0
 {let f = ~{match ${condition} {true -> @(x, fn () {count := count + 1}); false -> @(x, fn () {count := count + 10})}}
 f := 3}
 (x, count)}`,
        expected: [3, condition === 'true' ? 1 : 10],
    })),
    {
        name: 'late generic expression sees final contents',
        source: `{let x = 1
 let seen = 0
 {let f = ~{@(x, {seen := dup(~x)
 fn () ()})}
 f := 9}
 (x, seen)}`,
        expected: [9, 9],
    },
    {
        name: 'cleanup refills initially empty dependency',
        source: `{let x = 1
 let empty = 2
 empty
 {let f = ~{@(x, fn () {empty := 9})}
 f := true}
 (x, empty)}`,
        expected: [true, 9],
    },
    {
        name: 'cleanup calls reusable definition',
        source: `fn increment(x) {x + 1}
{let x = 1
 {let f = ~{@(x, fn () {x := increment(x)})}
 f := 4}
 x}`,
        expected: 5,
    },
    {
        name: 'unused focus restores once',
        source: `{let x = 1
 let count = 0
 {let _ = ~{@(x, fn () {count := count + 1})}
 ()}
 (x, count)}`,
        expected: [1, 1],
    },
    {
        name: 'duplicated focus restores once',
        source: `{let x = 1
 let count = 0
 let copied = dup(~{@(x, fn () {count := count + 1})})
 (copied, x, count)}`,
        expected: [1, 1, 1],
    },
    {
        name: 'owned cleanup result',
        source: `{let x = 1
 let resource = 2
 {let f = ~{@(x, fn () {let owned = fn () resource
 owned})}
 f := true}
 x}`,
        expected: true,
    },
];
