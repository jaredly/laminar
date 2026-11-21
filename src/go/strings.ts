import { BackendDiagnostic } from '../backend/target.ts';
import { utf8 } from '../c/strings.ts';
import type { GoFunction } from './syntax.ts';

/** A Go interpreted string literal for the UTF-8 bytes of source text. */
export function goBytes(text: string): string {
    let literal = '"';
    for (const b of utf8(text))
        literal +=
            b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c
                ? String.fromCharCode(b)
                : '\\x' + b.toString(16).padStart(2, '0');
    return literal + '"';
}

/** Go strings are immutable UTF-8 bytes under GC, so drop and `dup` need no code. */
export function goStringRuntime(): GoFunction[] {
    return [
        {
            // ECMAScript Number::toString over the shortest round-tripping digits.
            signature: 'func formatNumber(x float64) string',
            body: [
                { head: 'if math.IsNaN(x)', body: ['return "NaN"'] },
                { head: 'if x == 0', body: ['return "0"'] },
                'sign := ""',
                { head: 'if x < 0', body: ['sign = "-"', 'x = -x'] },
                { head: 'if math.IsInf(x, 1)', body: ['return sign + "Infinity"'] },
                "scientific := strconv.FormatFloat(x, 'e', -1, 64)",
                'mark := 0',
                { head: "for scientific[mark] != 'e'", body: ['mark++'] },
                'digits := ""',
                {
                    head: 'for _, c := range scientific[:mark]',
                    body: [{ head: "if c != '.'", body: ['digits += string(c)'] }],
                },
                'exponent, _ := strconv.Atoi(scientific[mark+1:])',
                'point, count := exponent+1, len(digits)',
                'zeros := func(n int) string {',
                '\tout := ""',
                '\tfor ; n > 0; n-- {',
                '\t\tout += "0"',
                '\t}',
                '\treturn out',
                '}',
                {
                    head: 'if count <= point && point <= 21',
                    body: ['return sign + digits + zeros(point-count)'],
                },
                {
                    head: 'if 0 < point && point <= 21',
                    body: ['return sign + digits[:point] + "." + digits[point:]'],
                },
                {
                    head: 'if -6 < point && point <= 0',
                    body: ['return sign + "0." + zeros(-point) + digits'],
                },
                'out := sign + digits[:1]',
                { head: 'if count > 1', body: ['out += "." + digits[1:]'] },
                { head: 'if point > 0', body: ['return out + "e+" + strconv.Itoa(point-1)'] },
                'return out + "e-" + strconv.Itoa(1-point)',
            ],
        },
        {
            // Test protocol: a JSON string. Bytes are valid UTF-8 and pass through unescaped.
            signature: 'func printString(s string)',
            body: [
                "out := []byte{'\"'}",
                {
                    head: 'for i := 0; i < len(s); i++',
                    body: [
                        'c := s[i]',
                        {
                            head: "if c == '\"' || c == '\\\\'",
                            body: ["out = append(out, '\\\\', c)"],
                        },
                        {
                            head: 'else if c < 32',
                            body: ['out = append(out, fmt.Sprintf("\\\\u%04x", c)...)'],
                        },
                        { head: 'else', body: ['out = append(out, c)'] },
                    ],
                },
                "out = append(out, '\"')",
                'fmt.Print(string(out))',
            ],
        },
    ];
}

/** Go expression converting one interpolated part, by its physical storage kind. */
export function goPart(kind: string, expression: string): string {
    switch (kind) {
        case 'string':
            return expression;
        case 'f64':
            return `formatNumber(${expression})`;
        case 'bool':
            return `strconv.FormatBool(${expression})`;
        default:
            throw new BackendDiagnostic(
                'unsupported-go',
                'String interpolation supports String, Number and Bool parts',
            );
    }
}
