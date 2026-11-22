import type { Declaration } from '../backend/reachable.ts';
/** Go spelling of the shared statement tree. Storage decisions belong to lower.ts. */
import { isExpr } from '../backend/imperative/code.ts';
import type { Syntax } from '../backend/imperative/locals.ts';
import type { Statement } from '../backend/imperative/statements.ts';

export type {
    LocalAssignment,
    LocalDeclaration,
    Statement,
} from '../backend/imperative/statements.ts';

const scalar = (v: number | boolean): string =>
    typeof v === 'boolean'
        ? String(v)
        : Number.isNaN(v)
          ? 'math.NaN()'
          : v === Infinity
            ? 'math.Inf(1)'
            : v === -Infinity
              ? 'math.Inf(-1)'
              : Object.is(v, -0)
                ? 'math.Copysign(0, -1)'
                : /[.e]/i.test(String(v))
                  ? String(v)
                  : `${v}.0`;
export const goSyntax: Syntax = {
    scalar,
    binary: (op, left, right) => `(${left} ${op} ${right})`,
};

export type GoFunction = {
    signature: string;
    body: Statement[];
};

export type GoFile = {
    packageName?: string;
    imports?: string[];
    declarations?: (string | Declaration)[];
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
    const indent = (n: number) => '\t'.repeat(n);
    for (const s of body) {
        if (Array.isArray(s)) {
            lines.push(...printGoStatements(s, depth));
        } else if (isExpr(s)) {
            lines.push(indent(depth) + s);
        } else if ('kind' in s && (s.kind === 'local' || s.kind === 'set')) {
            const text =
                s.kind === 'set'
                    ? `${s.name} = ${s.value}`
                    : s.value === undefined
                      ? `var ${s.name} ${s.type}`
                      : `${s.name} := ${s.value}`;
            lines.push(indent(depth) + text);
        } else if ('kind' in s && s.kind === 'if') {
            s.arms.forEach((arm, n) => {
                const head =
                    arm.condition === undefined
                        ? 'else'
                        : `${n ? 'else if' : 'if'} ${arm.condition}`;
                if (n) lines[lines.length - 1] += ` ${head} {`;
                else lines.push(`${indent(depth)}${head} {`);
                lines.push(...printGoStatements(arm.body, depth + 1));
                lines.push(indent(depth) + '}');
            });
        } else if ('kind' in s) {
            lines.push(`${indent(depth)}switch ${s.subject} {`);
            for (const c of s.cases) {
                lines.push(
                    indent(depth) + (c.label === undefined ? 'default:' : `case ${c.label}:`),
                );
                lines.push(...printGoStatements(c.body, depth + 1));
            }
            lines.push(indent(depth) + '}');
        } else {
            // Go-only runtime helpers still spell their own control flow.
            const head = String(s.head);
            if (head.startsWith('case ') || head === 'default:') {
                lines.push(indent(Math.max(0, depth - 1)) + head);
                lines.push(...printGoStatements(s.body, depth));
                continue;
            }
            const isElse = head.startsWith('else');
            if (isElse && lines.length > 0 && lines[lines.length - 1]!.trimEnd().endsWith('}')) {
                lines[lines.length - 1] = `${lines[lines.length - 1]!} ${head} {`;
            } else {
                lines.push(indent(depth) + head + ' {');
            }
            lines.push(...printGoStatements(s.body, depth + 1));
            lines.push(indent(depth) + '}');
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
        sections.push(...file.declarations.map(String));
    }

    if (file.functions && file.functions.length > 0) {
        sections.push(
            ...file.functions.map((f) => `${f.signature} {\n${printBody(f.body, 1).join('\n')}\n}`),
        );
    }

    return sections.join('\n\n') + '\n';
}
