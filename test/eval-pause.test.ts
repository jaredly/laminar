import { expect, it } from 'bun:test';
import { checkSource } from '../src/frontend.ts';
import { executeTypedProgram, startTypedProgram } from '../src/eval-typed.ts';

const check = (source: string) => checkSource(`// laminar: dual\n${source}`);

it('pauses at each input request and resumes with the answer', () => {
    let output = '';
    const execution = startTypedProgram(
        check(`{
            let name = getInput("name? ")
            print(name)
            waitKey(150)
        }`),
        { stdout: (text) => (output += text) },
    );
    expect(execution.next()).toEqual({ done: false, value: { op: 'input' } });
    expect(output).toBe('name? ');
    expect(execution.next('ada')).toEqual({
        done: false,
        value: { op: 'key', milliseconds: 150 },
    });
    expect(output).toBe('name? ada\n');
    expect(execution.next('w')).toEqual({ done: true, value: 'w' });
});

it('pauses inside nested calls', () => {
    const execution = startTypedProgram(
        check(`fn ask(prompt: string) { getInput(prompt) }
        fn both() { (ask("a"), ask("b")) }
        both()`),
        { stdout: () => {} },
    );
    execution.next();
    execution.next('1');
    expect(execution.next('2')).toEqual({ done: true, value: ['1', '2'] });
});

it('reports a missing input service when run without pausing', () => {
    const program = check('getInput("? ")');
    expect(() => executeTypedProgram(program, { stdout: () => {} })).toThrow(
        'The host does not provide `stdin`',
    );
    expect(() => executeTypedProgram(check('waitKey(1)'))).toThrow(
        'The host does not provide `key`',
    );
});
