import React from "react";
import rsce from "react-simple-code-editor";

import { checkSource } from "../src/compiler.ts";
import { executeTypedProgram } from "../src/eval-typed.ts";

const Editor = rsce.default;
export function App() {
    const [code, setCode] = React.useState(`{ 2 + 3 }`);
    const [output, setOutput] = React.useState("");

    React.useEffect(() => {
        const logs = [];
        const result = executeTypedProgram(
            checkSource(code, { mode: "dual" }),
            {
                stdout: (text) => {
                    logs.push(text);
                },
                stdin: () => {
                    return "No Stdin";
                },
            },
        );
        setOutput(logs.join("\n") + "\n\n" + JSON.stringify(result));
    }, [code]);

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
            <pre>{output}</pre>
        </div>
    );
}
