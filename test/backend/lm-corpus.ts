import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as g from '../../parser-generator/grammar-lexer.ts';
import { readLines, stringify } from '../../parser-generator/lexer.ts';
import { grammar } from '../../src/laminar-parser.ts';
import type { FileItem, Linear } from '../../src/ast.ts';
import { CompileError, checkSource } from '../../src/compiler.ts';

/** Snapshot files the legacy fixture runner executes; their tests are the accepted corpus. */
export const corpusFiles = ['src/systematic.test.lm', 'test/flow.test.lm'];

export type CorpusCase = {
    /** `file:line` of the expected value, matching the fixture runner's titles. */
    name: string;
    /** Prelude definitions the checker accepts, then the test body. */
    source: string;
    /** The same prelude, then the expected expression. */
    expectedSource: string;
    /**
     * The expected value when it is literal data. Snapshot files write tuples with
     * list syntax (`[[1, 2], 3]`), which the checker rejects as a heterogeneous list;
     * both print as the same JSON array in the result protocol.
     */
    expected?: { value: unknown };
};

/** JSON protocol value of literal data, or undefined for any other expression. */
function literal(e: Linear): { value: unknown } | undefined {
    const all = (items: Linear[]) => {
        const values = items.map(literal);
        return values.every(Boolean) ? values.map((v) => v!.value) : undefined;
    };
    switch (e.type) {
        case 'number':
        case 'bool':
            return { value: e.value };
        case 'string':
            return e.interp.length ? undefined : { value: e.head };
        case 'tuple': {
            const items = all(e.items);
            return (
                items && { value: items.length ? (items.length === 1 ? items[0] : items) : null }
            );
        }
        case 'constructor': {
            const items = all(e.args);
            if (!items) return undefined;
            if (e.name === 'nil' && !items.length) return { value: [] };
            if (e.name === 'cons' && items.length === 2 && Array.isArray(items[1]))
                return { value: [items[0], ...items[1]] };
            return { value: { kind: 'variant', name: e.name, items } };
        }
        default:
            return undefined;
    }
}

const irLine = g.list(' ', g.list('', g.lit('ir'), g.lit('->')), g.rest('ir', 'any', false));
/** The checker's rejection code for a source, or undefined when it is accepted. */
export const rejection = (source: string): string | undefined => {
    try {
        checkSource(source);
        return undefined;
    } catch (error) {
        if (error instanceof CompileError) return error.code;
        throw error;
    }
};

/**
 * Extract test cases with the fixture runner's pairing rules: a body expression
 * followed by its expected value; `ir->` lines are interpreter snapshots and are
 * skipped. Definitions the checker rejects stay out of later preludes, so one
 * rejected definition does not hide every later case.
 */
export function corpusCases(file: string): {
    cases: CorpusCase[];
    /** Definitions the checker rejects, with the location of their first line. */
    rejectedDefinitions: { name: string; code: string }[];
} {
    const raw = readFileSync(join(import.meta.dir, '../..', file), 'utf8');
    const line = (loc: number) => raw.slice(0, loc).split('\n').length;
    const prelude: string[] = [];
    const cases: CorpusCase[] = [],
        rejectedDefinitions: { name: string; code: string }[] = [];
    let declaration: string | undefined;
    let body: string | undefined;
    for (const node of readLines(raw).nodes) {
        const ir = g.parse<g.Node>('ir', node, {
            rules: { ir: [{ pat: irLine, res: (v: { ir: g.Node }) => v.ir }] },
            config: {},
        });
        if (ir.type !== 'failure') continue;
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure')
            throw Error(`Unparseable corpus item at ${file}:${line(node.loc)}`);
        const item = parsed.value,
            text = stringify(node);
        if (body === undefined && ['let', 'apply', 'constructor', 'case'].includes(item.type)) {
            body = text;
            continue;
        }
        if (item.type === 'decl') {
            declaration = text;
            continue;
        }
        if (item.type === 'fn' || item.type === 'type-alias' || item.type === 'union') {
            const definition = declaration ? `${declaration}\n${text}` : text;
            declaration = undefined;
            const code = rejection([...prelude, definition].join('\n'));
            if (code) rejectedDefinitions.push({ name: `${file}:${line(node.loc)}`, code });
            else prelude.push(definition);
            continue;
        }
        if (body === undefined) throw Error(`Unpaired corpus item at ${file}:${line(node.loc)}`);
        const head = prelude.join('\n');
        cases.push({
            name: `${file}:${line(node.loc)}`,
            source: `${head}\n${body}`,
            expectedSource: `${head}\n${text}`,
            expected: literal(item as Linear),
        });
        body = undefined;
    }
    return { cases, rejectedDefinitions };
}
