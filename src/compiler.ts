import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompileError, backendError, checkSource } from './frontend.ts';
import type { TypedProgram } from './typed-ir.ts';
import type { ConcreteProgram } from './concrete-ir.ts';
import { compileConcreteProgram } from './lower-concrete.ts';
import { withEmptyNeeds } from './specialize.ts';
import type { TargetConfig } from './backend/target.ts';
import { emitC } from './c/emit.ts';
import { lowerC } from './c/lower.ts';
import { printC } from './c/syntax.ts';
import type { SemanticType } from './elaborated.ts';
import { emitGo } from './go/emit.ts';
import type { Mode } from './mode.ts';

export { CompileError, checkSource, resolvePolicy } from './frontend.ts';
export type { CompileStage, SourceLocation } from './frontend.ts';

export type CompileOptions = {
    target: TargetConfig;
    specializeLenses?: readonly string[];
    mode?: Mode;
};
export type Compiled = {
    program: TypedProgram;
    concrete: ConcreteProgram;
    language: 'c' | 'go';
    code: string;
};

/**
 * Check, specialize and emit. The entry is the last top-level expression; its result
 * is printed by the generated test adapter. Emission never invokes a compiler, and
 * symbol names depend only on the program and target.
 */
export function compileSource(source: string, options: CompileOptions): Compiled {
    const program = checkSource(source, { mode: options.mode });
    const entry = program.units.findLast((u) => !u.definition);
    if (!entry)
        throw new CompileError('backend', 'missing-entry', 'No top-level expression to run');
    try {
        const concrete = compileConcreteProgram(
            program,
            options.target,
            [{ unit: entry.id, arguments: [] }],
            { specializeLenses: options.specializeLenses },
        );
        const language = options.target.abi === 'go' ? 'go' : 'c';
        return {
            program,
            concrete,
            language,
            code: language === 'go' ? emitGo(concrete) : emitC(concrete),
        };
    } catch (error) {
        throw backendError(error, source, program);
    }
}

/**
 * Build emitted code with the target's toolchain, returning the command that runs
 * it. Build failures keep their directory, named in the error.
 */
export function buildCompiled(
    compiled: Pick<Compiled, 'code' | 'language'>,
    target: TargetConfig,
    options: { optimize?: boolean; sanitize?: boolean; directory?: string } = {},
): { command: string; args: string[]; directory: string } {
    const directory = options.directory ?? mkdtempSync(join(tmpdir(), 'laminar-build-'));
    const fail = (command: string, stderr: string): never => {
        throw new CompileError(
            'build',
            `${target.toolchain.compiler}-build`,
            `${command}: ${stderr}\nArtifacts: ${directory}`,
        );
    };
    if (compiled.language === 'go') {
        const input = join(directory, 'main.go'),
            output = join(directory, 'program');
        writeFileSync(input, compiled.code);
        const result = spawnSync('go', ['build', '-o', output, 'main.go'], {
            cwd: directory,
            encoding: 'utf8',
        });
        if (result.status !== 0) fail('go', result.stderr);
        return { command: output, args: [], directory };
    }
    const wasm = target.toolchain.compiler === 'emscripten';
    const input = join(directory, 'program.c'),
        output = join(directory, wasm ? 'program.js' : 'program');
    writeFileSync(input, compiled.code);
    const compiler = wasm ? 'emcc' : target.toolchain.compiler;
    const args = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic'];
    args.push(options.optimize ? '-O2' : '-O0', input, '-o', output, '-lm');
    if (options.sanitize && !wasm)
        args.push(
            '-fsanitize=address,undefined',
            '-fno-omit-frame-pointer',
            '-fno-sanitize-recover=all',
        );
    if (wasm) args.push('-sENVIRONMENT=node', '-sEXIT_RUNTIME=1');
    // Host SDK include injection breaks Emscripten and bypasses system-header treatment.
    const env = { ...process.env };
    delete env.CPATH;
    delete env.C_INCLUDE_PATH;
    delete env.CPLUS_INCLUDE_PATH;
    if (wasm) delete env.SDKROOT;
    const result = spawnSync(compiler, args, { encoding: 'utf8', env });
    if (result.status !== 0) fail(compiler, result.stderr);
    return wasm
        ? { command: 'node', args: [output], directory }
        : { command: output, args: [], directory };
}

