import { Code, children, isExpr, refs, type Expr, type Node } from './code.ts';
import {
    bodies,
    expressions,
    isLocal,
    isScope,
    mapScope,
    visit,
    type LocalAssignment,
    type LocalDeclaration,
    type Single,
    type Statement,
} from './statements.ts';

type Recipe = Node;

/** A target's spelling of the expressions this pass synthesizes. */
export type Syntax = {
    scalar: (value: number | boolean) => string;
    binary: (op: string, left: string, right: string) => string;
    /** A return statement; `return value` when absent. */
    returns?: (value: string) => string;
};
const numeric = (op: string, a: number, b: number): number | boolean => {
    switch (op) {
        case '+':
            return a + b;
        case '-':
            return a - b;
        case '*':
            return a * b;
        case '/':
            return a / b;
        case '==':
            return a === b;
        case '>=':
            return a >= b;
        case '<=':
            return a <= b;
        default:
            throw Error(`Unknown numeric operation ${op}`);
    }
};

type Scope = { parent?: Scope; boundary?: Point };
type Point = { array: Statement[]; index: number; scope: Scope; order: number };

/**
 * Assemble one generated function's expressions as trees, then simplify them and
 * place declarations. References travel with the tree; nothing is inferred by
 * parsing printed text. Names are unique within a generated function.
 */
export class Locals {
    constructor(readonly syntax: Syntax) {}

    private references = new Set<string>();
    private blocked = new Set<string>();
    private declarations = new Map<string, LocalDeclaration>();

