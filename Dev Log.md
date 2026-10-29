
When trying out a lens match with no lens arg, I'm realizing I'm missing something.


let f = fn (side, ~(a, b)) ~(match side {
    Left -> a
    Right -> b
})
my match expects to flow back up through the case pattern, but that's not right
OH But actually its fine? we can just ignore it.
So: a funny thing with me only having one scope ever ... calling the cleanup function, the fn arg is allowed to overwrite the containing scope vbl.
This seems like ... something I should fix.
-> have a different arg to the fn
-> then do a swap(pat, vbl)
-> yeah that feels better.
-> and then I can do real scope management, which is very important

---

A note about lens unions: they can't work.
like `let some = (~x) => ~Some(x)`
Because if the value you get on the backend is `None`, you can't get an `x` out of it, and you're toast. The original x is gone, has been given away.
Now you could do a manual `let some = (default, ~x) => @(Some(x), opt => match opt { Some(x) -> x; None -> default })`, but that's you doing it yourself.

Noice. Ok so the manual route is validated.

---

Let's try using an IR.
-> ok let's talk about unique variables.
debruijn indices yo. maybe I guess.
IR gonna have:
-> a human name that it was known by, maybe
-> a unique index

---

Ok so I'm diving into multi-scoping.
Thought being:
-> what if, instead of passing around the gamma number (via ctx.scopes.length),
    -> we had the /names themselves/ know which scope they belonged to.
    SO: `lensToTS` gives me names that know what scopes they're in.
    `let` adds things to ctx.scopes.

OK so we should do new wraps for let value blocks too ... any block gets its own scope, really. but let scopes can access higher scopes, while function blocks ... probably shouldn't.

Ok here's a comprehensive strategy:
-> if `a` is a lens, then we can deal with an outer scope
-> if `a` is not a lens, then it must have been moved into this scope.

Function bodies can only receive moves.

(btw in their impl, toplevel fns can be called any number of times, but local fns are linear variables)

So my question ... I'm like "how do you make a local function that can be called multiple times",
or maybe "what is the type-level distinction between a toplevel defn and a local defn", and can you
promote a local defn?


I ... think I might need to rewrite the whole tots generation stuff.
I want it to be a lot more ... concerted, now that I mostly know what's going on.

BUT actually before I solve the scope stuff, I can do more of these demos.


---

Next steps on laminar:
-> update their flow.fl to my syntax
-> with tests
-> and comments explaining it all

Once I have all of their tests passing, I can make the followup "here's what linear/flow looks and acts like" because I can be confident in my understanding.

MULTI ARG:
Big question: about about allowing multiple lenses?
Basically, behind the scenes we would conceptually represent that as a tuple of lenses.
ALTHOUGH we can achieve the same thing by explicitly using a tuple of lenses in the moment, so why bother with the charade?
ok.
SO I just need to support 'multiple non-lens args', with the one on the end might be a lens arg.

---

haskelly syntax ... will take a bit of rejiggering
(postponing for now)

---

DSL Status:

- [x] self-lexer -> json.cst -> json-parser.ts
- [x] self-lexer -> self.cst -> self-lexer.ts
- [x] laminar.cst yes please
- [x] configs so we can specify "reserved words"
    - [x] actually use it
- [-] make it so I can put a type annotation after a rule name to simplify things
    - [x] last mile
    - [ ] ooh turns out I might want to be able to have 'more complex colons'
        - like `?:` for example. this would also be like a config option.
        - or `::`
        - anddddd do we want to be able to specify the `listOrder`? like precedence stuff?
        - and what list types can collapse into others?
        - [ ] ignoring this for now
- [ ] allow more rule types in more places, like regex inline
- [x] regex inline thx (id only tho, not op...)
- [ ] allow double duty `{\n;`, means that if both \n and ; show up in the same list, we merge, and \n wins

Q: what about indentation
seems like it might be a thing.
I kinda want to be able to parse the haskellish stuff.
BUT not enough to actually do it.

Q: so, what about "reserved words". Seems like I ought to support that.
so like, `id` and `op` would match anything that's not a reserved word. Pretty simple.

How to declare?
-> some pragma of some sort?
-> like `@reserve {}`
-> then we could have other pragmas for other config stuff.
-> could also have like toml frontmatter or something
--> OOH it could be an error to do an explicit match on something that's not reserved?
YEAH that sounds great. (but you could turn it off)
ALTERNATIVELY we could just use all the explicit matches to infer what's reserved?
-> hmmmm my have a default for that? Some languages will want to be a little squirly.
-> hm yeah let's have you list things out, and then WARN if you match on something that's not reserved?
-> let's have a "nonreserved:" for things that you will match on, but aren't reserved. I like that. then we can error on violation.
-> could be nice to have a script that spits out all your reserved words