/** A top-level definition exported to the host; generic ones need type arguments. */
export type HostExport = { name: string; symbol?: string; typeArguments?: SemanticType[] };
export type CompiledLibrary = {
    program: TypedProgram;
    concrete: ConcreteProgram;
    code: string;
    /** C declarations for the host: exports, handle types and disposal functions. */
    header: string;
};

/**
 * Compile definitions into a C library with a host ABI and header (see the C
 * backend's host export notes). The library has no `main` and prints nothing.
 */
function holdsLinearClosure(type: SemanticType): boolean {
    switch (type.tag) {
        case 'fn':
            return type.capture === 'linear';
        case 'con':
            return type.args.some(holdsLinearClosure);
        case 'tuple':
            return type.items.some(holdsLinearClosure);
        case 'record':
            return (
                type.fields.some((f) => holdsLinearClosure(f.type)) ||
                (!!type.rest && holdsLinearClosure(type.rest))
            );
        case 'variable':
        case 'needs':
            return false;
    }
}

export function compileLibrary(
    source: string,
    options: {
        target: TargetConfig;
        exports: readonly HostExport[];
        specializeLenses?: readonly string[];
        mode?: Mode;
    },
): CompiledLibrary {
    const program = checkSource(source, { mode: options.mode });
    if (options.target.abi !== 'c11')
        throw new CompileError('backend', 'unsupported-export', 'Host exports use the C ABI');
    if (!options.exports.length)
        throw new CompileError('backend', 'missing-export', 'No definitions to export');
    const roots = options.exports.map((e) => {
        const unit = program.units.find((u) => u.definition === `unit/definition/${e.name}`);
        if (!unit)
            throw new CompileError(
                'backend',
                'unknown-export',
                `No top-level definition ${e.name}`,
            );
        const type = unit.signature.type;
        if (type.tag !== 'fn')
            throw new CompileError('backend', 'unsupported-export', `${e.name} is not a function`);
        if (type.result.tag === 'plain' && holdsLinearClosure(type.result.value))
            throw new CompileError(
                'backend',
                'unsupported-export',
                `${e.name} returns a closure that must be called, which a host could drop instead`,
            );
        if (type.needs?.tag === 'needs')
            throw new CompileError(
                'backend',
                'unsupported-export',
                `${e.name} needs ${type.needs.entries.map((n) => n.name).join(', ')}, which a host cannot supply yet`,
            );
        const args = withEmptyNeeds(unit.signature, e.typeArguments ?? []);
        if (args.length !== unit.signature.quantified.length)
            throw new CompileError(
                'backend',
                'unsupported-export',
                `Export ${e.name} needs ${unit.signature.quantified.length} type argument(s)`,
            );
        return {
            unit: unit.id,
            arguments: args,
            parameters: type.args.map((a) =>
                a.tag === 'plain'
                    ? ({ kind: 'data' } as const)
                    : ({ kind: 'lens', topology: { kind: 'thin' } } as const),
            ),
        };
    });
    try {
        const concrete = compileConcreteProgram(program, options.target, roots, {
            specializeLenses: options.specializeLenses,
        });
        const unit = lowerC(concrete, {
            exports: options.exports.map((e, entry) => ({
                symbol: e.symbol ?? `laminar_${e.name}`,
                entry,
            })),
        });
        const header = [
            '#ifndef LAMINAR_H',
            '#define LAMINAR_H',
            ...unit.header!,
            '#endif',
            '',
        ].join('\n');
        return { program, concrete, code: printC(unit), header };
    } catch (error) {
        throw backendError(error, source, program);
    }
}
