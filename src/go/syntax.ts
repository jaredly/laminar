/** Syntax-only statement tree for Go. Storage decisions belong to lower.ts. */
export type Statement = string | { head: string; body: Statement[] };

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

export function printGo(file: GoFile): string {
    const printBody = (body: Statement[], depth: number): string[] => {
        const lines: string[] = [];
        for (const s of body) {
            if (typeof s === 'string') {
                lines.push('\t'.repeat(depth) + s);
            } else {
                const isElse = s.head.startsWith('else');
                if (isElse && lines.length > 0 && lines[lines.length - 1]!.trimEnd().endsWith('}')) {
                    lines[lines.length - 1] = `${lines[lines.length - 1]!} ${s.head} {`;
                } else {
                    lines.push('\t'.repeat(depth) + s.head + ' {');
                }
                lines.push(...printBody(s.body, depth + 1));
                lines.push('\t'.repeat(depth) + '}');
            }
        }
        return lines;
    };

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
            ...file.functions.map(
                (f) => `${f.signature} {\n${printBody(f.body, 1).join('\n')}\n}`,
            ),
        );
    }

    return sections.join('\n\n') + '\n';
}
