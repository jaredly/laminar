import {
    free,
    names,
    type Linear,
    type Lens,
    type Pat,
    type Term,
    type Type,
    type Decl,
} from './ast.ts';
import {
    Solver,
    TypeDiagnostic,
    con,
    tuple,
    fn,
    plain,
    flow,
    mono,
    mapFlow,
    type Ty,
    type FlowTy,
    type Scheme,
} from './types.ts';

type Root = { type: Ty };
type Binding = { root: Root; path: number[]; scheme?: Scheme };
type Env = Map<string, Binding>;
type View = { read: Ty; put: (type: Ty) => void; targets: Binding[] };
export type TypeEnvironment = ReadonlyMap<string, Scheme>;
export type Inference = {
    type: Ty;
    scheme: Scheme;
    types: ReadonlyMap<object, FlowTy>;
    bindings: ReadonlyMap<object, object>;
};

/** One solver per checked expression/definition; environments contain finalized schemes. */
export class Inferencer {
    readonly solver = new Solver();
    private types = new Map<object, FlowTy>();
    private bindings = new Map<object, object>();
    private constructors: Map<string, Scheme>;
    constructor(
        private globals: TypeEnvironment = new Map(),
        constructors: TypeEnvironment = new Map(),
    ) {
        // Re-home externally supplied variables so solver IDs never collide.
        const imports = (table: TypeEnvironment) =>
            new Map(
                [...table].map(([name, scheme]) => {
                    const source = new Solver();
                    const vars = [...source.free(scheme.body)];
                    if (vars.some((id) => !scheme.quantified.includes(id)))
                        throw new TypeDiagnostic(
                            'open-signature',
                            0,
                            `External signature ${name} contains unquantified variables`,
                        );
                    const replacements = new Map(vars.map((id) => [id, this.solver.fresh()]));
                    const body = this.replace(scheme.body, replacements);
                    const quantified = scheme.quantified.map(
                        (id) => (replacements.get(id) as Ty & { tag: 'meta' }).id,
                    );
                    return [name, { body, quantified }];
                }),
            );
        this.globals = imports(globals);
        this.constructors = imports(constructors);
    }
    private replace(t: Ty, vars: Map<number, Ty>): Ty {
        switch (t.tag) {
            case 'meta':
                return vars.get(t.id) ?? t;
            case 'rigid':
                return t;
            case 'con':
                return { ...t, args: t.args.map((v) => this.replace(v, vars)) };
            case 'tuple':
                return tuple(...t.items.map((v) => this.replace(v, vars)));
            case 'fn':
                return fn(
                    t.args.map((v) => mapFlow(v, (t) => this.replace(t, vars))),
                    mapFlow(t.result, (t) => this.replace(t, vars)),
                );
        }
    }
    private error(code: string, loc: number, message: string): never {
        throw new TypeDiagnostic(code, loc, message);
    }
    private env(): Env {
        return new Map(
            [...this.globals].map(([n, s]) => [n, { root: { type: s.body }, path: [], scheme: s }]),
        );
    }
    private lookup(env: Env, name: string, loc: number): Binding {
        return env.get(name) ?? this.error('unbound-name', loc, `Unbound name ${name}`);
    }
    private get(b: Binding, loc: number): Ty {
        let t = b.root.type;
        for (const i of b.path) {
            const p = this.solver.prune(t);
            if (p.tag !== 'tuple')
                return this.error(
                    'alias-shape',
                    loc,
                    'Aliased tuple no longer has its original shape',
                );
            t = p.items[i] ?? this.error('alias-shape', loc, 'Aliased tuple component is missing');
        }
        return t;
    }
    private put(b: Binding, value: Ty, loc: number): void {
        if (b.scheme)
            this.error('immutable-definition', loc, 'Reusable definitions cannot be lens targets');
        const update = (t: Ty, path: number[]): Ty => {
            if (!path.length) return value;
            const p = this.solver.prune(t);
            if (p.tag !== 'tuple' || path[0] >= p.items.length)
                return this.error('alias-shape', loc, 'Aliased tuple shape changed');
            return tuple(...p.items.map((v, i) => (i === path[0] ? update(v, path.slice(1)) : v)));
        };
        b.root.type = update(b.root.type, b.path);
    }
    private freshBinding(type: Ty): Binding {
        return { root: { type }, path: [] };
    }
    private record(node: object, t: FlowTy): void {
        this.types.set(node, t);
    }