    private code(node: Node, text: string): Expr {
        // A spelling identical to a local is that local, as a read. Empty code
        // stays falsy, so `joinCode(parts) || fallback` still works.
        if (this.references.has(text) || !text) return text;
        return new Code(node, text);
    }
    literal(text: string): Code {
        return new Code({ kind: 'text', text }, text);
    }
    reference(name: string): string {
        this.references.add(name);
        return name;
    }
    private spelling(node: Node): string {
        return node.kind === 'text' || node.kind === 'opaque'
            ? node.text
            : node.kind === 'ref'
              ? node.name
              : node.kind === 'scalar'
                ? this.syntax.scalar(node.value)
                : node.kind === 'binary'
                  ? this.syntax.binary(node.op, this.spelling(node.left), this.spelling(node.right))
                  : node.emit(node.parts.map((part) => this.spelling(part)));
    }
    private recipe(value: unknown): Recipe {
        if (value instanceof Code) return value.node;
        const text = String(value);
        // Any other plain string is literal text with no reads.
        return this.references.has(text)
            ? { kind: 'ref', name: text }
            : { kind: 'opaque', text, refs: new Set() };
    }
    private composed(emit: (parts: string[]) => string, parts: unknown[]): Expr {
        const text = emit(parts.map(String));
        return this.code({ kind: 'compose', parts: parts.map((p) => this.recipe(p)), emit }, text);
    }
    derive(text: string, ...parts: unknown[]): Expr {
        const reads = new Set(parts.flatMap((p) => refs(this.recipe(p))));
        return this.code({ kind: 'opaque', text, refs: reads }, text);
    }
    format(emit: (...parts: string[]) => string, ...parts: unknown[]): Expr {
        return this.composed((values) => emit(...values), parts);
    }
    template(strings: TemplateStringsArray, ...parts: unknown[]): Expr {
        return this.composed(
            (values) => strings.reduce((s, piece, i) => s + (i ? values[i - 1] : '') + piece, ''),
            parts,
        );
    }
    join(parts: readonly unknown[], separator = ','): Expr {
        return this.composed((values) => values.join(separator), [...parts]);
    }
    scalar(text: string, value: number | boolean): Expr {
        return this.code({ kind: 'scalar', value }, text);
    }
    binary(op: string, left: Expr, right: Expr): Expr {
        const text = this.syntax.binary(op, String(left), String(right));
        return this.code(
            { kind: 'binary', op, left: this.recipe(left), right: this.recipe(right) },
            text,
        );
    }
    aggregate(value: Expr, items: Expr[]): Expr {
        const r = this.recipe(value);
        if (r.kind !== 'compose') return value;
        return this.code({ ...r, aggregate: items.map((v) => this.recipe(v)) }, String(value));
    }
    returnValue(value: Expr): Expr {
        const spell = this.syntax.returns ?? ((v: string) => `return ${v}`);
        return this.code(
            {
                kind: 'compose',
                parts: [this.recipe(value)],
                emit: ([v]) => spell(v!),
                returns: true,
            },
            spell(String(value)),
        );
    }
    /** Every local some expression in `body` reads. Assignment targets are not reads. */
    reads(body: Statement[]): Set<string> {
        const result = new Set<string>();
        visit(body, (s) =>
            expressions(s).forEach((e) => refs(this.recipe(e)).forEach((n) => result.add(n))),
        );
        return result;
    }
    /** Rewrite local reads without interpreting literal text, members or type names.
     * Opaque fragments must be converted to structured formatters before rewriting. */
    rewriteReferences(value: Expr, replacements: ReadonlyMap<string, Expr>): Expr {
        const rewrite = (node: Node): Node => {
            if (node.kind === 'ref') {
                const value = replacements.get(node.name);
                return value === undefined ? node : this.recipe(value);
            }
            if (node.kind === 'opaque') {
                if ([...node.refs].some((name) => replacements.has(name)))
                    throw Error('Cannot rewrite references in opaque code');
                return node;
            }
            if (node.kind === 'binary')
                return { ...node, left: rewrite(node.left), right: rewrite(node.right) };
            if (node.kind === 'compose')
                return {
                    ...node,
                    parts: node.parts.map(rewrite),
                    ...(node.aggregate ? { aggregate: node.aggregate.map(rewrite) } : {}),
                };
            return node;
        };
        const node = rewrite(this.recipe(value));
        return this.code(node, this.spelling(node));
    }
    /** Field/pointee mutations not represented by a bare assignment node. */
    mutable(name: string): void {
        this.blocked.add(name);
    }
    /** Preserve the identity of a local cell whose address escapes an expression. */
    address(name: string): Expr {
        this.blocked.add(name);
        return this.template`&${this.reference(name)}`;
    }
    declaration(
        name: string,
        type: string,
        value?: Expr,
        options: { pure?: boolean; inline?: boolean; zeroInitial?: boolean; load?: boolean } = {},
    ): LocalDeclaration {
        this.reference(name);
        if (this.declarations.has(name)) throw Error(`Duplicate local ${name}`);
        const declaration: LocalDeclaration = { kind: 'local', name, type, value, ...options };
        this.declarations.set(name, declaration);
        return declaration;
    }
    assign(name: string, value: Expr): LocalAssignment {
        return { kind: 'set', name, value };
    }

