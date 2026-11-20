import { printStmt, tidy, usedNames, type Stmt } from './ast.ts';

/** Syntax-only tree for Zig. Storage decisions belong to lower.ts. */
export type Statement = string | Stmt | { head: string; body: Statement[] };

export type ZigFunction = {
    name: string;
    pub?: boolean;
    params: { name: string; type: string }[];
    result: string;
    body: Statement[];
};

export type ZigFile = {
    declarations?: { name: string; text: string }[];
    functions?: ZigFunction[];
};

// Keywords and primitive type names that cannot be bare identifiers.
const reserved = new Set(
    (
        'addrspace align allowzero and anyframe anytype asm break callconv catch comptime const ' +
        'continue defer else enum errdefer error export extern fn for if inline linksection ' +
        'noalias noinline nosuspend opaque or orelse packed pub resume return struct suspend ' +
        'switch test threadlocal try union unreachable var volatile while ' +
        'anyerror anyopaque bool f16 f32 f64 f80 f128 isize usize noreturn type void ' +
        'true false null undefined std printf putchar'
    ).split(' '),
);

export const isReserved = (name: string) => reserved.has(name) || /^[iu]\d+$/.test(name);

/** Valid Zig identifier for a generated name; reserved words become `@"name"`. */
export function identifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw Error(`Invalid Zig identifier: ${name}`);
    return isReserved(name) ? `@"${name}"` : name;
}

/** A readable, unique identifier derived from a source name. */
export function sourceIdentifier(raw: string, taken: Set<string>): string {
    let base = raw.replace(/[^A-Za-z_0-9]/g, '_').replace(/^(?=\d)/, '_') || '_v';
    if (isReserved(base)) base += '_';
    let name = base;
    for (let n = 1; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    return name;
}

const isStmt = (s: Statement): s is Stmt => typeof s === 'object' && 'k' in s;

export const printZigStatements = (body: Statement[], depth = 0): string[] => {
    const lines: string[] = [];
    const indent = '    '.repeat(depth);
    for (const s of body) {
        if (typeof s === 'string' || isStmt(s)) {
            lines.push(indent + (typeof s === 'string' ? s : printStmt(s)));
            continue;
        }
        const last = lines.at(-1);
        if (s.head.startsWith('else') && last?.trimEnd().endsWith('}'))
            lines[lines.length - 1] = `${last} ${s.head} {`;
        else lines.push(`${indent}${s.head} {`);
        lines.push(...printZigStatements(s.body, depth + 1), `${indent}}`);
    }
    return lines;
};

function printFunction(f: ZigFunction): string {
    const flat = f.body.every(isStmt);
    const body = flat ? tidy(f.body as Stmt[]) : f.body;
    const used = flat ? usedNames(body as Stmt[]) : undefined;
    const params = f.params
        .map((p) => `${used && !used.has(p.name) ? '_' : p.name}: ${p.type}`)
        .join(', ');
    return `${f.pub ? 'pub ' : ''}fn ${f.name}(${params}) ${f.result} {\n${printZigStatements(body, 1).join('\n')}\n}`;
}

/** Print a file, keeping only declarations reachable from `main`. */
export function printZig(file: ZigFile): string {
    const items = [
        ...(file.declarations ?? []),
        ...(file.functions ?? []).map((f) => ({ name: f.name, text: printFunction(f) })),
    ];
    const byName = new Map(items.map((i) => [i.name, i]));
    const kept = new Set<string>();
    const visit = (name: string) => {
        if (kept.has(name) || !byName.has(name)) return;
        kept.add(name);
        byName.get(name)!.text.match(/[A-Za-z_][A-Za-z_0-9]*/g)?.forEach(visit);
    };
    visit('main');
    const sections = [
        'const std = @import("std");',
        'extern fn printf(format: [*:0]const u8, ...) c_int;',
        'extern fn putchar(c: c_int) c_int;',
        ...items.filter((i) => kept.has(i.name)).map((i) => i.text),
    ];
    return sections.join('\n\n') + '\n';
}