--

side quest: DSL

Q: regex?
-> is there a way to lex regex without doing full js parsing along the way? I don't really think so.
-> we could have `re"regex literal"` and that'll work fine

Q: JSX vs <t,vbls>?
-> I'm thinking we'll need like <::> table syntax for one or the other ... which is a shame.

Q: single-quoted string?
-> should be a config option

Q: efficiency?
-> let's do fast failure (wrong # of items in a list, wrong literals somewhere in the list)

Q: suffixes?
-> name:**Rule means "rule gets a list, but doesnt have to consume all of it, because we're matching multiple times"

Q: binops?
-> hmmmm could be something like ...

Q: more complex functions than we want inline?
-> could have js code literals, like function name() {body} that we just stringify back into it? could be fun though.

Q: wanting to reasonable parse and regurgitate js makes me think more about newlines vs commas in lists.

options:

1. lists have a 'newline' flag, which indicates whether the first break was a newline/semicolon or a comma. When printing, we check this flag. This is probably the least change right now. it continues the collapsing of separators, but in a way that js can handle for the most part.
2. we refuse to collapse separators. We say that a ;-separated list is different from a ,-separated list, which may even be different from a \n-separated list. hmm naw it's just those two. so ;\n is collapsed to ;, ,\n still means ,, but bare \n is treated as ; for asi goodness.
   Honestly that seems like a reasonable idea.
   Q: what do we do with a single-item list? or a zero-item list? it has to default in some direction. Let's go with ,, and the parser can make different choices.
   ALSO: this means we could have a list [a,b,c;d,e,f], right? What do we do with that?
3. we say that [a,b,c;d,e,f] is `["[", [";", [",", "a", ...]]]`
   So a `[` by itself only has a single child. it has no notion of a separator. This makes our DSL much more verbose. BUT we could pun it with `["[," ...]` or `["[;" ...]` or even `["[\n" ...]`. ooh we could also pun `["[ " ...]`. Honestly thats attractive. we could also do `["[;\n" ...]` to indicate that both are acceptable.

Ok I'm leaning toward 3, as it errs on the side of expressiveness, which I like. It also feels like it can open up the door for indent-based parsing, with like a `["\n\t" ...]` or similar

Q: comman-newline shouldn't be squished into newline
but comma-semicolon should drop the trailing comma.

Ok bigger question.
Where do newlines go in the scheme of things.

, < ;
' ' < ,
'' < ' '

1,2,3
4,5,6 -> should be `['\n' [',' 1 2 3] [',' 4 5 6]]`

BUT

1,2,3,
4,5,6 -> should be `[',' 1 2 3 4 5 6]`

Does that mean we should just special case
collapsing a newline after another spacer

Trailing colon ...

1,2,3:, ... does that just get dropped? sure.

--

AH I need more disciplined scope handling.
Like, reading something out of the containing scope ... wait ... don't we just say that's not allowed?

-> immediate next step: get all their examples running
-> possible side quest; should I make a parser for their syntax?
-> could be interesting to make an indent-sensitive parser
-> we'd need some kind of 'indent-kind' list I imagine,
and it would be ... hmm
( ) child of ' '?
( ) child of '\n'?
honestly having it be a child of ' ' seems like the right call.
you're going along parsing stuff.

-> nother side quest: making a DSL for parsing.
-> I want ... generated typescript? of some sort.
-> but like maybe we're generating types?
-> so the question is, can we source map it? should be able to.
-> also, can we make it not obnoxiously long?
-> can turn it into like a dsl, but with type assertions
-> do we make a DSL for the DSL for parsing?
-> maybe we just make the human-readable dsl
-> and write it in that. that's nice.

