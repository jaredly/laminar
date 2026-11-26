import { sourceEscapes } from '../display.ts';
import { BackendDiagnostic } from '../backend/target.ts';
import type { Statement, TranslationUnit } from './syntax.ts';

/**
 * Laminar strings are owned, immutable UTF-8 byte sequences. A string value is a
 * pointer to one heap cell holding its length and bytes; the empty string is NULL,
 * so a zeroed slot is a valid string and the empty literal never allocates.
 */
export const stringType = 'laminar_string';

/** UTF-8 bytes of source text. Lone surrogates have no UTF-8 form and are rejected. */
export function utf8(text: string): Uint8Array {
    if (!text.isWellFormed())
        throw new BackendDiagnostic(
            'unsupported-string',
            'String text contains an unpaired surrogate and has no UTF-8 form',
        );
    return new TextEncoder().encode(text);
}

/** A C string literal for arbitrary bytes, with its exact byte length (NUL bytes included). */
export function cBytes(text: string): { literal: string; length: number } {
    const bytes = utf8(text);
    let literal = '"';
    for (const b of bytes)
        literal +=
            b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c && b !== 0x3f
                ? String.fromCharCode(b)
                : // Three octal digits never absorb a following digit.
                  '\\' + b.toString(8).padStart(3, '0');
    return { literal: literal + '"', length: bytes.length };
}

/** A runtime function and the package symbols its body calls. */
export type RuntimeFunction = TranslationUnit['functions'][number] & {
    name: string;
    uses: readonly string[];
};

