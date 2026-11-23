/**
 * Borrowed matches that return a lens (docs/direct-field-lenses.md, "Lens-valued cases").
 * The matched box stays in the list and the returned lens points into it, so a search
 * returns a pointer, with no payload copy, rebuild or restoration. Execution cases run
 * natively (ASan/UBSan at -O0, and -O2) when LAMINAR_EXEC is set.
 */
import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget, wasm32Emscripten } from '../../src/backend/target.ts';
import { backendAvailable, expectRun } from '../backend/backends.ts';

const compile = (source: string) =>
    compileSource(source, { target: wasm32Emscripten('test') }).code;
const execute = process.env.LAMINAR_EXEC && backendAvailable('native') ? it : it.skip;
const body = (code: string, name: string) => {
    const start = code.search(new RegExp(`^\\S+ ${name}\\(void \\*environment[^;]*\\{$`, 'm'));
    return code.slice(start, code.indexOf('\n}\n', start));
};

const findLens = `fn find_(needle, ~lst) ~{
    match ~lst {
        [one, ...rest] -> {
            match (dup(~one) == dup(~needle)) {
                true -> {
                    one
                }
                false -> {
                    find_(needle, ~rest)
                }
            }
        }
        [] -> {
            lens res <- 0
            res
        }
    }
}
`;
const update = (list: string, needle: number, to: number) =>
    `${findLens}{
    let x = ${list}
    find_(${needle}, ~x) := ${to}
    x
}`;

it('returns a pointer into the matched box, with no restoration', () => {
    const code = compile(update('[1, 2, 3]', 2, 20));
    const find = body(code, 'find_');
    expect(find).toMatch(/\.read=&\(\*v\d+\)\.item0/);
    // The tail is passed by address and the callee's lens is returned as is.
    expect(find).toMatch(/\.read=&\(\*v\d+\)\.item1/);
    expect(find).toMatch(/= find_\(NULL, needle, v\d+\);/);
    // Only the empty-list arm needs a callback; the cons arm allocates nothing.
    const cons = find.slice(find.indexOf('case List_Number_cons'), find.indexOf('case List_Number_nil'));
    expect(cons).not.toMatch(/allocate_context|release_context|restore|Backing/);
});

execute('updates the found element in place', async () => {
    await expectRun('native', update('[1, 2, 3]', 2, 20), { expected: [1, 20, 3] });
    await expectRun('native', update('[1, 2, 3]', 3, 30), { expected: [1, 2, 30] });
});
execute('writes through the empty-list lens when nothing is found', async () => {
    await expectRun('native', update('[1, 2, 3]', 9, 20), { expected: [1, 2, 3] });
});

const goBody = (code: string, name: string) => {
    const start = code.indexOf(`func ${name}(`);
    return code.slice(start, code.indexOf('\n}\n', start));
};
it('returns a pointer into the matched box in Go too', () => {
    const { code } = compileSource(update('[1, 2, 3]', 2, 20), { target: goTarget('test') });
    const find = goBody(code, 'find_');
    expect(find).toMatch(/Lens_float64\{read: &\(\*v\d+\)\.item0\}/);
    expect(find).toMatch(/= find_\(needle, Lens_List_Number\{read: &\(\*v\d+\)\.item1\}\)/);
    const cons = find.slice(find.indexOf('case List_Number_cons'), find.indexOf('case List_Number_nil'));
    expect(cons).not.toMatch(/restore|new\(|Backing/);
});
const executeGo = process.env.LAMINAR_EXEC && backendAvailable('go') ? it : it.skip;
executeGo('updates the found element in place in Go', async () => {
    await expectRun('go', update('[1, 2, 3]', 2, 20), { expected: [1, 20, 3] });
    await expectRun('go', update('[1, 2, 3]', 9, 20), { expected: [1, 2, 3] });
});