```
Linear {
    ["" ...children:*] -> parseOp(children)
    ["\"" head:id ...interp:(value:Linear tail:id)] -> {head: head.text, interp}
    ["{" child:Linear] -> child
    ["{" ...block:*Block] -> block
    ["("] -> ({type: 'const', value: null})
    ["(" one:Linear] -> one
    ["(" ...items:Linear] -> ({type: "tuple", items})
    [" " one:Linear] -> one
    [" " "match" value:Linear ["{" ...cases:LinearCase]] -> ({type: "case", value, cases})
    // if the fncall has a no binding, then the bindings are splatted in.
    [" " "fn" Ann(["(" ...args:FnArg]) body:FnBody] -> ({type: "fn", args, ann, body})
    [" " lens:Lens ":=" ...value:*Linear] -> ({type: "assign", lens, value})
    [" " left:Linear ...right:(op:op right:Linear)] -> partition(left, right)
}

FnBody {
    ["" "~" ...lens:*Lens] -> ({type: "lens", lens})
    ["{" one:Term] -> one
    ["{" ...block:*Block] -> block
    one:Linear -> Linear
}

// A fn allows optional bindings
Ann(inner) {
    [": " inner ann:Type]
    inner
}

LinearCase {
    [" " pat:Pat "=>" ...body:*Linear] -> ({pat, body})
}

Block {
    ["{" [" " "let" pat:Pat "=" ...value:*Term] ...body:*Block] -> ({type: "let", pat, value, body})
    ["{" value:Term ...body:*Block] => ({type: "let", pat: {type: "tuple", items: []}, value, body})
}

Pat {
    text:id -> ({type: "id", text: text.text})
    ["" "~" inner:Pat] -> ({type: "lens", inner})
    ["" name:id ["(" ...args:Pat]] -> ({type: "constructor", name: name.text, args})
    ["(" ...items:Pat] -> ({type: "tuple", items})
}
```

```
let out = 2
fn ok(x) {
    out := x
}
ok(4)
```

is that allowed?
I thiiink I would disallow it. like the fn would capture it,
so its dead to the outside world.

I WANT full sourcemapping, so errors can be more targetted
ALSO a nice way to write tests would be to have a value
that is a log array, so we can add to it at points (mutating it)
and then assert that the order is correct at the end.

Next steps:

Actually, let's formalize our pseudocode.
the GET/RECV/TEE/TEE2/WRAP stuff
and we can output that, and like, audit that.

- [.] lens x <- y // how do it?
    - [x] basic
    - [x] some error cases
    - [x] update a passed in lens in the destructor
    - working on it
- [ ] case make it work for term->lin
- [ ] split {} {} // fst() snd()
- [ ] figure out ... lens terms broadly
- [ ] case make it work for term->lens

I want to be representing lenses as a thing with a cleanup.
I think there's a cleaner way to do this.
I think once we get into let and case inside lens terms, we'll really need to be disciplined
instead of current loosy goosy.

--

```
fn dropper(a) ~{
    lens b <- a
    ...
}
->
fn dropper(arg) {
    recv(arg, "a")
    return [
        get("a"),
        (res) => {
            recv(res, "b")
            ...
        }
    ]
}
```

--

Ok let's talk about the full syntax. Because, interestingly,
doing

```
incand :: ~Int -> ~Int
incand ~x =
    x := x + 1
    ~x
```

gives me a `can't do ~x there`.
BUT we can do

```
incand :: ~Int -> Int
incand ~x =
    x := x + 1
    20
```

--

definitions:

- lin = linear term
- lens = lens term
- vbl = variable identifier
- term = lin | ~lens

pat
---

vbl
(pat, pat)
()

lin
---

```
vbl
lens := lin
unlens lens in lin
let pat = lin in lin
let pat = ~lens in lin
fn(pat) => lin
fn(pat) => ~lens
lin(lin)
lin(~lens)
(lin, lin)
()
Left(lin)
Right(lin)
case lin
    Left(pat) -> lin
    Right(pat) -> lin
case ~lens
    Left(pat) -> lin
    Right(pat) -> lin
false(term) ???
lin & lin // SPLIT
fst(lin)
snd(lin)
true(lin)
promote??discard??copy??derelict??
```

lens
----

```
vbl
aslens vbl <- lin in lin
let pat = lin in lens
let pat = ~lens in lens
lin(lin)
lin(~lens)
(lens, lens)
()
case lin
    Left(pat) -> lens
    Right(pat) -> lens
case ~lens
    Left(pat) -> lens
    Right(pat) -> lens
false(term)
```

both
----

```
vbl
let pat = term in both
lin(term)
(both, both)
()
case term
    Left(pat) -> both
    Right(pat) -> both
false(term)
```

I think `false` is like `throw` or something.

Some thoughts:

- the lens language supports tuples, but not left/right
- function calls are one or the other depending probably on their return value?
- in the paper, there's no such thing as fn(~x) => ... all fn args are bare variables. I assume they adopted the ~ in a fn pat for clarity and ease of inference?

AH OK SO

```
incand ~x =
    ~(let () = x := x + 1
      x)
```

SHOULD be admitted by the language. the compiler doesn't implement it though.

So what about

let x = ~y
x

can't do that, because x needs to send a value back into y.

let x = ~y
x := 2

works.

So:

