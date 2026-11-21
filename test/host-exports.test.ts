import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompileError, compileLibrary } from '../src/compiler.ts';
import { goTarget, wasm32Emscripten } from '../src/backend/target.ts';

const source = `fn inc(x) {x + 1}
greet :: (String) => String
fn greet(name) {"hi \${name}"}
fn range(n) {match dup(~n) {0 -> []; _ -> {let m = dup(~n)
 [m, ...range(n - 1)]}}}
fn sum(l) {match l {[] -> 0; [x, ...rest] -> x + sum(rest)}}
pick :: (Bool, String) => String
fn pick(b, s) {match b {true -> s; false -> "no"}}
fn len(l) {match l {[] -> 0; [x, ...rest] -> 1 + len(rest)}}
fn count(s) {len(charList(s))}
twice :: (String, Number) => (String, Number)
fn twice(s, n) {(s, n)}
first :: ((String, Number)) => String
fn first(p) {match p {(s, n) -> s}}
noop :: (()) => ()
fn noop(u) u
id :: (a) => a
fn id(x) x`;
const exports = ['inc', 'greet', 'range', 'sum', 'pick', 'count', 'twice', 'first', 'noop'].map(
    (name) => ({ name }),
);
const library = () => compileLibrary(source, { target: wasm32Emscripten('test'), exports });
const failure = (work: () => unknown) => {
    try {
        work();
    } catch (error) {
        if (error instanceof CompileError) return error;
        throw error;
    }
    throw Error('Expected a compile error');
};

it('declares a host ABI for scalars, buffers and handles', () => {
    const { header, code } = library();
    for (const line of [
        'double laminar_inc(double arg0);',
        'laminar_string *laminar_greet(const char *arg0, size_t arg0_length);',
        'typedef struct laminar_List_Number laminar_List_Number;',
        'void laminar_drop_List_Number(laminar_List_Number *handle);',
        'laminar_List_Number *laminar_range(double arg0);',
        'double laminar_sum(laminar_List_Number *arg0);',
        'laminar_string *laminar_pick(bool arg0, const char *arg1, size_t arg1_length);',
        'typedef struct laminar_Tuple_String_Number laminar_Tuple_String_Number;',
        'laminar_Tuple_String_Number *laminar_twice(const char *arg0, size_t arg0_length, double arg1);',
        'void laminar_noop(void);',
        'size_t laminar_live_allocations(void);',
    ])
        expect(header).toContain(line);
    // A library has no test entry point and never prints results.
    expect(code).not.toContain('int main(void)');
    expect(library().code).toBe(code);
});

it('diagnoses exports without a host contract', () => {
    const target = wasm32Emscripten('test');
    expect(
        failure(() => compileLibrary(source, { target, exports: [{ name: 'nope' }] })).code,
    ).toBe('unknown-export');
    expect(
        failure(() => compileLibrary(source, { target, exports: [{ name: 'id' }] })).message,
    ).toBe('Export id needs 1 type argument(s)');
    const number = { tag: 'con' as const, name: 'Number', args: [] };
    expect(() =>
        compileLibrary(source, {
            target,
            exports: [{ name: 'id', symbol: 'laminar_id_number', typeArguments: [number] }],
        }),
    ).not.toThrow();
    expect(
        failure(() =>
            compileLibrary('fn inc(~x) {x := x + 1}', { target, exports: [{ name: 'inc' }] }),
        ).message,
    ).toBe('Lens parameters need a host borrow contract');
    expect(failure(() => compileLibrary(source, { target: goTarget('test'), exports })).code).toBe(
        'unsupported-export',
    );
    expect(
        failure(() =>
            compileLibrary(source, {
                target,
                exports: [{ name: 'inc' }, { name: 'sum', symbol: 'laminar_inc' }],
            }),
        ).message,
    ).toBe('Duplicate host symbol laminar_inc');
});

const host = String.raw`#include <stdio.h>
#include <string.h>
#include "laminar.h"
static void show(laminar_string *s) {
    fwrite(laminar_string_data(s), 1, laminar_string_length(s), stdout);
    putchar('\n');
    laminar_string_free(s);
}
int main(void) {
    printf("%g\n", laminar_inc(41));
    /* Length-delimited input: the embedded NUL is data, and the host keeps its buffer. */
    char name[] = {'a', 0, 'b'};
    laminar_string *greeting = laminar_greet(name, sizeof name);
    printf("%zu %d\n", laminar_string_length(greeting), memcmp(laminar_string_data(greeting), "hi a\0b", 6));
    laminar_string_free(greeting);
    show(laminar_pick(true, "yes", 3));
    show(laminar_pick(false, "yes", 3));
    show(laminar_greet("", 0));
    printf("%g\n", laminar_count("h\xc3\xa9!", 4));
    /* A handle passed to an export transfers ownership; drop disposes of a kept one. */
    printf("%g\n", laminar_sum(laminar_range(4)));
    laminar_drop_List_Number(laminar_range(100));
    laminar_drop_Tuple_String_Number(laminar_twice("kept", 4, 1));
    show(laminar_first(laminar_twice("moved", 5, 2)));
    laminar_noop();
    printf("live %zu\n", laminar_live_allocations());
    return laminar_live_allocations() != 0;
}
`;

