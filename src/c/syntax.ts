/** C spelling of the shared statement tree. Storage decisions belong to lower.ts. */
import { isExpr } from '../backend/imperative/code.ts';
import type { Syntax } from '../backend/imperative/locals.ts';
import type { Statement } from '../backend/imperative/statements.ts';
import { cScalars } from './names.ts';

export type { Statement } from '../backend/imperative/statements.ts';
export type TranslationUnit = {
    declarations: string[];
    functions: { name?: string; signature: string; body: Statement[] }[];
    /** Library mode: the host-facing header for the exported functions. */
    header?: string[];
};
export function identifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw Error(`Invalid C identifier: ${name}`);
    return name;
}

/** Literal spelling shared by lowering and the passes' constant folding. */
export const cScalar = (v: number | boolean): string =>
    typeof v === 'boolean'
        ? String(v)
        : Number.isNaN(v)
          ? 'NAN'
          : v === Infinity
            ? 'INFINITY'
            : v === -Infinity
              ? '(-INFINITY)'
              : Object.is(v, -0)
                ? '(-0.0)'
                : // Integral literals beyond the safe range exceed every C integer type.
                  Number.isSafeInteger(v) || /[.e]/.test(String(v))
                  ? String(v)
                  : `${v}.0`;
export const cSyntax: Syntax = {
    scalar: cScalar,
    binary: (op, left, right) => `${left} ${op} ${right}`,
    returns: (value) => `return ${value};`,
    statement: (value) => `${value};`,
};

/** The zero value of a declared C type, spelled for what the type is. */
const zeroOf = (type: string): string =>
    ['double', 'int', 'size_t'].includes(type)
        ? '0'
        : type === 'bool'
          ? 'false'
          : type.endsWith('*') || type === cScalars.string
            ? 'NULL'
            : '{0}';

export const printStatements = (body: Statement[], depth = 0): string[] => {
    const indent = (n: number) => '    '.repeat(n);
    const lines: string[] = [];
    for (const s of body) {
        if (Array.isArray(s)) lines.push(...printStatements(s, depth));
        else if (isExpr(s)) lines.push(indent(depth) + s);
        else if ('kind' in s && (s.kind === 'local' || s.kind === 'set'))
            lines.push(
                indent(depth) +
                    (s.kind === 'set'
                        ? `${s.name} = ${s.value};`
                        : `${s.type} ${s.name} = ${s.value ?? zeroOf(s.type)};`),
            );
        else if ('kind' in s && s.kind === 'if')
            s.arms.forEach((arm, n) => {
                const head =
                    arm.condition === undefined
                        ? 'else'
                        : `${n ? 'else if' : 'if'} (${arm.condition})`;
                lines.push(`${indent(depth)}${head} {`);
                lines.push(...printStatements(arm.body, depth + 1));
                lines.push(indent(depth) + '}');
            });
        else if ('kind' in s) {
            lines.push(`${indent(depth)}switch (${s.subject}) {`);
            for (const c of s.cases) {
                lines.push(
                    indent(depth + 1) + (c.label === undefined ? 'default:' : `case ${c.label}:`),
                    `${indent(depth + 1)}{`,
                );
                lines.push(...printStatements(c.body, depth + 2), `${indent(depth + 2)}break;`);
                lines.push(`${indent(depth + 1)}}`);
            }
            lines.push(indent(depth) + '}');
        } else {
            lines.push(`${indent(depth)}${s.head} {`);
            lines.push(...printStatements(s.body, depth + 1));
            lines.push(indent(depth) + '}');
        }
    }
    return lines;
};

export function printC(unit: TranslationUnit): string {
    return (
        [
            ...unit.declarations,
            ...unit.functions.flatMap((f) => [
                f.signature + ' {',
                ...printStatements(f.body, 1),
                '}',
            ]),
        ].join('\n') + '\n'
    );
}