- "if a function accepts a ~lens as its argument, the function must provide a value back to it"
  -> that's not quite true. it can ignore it, or swap it
- Q: can you call a function with one lens, and return an unrelated one?
    - this is allowed by the syntax:
        - unrelated ~x = ~(let y = 2 in y)

something I'm trying to make happen:

adds2 ~x = ~(x + 2)

what do I think will happen?

well the thing I want it translated into is something like:

adds2 = \x -> (2, \resv -> resv + 2)

What would it mean for a ~lens to be a literal, like ~2?
its non-updatable. so yeah none of that.

```
Conceptually. if we have (A/B) -> C
that becomes
(A) => [C, B]

and if we expand that
(~x) => t
becomes
(x) => [t, get('x')]

and then, if we talk about a pair
(~(x, y)) => t
becomes
((x, y)) => [t, (get('x'), get('y'))]

## OK NOW let's talk about lenses on the way back ##

(A/B) -> C/D
that becomes
(A) => [C, D => B]

(~(x, y)) => ~x
becomes
((x, y)) => [x, nx => (nx, y)]
so that's like

((x, y)) => [(y, x), value => recv(value, 'x'); (get('x'), get('y'))]

logically, "the returned lens" needs to know about itself in terms of ... something.

let's try swap

(~(x, y)) => ~(y, x)
-->
((x, y)) => [t, value => recv(value, ['y', 'x']); (get('x'), get('y'))]

and swap2

(~(x, (y, z))) => ~(x, z)
-->
((x, (y, z))) => [t, value => recv(value, ['x', 'z']); (get('x'), (get('y'), get('z')))]

so that works for trivial constructions of lenses.


OK let's try using a lens here folks.

useIncd () =
    let x = 5
    inc ~x
    x - 1
->
useIncd () =
    recv(5, 'x')
    let () = tee(inc(get('x')), 'x')
    get('x') - 1

calling a function with a lens `a(~b)` turns into `tee(a(get('b')), 'b')`
where
tee ((a, b), c) = recv(b, c); a

useMore () =
    let x = (5, 6)
    inc ~(fst ~x)
    let (a, b) = x
    a + b * 2
->
useMore () =
    recv((5, 6), 'x')
    tee2(fst(get('x')), tmp1 => tee(inc(get(tmp1)), tmp1), 'x')
    recv(get('x'), ['a', 'b'])
    get('a') + get('b') * 2

tee2 ((value, next), target, as) =
    tmp = genid()
    recv(value, tmp)
    final = target(tmp)
    recv(next(get(tmp)), as)
    final



fn fst(arg) {
    recv(arg, ['a', 'b'])
    return [get('a'), (v) => {
        recv(recv(v, 'a'), []);
        return [get('a'), get('b')]
    }]
}
recv([1,10], 'x')
tee2(fst(get('x')), tmp1 => recv(5, tmp1))
get('x')

x := 5
tee2('x', tmp1 => recv(5, tmp1))
1


{
    recv([1,[10,1]], 'x')
    tee2(snd(get('x')), tmp1 => {
        // get(tmp1) is the return value of snd
        // put(tmp1) is how you send a new value back to the continuation
        return tee2(fst(get(tmp1)), tmp2 => {
            return tee(inc(get(tmp2)), tmp2)
        }, tmp1)
    }, 'x')

}

fn inc(arg) {
    recv(arg, 'c');
    retunr [recv(get('c') + 1, 'c'), get('c')];
}

fn fst(arg) {
    recv(arg, ['a', 'b'])
    return [get('a'), (v) => {
        recv(recv(v, 'a'), []);
        return [get('a'), get('b')]
    }]
}

fn snd(arg) {
    recv(arg, ['a', 'b'])
    return [get('b'), (v) => {
        recv(recv(v, 'b'), []);
        return [get('a'), get('b')]
    }]
}




fstsnd2 = \() ->
    case snd (1 :: Int, 2 :: Int) of (b, res2) ->
    case fst (3 :: Int, 4 :: Int) of (b0, res20) ->
    case fst (b, b0) of (b1, res21) ->
    case inc b1 of (b2, res22) ->
    case res21 res22 of (tres, tres0) ->
    case b2 of () -> (res2 tres, res20 tres0)












QUestions:

    inner () =
        let m = 2
        let x = \x -> x + (dup ~m)
        x m
    -> is it a fundamental limitation that you can't bring a lens into a function?

    unlens x in t <- I'm not sure what `t` is supposed to mean here.
    what are the semantics

    they are sloppy about not wrapping lens function bodies in ~()

    I think the `lens x <- y in z` needs to consume(x) at some point in z. They have `use := λa : A. lens x ← a in x` on page 17. Yeah, page 15's definition of lens specifies that z needs to consume x.


ok frustrating that they don't implement really any logic in lens-world.
Some NOT IMPLEMENTED things

~(case ...)

one ~x =
    ~(let () = x := x + 1
    x)

two ~x =
    let y = ~x
    y := 4

three ~x =
    ~4

a COMPILER BUG

swap2 :: (a,b)/(a,b) -> ~(a, a)
swap2 ~(x, y) = ~(x, x)
-- turns into --
swap2 = \(x, y) -> ((x, ()), \resv -> case resv of (tres, tres0) -> (tres0, y))

the first part of the return value (x, ()) is expected to have type (a, a)

callnul2 :: ~Int -> ~()
callnul2 ~inputv = ~(makenul ())
-- turns into --
callnul2 = \inputv -> case makenul () of (ab, ares) -> case ares () of () -> (ab, \resv -> case inputv resv of v -> v)

pretty sure you're not supposed to be calling `inputv` as a function

wow this is also bug

callnul :: ~Int -> ~(Int, ())
callnul ~inputv = ~(inputv, makenul ())
-- turns into --
callnul = \inputv -> case makenul () of
  (ab, ares) -> case ares () of
    () -> ((inputv, ab), \resv -> case resv of (tres, tres0) -> case () tres0 of () -> tres)

Can't be calling () a unit as a function



```

