// Escape sequences accepted by the Laminar lexer, including literal interpolation openers.
export const sourceEscapes: readonly (readonly [string, string])[] = [
    ['\\', '\\\\'],
    ['"', '\\"'],
    ['${', '\\${'],
    ['\n', '\\n'],
    ['\t', '\\t'],
    ['\r', '\\r'],
    ['\b', '\\b'],
    ['\x1b', '\\e'],
];

export function displayValue(value: unknown, nested = false): string {
    if (value === null) return '()';
    if (Array.isArray(value)) return '(' + value.map((v) => displayValue(v, true)).join(', ') + ')';
    if (nested && typeof value === 'string') {
        const escaped = value.replace(
            /\\|"|\$\{|\n|\t|\r|\x08|\x1b/g,
            (part) => sourceEscapes.find(([key]) => key === part)![1],
        );
        return '"' + escaped + '"';
    }
    return String(value);
}
