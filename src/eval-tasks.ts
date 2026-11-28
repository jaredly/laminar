/**
 * The reference evaluator's tasks. Code that runs the program is a generator. It never calls
 * another such generator itself: it asks the scheduler to, which keeps each task's stack in an
 * array. So a task can wait in the middle of any call, resuming one costs the same at any depth,
 * and how deep a program recurses does not depend on JavaScript's stack.
 *
 * Scheduling is cooperative and deterministic: a task runs until it blocks, and tasks that
 * become ready run in that order. So the reference tries one interleaving of a program. It says
 * what that run does, not that every interleaving does the same, and it cannot find data races.
 * As in Go, the program ends when its main task returns, wherever the others are.
 *
 * The scheduler is a generator too. When a task asks for host input, the whole program pauses:
 * the scheduler yields the request, and resumes that same task with the answer, so waiting does
 * not change the interleaving.
 */

/** Input only the host has: one line, or one key within a time limit. */
export type HostRequest = { op: 'input' } | { op: 'key'; milliseconds: number };

/** What a task asks of the scheduler. */
export type Request =
    | { op: 'enter'; run: Run<unknown> }
    | { op: 'spawn'; task: Run<void> }
    | { op: 'send'; channel: Channel; value: unknown }
    | { op: 'receive'; channel: Channel }
    | { op: 'sleep'; milliseconds: number }
    | HostRequest;

/**
 * Code that may block. It is resumed with what its request produced: an entered call's result,
 * or the value a `receive` got.
 */
export type Run<T> = Generator<Request, T, unknown>;

/** Call `run` from another `Run`, giving its result. */
export function* enter<T>(run: Run<T>): Run<T> {
    return (yield { op: 'enter', run }) as T;
}

type Task = { stack: Run<unknown>[] };
/** Unbuffered: whichever side arrives first waits here for the other. */
export type Channel = {
    senders: { task: Task; value: unknown }[];
    receivers: Task[];
};
export const channel = (): Channel => ({ senders: [], receivers: [] });

/**
 * Run `main`, and the tasks it spawns, until `main` returns. Each host request is yielded, and
 * the value passed to `next` answers it. Time is simulated: `sleep` costs
 * nothing, and the clock only advances when no task is ready.
 */
export function* schedule<T>(
    main: Run<T>,
    deadlock: () => never,
): Generator<HostRequest, T, string> {
    const first: Task = { stack: [main] };
    const ready: { task: Task; received: unknown }[] = [{ task: first, received: undefined }];
    let sleeping: { task: Task; until: number }[] = [];
    let now = 0;
    const wake = (task: Task, received?: unknown) => ready.push({ task, received });
    for (;;) {
        const next = ready.shift();
        if (!next) {
            if (!sleeping.length) return deadlock();
            now = sleeping.reduce((soonest, s) => Math.min(soonest, s.until), Infinity);
            // Tasks due at the same moment wake in the order they went to sleep.
            for (const s of sleeping) if (s.until === now) wake(s.task);
            sleeping = sleeping.filter((s) => s.until !== now);
            continue;
        }
        const { task } = next;
        let resume = next.received;
        // Keep running this task until it has to wait or finishes.
        running: while (task.stack.length) {
            const step = task.stack[task.stack.length - 1]!.next(resume);
            resume = undefined;
            if (step.done) {
                task.stack.pop();
                if (!task.stack.length && task === first) return step.value as T;
                resume = step.value;
                continue;
            }
            const request = step.value;
            switch (request.op) {
                case 'enter':
                    task.stack.push(request.run);
                    break;
                case 'spawn':
                    wake({ stack: [request.task] });
                    break;
                case 'send': {
                    const receiver = request.channel.receivers.shift();
                    if (receiver) wake(receiver, request.value);
                    else {
                        request.channel.senders.push({ task, value: request.value });
                        break running;
                    }
                    break;
                }
                case 'receive': {
                    const sender = request.channel.senders.shift();
                    if (!sender) {
                        request.channel.receivers.push(task);
                        break running;
                    }
                    wake(sender.task);
                    resume = sender.value;
                    break;
                }
                case 'sleep':
                    sleeping.push({ task, until: now + Math.max(0, request.milliseconds || 0) });
                    break running;
                case 'input':
                case 'key':
                    resume = yield request;
                    break;
            }
        }
    }
}
