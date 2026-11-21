import type { Statement, LocalDeclaration, LocalAssignment } from './syntax.ts';

class LiteralCode {
    constructor(readonly text: string) {}
    toString() {
        return this.text;
    }
}

type Recipe =
    | { kind: 'text'; text: string }
    | { kind: 'ref'; name: string }
    | { kind: 'scalar'; value: number | boolean }
    | { kind: 'binary'; op: string; left: Recipe; right: Recipe }
    | {
          kind: 'compose';
          parts: Recipe[];
          emit: (parts: string[]) => string;
          returns?: boolean;
          aggregate?: Recipe[];
      }
    | { kind: 'opaque'; text: string; refs: Set<string> };
const scalarText = (v: number | boolean): string =>
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
            throw Error(`Unknown numeric Go operation ${op}`);
    }
};

type Scope = { parent?: Scope; boundary?: Point };
type Point = { array: Statement[]; index: number; scope: Scope; order: number };

/** Preserve expression references while assembling code; never infer them by
 * parsing printed text. Names are unique within a generated function. */
export class GoLocals {
    private reads = new Map<string, Set<string>>();
    private references = new Set<string>();
    private recipes = new Map<string, Recipe>();
    private blocked = new Set<string>();
    private declarations = new Map<string, LocalDeclaration>();

    literal(text: string) {
        return new LiteralCode(text);
    }
    reference(name: string): string {
        this.recipes.set(name, { kind: 'ref', name });
        this.references.add(name);
        this.reads.set(name, new Set([name]));
        return name;
    }
    private combine(text: string, parts: readonly unknown[]): string {
        const refs = new Set<string>();
        for (const part of parts)
            if (!(part instanceof LiteralCode))
                for (const ref of this.reads.get(String(part)) ?? []) refs.add(ref);
        // Assembling a field/type spelling must not overwrite the intrinsic
        // reference attached to a local with the same name. Field positions use
        // LiteralCode explicitly, so that namespace does not count as a read.
        if (!this.references.has(text)) this.reads.set(text, refs);
        return text;
    }
    private recipe(value: unknown): Recipe {
        if (value instanceof LiteralCode) return { kind: 'text', text: value.text };
        const text = String(value);
        return (
            this.recipes.get(text) ?? {
                kind: 'opaque',
                text,
                refs: this.reads.get(text) ?? new Set(),
            }
        );
    }
    private composed(emit: (parts: string[]) => string, parts: unknown[]): string {
        const text = emit(parts.map(String));
        const children = parts.map((p) => this.recipe(p));
        this.combine(text, parts);
        if (!this.references.has(text))
            this.recipes.set(text, { kind: 'compose', parts: children, emit });
        return text;
    }
    derive(text: string, ...parts: unknown[]): string {
        const result = this.combine(text, parts);
        if (!this.references.has(text))
            this.recipes.set(text, { kind: 'opaque', text, refs: this.reads.get(text)! });
        return result;
    }
    format(emit: (...parts: string[]) => string, ...parts: unknown[]): string {
        return this.composed((values) => emit(...values), parts);
    }
    template(strings: TemplateStringsArray, ...parts: unknown[]): string {
        return this.composed(
            (values) => strings.reduce((s, piece, i) => s + (i ? values[i - 1] : '') + piece, ''),
            parts,
        );
    }
    join(parts: readonly unknown[], separator = ','): string {
        return this.composed((values) => values.join(separator), [...parts]);
    }
    scalar(text: string, value: number | boolean): string {
        this.recipes.set(text, { kind: 'scalar', value });
        this.reads.set(text, new Set());
        return text;
    }
    binary(op: string, left: string, right: string): string {
        const text = this.template`(${left} ${this.literal(op)} ${right})`;
        this.recipes.set(text, {
            kind: 'binary',
            op,
            left: this.recipe(left),
            right: this.recipe(right),
        });
        return text;
    }
    aggregate(value: string, items: string[]): string {
        const r = this.recipe(value);
        if (r.kind === 'compose') r.aggregate = items.map((v) => this.recipe(v));
        return value;
    }
    returnValue(value: string): string {
        const text = this.template`return ${value}`;
        const r = this.recipes.get(text)!;
        if (r.kind === 'compose') r.returns = true;
        return text;
    }
    /** Field/pointee mutations not represented by a bare assignment node. */
    mutable(name: string): void {
        this.blocked.add(name);
    }
    /** Preserve the identity of a local cell whose address escapes an expression. */
    address(name: string): string {
        this.blocked.add(name);
        return this.template`&${this.reference(name)}`;
    }
    declaration(
        name: string,
        type: string,
        value?: string,
        options: { pure?: boolean; inline?: boolean; zeroInitial?: boolean; load?: boolean } = {},
    ): LocalDeclaration {
        this.reference(name);
        if (this.declarations.has(name)) throw Error(`Duplicate Go local ${name}`);
        const declaration: LocalDeclaration = { kind: 'local', name, type, value, ...options };
        this.declarations.set(name, declaration);
        return declaration;
    }
    assign(name: string, value: string): LocalAssignment {
        return { kind: 'set', name, value };
    }

