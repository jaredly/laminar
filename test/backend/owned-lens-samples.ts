/** Every cleanup prints, so the output shows exactly when each lens ended. */
export const net = `// laminar: dual
fn connection(n) ~{
    lens fd <- n + 0
    print("close \${dup(~fd)}")
}
fn peek(~conn) { print("peek \${dup(~conn)}") }
fn handle(label, mut ~conn) {
    print("\${label} start")
    peek(~conn)
    print("\${label} done")
}
`;
const lines = (...all: string[]) => all.map((l) => `${l}\n`).join('');
const used = (label: string, n: number) => [`${label} start`, `peek ${n}`, `${label} done`];

const cases: [string, string, string][] = [
    [
        'a temporary ends when its new holder does',
        '{handle("a", ~connection(1))\n print("after")}',
        lines(...used('a', 1), 'close 1', 'after'),
    ],
    [
        'a binding that moves ends in the callee, not at the end of its scope',
        '{let conn = ~connection(2)\n peek(~conn)\n handle("a", ~conn)\n print("after")}',
        lines('peek 2', ...used('a', 2), 'close 2', 'after'),
    ],
    [
        'a lens that never moves ends with its scope',
        'fn keep() {let conn = ~connection(3)\n peek(~conn)}\n{keep()\n print("after")}',
        lines('peek 3', 'close 3', 'after'),
    ],
    [
        'cleanup sees what was written before and after the move',
        'fn bump(mut ~c) {c := dup(~c) + 100}\n{let conn = ~connection(1)\n conn := dup(~conn) + 10\n bump(~conn)\n print("after")}',
        lines('close 111', 'after'),
    ],
    [
        'a holder can pass the lens on',
        'fn forward(mut ~c) {print("in")\n handle("a", ~c)\n print("out")}\n{forward(~connection(4))\n print("after")}',
        lines('in', ...used('a', 4), 'close 4', 'out', 'after'),
    ],
    ...[true, false].map((flag): [string, string, string] => [
        `a lens that one branch moves ends on every path (${flag})`,
        `fn choose(flag) {let conn = ~connection(5)\n if flag then handle("a", ~conn) else print("kept")\n print("joined")}\n{choose(${flag})\n print("after")}`,
        flag
            ? lines(...used('a', 5), 'close 5', 'joined', 'after')
            : lines('kept', 'close 5', 'joined', 'after'),
    ]),
    ...[true, false].map((flag): [string, string, string] => [
        `an owned parameter that one branch passes on ends on every path (${flag})`,
        `fn choose(flag, mut ~c) {if flag then handle("a", ~c) else peek(~c)\n print("joined")}\n{choose(${flag}, ~connection(6))\n print("after")}`,
        flag
            ? lines(...used('a', 6), 'close 6', 'joined', 'after')
            : lines('peek 6', 'close 6', 'joined', 'after'),
    ]),
    [
        'a closure takes the lens and ends it when it runs',
        '{let conn = ~connection(7)\n let mut task = fn () {handle("a", ~conn)}\n print("before")\n task()\n print("after")}',
        lines('before', ...used('a', 7), 'close 7', 'after'),
    ],
    [
        'a closure that only borrows its capture still ends it',
        '{let conn = ~connection(8)\n let mut task = fn () {peek(~conn)\n peek(~conn)}\n print("before")\n task()\n print("after")}',
        lines('before', 'peek 8', 'peek 8', 'close 8', 'after'),
    ],
    [
        'a lens passes through two closures',
        '{let conn = ~connection(9)\n let mut outer = fn () {let mut inner = fn () {handle("a", ~conn)}\n print("middle")\n inner()}\n outer()\n print("after")}',
        lines('middle', ...used('a', 9), 'close 9', 'after'),
    ],
    [
        'a closure goes to a function that calls it',
        'fn run(mut task) {print("running")\n task()}\n{let conn = ~connection(10)\n run(fn () {handle("a", ~conn)})\n print("after")}',
        lines('running', ...used('a', 10), 'close 10', 'after'),
    ],
    [
        'a recursive holder ends it once',
        'fn drain(n, mut ~c) {if n == 0 then handle("a", ~c) else {peek(~c)\n drain(n - 1, ~c)}}\n{drain(2, ~connection(11))\n print("after")}',
        lines('peek 11', 'peek 11', ...used('a', 11), 'close 11', 'after'),
    ],
    [
        'an owned parameter can be lent out again as the result',
        'fn wrap(mut ~c) ~c\n{let conn = ~connection(12)\n let again = ~wrap(~conn)\n handle("a", ~again)\n print("after")}',
        lines(...used('a', 12), 'close 12', 'after'),
    ],
    [
        'a handler chosen at run time takes the lens',
        'fn one(mut ~c) {handle("one", ~c)}\nfn two(mut ~c) {handle("two", ~c)}\neach :: (mut Number, mut (mut ~Number) => ()) => ()\nfn each(mut n, mut handler) {let conn = ~connection(n)\n handler(~conn)\n print("returned")}\n{each(13, if true then two else one)\n print("after")}',
        lines(...used('two', 13), 'close 13', 'returned', 'after'),
    ],
    [
        'the lens may hold a linear value',
        'type linear Conn {\n    Conn(Number)\n}\nfn open(n) ~{lens c <- Conn(n)\n match c {mut Conn(fd) -> print("shut ${fd}")}}\nfn read(~c) {match ~c {Conn(fd) -> print("read ${dup(~fd)}")}}\nfn own(mut ~c) {read(~c)}\n{let c = ~open(14)\n let mut task = fn () {own(~c)}\n task()\n print("after")}',
        lines('read 14', 'shut 14', 'after'),
    ],
    [
        'a lens over a pair moves whole',
        'fn pair(n) ~{lens p <- (n, n + 1)\n match p {(a, b) -> print("close ${a} ${b}")}}\nfn both(mut ~p) {match ~p {(a, b) -> print("both ${dup(~a)} ${dup(~b)}")}}\n{let p = ~pair(1)\n both(~p)\n print("after")}',
        lines('both 1 2', 'close 1 2', 'after'),
    ],
    [
        'a closure keeps the lens after the function that made it returns',
        'fn make(mut n) {let c = ~connection(n)\n print("made")\n fn () {handle("a", ~c)}}\n{let mut a = make(1)\n let mut b = make(2)\n print("calling")\n b()\n a()}',
        lines('made', 'made', 'calling', ...used('a', 2), 'close 2', ...used('a', 1), 'close 1'),
    ],
    [
        'a closure keeps an owned parameter after its function returns',
        'fn make(mut ~c) {fn () {handle("a", ~c)}}\n{let mut task = make(~connection(1))\n print("calling")\n task()}',
        lines('calling', ...used('a', 1), 'close 1'),
    ],
    [
        'a lens over a vector is changed by its holder and freed by its producer',
        'fn items(mut n) ~{lens v <- [:dup(~n), 2:]\n print("end ${dup(~v[0])} ${dup(~v[1])}")}\nfn grow(mut ~v) {v[0] := 9\n v[1] := 10\n ()}\n{let v = ~items(1)\n let mut task = fn () {grow(~v)}\n task()\n print("after")}',
        lines('end 9 10', 'after'),
    ],
    [
        'a lens over a string is replaced by its holder',
        'fn text(mut s) ~{lens v <- s\n print("end ${v}")}\nfn mark(~s) {s := "${dup(~s)}?"\n ()}\nfn shout(mut ~s) {s := "${dup(~s)}!"\n ()}\n{let s = ~text("hi")\n mark(~s)\n shout(~s)\n print("after")}',
        lines('end hi?!', 'after'),
    ],
    [
        'branches end the lenses they keep, newest first',
        'fn go(x, y) {let a = ~connection(1)\n let b = ~connection(2)\n if x then {if y then handle("a", ~a) else handle("b", ~b)} else print("none")\n print("joined")}\n{go(true, true)\n go(true, false)\n go(false, false)}',
        lines(...used('a', 1), 'close 1', 'close 2', 'joined', ...used('b', 2), 'close 2', 'close 1', 'joined', 'none', 'close 2', 'close 1', 'joined'),
    ],
    [
        'each pass of a recursion has its own lens',
        'fn each(n) {if n == 0 then () else {handle("a", ~connection(n))\n each(n - 1)}}\neach(3)',
        lines(...used('a', 3), 'close 3', ...used('a', 2), 'close 2', ...used('a', 1), 'close 1'),
    ],
    [
        'a lens passes through producers built on one another',
        'fn again(n) ~connection(n + 1)\n{handle("a", ~again(1))\n print("after")}',
        lines(...used('a', 2), 'close 2', 'after'),
    ],
    // C once read the moved lens's freed storage while joining the branches.
    ...[true, false].map((flag): [string, string, string] => [
        `one branch writes through a lens that the other moves (${flag})`,
        `fn text(mut s) ~{lens v <- s\n print("end \${v}")}\nfn take(mut ~v) {()}\nfn choose(flag) {let l = ~text("a\${1}")\n if flag then {l := "\${dup(~l)}+"\n ()} else take(~l)\n print("joined")}\nchoose(${flag})`,
        flag ? lines('end a1+', 'joined') : lines('end a1', 'joined'),
    ]),
];

export const ownedLensSamples = cases.map(([name, body, output]) => ({
    name,
    source: net + body,
    output,
}));
