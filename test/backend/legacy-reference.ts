import { readLines } from '../../parser-generator/lexer.ts';
import { grammar } from '../../src/laminar-parser.ts';
import type { Decl, FileItem } from '../../src/ast.ts';
import { Checker } from '../../src/check.ts';
import { evalExpr, dupAt, type Ctx, type Pointer } from '../../src/eval.ts';

/** Test adapter only: typed-IR execution itself has no dependency on the legacy evaluator. */
export function legacyReference(source: string): unknown {
    const builtins: Ctx['builtins'] = {
        '+': (_: Ctx, a: number, b: number) => a + b,
        '-': (_: Ctx, a: number, b: number) => a - b,
        '*': (_: Ctx, a: number, b: number) => a * b,
        '/': (_: Ctx, a: number, b: number) => a / b,
        '==': (_: Ctx, a: number, b: number) => a === b,
        '>=': (_: Ctx, a: number, b: number) => a >= b,
        '<=': (_: Ctx, a: number, b: number) => a <= b,
        round: (_: Ctx, n: number) => Math.round(n),
        dup: (ctx: Ctx, p: Pointer) => dupAt(ctx, p, 0),
        fst: (_: Ctx, p: Pointer) => [
            p.type === 'tuple' ? p.items[0] : { ...p, path: [...p.path, 0] },
            () => null,
        ],
        charList: (_: Ctx, s: string) => [...s],
        heapsize: () => 0,
    };
    const ctx: Ctx = {
        builtins,
        scopes: [{ bindings: {} }],
        stack: [{ values: [], id: 'root' }],
        heap: { lid: 0, data: {} },
    };
    const checker = new Checker();
    let declaration: Decl | undefined, result: unknown;
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw new Error('Invalid differential-test source');
        const item = parsed.value;
        if (item.type === 'decl') {
            declaration = item;
            continue;
        }
        if (item.type === 'type-alias' || item.type === 'union') {
            checker.addType(item);
            continue;
        }
        const checked = checker.check(item, declaration);
        result = evalExpr(ctx, checker.lower(checked));
        if (item.type === 'fn' && item.name) {
            builtins[item.name] = result;
            checker.publish(checked);
        }
        declaration = undefined;
    }
    const normalize = (v: unknown): unknown =>
        typeof v === 'symbol' ? null : Array.isArray(v) ? v.map(normalize) : v;
    return normalize(result);
}