========

========

=========
--

Ok thinking about impl.

variable access `x` is the same as `x := ()`
which is why `x := x + 2` evaluates to `()`
because it's `x := (x := ()) + 2`

OK let's write some assembly/

```
inc :: ~Int -> ()
inc ~x = x := x + 1

fn inc(ctx) {
    return [swap('x', swap('x', null) + 1), swap('x', null)]
}

fn trade(ctx) {
    // a ~ literal can ONLY contain
    // - variable names
    // - function calls *that return lenses*
    // forbidden, at least by this impl:
    // - literal values
    // - functions that don't return lenses

    return [swap('x', inc)]

}

```

--

Let's talk brass tacks.

defined as linear
you might:

- have a lens arg
- have a lens result
  there are 4 combos of these

```
(a/b) -> c   :: a -> (c, b) ;; you produce the value going back immediately
(a/b) -> c/d :: a -> (c, d -> b) ;; you produce the value in a thunk
(a)   -> b/c :: a -> (b, c -> ())
(a)   -> b   :: a -> b
```

If you call a fn that takes a lense.

```
(a/b) -> c
```

you're expected to pass back that lense... right?

```
let x = ~y
```

if y is already a lens term ... if not, there's nothing for it.

rules: "Only the last parameter in a fn can use a flow pattern"
... hmm need to think about why that would be

So the CPS translation is one way to do it.
if I have full control (not liquid haskell constraints),
it seems like there would be a more direct way to do it.

--
THINGS that are called 'out of scope'

- let z = ~x
- ~2
- let (a, b) = ~x // which is a direct example from the paper

Something that confuses me is the 'promotion' of a linear term to a lens term.
You can do

```
add1 y =
    inc ~y
    y
```

I feel like for ergonimics, I would want primitives to be 'dup on use'.
OR maybe have some simple syntax sugar for `dup(~x)`. maybe +x

---

q: do we want to support 'enforced semicolons'?
like two modes, one where you don't need semicolons, but multiline things can't be hanging.
I guess it's like asi somewhat. but opt-in

OK so we're fine with parsing.
and we have some basic evaluation. very cool.

question on everyone's lips is:

- do I try to do a linear type checker?
- or do I go straight for the flow dealio
- right now my scope eval is a lil nuts

ok lets make our evaluator obey linearity

I find myself frustrated with the notation.

They say
We introduce the notation Γ1 ⊢ t : A ⊣ Γ2 for flow typing judgements to be interpreted as lenses of the form (Γ◦1 , Γ◦2) → (A, 1).

BUT then they use that form for the general case, where 't' might well contain lenses that perform updates on the context.

Ok looking at the liquid haskell compiled output ... it looks like:

"a function that takes a lens must return a pair"
and on the way back, we're looking at CPS of some sort.
IF the return type is a lens, the second item is a lambda.
IS that true?

if a function doesn't touch lenses, then it doesnt need the tuple.

this does mean we have a 'what color is your function' situation, right?
And it means that we can't abstract over the lensedness of things.
this seems like a fine restriction though.

ok BUT you can do lens shenanigans inside a function without anyone knowing. Which seems useful.
