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

it('returns a constructor lens as a tag and field pointers', () => {
    const code = compile(pick('    match ~pick(~x) {\n        Some(y) -> ()\n        None -> ()\n    }'));
    expect(code).toMatch(/struct Fields_Option_Number \{ uint32_t tag; double \*v0;/);
    // The callee returns the tag and the address of the field: no temporary, no callback.
    const callee = body(code, 'pick');
    expect(callee).toMatch(/return \(Fields_Option_Number\)\{\.tag=Option_Number_Some, \.v0=a\.read\};/);
    expect(callee).not.toMatch(/allocate_context|restore/);
    // The caller writes through the pointer unless the lens carries its own callback.
    const entry = body(code, 'entry');
    expect(entry).toMatch(/if \(\w+\.restore\)/);
    expect(entry).toMatch(/\*\w+\.v0 = \w+\.as\.v0;/);
});
it('compiles the recursive search to pointers into the list', () => {
    const code = compile(update('[1, 2, 3]', 2, 20));
    const find = body(code, 'find');
    expect(find).toMatch(/\.tag=Option_Number_Some, \.v0=&\(\*v\d+\)\.item0/);
    expect(find).toMatch(/= find\(NULL, needle, v\d+\);/);
    const cons = find.slice(find.indexOf('case List_Number_cons'), find.indexOf('case List_Number_nil'));
    expect(cons).not.toMatch(/allocate_context|restore|Backing/);
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

const choice = `type Choice(a, b) {
    Both(a, b)
    Neither
}
fn both(~(a, b)) ~{Both(a, b)}
{
    let p = (1, 2)
    match ~both(~p) {
        Both(x, y) -> {
            x := dup(~y) + 10
            y := 7
            ()
        }
        Neither -> ()
    }
    p
}`;
// A union with a boxed variant cannot be scattered; the temporary form does not support it either.
const tree = `type Tree(a) {
    Leaf
    Node(a, Tree(a))
}
fn node(~(v, t)) ~{Node(v, t)}
{
    let p = (1, Leaf)
    match ~node(~p) {
        Node(v, rest) -> {
            v := 5
            ()
        }
        Leaf -> ()
    }
    p
}`;
it('scatters a multi-field constructor into one pointer per field', () => {
    const code = compile(choice);
    expect(body(code, 'both')).toMatch(/\.tag=Choice_\w+_Both, \.v0_0=a_b\.item0\.read, \.v0_1=a_b\.item1\.read/);
});
it('reports a constructor lens over a boxed variant as unsupported', () => {
    expect(() => compile(tree)).toThrow('Constructor lens over a boxed variant');
});
execute('runs a multi-field scattered lens natively', async () => {
    await expectRun('native', choice, { expected: [12, 7] });
});
executeGo('runs a multi-field scattered lens in Go', async () => {
    await expectRun('go', choice, { expected: [12, 7] });
});