    /** Substitute immutable copies and single-use pure compiler expressions.
     * Loads/calls keep their sequencing points; mutable and addressed cells keep identity. */
    private simplify(body: Statement[]): Statement[] {
        const blocked = new Set(this.blocked);
        const defs = new Map<string, LocalDeclaration>();
        const roots: Recipe[] = [];
        visit(body, (s) => {
            if (isLocal(s)) {
                if (s.kind === 'local') defs.set(s.name, s);
                else blocked.add(s.name);
            }
        });
        const contents = (s: Single): Recipe[] => expressions(s).map((e) => this.recipe(e));
        // Legacy opaque formatter fragments cannot be rewritten. Their referenced
        // variables remain materialized, rather than guessing at printed text.
        const protect = (r: Recipe) => {
            if (r.kind === 'opaque') r.refs.forEach((n) => blocked.add(n));
            children(r).forEach(protect);
        };
        visit(body, (s) => contents(s).forEach(protect));
        const substitutions = new Map<string, Recipe>();
        for (const d of defs.values()) {
            const r = this.recipe(d.value ?? '');
            if (
                !blocked.has(d.name) &&
                r.kind === 'ref' &&
                r.name !== d.name &&
                !blocked.has(r.name)
            )
                substitutions.set(d.name, r);
        }
        const expandAliases = (r: Recipe): Recipe =>
            r.kind === 'ref' && substitutions.has(r.name)
                ? expandAliases(substitutions.get(r.name)!)
                : r;
        const counts = new Map<string, number>();
        const count = (r: Recipe) => {
            r = expandAliases(r);
            if (r.kind === 'ref') counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
            else children(r).forEach(count);
        };
        visit(body, (s) => {
            if (isLocal(s) && s.kind === 'local' && substitutions.has(s.name)) return;
            contents(s).forEach(count);
        });
        const removable = (d: LocalDeclaration): boolean =>
            !!d.pure || this.recipe(d.value ?? '').kind === 'scalar';
        for (const d of defs.values()) {
            const r = this.recipe(d.value ?? '');
            if (
                !blocked.has(d.name) &&
                counts.get(d.name) === 1 &&
                ((d.inline && d.pure) || r.kind === 'scalar') &&
                refs(r).every((n) => !blocked.has(n))
            )
                substitutions.set(d.name, r);
        }
        const fact = (
            r: Recipe,
            seen = new Set<string>(),
        ): { value: number | boolean } | undefined => {
            if (r.kind === 'scalar') return r;
            if (r.kind === 'ref' && !blocked.has(r.name) && !seen.has(r.name)) {
                const d = defs.get(r.name);
                if (d?.value !== undefined)
                    return fact(this.recipe(d.value), new Set([...seen, r.name]));
            }
            if (r.kind === 'binary') {
                const a = fact(r.left, seen),
                    b = fact(r.right, seen);
                if (typeof a?.value === 'number' && typeof b?.value === 'number')
                    return { value: numeric(r.op, a.value, b.value) };
            }
            return undefined;
        };
        const normalize = (r: Recipe, seen = new Set<string>()): Recipe => {
            if (r.kind === 'ref' && substitutions.has(r.name) && !seen.has(r.name))
                return normalize(substitutions.get(r.name)!, new Set([...seen, r.name]));
            if (r.kind === 'binary') {
                const value = fact(r);
                if (value) return { kind: 'scalar', value: value.value };
                return { ...r, left: normalize(r.left, seen), right: normalize(r.right, seen) };
            }
            if (r.kind === 'compose')
                return {
                    ...r,
                    parts: r.parts.map((p) => normalize(p, seen)),
                    aggregate: r.aggregate?.map((p) => normalize(p, seen)),
                };
            return r;
        };
        const render = (s: unknown): Expr => {
            const r = normalize(this.recipe(s));
            return this.code(r, this.spelling(r));
        };
        const rewritten = (array: Statement[]): Statement[] =>
            array.flatMap((s): Statement[] => {
                if (Array.isArray(s)) return [rewritten(s)];
                if (isExpr(s)) return [render(s)];
                if (isLocal(s)) {
                    if (s.kind === 'local' && substitutions.has(s.name)) return [];
                    return [
                        { ...s, value: s.value === undefined ? undefined : render(s.value) } as
                            | LocalDeclaration
                            | LocalAssignment,
                    ];
                }
                return [mapScope(s, render, rewritten)];
            });
        // Fuse a definition into an immediately following bare assignment or
        // return. There is no intervening statement or lvalue evaluation to cross,
        // so even a call/load retains its order. Never do this for addressed cells.
        const firstPass = rewritten(body);
        const occurrences = new Map<string, number>();
        visit(firstPass, (s) =>
            contents(s)
                .flatMap(refs)
                .forEach((name) => occurrences.set(name, (occurrences.get(name) ?? 0) + 1)),
        );
        const adjacent = (array: Statement[]): Statement[] => {
            const flat: Statement[] = [];
            const flatten = (items: Statement[]) =>
                items.forEach((s) => {
                    if (Array.isArray(s)) flatten(s);
                    else flat.push(isScope(s) ? mapScope(s, (e) => e, adjacent) : s);
                });
            flatten(array);
            for (let n = 0; n + 1 < flat.length; n++) {
                const d = flat[n]!,
                    next = flat[n + 1]!;
                if (
                    !isLocal(d) ||
                    d.kind !== 'local' ||
                    d.value === undefined ||
                    blocked.has(d.name) ||
                    occurrences.get(d.name) !== 1
                )
                    continue;
                if (isLocal(next) && next.kind === 'set') {
                    const r = this.recipe(next.value);
                    if (r.kind === 'ref' && r.name === d.name) {
                        flat[n + 1] = { ...next, value: d.value };
                        flat.splice(n--, 1);
                    }
                } else if (isExpr(next)) {
                    const r = this.recipe(next);
                    if (
                        r.kind === 'compose' &&
                        r.returns &&
                        r.parts.length === 1 &&
                        r.parts[0]!.kind === 'ref' &&
                        r.parts[0]!.name === d.name
                    ) {
                        flat[n + 1] = this.returnValue(d.value);
                        flat.splice(n--, 1);
                    }
                }
            }
            // A suffix of single-use snapshot loads can flow into a return
            // consisting only of aggregates and stable values. Cross no other
            // statements, calls or control-flow boundaries, and keep load order.
            const tail = flat.at(-1);
            if (isExpr(tail)) {
                const original = this.recipe(tail);
                const safe = (r: Recipe): boolean =>
                    r.kind === 'ref' ||
                    r.kind === 'scalar' ||
                    r.kind === 'text' ||
                    (r.kind === 'binary' && safe(r.left) && safe(r.right)) ||
                    (r.kind === 'compose' &&
                        (r.returns
                            ? r.parts.every(safe)
                            : !!r.aggregate && r.aggregate.every(safe)));
                if (original.kind === 'compose' && original.returns && safe(original)) {
                    let start = flat.length - 1;
                    while (start > 0) {
                        const d = flat[start - 1]!;
                        if (
                            !isLocal(d) ||
                            d.kind !== 'local' ||
                            !d.load ||
                            d.value === undefined ||
                            blocked.has(d.name) ||
                            occurrences.get(d.name) !== 1
                        )
                            break;
                        start--;
                    }
                    const loads = flat.slice(start, -1) as LocalDeclaration[];
                    const order = refs(original).filter((n) => loads.some((d) => d.name === n));
                    if (loads.length && order.join(',') === loads.map((d) => d.name).join(',')) {
                        const replacements = new Map(
                            loads.map((d) => [d.name, this.recipe(d.value!)]),
                        );
                        const replace = (r: Recipe): Recipe =>
                            r.kind === 'ref'
                                ? (replacements.get(r.name) ?? r)
                                : r.kind === 'compose'
                                  ? { ...r, parts: r.parts.map(replace) }
                                  : r.kind === 'binary'
                                    ? { ...r, left: replace(r.left), right: replace(r.right) }
                                    : r;
                        const r = replace(original);
                        flat.splice(start, loads.length + 1, this.code(r, this.spelling(r)));
                    }
                }
            }
            return flat;
        };
        const result = adjacent(firstPass);
        const remaining = new Map<string, LocalDeclaration>();
        const live = new Set<string>();
        visit(result, (s) => {
            if (isLocal(s) && s.kind === 'local') remaining.set(s.name, s);
            else {
                roots.push(...contents(s));
                if (isLocal(s)) live.add(s.name);
            }
        });
        const retain = (name: string) => {
            if (live.has(name)) return;
            live.add(name);
            const d = remaining.get(name);
            if (d?.value !== undefined) refs(this.recipe(d.value)).forEach(retain);
        };
        // Traverse effects and retained cells as roots, then their initializers.
        const written = [...live];
        live.clear();
        written.forEach(retain);
        roots.flatMap(refs).forEach(retain);
        for (const d of remaining.values())
            if (!removable(d) || blocked.has(d.name)) retain(d.name);
        const prune = (array: Statement[]): Statement[] =>
            array.flatMap((s): Statement[] => {
                if (Array.isArray(s)) return [prune(s)];
                if (isExpr(s)) return [s];
                if (isLocal(s)) return s.kind === 'local' && !live.has(s.name) ? [] : [s];
                return [mapScope(s, (e) => e, prune)];
            });
        return prune(result);
    }