const buildHost = (directory: string) => {
    const { code, header } = library();
    writeFileSync(join(directory, 'laminar.c'), code);
    writeFileSync(join(directory, 'laminar.h'), header);
    writeFileSync(join(directory, 'host.c'), host);
};
const env = { ...process.env };
delete env.CPATH;
delete env.C_INCLUDE_PATH;

(process.env.LAMINAR_EXEC ? it : it.skip)(
    'runs a native C host against the library',
    () => {
        const directory = mkdtempSync(join(tmpdir(), 'laminar-host-'));
        buildHost(directory);
        const flags = [
            '-std=c11',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-pedantic',
            '-fsanitize=address,undefined',
            '-fno-sanitize-recover=all',
        ];
        const build = spawnSync('clang', [...flags, 'host.c', 'laminar.c', '-o', 'host', '-lm'], {
            cwd: directory,
            encoding: 'utf8',
            env,
        });
        expect(build.stderr).toBe('');
        const run = spawnSync(join(directory, 'host'), { encoding: 'utf8' });
        expect([run.status, run.stdout]).toEqual([
            0,
            '42\n6 0\nyes\nno\nhi \n3\n10\nmoved\nlive 0\n',
        ]);
        rmSync(directory, { recursive: true });
    },
    60000,
);

const emcc = process.env.LAMINAR_EXEC && spawnSync('emcc', ['--version']).status === 0;
(emcc ? it : it.skip)(
    'refreshes Wasm memory views after an export grows memory',
    () => {
        const directory = mkdtempSync(join(tmpdir(), 'laminar-wasm-host-'));
        buildHost(directory);
        const exported = [
            '_laminar_greet',
            '_laminar_string_data',
            '_laminar_string_length',
            '_laminar_string_free',
            '_laminar_live_allocations',
            '_malloc',
            '_free',
        ];
        const build = spawnSync(
            'emcc',
            [
                '-std=c11',
                '-Wall',
                '-Wextra',
                '-Werror',
                'laminar.c',
                '-o',
                'laminar.js',
                '-sENVIRONMENT=node',
                '-sMODULARIZE',
                '-sALLOW_MEMORY_GROWTH=1',
                `-sEXPORTED_FUNCTIONS=${exported.join(',')}`,
                '-sEXPORTED_RUNTIME_METHODS=HEAPU8',
            ],
            { cwd: directory, encoding: 'utf8', env: { ...env, SDKROOT: undefined } },
        );
        expect(build.status).toBe(0);
        writeFileSync(
            join(directory, 'host.cjs'),
            `const create = require('./laminar.js');
create().then((m) => {
    const size = 24 << 20;
    const input = m._malloc(size);
    m.HEAPU8.fill(120, input, input + size);
    const before = m.HEAPU8;
    // The export copies its input and builds a larger result, growing memory.
    const result = m._laminar_greet(input, size);
    m._free(input);
    const grew = before.byteLength === 0 || before.buffer !== m.HEAPU8.buffer;
    // Views taken before the call are stale; read through the current one.
    const data = m._laminar_string_data(result), length = m._laminar_string_length(result);
    const text = Buffer.from(m.HEAPU8.subarray(data, data + 8)).toString();
    m._laminar_string_free(result);
    console.log(JSON.stringify({ grew, length, text, live: m._laminar_live_allocations() }));
});
`,
        );
        const run = spawnSync('node', ['host.cjs'], { cwd: directory, encoding: 'utf8' });
        expect(JSON.parse(run.stdout)).toEqual({
            grew: true,
            length: (24 << 20) + 3,
            text: 'hi xxxxx',
            live: 0,
        });
        rmSync(directory, { recursive: true });
    },
    120000,
);

it('emits a library and header from the command line', () => {
    const directory = mkdtempSync(join(tmpdir(), 'laminar-lib-cli-'));
    const file = join(directory, 'lib.lm');
    writeFileSync(file, 'fn inc(x) {x + 1}\n');
    const cli = join(import.meta.dir, '../cli/laminar.ts');
    const header = join(directory, 'lib.h');
    const run = spawnSync(
        'bun',
        [
            cli,
            'emit',
            file,
            '--target',
            'native',
            '--export',
            'inc',
            '--header',
            header,
            '-o',
            join(directory, 'lib.c'),
        ],
        { encoding: 'utf8' },
    );
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(readFileSync(header, 'utf8')).toContain('double laminar_inc(double arg0);');
    const missing = spawnSync('bun', [cli, 'emit', file, '--export', 'inc'], { encoding: 'utf8' });
    expect(missing.stderr).toStartWith('--export needs emit and --header');
    rmSync(directory, { recursive: true });
});
