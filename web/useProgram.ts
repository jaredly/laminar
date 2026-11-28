import React from "react";

import { checkSource, CompileError } from "../src/frontend.ts";
import { startTypedProgram, type Execution } from "../src/eval-typed.ts";

/** The page is frozen while the program computes, so this bounds each stretch between pauses. */
const maxStepsBetweenPauses = 5_000_000;
const clearScreen = "\x1b[H\x1b[2J";

export type Status = "idle" | "running" | "input" | "key";

type Run = {
    execution: Execution;
    screen: string;
    steps: number;
    /** Keys pressed while the program wasn't waiting for one, as a terminal buffers them. */
    keys: string[];
    /** Set while paused at `waitKey`. */
    onKey?: (key: string) => void;
    timer?: ReturnType<typeof setTimeout>;
};

/** Runs a program a pause at a time, showing its output and collecting its input. */
export function useProgram() {
    const [output, setOutput] = React.useState("");
    const [result, setResult] = React.useState("");
    const [status, setStatus] = React.useState<Status>("idle");
    const current = React.useRef<Run | null>(null);

    /** Dropping the paused execution is all it takes to stop it. */
    const drop = () => {
        clearTimeout(current.current?.timer);
        current.current = null;
    };
    React.useEffect(() => drop, []);

    const finish = (outcome: string) => {
        drop();
        setResult(outcome);
        setStatus("idle");
    };

    const write = (run: Run, text: string) => {
        run.screen += text;
        const cleared = run.screen.lastIndexOf(clearScreen);
        if (cleared >= 0) run.screen = run.screen.slice(cleared + clearScreen.length);
    };

    /** Run to the next pause or the end, answering the last request. */
    const advance = (run: Run, answer = "") => {
        run.steps = 0;
        let step;
        try {
            step = run.execution.next(answer);
        } catch (error) {
            setOutput(run.screen);
            finish((error as Error).message);
            return;
        }
        setOutput(run.screen);
        if (step.done) {
            finish(JSON.stringify(step.value));
            return;
        }
        const request = step.value;
        setStatus(request.op);
        if (request.op === "input") return;

        // Resume from a timer, even with a key already buffered, so the page can repaint.
        const resume = (key: string) => {
            clearTimeout(run.timer);
            run.onKey = undefined;
            run.timer = setTimeout(() => advance(run, key));
        };
        const buffered = run.keys.shift();
        if (buffered !== undefined) resume(buffered);
        else {
            run.onKey = resume;
            run.timer = setTimeout(() => {
                run.onKey = undefined;
                advance(run, "");
            }, Math.max(0, request.milliseconds));
        }
    };

    const start = (source: string) => {
        drop();
        setOutput("");
        setResult("");
        try {
            const run: Run = {
                screen: "",
                steps: 0,
                keys: [],
                execution: startTypedProgram(checkSource(source, { mode: "dual" }), {
                    stdout: (text) => write(run, text),
                    maxSteps: Infinity,
                    onStep: () => {
                        if (++run.steps > maxStepsBetweenPauses)
                            throw new Error("Stopped: too many steps without pausing for input");
                    },
                }),
            };
            current.current = run;
            setStatus("running");
            // Let the cleared output paint before the program takes over the thread.
            run.timer = setTimeout(() => advance(run));
        } catch (error) {
            finish(error instanceof CompileError ? error.format() : (error as Error).message);
        }
    };

    const stop = () => finish("Stopped");

    /** Answer a `getInput`, echoing the line as a terminal would. */
    const sendLine = (line: string) => {
        const run = current.current;
        if (!run || status !== "input") return;
        write(run, `${line}\n`);
        setStatus("running");
        advance(run, line);
    };

    const sendKey = (key: string) => {
        const run = current.current;
        if (!run) return;
        if (run.onKey) run.onKey(key);
        else run.keys.push(key);
    };

    return { output, result, status, start, stop, sendLine, sendKey };
}
