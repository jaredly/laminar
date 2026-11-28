import React from "react";
import rsce from "react-simple-code-editor";

import { useProgram } from "./useProgram.ts";

const Editor = rsce.default;
export function App() {
    const [code, setCode] = React.useState(`{ 2 + 3 }`);
    const [line, setLine] = React.useState("");
    const { output, result, status, start, stop, sendLine, sendKey } = useProgram();
    const screen = React.useRef<HTMLPreElement>(null);

    // Keys go to the output, so that typing in the editor never reaches the program.
    React.useEffect(() => {
        if (status === "key") screen.current?.focus();
    }, [status]);

    return (
        <div>
            <h1>Hellooo</h1>
            <Editor
                value={code}
                onValueChange={(code) => setCode(code)}
                // highlight={code => highlight(code, languages.js)}
                highlight={(code) => code}
                padding={10}
                style={{
                    fontFamily: '"Fira code", "Fira Mono", monospace',
                    fontSize: 12,
                }}
            />
            <button onClick={() => start(code)}>Run</button>
            <button onClick={stop} disabled={status === "idle"}>
                Stop
            </button>
            {status === "key" && <span> Press keys with the output focused.</span>}
            <pre
                ref={screen}
                tabIndex={0}
                aria-label="Program output"
                onKeyDown={(event) => {
                    if (status === "idle" || event.metaKey || event.ctrlKey || event.altKey) return;
                    const key = event.key === "Enter" ? "\n" : event.key;
                    // `waitKey` reads one byte, so only ASCII keys count.
                    if (key.length !== 1 || key.charCodeAt(0) > 127) return;
                    event.preventDefault();
                    sendKey(key);
                }}
            >
                {output}
            </pre>
            {status === "input" && (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        sendLine(line);
                        setLine("");
                    }}
                >
                    <input
                        autoFocus
                        aria-label="Program input"
                        value={line}
                        onChange={(event) => setLine(event.target.value)}
                    />
                    <button type="submit">Send</button>
                </form>
            )}
            {result && <pre>{result}</pre>}
        </div>
    );
}
