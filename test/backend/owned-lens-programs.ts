/**
 * Random programs over owned lenses. Every cleanup prints what its lens held, so the output
 * records when each lens ended and with what. There is no expected output: the reference
 * evaluator is the oracle for the compiled backends.
 *
 * A program is determined by its seed. The generator tracks which lenses are still alive, so
 * what it writes should always type check:
 *
 * - a lens is created, lent, written through, or handed back by `wrap`;
 * - it moves into a function (a fixed one, a generated one, or a recursive one);
 * - it moves into a closure, which is called at once, through `run`, or at the end of the block;
 * - it moves in one or both branches of an `if`.
 *
 * Not generated: `match`, vectors, tuples, linear types and `spawn`.
 */
export function ownedLensProgram(seed: number): string {
    let state = seed * 7919 + 1;
    const random = (n: number) => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return Math.floor((state / 2147483648) * n);
    };
    // The first values follow the seed too closely.
    for (let i = 0; i < 5; i++) random(2);

    let names = 0,
        made = 0;
    const helpers: string[] = [];
    // Half the programs focus a string: heap data is where an ownership mistake shows.
    const text = random(2) === 1;
    const initial = () => (text ? `"c${made++}"` : `${made++ * 100}`);
    const bump = (x: string) => (text ? `${x} := "\${dup(~${x})}+"` : `${x} := dup(~${x}) + 1`);
    const body = (statements: string[]) => `{\n${[...statements, '()'].join('\n')}\n}`;

    /** Statements over the lenses in `live`, which loses whatever moves. */
    const block = (live: Set<string>, depth: number, count: number): string[] => {
        const out: string[] = [];
        /** Closures to call before the block ends. */
        const pending: string[] = [];
        const pick = () => [...live][random(live.size)]!;
        const taken = () => {
            const x = pick();
            live.delete(x);
            return x;
        };
        for (let step = 0; step < count; step++) {
            const choice = random(11);
            const nests = depth < 3;
            if (choice === 0 || !live.size) {
                const x = `l${names++}`;
                out.push(`let ${x} = ~connection(${initial()})`);
                live.add(x);
            } else if (choice === 1) out.push(`peek(~${pick()})`);
            else if (choice === 2) out.push(bump(pick()));
            else if (choice === 3) out.push(`end(~${taken()})`);
            else if (choice === 4 && nests) {
                const helper = `helper${names++}`;
                const inner = block(new Set(['c']), depth + 1, 1 + random(4));
                helpers.push(`fn ${helper}(mut ~c) ${body(inner)}`);
                out.push(`${helper}(~${taken()})`);
            } else if (choice === 5 && nests) {
                const captured = new Set<string>();
                for (let k = 0; k <= random(2) && live.size; k++) captured.add(taken());
                // Each captured lens is mentioned first, so the closure does take it.
                const uses = [...captured].map((x) => `peek(~${x})`);
                const inner = block(new Set(captured), depth + 1, 1 + random(4));
                const task = `task${names++}`;
                out.push(`let mut ${task} = fn () ${body([...uses, ...inner])}`);
                const how = random(3);
                if (how === 0) out.push(`${task}()`);
                else if (how === 1) out.push(`run(${task})`);
                else pending.push(`${task}()`);
            } else if ((choice === 6 || choice === 7) && nests) {
                const a = new Set(live),
                    b = new Set(live);
                const yes = block(a, depth + 1, random(4)),
                    no = block(b, depth + 1, random(4));
                const flag = random(2) ? 'true' : 'false';
                out.push(`if ${flag} then ${body(yes)} else ${body(no)}`);
                // Moved by either branch is gone afterwards.
                for (const x of [...live]) if (!a.has(x) || !b.has(x)) live.delete(x);
            } else if (choice === 8) {
                const x = taken();
                out.push(`drain(${random(4)}, ~${x})`);
            } else if (choice === 9) {
                const x = taken(),
                    y = `l${names++}`;
                live.add(y);
                out.push(`let ${y} = ~wrap(~${x})`);
            } else if (choice === 10) out.push(`end(~connection(${initial()}))`);
        }
        return [...out, ...pending, `print("-${depth}")`];
    };

    const main = block(new Set(), 0, 4 + random(7));
    return `// laminar: dual
fn connection(mut n) ~{
    lens fd <- n
    print("close \${dup(~fd)}")
}
fn peek(~conn) { print("peek \${dup(~conn)}") }
fn end(mut ~c) { print("end \${dup(~c)}") }
fn drain(n, mut ~c) { if n == 0 then end(~c) else { peek(~c)
    drain(n - 1, ~c) } }
fn wrap(mut ~c) ~c
fn run(mut task) { print("run")
    task() }
${helpers.join('\n')}
${body(main)}`;
}
