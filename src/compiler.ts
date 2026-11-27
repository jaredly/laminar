import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from './laminar-parser.ts';
import type { Decl, FileItem } from './ast.ts';
import { Checker } from './check.ts';
import { lowerTypedProgram } from './lower-typed.ts';
import type { Elaboration } from './elaborated.ts';
import type { TypedProgram } from './typed-ir.ts';
import type { ConcreteProgram } from './concrete-ir.ts';
import { compileConcreteProgram } from './lower-concrete.ts';
import { BackendDiagnostic, type TargetConfig } from './backend/target.ts';
import { TypeDiagnostic } from './types.ts';
import { emitC } from './c/emit.ts';
import { lowerC } from './c/lower.ts';
import { printC } from './c/syntax.ts';
import type { SemanticType } from './elaborated.ts';
import { emitGo } from './go/emit.ts';
import { declaredMode, modes, policyFor, type Mode, type Policy } from './mode.ts';

export type CompileStage = 'usage' | 'parse' | 'type' | 'backend' | 'build';
export type SourceLocation = { line: number; column: number };

/** Every compiler failure, with its stage, stable code and (when known) source position. */
export class CompileError extends Error {
    constructor(
        readonly stage: CompileStage,
        readonly code: string,
        message: string,
        readonly location?: SourceLocation,
    ) {
        super(message);
        this.name = 'CompileError';
    }
    /** `file:line:column: stage error [code]: message`, as compilers conventionally report. */
    format(file = '<source>'): string {
        const where = this.location
            ? `${file}:${this.location.line}:${this.location.column}`
            : file;
        return `${where}: ${this.stage} error [${this.code}]: ${this.message}`;
    }
}

/** 1-based line and column of a source offset. */
function locate(source: string, offset: number): SourceLocation {
    const before = source.slice(0, Math.max(0, offset)).split('\n');
    return { line: before.length, column: before.at(-1)!.length + 1 };
}

/**
 * The mode a program is compiled in: the `// laminar: <mode>` pragma, else the requested mode,
 * else `pure`. A pragma that disagrees with the requested mode is an error, because the two
 * languages are never mixed.
 */
export function resolvePolicy(source: string, requested?: Mode): Policy {
    const declared = declaredMode(source);
    if (declared && typeof declared === 'object')
        throw new CompileError(
            'usage',
            'unknown-mode',
            `Unknown mode "${declared.invalid}"; expected ${modes.join(' or ')}`,
        );
    if (declared && requested && declared !== requested)
        throw new CompileError(
            'usage',
            'mode-mismatch',
            `The file declares ${declared} mode but ${requested} mode was requested`,
        );
    return policyFor(declared ?? requested ?? 'pure');
}

/** Parse and type check a source file, producing verified typed IR. */
export function checkSource(source: string, options: { mode?: Mode } = {}): TypedProgram {
    const policy = resolvePolicy(source, options.mode);
    let nodes;
    try {
        nodes = readLines(source).nodes;
    } catch (error) {
        throw new CompileError('parse', 'lex', (error as Error).message);
    }
    const checker = new Checker(undefined, undefined, undefined, policy),
        elaborations: Elaboration[] = [];
    let declaration: Decl | undefined;
    for (const node of nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure')
            throw new CompileError(
                'parse',
                'syntax',
                'Unrecognized top-level item',
                locate(source, node.loc),
            );
        const item = parsed.value;
        if (item.type === 'decl') {
            declaration = item;
            continue;
        }
        try {
            if (item.type === 'type-alias' || item.type === 'union') {
                checker.addType(item);
                continue;
            }
            const checked = checker.check(item, declaration);
            elaborations.push(checked.elaboration);
            if (item.type === 'fn' && item.name) checker.publish(checked);
        } catch (error) {
            if (error instanceof TypeDiagnostic)
                throw new CompileError(
                    'type',
                    error.code,
                    error.message,
                    locate(source, error.loc),
                );
            throw new CompileError(
                'type',
                'internal',
                (error as Error).message,
                locate(source, node.loc),
            );
        }
        declaration = undefined;
    }
    try {
        return lowerTypedProgram(elaborations, checker.imports);
    } catch (error) {
        throw backendError(error, source);
    }
}

/** Map a backend diagnostic to its source position through the typed IR origin table. */
function backendError(error: unknown, source: string, program?: TypedProgram): CompileError {
    if (error instanceof CompileError) return error;
    if (!(error instanceof BackendDiagnostic))
        return new CompileError('backend', 'internal', (error as Error).message);
    const loc = error.node
        ? program?.units.flatMap((u) => u.origins).find((o) => o.id === error.node)?.loc
        : undefined;
    return new CompileError(
        'backend',
        error.code,
        error.message,
        loc === undefined ? undefined : locate(source, loc),
    );
}

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
            return !!type.linear;
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
        const args = e.typeArguments ?? [];
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
