import type { Statement, LocalDeclaration, LocalAssignment } from './syntax.ts';

class LiteralCode {
    constructor(readonly text: string) {}
    toString() {
        return this.text;
    }
}

type Scope = { parent?: Scope; boundary?: Point };
type Point = { array: Statement[]; index: number; scope: Scope; order: number };

/** Preserve expression references while assembling code; never infer them by
 * parsing printed text. Names are unique within a generated function. */
export class GoLocals {
    private reads = new Map<string, Set<string>>();
    private references = new Set<string>();
    private declarations = new Map<string, LocalDeclaration>();

    literal(text: string) {
        return new LiteralCode(text);
    }
    reference(name: string): string {
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
    derive(text: string, ...parts: unknown[]): string {
        return this.combine(text, parts);
    }
    template(strings: TemplateStringsArray, ...parts: unknown[]): string {
        return this.combine(
            strings.reduce((s, piece, i) => s + (i ? String(parts[i - 1]) : '') + piece, ''),
            parts,
        );
    }
    join(parts: readonly unknown[], separator = ','): string {
        return this.combine(parts.join(separator), parts);
    }
    declaration(name: string, type: string, value?: string): LocalDeclaration {
        this.reference(name);
        if (this.declarations.has(name)) throw Error(`Duplicate Go local ${name}`);
        const declaration: LocalDeclaration = { kind: 'local', name, type, value };
        this.declarations.set(name, declaration);
        return declaration;
    }
    assign(name: string, value: string): LocalAssignment {
        return { kind: 'set', name, value };
    }

    /** Place each declaration in the common lexical scope of its definition and
     * uses. An initializer stays at its original sequencing point even when its
     * declaration must move outward for restoration or a branch join. */
    place(body: Statement[]): Statement[] {
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
                            s.value === undefined
                                ? `var ${s.name} ${s.type}`
                                : `${s.name} := ${s.value}`,
                        );
                } else result.push({ ...s, body: rewrite(s.body) });
                return result;
            });
        return rewrite(body);
    }
}
