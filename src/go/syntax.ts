/** Syntax-only statement tree for Go. Storage decisions belong to lower.ts. */
import { Code, type Expr } from './code.ts';

// Nested lists are transparent sequencing points. Lowering can reserve a point
// and materialize a value there only when an IR consumer actually needs it.
export type LocalDeclaration = {
    kind: 'local';
    name: string;
    type: string;
    value?: Expr;
    pure?: boolean;
    inline?: boolean;
    load?: boolean;
    // The initializer equals this type's default value. It may be omitted only
    // when the declaration stays here; hoisted cells still need their reset.
    zeroInitial?: boolean;
};
export type LocalAssignment = { kind: 'set'; name: string; value: Expr };
export type Statement =
    | Expr
    | Statement[]
    | LocalDeclaration
    | LocalAssignment
    | { head: Expr; body: Statement[] };

export type GoFunction = {
    signature: string;
    body: Statement[];
};

export type GoFile = {
    packageName?: string;
    imports?: string[];
    declarations?: string[];
    functions?: GoFunction[];
};

export function identifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) {
        throw Error(`Invalid Go identifier: ${name}`);
    }
    return name;
}

export const printGoStatements = (body: Statement[], depth = 0): string[] => {
    const lines: string[] = [];
    for (const s of body) {
        if (Array.isArray(s)) {
            lines.push(...printGoStatements(s, depth));
        } else if (typeof s === 'string' || s instanceof Code) {
            lines.push('\t'.repeat(depth) + s);
        } else if ('kind' in s) {
            const text =
                s.kind === 'set'
                    ? `${s.name} = ${s.value}`
                    : s.value === undefined
                      ? `var ${s.name} ${s.type}`
                      : `${s.name} := ${s.value}`;
            lines.push('\t'.repeat(depth) + text);
        } else {
            const head = String(s.head);
            if (head.startsWith('case ') || head === 'default:') {
                lines.push('\t'.repeat(Math.max(0, depth - 1)) + head);
                lines.push(...printGoStatements(s.body, depth));
                continue;
            }
            const isElse = head.startsWith('else');
            if (isElse && lines.length > 0 && lines[lines.length - 1]!.trimEnd().endsWith('}')) {
                lines[lines.length - 1] = `${lines[lines.length - 1]!} ${head} {`;
            } else {
                lines.push('\t'.repeat(depth) + head + ' {');
            }
            lines.push(...printGoStatements(s.body, depth + 1));
            lines.push('\t'.repeat(depth) + '}');
        }
    }
    return lines;
};

export function printGo(file: GoFile): string {
    const printBody = printGoStatements;
    const sections: string[] = [`package ${file.packageName ?? 'main'}`];

    if (file.imports && file.imports.length > 0) {
        const unique = [...new Set(file.imports)].sort();
        if (unique.length === 1) {
            sections.push(`import "${unique[0]}"`);
        } else {
            sections.push(`import (\n${unique.map((imp) => `\t"${imp}"`).join('\n')}\n)`);
        }
    }

    if (file.declarations && file.declarations.length > 0) {
        sections.push(...file.declarations);
    }

    if (file.functions && file.functions.length > 0) {
        sections.push(
            ...file.functions.map((f) => `${f.signature} {\n${printBody(f.body, 1).join('\n')}\n}`),
        );
    }

    return sections.join('\n\n') + '\n';
}
