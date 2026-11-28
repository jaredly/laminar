// The platform-neutral front end: this module and its imports must run in a browser.
import { readLines } from '../parser-generator/lexer.ts';
import { grammar } from './laminar-parser.ts';
import type { Decl, FileItem } from './ast.ts';
import { Checker } from './check.ts';
import { lowerTypedProgram } from './lower-typed.ts';
import type { Elaboration } from './elaborated.ts';
import type { TypedProgram } from './typed-ir.ts';
import { BackendDiagnostic } from './backend/target.ts';
import { TypeDiagnostic } from './types.ts';
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
export function backendError(error: unknown, source: string, program?: TypedProgram): CompileError {
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
