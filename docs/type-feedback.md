
# Issue 1: use-while-borrowed

This code is invalid
```lm
{
    let x = (1, 2)
    let (a, b) = ~x
    a := true
    (x, b)
}
```
x is borrowed for the lifetime of a and b (functionally, the rest of the {} block) and so cannot be used again while they are live.

Same here
```lm
{
    let x = 1
    let y = ~x
    y := true
    x
}
```
needs to be
```lm
{
    let x = 1
    {
        let y = ~x
        y := true
    }
    x
}
```
in order to be valid.

Likewise, this is a use-while-borrowed error, not an alias shape error:
```lm
let x = (1, 2)
let (a, b) = ~x
x := true
a
```

# Issue 2: first-class functions are linear

A toplevel-defined function can be used any number of times, but a first-class function is linear just like any other value, and can only be used once.

So
```lm
let id = fn (x) x
(id(1), id(true))
```
is actually invalid, `id` can only be used once. I do want to support multi-use first-class-functions eventually, but that will be its own whole thing.

Because first-class functions are linear, they are allowed to capture scope variables. This is perfectly fine, for example:
```lm
let x = 1
let f = fn (()) x
f(())
```

Note that lensing scope variables is not allowed. This is invalid, because it attempts to only borrow x, which would cause x's lifetime to be indeterminite.
```lm
let x = 1
let f = fn (()) x := 2
f(())
```