    /** Place each declaration in the common lexical scope of its definition and
     * uses. An initializer stays at its original sequencing point even when its
     * declaration must move outward for restoration or a branch join. */
    place(body: Statement[]): Statement[] {
        body = this.simplify(body);
        const definitions = new Map<string, Point>();
        const uses = new Map<string, Point[]>();
        let order = 0;
        const use = (name: string, point: Point) => {
            const points = uses.get(name) ?? [];
            points.push(point);
            uses.set(name, points);
        };
        const read = (value: unknown, point: Point) => {
            for (const name of new Set(refs(this.recipe(value)))) use(name, point);
        };
        const walk = (array: Statement[], scope: Scope) => {
            array.forEach((s, index) => {
                if (Array.isArray(s)) {
                    walk(s, scope);
                    return;
                }
                const point = { array, index, scope, order: order++ };
                if (isLocal(s)) {
                    if (s.kind === 'local') definitions.set(s.name, point);
                    else use(s.name, point);
                }
                // A whole if/else chain or switch is one statement: conditions and
                // labels read at it, and no declaration may split its arms.
                expressions(s).forEach((e) => read(e, point));
                bodies(s).forEach((b) => walk(b, { parent: scope, boundary: point }));
            });
        };
        walk(body, {});
        const ancestors = (s: Scope) => {
            const result = [s];
            while (s.parent) {
                s = s.parent;
                result.push(s);
            }
            return result;
        };
        const project = (p: Point, scope: Scope): Point => {
            while (p.scope !== scope) p = p.scope.boundary!;
            return p;
        };
        const moved = new Set<string>();
        const before = new Map<Statement[], Map<number, string[]>>();
        for (const [name, definition] of definitions) {
            const references = uses.get(name) ?? [];
            let scope = definition.scope;
            for (const p of references) {
                const parents = new Set(ancestors(p.scope));
                while (!parents.has(scope)) scope = scope.parent!;
            }
            const first = [definition, ...references]
                .map((p) => project(p, scope))
                .reduce((a, b) => (a.order < b.order ? a : b));
            if (scope === definition.scope && first === definition) continue;
            moved.add(name);
            const insertions = before.get(first.array) ?? new Map<number, string[]>();
            const names = insertions.get(first.index) ?? [];
            names.push(name);
            insertions.set(first.index, names);
            before.set(first.array, insertions);
        }
        const declaration = (name: string): LocalDeclaration => ({
            kind: 'local',
            name,
            type: this.declarations.get(name)!.type,
        });
        const rewrite = (array: Statement[]): Statement[] =>
            array.flatMap((s, index): Statement[] => {
                const result: Statement[] = (before.get(array)?.get(index) ?? []).map(declaration);
                if (Array.isArray(s)) result.push(rewrite(s));
                else if (isExpr(s)) result.push(s);
                else if (isLocal(s)) {
                    if (s.kind === 'set') result.push(s);
                    else if (moved.has(s.name)) {
                        // The declaration moved outward; initialize at the original point.
                        if (s.value !== undefined)
                            result.push({ kind: 'set', name: s.name, value: s.value });
                    } else
                        result.push(
                            s.value === undefined || s.zeroInitial
                                ? declaration(s.name)
                                : { kind: 'local', name: s.name, type: s.type, value: s.value },
                        );
                } else result.push(mapScope(s, (e) => e, rewrite));
                return result;
            });
        return rewrite(body);
    }
}
