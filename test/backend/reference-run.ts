import { executeTypedProgram } from '../../src/eval-typed.ts';
import type { TypedProgram } from '../../src/typed-ir.ts';

/** Run the reference with the sample's stdin, capturing host output. */
export function referenceRun(program: TypedProgram, stdin = '') {
    const lines = stdin.split('\n');
    let output = '',
        next = 0;
    const result = executeTypedProgram(program, {
        stdout: (text) => (output += text),
        stdin: () => lines[next++] ?? '',
    });
    return { result, output };
}
