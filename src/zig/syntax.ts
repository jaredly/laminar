/** Syntax-only statement tree for Zig. Storage decisions belong to lower.ts. */
export type Statement = string | { head: string; body: Statement[] };

export type ZigFunction = { signature: string; body: Statement[] };

export type ZigFile = {
    declarations?: string[];
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
        'true false null undefined'
    ).split(' '),
);

/** Valid Zig identifier for `name`; reserved words become `@"name"`. */
export function identifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw Error(`Invalid Zig identifier: ${name}`);
    if (reserved.has(name) || /^[iu]\d+$/.test(name)) return `@"${name}"`;
    return name;
}

export const printZigStatements = (body: Statement[], depth = 0): string[] => {
    const lines: string[] = [];
    const indent = '    '.repeat(depth);
    for (const s of body) {
        if (typeof s === 'string') {
            lines.push(indent + s);
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

export function printZig(file: ZigFile): string {
    const sections = [
        'const std = @import("std");',
        'extern fn printf(format: [*:0]const u8, ...) c_int;',
        'extern fn putchar(c: c_int) c_int;',
        ...(file.declarations ?? []),
        ...(file.functions ?? []).map(
            (f) => `${f.signature} {\n${printZigStatements(f.body, 1).join('\n')}\n}`,
        ),
    ];
    return sections.join('\n\n') + '\n';
}
