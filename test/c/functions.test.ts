/**
 * C keeps only functions reachable from `main` (or a host export). Reachability
 * comes from the mentions lowering records, not from scanning printed text; these
 * tests scan printed text only to check the result. Execution cases run natively
 * (under ASan/UBSan at -O0, and at -O2) against the reference interpreter.
 */
import { expect, it } from 'bun:test';
import { checkSource, compileLibrary, compileSource } from '../../src/compiler.ts';
import { executeTypedProgram } from '../../src/eval-typed.ts';
import { wasm32Emscripten } from '../../src/backend/target.ts';
import { samples } from '../backend/execution-samples.ts';
import { expectRun } from '../backend/backends.ts';

const target = wasm32Emscripten('test');
const compile = (source: string) => compileSource(source, { target }).code;
const execute = process.env.LAMINAR_EXEC ? it : it.skip;

/** Functions defined in the output, i.e. `T name(...) {` at the start of a line. */
const defined = (code: string) =>
    new Set(
        [...code.matchAll(/^[A-Za-z_][^\n;{=]*?\b([A-Za-z_]\w*)\([^\n]*\) \{$/gm)].map(
            (m) => m[1]!,
        ),
    );
/** Runtime and generated-helper functions the output calls or points to. */
const mentioned = (code: string) =>
    new Set(
        [
            ...code.matchAll(
                /\b((?:string|builder|print|drop|dup|vector|char_list|round|host)_\w+|allocate_context|release_context)\b(?=\()/g,
            ),
        ].map((m) => m[1]!),
    );

const scalar = '1 + 2';
const boolean = 'true';
const literal = '"a"';
const interpolated = '{let n = 1\n "n=${n}"}';
const duplicated = '{let s = "x"\n (dup(~s), s)}';
const matched = '{let s = "x"\n match s {"x" -> 1; _ -> 2}}';

it('omits the string runtime from a program that never builds a string', () => {
    const code = compile(scalar);
    for (const name of ['string_new', 'builder_bytes', 'print_string', 'string_drop'])
        expect(defined(code)).not.toContain(name);
    expect(code).not.toContain('laminar_string');
});

it('keeps only the allocator and printers an entry needs', () => {
    const number = compile(scalar);
    expect(defined(number)).toContain('print_number');
    // Nothing allocates, so the allocator is gone; the counter main checks stays.
    expect(defined(number)).not.toContain('allocate_context');
    expect(defined(number)).not.toContain('release_context');
    expect(number).toContain('static size_t live_contexts = 0;');
    expect(number).toContain('if (live_contexts != 0)');
    // A Bool result prints inline, so print_number goes too.
    const bool = compile(boolean);
    expect(defined(bool)).not.toContain('print_number');
    expect(bool).not.toContain('print_number');
});

it('keeps exactly the string functions a program calls, and what they call', () => {
    const lit = defined(compile(literal));
    expect(lit).toContain('string_new');
    expect(lit).toContain('string_drop');
    expect(lit).toContain('print_string');
    // Their callees come with them.
    expect(lit).toContain('allocate_context');
    expect(lit).toContain('release_context');
    for (const name of ['string_dup', 'string_equals', 'builder_bytes', 'builder_number'])
        expect(lit).not.toContain(name);

    // Interpolating a Number needs the builder, its formatter and its finisher only.
    const text = defined(compile(interpolated));
    for (const name of ['builder_bytes', 'builder_number', 'builder_finish'])
        expect(text).toContain(name);
    for (const name of ['builder_string', 'builder_bool', 'string_dup'])
        expect(text).not.toContain(name);

    expect(defined(compile(duplicated))).toContain('string_dup');
    expect(defined(compile(matched))).toContain('string_equals');
});

it('prototypes only the functions it defines', () => {
    for (const source of [scalar, literal, interpolated, duplicated, matched]) {
        const code = compile(source);
        const prototypes = [
            ...code.matchAll(/^[A-Za-z_][^\n{=]*?\b([A-Za-z_]\w*)\([^\n]*\);$/gm),
        ].map((m) => m[1]!);
        const have = defined(code);
        for (const name of prototypes)
            if (/^(?:string|builder|print|allocate|release)_/.test(name) || name === 'entry')
                expect(have).toContain(name);
    }
});

it('never calls a function it dropped, across every execution sample', () => {
    for (const sample of samples) {
        let code: string;
        try {
            code = compile(sample.source);
        } catch {
            continue; // not every sample targets C
        }
        const have = defined(code);
        for (const name of mentioned(code))
            if (!have.has(name)) throw Error(`${sample.name}: ${name} is called but not defined`);
    }
}, 60000);

it('keeps a host export and what it calls, and nothing it does not', () => {
    const { code, header } = compileLibrary(
        'fn inc(x) {x + 1}\ngreet :: (String) => String\nfn greet(name) {"hi ${name}"}',
        { target, exports: [{ name: 'inc' }, { name: 'greet' }] },
    );
    const have = defined(code);
    for (const name of ['laminar_inc', 'laminar_greet', 'laminar_live_allocations'])
        expect(have).toContain(name);
    // `greet` appends a String to a builder and finishes it.
    for (const name of ['string_new', 'builder_string', 'builder_bytes', 'builder_finish'])
        expect(have).toContain(name);
    // Nothing prints, and nothing here interpolates a Number or a Bool.
    for (const name of [
        'print_number',
        'print_string',
        'builder_number',
        'builder_bool',
        'string_dup',
    ])
        expect(have).not.toContain(name);
    expect(code).not.toContain('int main(void)');
    expect(header).toContain('size_t laminar_live_allocations(void);');
    for (const name of mentioned(code)) expect(have).toContain(name);
});

for (const [name, source] of [
    ['a scalar entry that never allocates', scalar],
    ['a string literal', literal],
    ['a Number interpolation', interpolated],
    ['a string dup', duplicated],
    ['a string match', matched],
] as const)
    execute(
        `pruned C: ${name}`,
        () => expectRun('native', source, { expected: executeTypedProgram(checkSource(source)) }),
        60000,
    );
