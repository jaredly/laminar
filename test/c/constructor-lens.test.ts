/**
 * Constructor lenses in C (docs/scattered-constructor-lenses.md). A constructor lens is
 * a thin lens over a temporary that holds the value built from its field lenses; the
 * restoration callback checks the tag and writes each payload field back. Execution
 * cases run natively (ASan/UBSan at -O0, and -O2) when LAMINAR_EXEC is set.
 */
import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { backendAvailable, expectRun } from '../backend/backends.ts';

const compile = (source: string) =>
    compileSource(source, { target: wasm32Emscripten('test') }).code;
const execute = process.env.LAMINAR_EXEC && backendAvailable('native') ? it : it.skip;
const body = (code: string, name: string) => {
    const start = code.search(new RegExp(`^\\S+ ${name}\\(void \\*environment[^;]*\\{$`, 'm'));
    return code.slice(start, code.indexOf('\n}\n', start));
};

const find = `fn find(needle, ~lst) ~{
    match ~lst {
        [x, ...rest] -> {
            match (dup(~x) == dup(~needle)) {
                true -> {
                    Some(x)
                }
                false -> {
                    find(needle, ~rest)
                }
            }
        }
        [] -> {
            None
        }
    }
}
`;
const update = (list: string, needle: number, to: number) =>
    `${find}{
    let x = ${list}
    match ~find(${needle}, ~x) {
        Some(y) -> {
            y := ${to}
            ()
        }
        None -> ()
    }
    x
}`;
const pick = (body: string) => `fn pick(~a) ~{Some(a)}
{
    let x = 1
${body}
    x
}`;

it('returns a constructor lens as a thin lens whose restoration checks the tag', () => {
    const code = compile(pick('    match ~pick(~x) {\n        Some(y) -> ()\n        None -> ()\n    }'));
    expect(code).toContain('struct Lens_Option_Number { Option_Number *read;');
    const callee = body(code, 'pick');
    // The temporary holds the constructed value; the field is only read here.
    expect(callee).toMatch(/\.tag=Option_Number_Some, \.as\.v0=\*a\.read/);
    expect(callee).toMatch(/v\d+\.restore = restore\d+;/);
    const restore = code.slice(code.search(/^Unit restore\d+\(void \*opaque, Option_Number/m));
    expect(restore).toMatch(/replacement\.tag != Option_Number_Some/);
    expect(restore).toMatch(/\*ctx->a\.read = replacement\.as\.v0;/);
});
it('compiles the recursive search with selected-arm restoration', () => {
    const code = compile(update('[1, 2, 3]', 2, 20));
    expect(body(code, 'find')).toMatch(/\.tag=Option_Number_Some/);
    expect(code).toMatch(/replacement\.tag != Option_Number_Some/);
});

execute('runs a constructor lens natively', async () => {
    await expectRun('native', pick('    match ~pick(~x) {\n        Some(y) -> {\n            y := 5\n            ()\n        }\n        None -> ()\n    }'), {
        expected: 5,
    });
});
execute('updates the found element in place', async () => {
    await expectRun('native', update('[1, 2, 3]', 2, 20), { expected: [1, 20, 3] });
});
execute('finds the first and the last element', async () => {
    await expectRun('native', update('[1, 2, 3]', 1, 10), { expected: [10, 2, 3] });
    await expectRun('native', update('[1, 2, 3]', 3, 30), { expected: [1, 2, 30] });
});
execute('leaves the list unchanged when nothing is found', async () => {
    await expectRun('native', update('[1, 2, 3]', 9, 20), { expected: [1, 2, 3] });
    await expectRun('native', update('[]', 1, 20), { expected: [] });
});

const executeGo = process.env.LAMINAR_EXEC && backendAvailable('go') ? it : it.skip;
executeGo('runs the recursive search in Go', async () => {
    await expectRun('go', update('[1, 2, 3]', 2, 20), { expected: [1, 20, 3] });
    await expectRun('go', update('[1, 2, 3]', 9, 20), { expected: [1, 2, 3] });
    await expectRun('go', update('[]', 1, 20), { expected: [] });
});
executeGo('runs a constructor lens in Go', async () => {
    await expectRun(
        'go',
        pick('    match ~pick(~x) {\n        Some(y) -> {\n            y := 5\n            ()\n        }\n        None -> ()\n    }'),
        { expected: 5 },
    );
});