    /** Substitute immutable copies and single-use pure compiler expressions.
     * Loads/calls keep their sequencing points; mutable and addressed cells keep identity. */
    private simplify(body: Statement[]): Statement[] {
        const blocked = new Set(this.blocked);
        const defs = new Map<string, LocalDeclaration>();
        const roots: Recipe[] = [];
        const visit = (array: Statement[], fn: (s: Exclude<Statement, Statement[]>) => void) => {
            for (const s of array) {
                if (Array.isArray(s)) visit(s, fn);
                else {
                    fn(s);
                    if (typeof s !== 'string' && !('kind' in s)) visit(s.body, fn);
                }
            }
        };
        visit(body, (s) => {
            if (typeof s !== 'string' && 'kind' in s) {
                if (s.kind === 'local') defs.set(s.name, s);
                else blocked.add(s.name);
            }
        });
        const children = (r: Recipe): Recipe[] =>
            r.kind === 'compose' ? r.parts : r.kind === 'binary' ? [r.left, r.right] : [];
        const refs = (r: Recipe): string[] =>
            r.kind === 'ref'
                ? [r.name]
                : r.kind === 'opaque'
                  ? [...r.refs]
                  : children(r).flatMap(refs);
        // Legacy opaque formatter fragments cannot be rewritten. Their referenced
        // variables remain materialized, rather than guessing at printed text.
        const protect = (r: Recipe) => {
            if (r.kind === 'opaque') r.refs.forEach((n) => blocked.add(n));
            children(r).forEach(protect);
        };
        visit(body, (s) => {
            const r = this.recipe(
                typeof s === 'string' ? s : 'kind' in s ? (s.value ?? '') : s.head,
            );
            protect(r);
        });
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
            if (
                typeof s !== 'string' &&
                'kind' in s &&
                s.kind === 'local' &&
                substitutions.has(s.name)
            )
                return;
            count(this.recipe(typeof s === 'string' ? s : 'kind' in s ? (s.value ?? '') : s.head));
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
        const text = (r: Recipe): string =>
            r.kind === 'text' || r.kind === 'opaque'
                ? r.text
                : r.kind === 'ref'
                  ? r.name
                  : r.kind === 'scalar'
                    ? scalarText(r.value)
                    : r.kind === 'binary'
                      ? `(${text(r.left)} ${r.op} ${text(r.right)})`
                      : r.emit(r.parts.map(text));
        const render = (s: string): string => {
            const r = normalize(this.recipe(s));
            const result = text(r);
            if (!this.references.has(result)) {
                this.recipes.set(result, r);
                this.reads.set(result, new Set(refs(r)));
            }
            return result;
        };
        const rewritten = (array: Statement[]): Statement[] =>
            array.flatMap((s): Statement[] => {
                if (Array.isArray(s)) return [rewritten(s)];
                if (typeof s === 'string') return [render(s)];
                if ('kind' in s) {
                    if (s.kind === 'local' && substitutions.has(s.name)) return [];
                    return [
                        { ...s, value: s.value === undefined ? undefined : render(s.value) } as
                            | LocalDeclaration
                            | LocalAssignment,
                    ];
                }
                return [{ ...s, head: render(s.head), body: rewritten(s.body) }];
            });
        // Fuse a definition into an immediately following bare assignment or
        // return. There is no intervening statement or lvalue evaluation to cross,
        // so even a call/load retains its order. Never do this for addressed cells.
        const firstPass = rewritten(body);
        const occurrences = new Map<string, number>();
        visit(firstPass, (s) => {
            const r = this.recipe(
                typeof s === 'string' ? s : 'kind' in s ? (s.value ?? '') : s.head,
            );
            refs(r).forEach((name) => occurrences.set(name, (occurrences.get(name) ?? 0) + 1));
        });
        const adjacent = (array: Statement[]): Statement[] => {
            const flat: Statement[] = [];
            const flatten = (items: Statement[]) =>
                items.forEach((s) => {
                    if (Array.isArray(s)) flatten(s);
                    else
                        flat.push(
                            typeof s !== 'string' && !('kind' in s)
                                ? { ...s, body: adjacent(s.body) }
                                : s,
                        );
                });
            flatten(array);
            for (let n = 0; n + 1 < flat.length; n++) {
                const d = flat[n]!,
                    next = flat[n + 1]!;
                if (
                    typeof d === 'string' ||
                    Array.isArray(d) ||
                    !('kind' in d) ||
                    d.kind !== 'local' ||
                    d.value === undefined ||
                    blocked.has(d.name) ||
                    occurrences.get(d.name) !== 1
                )
                    continue;
                if (
                    typeof next !== 'string' &&
                    !Array.isArray(next) &&
                    'kind' in next &&
                    next.kind === 'set'
                ) {
                    const r = this.recipe(next.value);
                    if (r.kind === 'ref' && r.name === d.name) {
                        flat[n + 1] = { ...next, value: d.value };
                        flat.splice(n--, 1);
                    }
                } else if (typeof next === 'string') {
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
            if (typeof tail === 'string') {
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
                            typeof d === 'string' ||
                            Array.isArray(d) ||
                            !('kind' in d) ||
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
                        const r = replace(original),
                            code = text(r);
                        this.recipes.set(code, r);
                        this.reads.set(code, new Set(refs(r)));
                        flat.splice(start, loads.length + 1, code);
                    }
                }
            }
            return flat;
        };
        const result = adjacent(firstPass);
        const remaining = new Map<string, LocalDeclaration>();
        const live = new Set<string>();
        visit(result, (s) => {
            if (typeof s !== 'string' && 'kind' in s && s.kind === 'local')
                remaining.set(s.name, s);
            else {
                roots.push(this.recipe(typeof s === 'string' ? s : 'kind' in s ? s.value : s.head));
                if (typeof s !== 'string' && 'kind' in s) live.add(s.name);
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
                if (typeof s === 'string') return [s];
                if ('kind' in s) return s.kind === 'local' && !live.has(s.name) ? [] : [s];
                return [{ ...s, body: prune(s.body) }];
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
        const read = (text: string, point: Point) => {
            for (const name of this.reads.get(text) ?? []) use(name, point);
        };
        const conditional = new Map<Scope, Point>();
        const walk = (array: Statement[], scope: Scope) => {
            array.forEach((s, index) => {
                if (Array.isArray(s)) {
                    walk(s, scope);
                    return;
                }
                const point = { array, index, scope, order: order++ };
                if (typeof s === 'string') {
                    read(s, point);
                    if (s.trim()) conditional.delete(scope);
                } else if ('kind' in s) {
                    conditional.delete(scope);
                    if (s.kind === 'local') definitions.set(s.name, point);
                    else use(s.name, point);
                    if (s.value !== undefined) read(s.value, point);
                } else {
                    const isElse = s.head.startsWith('else');
                    const boundary = isElse ? (conditional.get(scope) ?? point) : point;
                    if (s.head.startsWith('if ') || s.head.startsWith('if('))
                        conditional.set(scope, point);
                    else if (!isElse) conditional.delete(scope);
                    read(s.head, boundary);
                    if (s.head.startsWith('switch ')) {
                        // A switch's clause list is not a declaration scope.
                        // Shared cells belong before the entire switch.
                        for (const clause of s.body) {
                            if (
                                typeof clause === 'object' &&
                                !Array.isArray(clause) &&
                                !('kind' in clause)
                            ) {
                                read(clause.head, point);
                                walk(clause.body, { parent: scope, boundary: point });
                            }
                        }
                        return;
                    }
                    // No declaration may split an if/else chain. All arm scopes
                    // project to the chain's first if when lifted to their parent.
                    walk(s.body, { parent: scope, boundary });
                }
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
        const rewrite = (array: Statement[]): Statement[] =>
            array.flatMap((s, index): Statement[] => {
                const result: Statement[] = (before.get(array)?.get(index) ?? []).map(
                    (name) => `var ${name} ${this.declarations.get(name)!.type}`,
                );
                if (Array.isArray(s)) result.push(rewrite(s));
                else if (typeof s === 'string') result.push(s);
                else if ('kind' in s) {
                    if (s.kind === 'set') result.push(`${s.name} = ${s.value}`);
                    else if (moved.has(s.name)) {
                        if (s.value !== undefined) result.push(`${s.name} = ${s.value}`);
                    } else
                        result.push(
                            s.value === undefined || s.zeroInitial
                                ? `var ${s.name} ${s.type}`
                                : `${s.name} := ${s.value}`,
                        );
                } else result.push({ ...s, body: rewrite(s.body) });
                return result;
            });
        return rewrite(body);
    }
}
