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
 * With `tasks`, closures are also spawned. Tasks run in no fixed order, so those programs print
 * nothing. Instead each cleanup sends what its lens held to a collector task, and the result is
 * the sum: a lost or stale write changes it, and a cleanup that never runs leaves the program
 * waiting. A program without `tasks` is the same for a seed whether or not this option exists.
 *
 * Not generated: `match`, vectors, tuples and linear types.
 */
export function ownedLensProgram(seed: number, { tasks = false } = {}): string {
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
    // Half the programs focus a string: heap data is where an ownership mistake shows. Only
    // numbers go over channels.
    const text = !tasks && random(2) === 1;
    const initial = () => (text ? `"c${made++}"` : `${made++ * 100}`);
    // With tasks: where cleanups report, and how many of them will run.
    const closed = tasks ? 'closed, ' : '';
    let cleanups = 0;
    /** A new lens. `runs` is false in a branch that the program does not take. */
    const connect = (runs: boolean) => {
        if (runs) cleanups++;
        return `~connection(${closed}${initial()})`;
    };
    const bump = (x: string) => (text ? `${x} := "\${dup(~${x})}+"` : `${x} := dup(~${x}) + 1`);
    const body = (statements: string[]) => `{\n${[...statements, '()'].join('\n')}\n}`;

    /** Statements over the lenses in `live`, which loses whatever moves. */
    const block = (live: Set<string>, depth: number, count: number, runs = true): string[] => {
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
                out.push(`let ${x} = ${connect(runs)}`);
                live.add(x);
            } else if (choice === 1) out.push(`peek(~${pick()})`);
            else if (choice === 2) out.push(bump(pick()));
            else if (choice === 3) out.push(`end(~${taken()})`);
            else if (choice === 4 && nests) {
                const helper = `helper${names++}`;
                const inner = block(new Set(['c']), depth + 1, 1 + random(4), runs);
                helpers.push(`fn ${helper}(${closed}mut ~c) ${body(inner)}`);
                out.push(`${helper}(${closed}~${taken()})`);
            } else if (choice === 5 && nests) {
                const captured = new Set<string>();
                for (let k = 0; k <= random(2) && live.size; k++) captured.add(taken());
                // Each captured lens is mentioned first, so the closure does take it.
                const uses = [...captured].map((x) => `peek(~${x})`);
                const inner = block(new Set(captured), depth + 1, 1 + random(4), runs);
                const task = `task${names++}`;
                out.push(`let mut ${task} = fn () ${body([...uses, ...inner])}`);
                const how = random(tasks ? 6 : 3);
                if (how >= 3) out.push(`spawn(${task})`);
                else if (how === 0) out.push(`${task}()`);
                else if (how === 1) out.push(`run(${task})`);
                else pending.push(`${task}()`);
            } else if ((choice === 6 || choice === 7) && nests) {
                const a = new Set(live),
                    b = new Set(live);
                // With tasks the branch taken must be known first, to count its cleanups.
                const chosen = tasks ? random(2) === 1 : undefined;
                const yes = block(a, depth + 1, random(4), runs && chosen !== false),
                    no = block(b, depth + 1, random(4), runs && chosen !== true);
                const flag = (chosen ?? random(2) === 1) ? 'true' : 'false';
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
            } else if (choice === 10) out.push(`end(${connect(runs)})`);
        }
        return [...out, ...pending, ...(tasks ? [] : [`print("-${depth}")`])];
    };

    const main = block(new Set(), 0, 4 + random(7));
    const functions = tasks
        ? `fn connection(closed, mut n) ~{
    lens fd <- n
    chanSend(closed, dup(~fd))
}
fn collect(closed, report, left, sum) {
    if left == 0 then chanSend(report, sum) else collect(closed, report, left - 1, sum + chanRecv(closed))
}
fn peek(~conn) { () }
fn end(mut ~c) { () }`
        : `fn connection(mut n) ~{
    lens fd <- n
    print("close \${dup(~fd)}")
}
fn peek(~conn) { print("peek \${dup(~conn)}") }
fn end(mut ~c) { print("end \${dup(~c)}") }`;
    const program = tasks
        ? [
              'let closed = chanNew()',
              'let report = chanNew()',
              `spawn(fn () {collect(closed, report, ${cleanups}, 0)})`,
              `let finish = fn () ${body(main)}`,
              'finish()',
              'chanRecv(report)',
          ]
        : [...main, '()'];
    return `// laminar: dual
${functions}
fn drain(n, mut ~c) { if n == 0 then end(~c) else { peek(~c)
    drain(n - 1, ~c) } }
fn wrap(mut ~c) ~c
fn run(mut task) { ${tasks ? '' : 'print("run")\n    '}task() }
${helpers.join('\n')}
{
${program.join('\n')}
}`;
}
