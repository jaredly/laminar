#!/usr/bin/env bun
/**
 * Laminar compiler command.
 *
 *   laminar check <file>
 *   laminar emit  <file> [--target native|wasm32|go] [-o <path>]
 *                        [--export <name,...> --header <path>] [--concrete]
 *                        [--specialize-lenses <name,...|*>]
 *   laminar run   <file> [--target native|wasm32|go|reference] [--optimize] [--sanitize]
 *
 * `emit` writes C (native, wasm32) or Go source without invoking a compiler. With
 * `--export`, it writes a C library exporting those definitions, and its header;
 * `--concrete` prints the verified concrete IR instead of target source.
 * `run` builds with the target's toolchain and executes; `--target reference` runs
 * the typed-IR evaluator instead. Program output and input pass through; the
 * entry's result is printed last, as a JSON line.
 */
import { readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
    CompileError,
    buildCompiled,
    checkSource,
    compileLibrary,
    compileSource,
} from '../src/compiler.ts';
import { detectTarget, targetNames, type TargetName } from '../src/backend/host.ts';
import { BackendDiagnostic } from '../src/backend/target.ts';
import { modes, type Mode } from '../src/mode.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { printConcreteProgram } from '../src/print-concrete.ts';

const usage = `usage: laminar check <file>
       laminar emit <file> [--target native|wasm32|go] [-o <path>] [--export <name,...> --header <path>] [--concrete]
       laminar run <file> [--target native|wasm32|go|reference] [--optimize] [--sanitize]
       emit/run: [--specialize-lenses <definition,...|*>] (default: off)
       all: [--mode pure|dual] (default: pure, or the file's \`// laminar: <mode>\` pragma)`;

function parseArgs(argv: string[]) {
    const [command, file, ...rest] = argv;
    const flags = {
        target: 'native',
        output: undefined as string | undefined,
        header: undefined as string | undefined,
        exports: [] as string[],
        concrete: false,
        optimize: false,
        sanitize: false,
        specializeLenses: [] as string[],
        mode: undefined as Mode | undefined,
    };
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i]!;
        if (arg === '--target') flags.target = rest[++i] ?? '';
        else if (arg === '-o') flags.output = rest[++i];
        else if (arg === '--header') flags.header = rest[++i];
        else if (arg === '--concrete') flags.concrete = true;
        else if (arg === '--export')
            flags.exports.push(...(rest[++i] ?? '').split(',').filter(Boolean));
        else if (arg === '--mode') {
            const mode = rest[++i] ?? '';
            if (!(modes as readonly string[]).includes(mode))
                throw new CompileError(
                    'usage',
                    'usage',
                    `Unknown mode ${mode}; expected ${modes.join(', ')}`,
                );
            flags.mode = mode as Mode;
        } else if (arg === '--optimize') flags.optimize = true;
        else if (arg === '--sanitize') flags.sanitize = true;
        else if (arg === '--specialize-lenses') {
            const names = rest[++i];
            if (!names || names.startsWith('--') || names.split(',').some((n) => !n.trim()))
                throw new CompileError(
                    'usage',
                    'usage',
                    '--specialize-lenses requires definition names or *',
                );
            flags.specializeLenses.push(...names.split(',').map((n) => n.trim()));
        } else throw new CompileError('usage', 'usage', `Unknown option ${arg}\n${usage}`);
    }
    if (!command || !file || !['check', 'emit', 'run'].includes(command))
        throw new CompileError('usage', 'usage', usage);
    const targets: string[] = [...targetNames, ...(command === 'run' ? ['reference'] : [])];
    if (!targets.includes(flags.target))
        throw new CompileError(
            'usage',
            'usage',
            `Unknown target ${flags.target}; expected ${targets.join(', ')}`,
        );
    if (flags.exports.length && (command !== 'emit' || !flags.header))
        throw new CompileError('usage', 'usage', `--export needs emit and --header\n${usage}`);
    return { command, file, ...flags };
}

/** One stdin line without its newline, read synchronously; end of input ends the line. */
function readLine(): string {
    const bytes: number[] = [],
        byte = Buffer.alloc(1);
    while (readSync(0, byte, 0, 1, null) === 1 && byte[0] !== 10) bytes.push(byte[0]!);
    return Buffer.from(bytes).toString('utf8');
}

async function main(argv: string[]): Promise<number> {
    let file = '<source>';
    try {
        const args = parseArgs(argv);
        file = args.file;
        const source = readFileSync(file, 'utf8');
        if (args.command === 'check') {
            checkSource(source, { mode: args.mode });
            console.log(`${file}: ok`);
            return 0;
        }
        if (args.command === 'run' && args.target === 'reference') {
            const result = executeTypedProgram(checkSource(source, { mode: args.mode }), {
                stdout: (text) => process.stdout.write(text),
                stdin: readLine,
            });
            process.stdout.write(JSON.stringify(result) + '\n');
            return 0;
        }
        const target = detectTarget(args.target as TargetName);
        if (args.exports.length) {
            const library = compileLibrary(source, {
                target,
                exports: args.exports.map((name) => ({ name })),
                specializeLenses: args.specializeLenses,
                mode: args.mode,
            });
            writeFileSync(args.header!, library.header);
            if (args.output) writeFileSync(args.output, library.code);
            else process.stdout.write(library.code);
            return 0;
        }
        const compiled = compileSource(source, {
            target,
            specializeLenses: args.specializeLenses,
            mode: args.mode,
        });
        if (args.command === 'emit') {
            const text = args.concrete
                ? printConcreteProgram(compiled.concrete) + '\n'
                : compiled.code;
            if (args.output) writeFileSync(args.output, text);
            else process.stdout.write(text);
            return 0;
        }
        const built = buildCompiled(compiled, target, args);
        return await new Promise<number>((resolve) => {
            const child = spawn(built.command, built.args, {
                stdio: ['inherit', 'pipe', 'inherit'],
            });
            // The record separator only delimits results for test runners.
            child.stdout.on('data', (chunk: Buffer) =>
                process.stdout.write(chunk.filter((byte) => byte !== 0x1e)),
            );
            child.on('close', (code, signal) => {
                rmSync(built.directory, { recursive: true, force: true });
                resolve(code ?? (signal ? 1 : 0));
            });
        });
    } catch (error) {
        if (error instanceof CompileError && error.stage === 'usage') console.error(error.message);
        else if (error instanceof CompileError) console.error(error.format(file));
        else if (error instanceof BackendDiagnostic)
            console.error(`${file}: error [${error.code}]: ${error.message}`);
        else console.error(`${file}: ${(error as Error).message}`);
        return 1;
    }
}

process.exit(await main(process.argv.slice(2)));