/** Runtime support emitted only when a program reaches a string layout. */
export function stringRuntime(): {
    /** Type definitions the rest of the runtime is written against. */
    types: string[];
    functions: RuntimeFunction[];
} {
    const functions: RuntimeFunction[] = [
        {
            name: 'string_new',
            uses: ['allocate_context'],
            signature: `${stringType} *string_new(const char *bytes, size_t length)`,
            body: [
                { head: 'if (!length)', body: ['return NULL;'] },
                `${stringType} *s = allocate_context(sizeof *s + length);`,
                's->length = length;',
                'memcpy(s->bytes, bytes, length);',
                'return s;',
            ],
        },
        {
            name: 'string_drop',
            uses: ['release_context'],
            signature: `void string_drop(${stringType} *s)`,
            body: [{ head: 'if (s)', body: ['release_context(s);'] }],
        },
        {
            // A shared read of a string: one more reference to the same bytes.
            name: 'string_share',
            uses: ['retain_context'],
            signature: `${stringType} *string_share(${stringType} *s)`,
            body: [{ head: 'if (s)', body: ['retain_context(s);'] }, 'return s;'],
        },
        {
            name: 'string_dup',
            uses: ['string_new'],
            signature: `${stringType} *string_dup(${stringType} *s)`,
            body: ['return s ? string_new((const char *)s->bytes, s->length) : NULL;'],
        },
        {
            name: 'string_same',
            uses: [],
            signature: `_Bool string_same(${stringType} *a, ${stringType} *b)`,
            body: [
                'size_t n = a ? a->length : 0;',
                'return n == (b ? b->length : 0) && (!n || memcmp(a->bytes, b->bytes, n) == 0);',
            ],
        },
        {
            name: 'string_equals',
            uses: [],
            signature: `_Bool string_equals(${stringType} *s, const char *bytes, size_t length)`,
            body: [
                'size_t n = s ? s->length : 0;',
                'return n == length && (!length || memcmp(s->bytes, bytes, length) == 0);',
            ],
        },
        {
            name: 'builder_bytes',
            uses: [],
            signature: 'void builder_bytes(string_builder *b, const char *bytes, size_t length)',
            body: [
                { head: 'if (!length)', body: ['return;'] },
                {
                    head: 'if (b->length + length > b->capacity)',
                    body: [
                        'size_t capacity = b->capacity ? b->capacity : 16;',
                        { head: 'while (capacity < b->length + length)', body: ['capacity *= 2;'] },
                        'unsigned char *grown = realloc(b->bytes, capacity);',
                        { head: 'if (!grown)', body: ['abort();'] },
                        'b->bytes = grown;',
                        'b->capacity = capacity;',
                    ],
                },
                'memcpy(b->bytes + b->length, bytes, length);',
                'b->length += length;',
            ],
        },
        {
            name: 'builder_quoted',
            uses: ['builder_bytes', 'string_drop'],
            signature: `void builder_quoted(string_builder *b, ${stringType} *s)`,
            body: [
                `builder_bytes(b, ${cBytes('"').literal}, 1);`,
                {
                    head: 'for (size_t i = 0; s && i < s->length; i++)',
                    body: [
                        ...sourceEscapes.map(([key, escaped]) => ({
                            head:
                                key.length === 1
                                    ? `if (s->bytes[i] == ${key.charCodeAt(0)})`
                                    : `if (i + 1 < s->length && s->bytes[i] == 36 && s->bytes[i + 1] == 123)`,
                            body: [
                                `builder_bytes(b, ${cBytes(escaped).literal}, ${escaped.length});`,
                                ...(key.length > 1 ? ['i++;'] : []),
                                'continue;',
                            ],
                        })),
                        'builder_bytes(b, (const char *)&s->bytes[i], 1);',
                    ],
                },
                `builder_bytes(b, ${cBytes('"').literal}, 1);`,
                'string_drop(s);',
            ],
        },
        {
            // Interpolation consumes its string operand.
            name: 'builder_string',
            uses: ['builder_bytes', 'string_drop'],
            signature: `void builder_string(string_builder *b, ${stringType} *s)`,
            body: [
                {
                    head: 'if (s)',
                    body: [
                        'builder_bytes(b, (const char *)s->bytes, s->length);',
                        'string_drop(s);',
                    ],
                },
            ],
        },
        {
            name: 'builder_bool',
            uses: ['builder_bytes'],
            signature: 'void builder_bool(string_builder *b, _Bool value)',
            body: [
                { head: 'if (value)', body: ['builder_bytes(b, "true", 4);'] },
                { head: 'else', body: ['builder_bytes(b, "false", 5);'] },
            ],
        },
        {
            // ECMAScript Number::toString: the shortest round-tripping digits, laid out
            // in positional form for decimal exponents in (-7, 21) and exponent form otherwise.
            name: 'builder_number',
            uses: ['builder_bytes'],
            signature: 'void builder_number(string_builder *b, double x)',
            body: [
                { head: 'if (isnan(x))', body: ['builder_bytes(b, "NaN", 3);', 'return;'] },
                { head: 'if (x == 0)', body: ['builder_bytes(b, "0", 1);', 'return;'] },
                { head: 'if (x < 0)', body: ['builder_bytes(b, "-", 1);', 'x = -x;'] },
                { head: 'if (isinf(x))', body: ['builder_bytes(b, "Infinity", 8);', 'return;'] },
                'char scientific[40];',
                'int precision = 1;',
                {
                    head: 'for (; precision <= 17; precision++)',
                    body: [
                        'snprintf(scientific, sizeof scientific, "%.*e", precision - 1, x);',
                        { head: 'if (strtod(scientific, NULL) == x)', body: ['break;'] },
                    ],
                },
                'char digits[20];',
                'int count = 0;',
                'const char *p = scientific;',
                {
                    head: "for (; *p && *p != 'e'; p++)",
                    body: [{ head: "if (*p != '.')", body: ['digits[count++] = *p;'] }],
                },
                'int point = atoi(p + 1) + 1;',
                { head: "while (count > 1 && digits[count - 1] == '0')", body: ['count--;'] },
                {
                    head: 'if (count <= point && point <= 21)',
                    body: [
                        'builder_bytes(b, digits, (size_t)count);',
                        {
                            head: 'for (int i = count; i < point; i++)',
                            body: ['builder_bytes(b, "0", 1);'],
                        },
                    ],
                },
                {
                    head: 'else if (0 < point && point <= 21)',
                    body: [
                        'builder_bytes(b, digits, (size_t)point);',
                        'builder_bytes(b, ".", 1);',
                        'builder_bytes(b, digits + point, (size_t)(count - point));',
                    ],
                },
                {
                    head: 'else if (-6 < point && point <= 0)',
                    body: [
                        'builder_bytes(b, "0.", 2);',
                        {
                            head: 'for (int i = point; i < 0; i++)',
                            body: ['builder_bytes(b, "0", 1);'],
                        },
                        'builder_bytes(b, digits, (size_t)count);',
                    ],
                },
                {
                    head: 'else',
                    body: [
                        'builder_bytes(b, digits, 1);',
                        {
                            head: 'if (count > 1)',
                            body: [
                                'builder_bytes(b, ".", 1);',
                                'builder_bytes(b, digits + 1, (size_t)(count - 1));',
                            ],
                        },
                        'char exponent[16];',
                        'int written = snprintf(exponent, sizeof exponent, "e%c%d", point > 0 ? 43 : 45, abs(point - 1));',
                        'builder_bytes(b, exponent, (size_t)written);',
                    ],
                },
            ],
        },
        {
            name: 'builder_finish',
            uses: ['string_new'],
            signature: `${stringType} *builder_finish(string_builder *b)`,
            body: [
                `${stringType} *s = string_new((const char *)b->bytes, b->length);`,
                'free(b->bytes);',
                'return s;',
            ],
        },
        {
            // Test protocol: a JSON string. Bytes are valid UTF-8 and pass through unescaped.
            name: 'print_string',
            uses: [],
            signature: `void print_string(${stringType} *s)`,
            body: [
                "putchar('\"');",
                'size_t n = s ? s->length : 0;',
                {
                    head: 'for (size_t i = 0; i < n; i++)',
                    body: [
                        'unsigned char c = s->bytes[i];',
                        {
                            head: "if (c == '\"' || c == '\\\\')",
                            body: ["putchar('\\\\');", 'putchar(c);'],
                        },
                        { head: 'else if (c < 32)', body: ['printf("\\\\u%04x", c);'] },
                        { head: 'else', body: ['putchar(c);'] },
                    ],
                },
                "putchar('\"');",
            ],
        },
    ];
    return {
        types: [
            `typedef struct ${stringType} { size_t length; unsigned char bytes[]; } ${stringType};`,
            'typedef struct { unsigned char *bytes; size_t length; size_t capacity; } string_builder;',
        ],
        functions,
    };
}

/** The runtime function appending one interpolated part, by its physical storage kind. */
export function appendFunction(kind: string): string {
    switch (kind) {
        case 'string':
            return 'builder_string';
        case 'f64':
            return 'builder_number';
        case 'bool':
            return 'builder_bool';
        default:
            throw new BackendDiagnostic(
                'unsupported-c',
                'String interpolation supports String, Number and Bool parts',
            );
    }
}