    infer(ast: Linear, declaration?: Decl): Inference {
        const env = this.env();
        let self: Ty | undefined;
        if (ast.type === 'fn' && ast.name) {
            self = this.solver.fresh();
            // Recursion is reusable at runtime, but monomorphic during inference.
            env.set(ast.name, { ...this.freshBinding(self), scheme: mono(self) });
        }
        const type = this.linear(ast, env);
        if (self) this.solver.unify(self, type, ast.loc);
        let scheme = this.solver.generalize(type, [...this.globals.values()]);
        if (declaration) {
            if (ast.type !== 'fn' || ast.name !== declaration.name.text)
                this.error(
                    'declaration-name',
                    declaration.loc,
                    'Declaration must name its implementation',
                );
            const declared = this.annotation(declaration.ann, new Map());
            if (declared.tag !== 'plain')
                this.error(
                    'annotation-mismatch',
                    declaration.loc,
                    'Definition signature must be a value type',
                );
            const contract = this.solver.generalize(declared.value, []);
            this.solver.unify(
                this.solver.instantiate(scheme),
                this.solver.instantiate(contract, true),
                declaration.loc,
            );
            scheme = contract;
        }
        return {
            type: this.solver.resolve(type),
            scheme,
            types: new Map(
                [...this.types].map(([n, t]) => [n, mapFlow(t, (v) => this.solver.resolve(v))]),
            ),
            bindings: this.bindings,
        };
    }
    private annotation(t: Type, vars: Map<string, Ty>): FlowTy {
        switch (t.type) {
            case 'id': {
                if (['Number', 'Int', 'Bool', 'String', 'World', 'Handle'].includes(t.text))
                    return plain(con(t.text === 'Int' ? 'Number' : t.text));
                if (!/^[a-z]/.test(t.text))
                    this.error('unknown-type', t.loc, `Unknown type ${t.text}`);
                if (!vars.has(t.text)) vars.set(t.text, this.solver.fresh());
                return plain(vars.get(t.text)!);
            }
            case 'lens': {
                const a = this.valueAnnotation(t.left, vars);
                return flow(a, t.right ? this.valueAnnotation(t.right, vars) : a);
            }
            case 'tuple':
                return plain(tuple(...t.items.map((v) => this.valueAnnotation(v, vars))));
            case 'fn':
                return plain(
                    fn(
                        t.args.map((v) => this.annotation(v, vars)),
                        this.annotation(t.body, vars),
                    ),
                );
        }
    }
    private valueAnnotation(t: Type, vars: Map<string, Ty>): Ty {
        const a = this.annotation(t, vars);
        if (a.tag !== 'plain')
            return this.error(
                'mode-mismatch',
                'loc' in t ? t.loc : 0,
                'Lens types are only allowed in function argument/result positions',
            );
        return a.value;
    }
    private components(type: Ty, count: number, loc: number): Ty[] {
        const items = Array.from({ length: count }, () => this.solver.fresh());
        this.solver.unify(type, tuple(...items), loc);
        return items;
    }
    private pattern(p: Pat, type: Ty, env: Env, source?: Binding, seen = new Set<string>()): void {
        this.record(p, plain(type));
        switch (p.type) {
            case 'id': {
                if (seen.has(p.text))
                    this.error('duplicate-pattern', p.loc, `Duplicate pattern name ${p.text}`);
                seen.add(p.text);
                const b = source ?? this.freshBinding(type);
                env.set(p.text, b);
                this.bindings.set(p, b);
                return;
            }
            case 'drop':
                return;
            case 'bool':
                this.solver.unify(type, con('Bool'), p.loc);
                return;
            case 'number':
                this.solver.unify(type, con('Number'), p.loc);
                return;
            case 'string':
                this.solver.unify(type, con('String'), p.loc);
                return;
            case 'tuple': {
                this.components(type, p.items.length, p.loc).forEach((v, i) =>
                    this.pattern(
                        p.items[i],
                        v,
                        env,
                        source ? { ...source, path: [...source.path, i] } : undefined,
                        seen,
                    ),
                );
                return;
            }
            case 'constructor': {
                if (source)
                    this.error(
                        'unsupported-lens-pattern',
                        p.loc,
                        'Constructor aliases require restoration checking',
                    );
                const args = p.args.map(() => this.solver.fresh());
                this.constructorType(p.name, args, type, p.loc);
                p.args.forEach((v, i) => this.pattern(v, args[i], env, undefined, seen));
                return;
            }
            case 'lens':
                this.error(
                    'invalid-lens-pattern',
                    p.loc,
                    'Lens pattern is only valid as the final function parameter',
                );
        }
    }
    private constructorType(name: string, args: Ty[], result: Ty, loc: number): void {
        const scheme =
            this.constructors.get(name) ??
            this.error('unknown-constructor', loc, `Unknown constructor ${name}`);
        this.solver.unify(this.solver.instantiate(scheme), fn(args.map(plain), plain(result)), loc);
    }
    private linear(n: Linear, env: Env): Ty {
        const t = this.linearInner(n, env);
        this.record(n, plain(t));
        return t;
    }
    private linearInner(n: Linear, env: Env): Ty {
        switch (n.type) {
            case 'id':
            case 'op': {
                const b = this.lookup(env, n.text, n.loc);
                this.bindings.set(n, b);
                return b.scheme ? this.solver.instantiate(b.scheme) : this.get(b, n.loc);
            }
            case 'number':
                return con('Number');
            case 'bool':
                return con('Bool');
            case 'string':
                n.interp.forEach((v) => this.linear(v.value, env));
                return con('String');
            case 'tuple':
                return n.items.length === 1
                    ? this.linear(n.items[0], env)
                    : tuple(...n.items.map((v) => this.linear(v, env)));
            case 'constructor': {
                const args = n.args.map((v) => this.linear(v, env)),
                    result = this.solver.fresh();
                this.constructorType(n.name, args, result, n.loc);
                return result;
            }
            case 'apply':
                return this.call(n, env, false).read;
            case 'assign': {
                const view = this.lens(n.lens, env);
                const states = view.targets.map((b) => b.root.type);
                const value = this.linear(n.value, env);
                if (
                    n.lens.type !== 'id' &&
                    n.lens.type !== 'tuple' &&
                    view.targets.some((b, i) => b.root.type !== states[i])
                )
                    this.error(
                        'alias-conflict',
                        n.loc,
                        'Assignment RHS changes the owner of an active computed lens',
                    );
                const previous = view.read;
                view.put(value);
                return previous;
            }
            case 'let':
                return this.letBody(n, env, false) as Ty;
            case 'fn':
                return this.lambda(n, env);
            case 'case':
                return this.caseBody(n, env);
        }
    }
    private lambda(n: Linear & { type: 'fn' }, env: Env): Ty {
        const bound = new Set(n.args.flatMap((a) => names(a.pat)));
        for (const name of free(n.body)) {
            if (!bound.has(name) && !env.has(name))
                this.error('unbound-name', n.loc, `Unbound name ${name}`);
            if (!bound.has(name) && !env.get(name)?.scheme)
                this.error(
                    'unsupported-capture',
                    n.loc,
                    `Closure captures mutable local ${name}; capture effects are not yet supported`,
                );
        }
        const sub = new Map(env),
            vars = new Map<string, Ty>();
        const exits: { root: Binding; read: Ty; write: Ty }[] = [];
        const seen = new Set<string>();
        const args = n.args.map((a, i): FlowTy => {
            const read = this.solver.fresh();
            let type: FlowTy;
            if (a.pat.type === 'lens') {
                if (i !== n.args.length - 1)
                    this.error('lens-position', a.pat.loc, 'Lens argument must be last');
                const root = this.freshBinding(read),
                    write = this.solver.fresh();
                this.pattern(a.pat.inner, read, sub, root, seen);
                exits.push({ root, read, write });
                type = flow(read, write);
            } else {
                this.pattern(a.pat, read, sub, undefined, seen);
                type = plain(read);
            }
            if (a.typ) this.solver.unifyFlow(type, this.annotation(a.typ, vars), a.pat.loc);
            return type;
        });
        let result: FlowTy;
        if (n.body.type === 'lens') {
            const view = this.lens(n.body.lens, sub),
                write = this.solver.fresh();
            if (view.targets.some((t) => !exits.some((e) => e.root.root === t.root)))
                this.error('escaping-lens', n.loc, 'Returned lens must refer to a lens parameter');
            const read = view.read;
            view.put(write);
            result = flow(read, write);
        } else result = plain(this.linear(n.body, sub));
        exits.forEach((v) => this.solver.unify(v.write, this.get(v.root, n.loc), n.loc));
        if (n.ann) this.solver.unifyFlow(result, this.annotation(n.ann, vars), n.loc);
        return fn(args, result);
    }
    private alias(n: Lens, env: Env): Binding {
        if (n.type !== 'id')
            return this.error(
                'unsupported-alias',
                n.loc,
                'Persistent aliases currently require a variable lens',
            );
        const b = this.lookup(env, n.text, n.loc);
        if (b.scheme)
            this.error(
                'immutable-definition',
                n.loc,
                'Reusable definitions cannot be lens targets',
            );
        return b;
    }
    private letBody(n: (Linear | Lens) & { type: 'let' }, env: Env, isLens: boolean): Ty | View {
        const sub = new Map(env);
        const p: Pat =
            n.pat.type === 'drop' && n.value.type === 'fn' && n.value.name
                ? { type: 'id', text: n.value.name, loc: n.value.loc }
                : n.pat;
        if (n.value.type === 'lens') {
            const b = this.alias(n.value.lens, env);
            this.pattern(p, this.get(b, n.loc), sub, b);
        } else {
            const type = this.linear(n.value, env);
            this.pattern(p, type, sub);
            // Generalized bindings are immutable: borrowing them is rejected at every use.
            // This conservative rule avoids needing a whole-program address-taken analysis.
            if (
                p.type === 'id' &&
                n.value.type === 'fn' &&
                free(n.value).every((name) => env.get(name)?.scheme)
            ) {
                const b = sub.get(p.text)!;
                b.scheme = this.solver.generalize(
                    type,
                    [...env.values()].map((v) => v.scheme ?? mono(this.get(v, n.loc))),
                );
            }
        }
        return isLens ? this.lens(n.body as Lens, sub) : this.linear(n.body as Linear, sub);
    }
    private lens(n: Lens, env: Env): View {
        const v = this.lensInner(n, env);
        // A lens occurrence has its own replacement metavariable for tooling.
        const write = this.solver.fresh();
        this.record(n, flow(v.read, write));
        return {
            get read() {
                return v.read;
            },
            targets: v.targets,
            put: (t) => {
                this.record(n, flow(v.read, write));
                this.solver.unify(write, t, n.loc);
                v.put(t);
            },
        };
    }
    private lensInner(n: Lens, env: Env): View {
        switch (n.type) {
            case 'id': {
                const b = this.alias(n, env);
                this.bindings.set(n, b);
                const self = this;
                return {
                    get read() {
                        return self.get(b, n.loc);
                    },
                    put: (t) => this.put(b, t, n.loc),
                    targets: [b],
                };
            }
            case 'tuple': {
                const views = n.items.map((v) => this.lens(v, env));
                const targets = views.flatMap((v) => v.targets);
                this.disjoint(targets, n.loc);
                return {
                    get read() {
                        return tuple(...views.map((v) => v.read));
                    },
                    targets,
                    put: (t) =>
                        this.components(t, views.length, n.loc).forEach((v, i) => views[i].put(v)),
                };
            }
            case 'apply':
                return this.call(n, env, true);
            case 'let':
                return this.letBody(n, env, true) as View;
            case 'manual':
            case 'aslens':
            case 'case':
                return this.error(
                    'unsupported-lens',
                    n.loc,
                    `${n.type} lenses require scoped restoration checking`,
                );
        }
    }
    private disjoint(targets: Binding[], loc: number): void {
        targets.forEach((a, i) =>
            targets.slice(i + 1).forEach((b) => {
                if (
                    a.root === b.root &&
                    a.path
                        .slice(0, Math.min(a.path.length, b.path.length))
                        .every((p, i) => p === b.path[i])
                )
                    this.error('alias-conflict', loc, 'Overlapping lens targets');
            }),
        );
    }
    private call(n: (Linear | Lens) & { type: 'apply' }, env: Env, lensResult: boolean): View {
        const last = n.args[n.args.length - 1];
        if (n.args.slice(0, -1).some((a) => a.type === 'lens'))
            this.error('lens-position', n.loc, 'Lens argument must be last');
        // Match decomposition: final lens setup is hoisted before callee/ordinary arguments.
        const view = last?.type === 'lens' ? this.lens(last.lens, env) : undefined;
        const states = view?.targets.map((b) => b.root.type);
        const callee = this.linear(n.fn, env);
        const replacement = this.solver.fresh();
        const args = n.args.map((a) =>
            a.type === 'lens' ? flow(view!.read, replacement) : plain(this.linear(a, env)),
        );
        if (
            view &&
            last?.type === 'lens' &&
            last.lens.type !== 'id' &&
            last.lens.type !== 'tuple' &&
            view.targets.some((b, i) => b.root.type !== states![i])
        )
            this.error(
                'alias-conflict',
                n.loc,
                'Arguments change the owner of an active computed lens',
            );
        const read = this.solver.fresh(),
            write = this.solver.fresh();
        this.solver.unify(callee, fn(args, lensResult ? flow(read, write) : plain(read)), n.loc);
        if (!lensResult) {
            view?.put(replacement);
            return { read, put: () => {}, targets: [] };
        }
        return {
            read,
            targets: view?.targets ?? [],
            put: (t) => {
                this.solver.unify(write, t, n.loc);
                view?.put(replacement);
            },
        };
    }
    private caseBody(n: Linear & { type: 'case' }, env: Env): Ty {
        if (n.value.type === 'lens')
            return this.error(
                'unsupported-lens-case',
                n.loc,
                'Matching a lens requires scoped restoration checking',
            );
        const scrutinee = this.linear(n.value, env),
            result = this.solver.fresh();
        if (!n.cases.length) this.error('empty-case', n.loc, 'Case requires at least one branch');
        const roots = [...new Set([...env.values()].map((b) => b.root))];
        const initial = roots.map((r) => r.type);
        let joined: Ty[] | undefined;
        for (const branch of n.cases) {
            roots.forEach((r, i) => (r.type = initial[i]));
            const sub = new Map(env);
            this.pattern(branch.pat, scrutinee, sub);
            this.solver.unify(result, this.linear(branch.body, sub), branch.body.loc);
            if (!joined) joined = roots.map((r) => r.type);
            else
                roots.forEach((r, i) => {
                    try {
                        this.solver.unify(joined![i], r.type, n.loc);
                    } catch (e) {
                        if (e instanceof TypeDiagnostic)
                            this.error(
                                'branch-state',
                                n.loc,
                                `Branches leave incompatible binding types: ${e.message}`,
                            );
                        throw e;
                    }
                });
        }
        roots.forEach((r, i) => (r.type = joined![i]));
        return result;
    }
}
