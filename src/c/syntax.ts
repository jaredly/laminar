/** Syntax-only statement tree. Storage decisions belong to lower.ts. */
export type Statement = string | { head: string; body: Statement[] };
export type TranslationUnit = {
    declarations: string[];
    functions: { signature: string; body: Statement[] }[];
};
export function identifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw Error(`Invalid C identifier: ${name}`);
    return name;
}
export function printC(unit: TranslationUnit): string {
    const statements = (body: Statement[], depth: number): string[] =>
        body.flatMap((s) =>
            typeof s === 'string'
                ? ['    '.repeat(depth) + s]
                : [
                      '    '.repeat(depth) + s.head + ' {',
                      ...statements(s.body, depth + 1),
                      '    '.repeat(depth) + '}',
                  ],
        );
    return (
        [
            ...unit.declarations,
            ...unit.functions.flatMap((f) => [f.signature + ' {', ...statements(f.body, 1), '}']),
        ].join('\n') + '\n'
    );
}
