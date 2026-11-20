import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Phase 0 of docs/zig-codegen-plan.md: prove the emission idioms on the local Zig
// before any lowering exists. Skips only when Zig is missing.
const zigVersion = spawnSync('zig', ['version'], { encoding: 'utf8' });
const zigAvailable = zigVersion.status === 0;

function build(source: string, args: string[] = []) {
    const directory = mkdtempSync(join(tmpdir(), 'laminar-zig-'));
    writeFileSync(join(directory, 'main.zig'), source);
    const compile = spawnSync('zig', ['build-exe', '-lc', ...args, 'main.zig'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 120000,
    });
    const run =
        compile.status === 0
            ? spawnSync(join(directory, 'main'), [], { cwd: directory, encoding: 'utf8' })
            : undefined;
    return {
        directory,
        compile,
        run,
        cleanup: () => rmSync(directory, { recursive: true }),
    };
}

const fixture = (name: string) => join(import.meta.dir, 'fixtures', name);

describe.skipIf(!zigAvailable)(`Zig phase 0 (${zigVersion.stdout?.trim()})`, () => {
    for (const mode of ['Debug', 'ReleaseSafe']) {
        it(`strictness fixture compiles and runs (${mode})`, () => {
            const directory = mkdtempSync(join(tmpdir(), 'laminar-zig-'));
            copyFileSync(fixture('strictness.zig'), join(directory, 'main.zig'));
            const compile = spawnSync('zig', ['build-exe', '-lc', '-O', mode, 'main.zig'], {
                cwd: directory,
                encoding: 'utf8',
                timeout: 120000,
            });
            expect(compile.stderr).toBe('');
            expect(compile.status).toBe(0);
            const run = spawnSync(join(directory, 'main'), [], { encoding: 'utf8' });
            expect(run.stderr).toBe('');
            expect(run.status).toBe(0);
            expect(run.stdout.trim().split('\n').map((l) => JSON.parse(l))).toEqual([
                42,
                42,
                [2, 1],
                7,
                { number: '-0' },
                { number: 'NaN' },
            ]);
            rmSync(directory, { recursive: true });
        }, 120000);
    }

    // Why the uniform-discard rule uses `_ = &x` rather than `_ = x`.
    it('rejects a value discard of a used local', () => {
        const r = build(
            ['pub fn main() void {', '    var x: f64 = 1;', '    var y: f64 = x;', '    _ = &y;', '    _ = x;', '}'].join('\n'),
        );
        expect(r.compile.status).not.toBe(0);
        expect(r.compile.stderr).toContain('pointless discard');
        r.cleanup();
    }, 120000);

    // Why aggregate rebuilds that read their destination need a temporary.
    // If a Zig release changes this, the hazard section of the plan is stale.
    it('struct literals alias their destination', () => {
        const r = build(
            [
                'extern fn printf(format: [*:0]const u8, ...) c_int;',
                'const P = struct { a: f64, b: f64 };',
                'pub fn main() void {',
                '    var x: P = .{ .a = 1, .b = 2 };',
                '    _ = &x;',
                '    x = .{ .a = x.b, .b = x.a };',
                '    _ = printf("%g %g\\n", x.a, x.b);',
                '}',
            ].join('\n'),
        );
        expect(r.compile.status).toBe(0);
        expect(r.run!.stdout.trim()).toBe('2 2');
        r.cleanup();
    }, 120000);

    it('reports leaks through the live-context check', () => {
        const source = readFileSync(fixture('strictness.zig'), 'utf8').replace(
            '    release(Env0, env);',
            '    _ = env;',
        );
        const r = build(source);
        expect(r.compile.status).toBe(0);
        expect(r.run!.status).not.toBe(0);
        expect(r.run!.stderr).toContain('laminar: live contexts at exit');
        r.cleanup();
    }, 120000);
});
