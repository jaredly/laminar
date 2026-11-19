import {
    ElaborationBuilder,
    type Elaboration,
    type ElaborationContext,
    type BindingRecord,
    type RawState,
} from './elaborated.ts';
import { captureUses } from './captures.ts';
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
    mapType,
    type Ty,
    type FlowTy,
    type Scheme,
} from './types.ts';

type Borrow = { path: number[]; parent?: Borrow; id: string };
type Root = {
    /** Provenance retained while this computed focus owns deferred restoration. */
    owners?: Binding[];
    // Exclusive protection is independent of permission to retain owned backing.
    protectedOwners?: Binding[];
    place?: string;
    type: Ty;
    empty: number[][];
    borrows: Set<Borrow>;
    revisions: Map<string, number>;
};
type Binding = { id?: string; root: Root; path: number[]; scheme?: Scheme; permit?: Borrow };
type Env = Map<string, Binding>;
type View = {
    /** Stage final focus contents now; the returned action completes restoration. */
    stage?: (type: Ty) => () => void;
    pending?: Binding[];
    provenance?: Binding[];
    empty?: number[][];
    read: Ty;
    put: (type: Ty) => void;
    targets: Binding[];
};
export type TypeEnvironment = ReadonlyMap<string, Scheme>;
export type Inference = {
    type: Ty;
    scheme: Scheme;
    types: ReadonlyMap<object, FlowTy>;
    bindings: ReadonlyMap<object, BindingRecord>;
    elaboration: Elaboration;
};

/** One solver per checked expression/definition; environments contain finalized schemes. */
export class Inferencer {
    readonly solver = new Solver();
    private types = new Map<object, FlowTy>();
    private bindings = new Map<object, Binding>();
    private builder: ElaborationBuilder;
    private current?: object;
    private globalParameters = new Map<string, { local: number; parameter: string }[]>();
    private constructors: Map<string, Scheme>;
    constructor(
        private globals: TypeEnvironment = new Map(),
        constructors: TypeEnvironment = new Map(),
        context: ElaborationContext = { id: 'unit/expression' },
    ) {
        this.builder = new ElaborationBuilder(context);
        // Re-home externally supplied variables so solver IDs never collide.
        const imports = (table: TypeEnvironment, constructor = false) =>
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
                    const definition = constructor
                        ? `constructor/${name}`
                        : (context.definitions?.get(name) ?? `native/${name}`);
                    this.globalParameters.set(
                        (constructor ? 'constructor:' : 'value:') + name,
                        quantified.map((local, i) => ({ local, parameter: `${definition}/q${i}` })),
                    );
                    return [name, { body, quantified }];
                }),
            );
        this.globals = imports(globals);
        this.constructors = imports(constructors, true);
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
            [...this.globals].map(([name, scheme]) => {
                const b = { ...this.freshBinding(scheme.body), scheme };
                this.declare(
                    b,
                    name,
                    undefined,
                    'global',
                    this.builder.context.definitions?.get(name) ?? `native/${name}`,
                );
                return [name, b];
            }),
        );
    }
    private declare(
        b: Binding,
        name: string,
        node: object | undefined,
        kind: BindingRecord['kind'],
        definition?: string,
    ): void {
        b.id = this.builder.binding({
            name,
            declaration: node ? this.builder.node(node) : undefined,
            definition,
            place: b.root.place!,
            path: [...b.path],
            kind,
            borrow: b.permit?.id,
            initialType: this.get(b, 0),
        });
    }
    private state(root: Root): RawState {
        return {
            place: root.place!,
            type: root.type,
            empty: root.empty.map((p) => [...p]),
            borrows: [...new Set([...root.borrows].map((b) => b.id))],
        };
    }
    private states(env: Env): RawState[] {
        return [...new Set([...env.values()].filter((b) => !b.scheme).map((b) => b.root))]
            .filter((r) => r.place)
            .map((r) => this.state(r));
    }
    private transition(
        kind: Elaboration['transitions'][number]['kind'],
        b: Binding,
        before: RawState,
    ): void {
        if (b.root.place && this.current)
            this.builder.transitions.push({
                node: this.builder.node(this.current),
                kind,
                path: [...b.path],
                before,
                after: this.state(b.root),
            });
    }
    private use(node: object, b: Binding, mode: 'value' | 'lens'): void {
        this.bindings.set(node, b);
        this.builder.uses.push({ node: this.builder.node(node), binding: b.id!, mode });
    }
    private instantiate(name: string, scheme: Scheme, node: object, constructor = false): Ty {
        const result = this.solver.instantiateWithArguments(scheme);
        const recursive = !constructor && name === this.selfName;
        const parameters = recursive
            ? []
            : (this.globalParameters.get((constructor ? 'constructor:' : 'value:') + name) ?? []);
        this.builder.instantiations.push({
            node: this.builder.node(node),
            definition: constructor
                ? `constructor/${name}`
                : recursive
                  ? this.builder.context.id
                  : (this.builder.context.definitions?.get(name) ?? `native/${name}`),
            type: result.type,
            arguments: parameters.map((p) => ({
                parameter: p.parameter,
                type: result.arguments.get(p.local)!,
            })),
        });
        return result.type;
    }
    private selfName?: string;
    private lookup(env: Env, name: string, loc: number): Binding {
        return env.get(name) ?? this.error('unbound-name', loc, `Unbound name ${name}`);
    }
    private overlaps(a: number[], b: number[]): boolean {
        return a.slice(0, Math.min(a.length, b.length)).every((v, i) => v === b[i]);
    }
    // A computed focus depends on its logical path, including ancestor and
    // descendant writes, rather than the identity of its containing tuple type.
    private revision(b: Binding): number {
        return [...b.root.revisions].reduce(
            (n, [path, count]) => n + (this.overlaps(JSON.parse(path), b.path) ? count : 0),
            0,
        );
    }
    private joinRevisions(states: Map<string, number>[]): Map<string, number> {
        return new Map(
            [...new Set(states.flatMap((s) => [...s.keys()]))].map((path) => [
                path,
                Math.max(...states.map((s) => s.get(path) ?? 0)),
            ]),
        );
    }
    private accessible(b: Binding, loc: number): void {
        const permits = new Set<Borrow>();
        for (let p = b.permit; p; p = p.parent) permits.add(p);
        for (const borrow of b.root.borrows) {
            if (this.overlaps(b.path, borrow.path) && !permits.has(borrow))
                this.error(
                    'use-while-borrowed',
                    loc,
                    'Binding is exclusively borrowed until its aliases leave scope',
                );
        }
    }
    private available(b: Binding): boolean {
        return !b.root.empty.some((path) => this.overlaps(path, b.path));
    }
    private get(b: Binding, loc: number): Ty {
        this.accessible(b, loc);
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
    private put(b: Binding, value: Ty, loc: number, record = true): void {
        const before = this.state(b.root);
        this.accessible(b, loc);
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
        const revisionPath = JSON.stringify(b.path);
        b.root.revisions.set(revisionPath, (b.root.revisions.get(revisionPath) ?? 0) + 1);
        b.root.empty = b.root.empty.filter((path) => !this.overlaps(path, b.path));
        if (record) this.transition('write', b, before);
    }
    private consume(b: Binding, loc: number): Ty {
        const type = this.get(b, loc);
        if (!this.available(b))
            this.error('use-after-move', loc, 'Value has already been consumed');
        const before = this.state(b.root);
        this.put(b, tuple(), loc, false);
        b.root.empty.push(b.path);
        this.transition('move', b, before);
        return type;
    }
    private restored(b: Binding, loc: number): void {
        this.accessible(b, loc);
        if (!this.available(b))
            this.error(
                'unrestored-lens',
                loc,
                'Lens must contain a value at the end of its lifetime',
            );
    }
    private freshBinding(type: Ty): Binding {
        return {
            root: {
                place: this.builder.place(),
                type,
                empty: [],
                borrows: new Set(),
                revisions: new Map(),
            },
            path: [],
        };
    }
    private record(node: object, t: FlowTy): void {
        this.types.set(node, t);
        this.builder.record(node, t);
    }

    infer(ast: Linear, declaration?: Decl): Inference {
        const prepared = this.builder.prepare(ast, declaration);
        ast = prepared.ast;
        declaration = prepared.declaration;
        const env = this.env();
        const bodyVariables = new Map<number, Ty>();
        let self: Ty | undefined;
        if (ast.type === 'fn' && ast.name) {
            self = this.solver.fresh();
            // Recursion is reusable at runtime, but monomorphic during inference.
            this.selfName = ast.name;
            const binding = { ...this.freshBinding(self), scheme: mono(self) };
            this.declare(binding, ast.name, ast, 'global', this.builder.context.id);
            env.set(ast.name, binding);
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
            const inferredInstance = this.solver.instantiateWithArguments(scheme);
            const contractInstance = this.solver.instantiateWithArguments(contract, true);
            this.solver.unify(inferredInstance.type, contractInstance.type, declaration.loc);
            const contractVariables = new Map(
                [...contractInstance.arguments].map(([id, t]) => [
                    (t as Ty & { tag: 'rigid' }).id,
                    { tag: 'meta' as const, id },
                ]),
            );
            for (const [id, instance] of inferredInstance.arguments) {
                bodyVariables.set(
                    id,
                    mapType(this.solver.resolve(instance), (t) =>
                        t.tag === 'rigid' ? contractVariables.get(t.id) : undefined,
                    ),
                );
            }
            scheme = contract;
        }
        const elaboration = this.builder.finish(
            ast,
            declaration,
            this.solver,
            scheme,
            type,
            bodyVariables,
        );
        const bindingRecords = new Map(elaboration.bindings.map((b) => [b.id, b]));
        return {
            elaboration,
            type: this.solver.resolve(type),
            scheme,
            types: new Map(
                [...this.types].map(([n, t]) => [n, mapFlow(t, (v) => this.solver.resolve(v))]),
            ),
            bindings: new Map(
                [...this.bindings].map(([node, binding]) => [
                    node,
                    bindingRecords.get(binding.id!)!,
                ]),
            ),
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
                const b = source ? { ...source } : this.freshBinding(type);
                this.declare(b, p.text, p, source ? 'alias' : 'local');
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
                this.constructorType(p.name, args, type, p.loc, p);
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
    private constructorType(name: string, args: Ty[], result: Ty, loc: number, node: object): void {
        const scheme =
            this.constructors.get(name) ??
            this.error('unknown-constructor', loc, `Unknown constructor ${name}`);
        this.solver.unify(
            this.instantiate(name, scheme, node, true),
            fn(args.map(plain), plain(result)),
            loc,
        );
    }
    private linear(n: Linear, env: Env): Ty {
        const previous = this.current;
        this.current = n;
        try {
            const t = this.linearInner(n, env);
            this.record(n, plain(t));
            return t;
        } finally {
            this.current = previous;
        }
    }
    private linearInner(n: Linear, env: Env): Ty {
        switch (n.type) {
            case 'id':
            case 'op': {
                const b = this.lookup(env, n.text, n.loc);
                this.use(n, b, 'value');
                return b.scheme ? this.instantiate(n.text, b.scheme, n) : this.consume(b, n.loc);
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
                this.constructorType(n.name, args, result, n.loc, n);
                return result;
            }
            case 'apply':
                return this.call(n, env, false).read;
            case 'assign': {
                const view = this.lens(n.lens, env);
                const states = view.targets.map((b) => this.revision(b));
                const value = this.linear(n.value, env);
                if (
                    n.lens.type !== 'id' &&
                    n.lens.type !== 'tuple' &&
                    view.targets.some((b, i) => this.revision(b) !== states[i])
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
        const { values: captures, lenses: borrowed } = captureUses(n.body, bound);
        const sub = new Map(env),
            vars = new Map<string, Ty>();
        const captureRoots: Root[] = [];
        for (const name of borrowed) {
            const b = this.lookup(env, name, n.loc);
            if (!b.scheme)
                this.error(
                    'borrowed-capture',
                    n.loc,
                    `Closure cannot borrow outer binding ${name}`,
                );
        }
        for (const name of captures) {
            const b = this.lookup(env, name, n.loc);
            if (!b.scheme) {
                const type = this.consume(b, n.loc),
                    captured = this.freshBinding(type);
                this.declare(captured, name, n, 'capture');
                this.builder.captures.push({
                    node: this.builder.node(n),
                    from: b.id!,
                    to: captured.id!,
                    type,
                });
                sub.set(name, captured);
                captureRoots.push(captured.root);
            }
        }
        const exits: { root: Binding; read: Ty; write: Ty }[] = [];
        const seen = new Set<string>();
        const parameters: string[][] = [],
            parameterPlaces: string[][] = [];
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
            parameters.push(names(a.pat).map((name) => sub.get(name)!.id!));
            parameterPlaces.push(
                a.pat.type === 'lens'
                    ? [exits[exits.length - 1].root.root.place!]
                    : [...new Set(names(a.pat).map((name) => sub.get(name)!.root.place!))],
            );
            if (a.typ) this.solver.unifyFlow(type, this.annotation(a.typ, vars), a.pat.loc);
            return type;
        });
        const parameterIds = new Set(parameters.flat());
        const functionRoots = [
            ...new Set([
                ...captureRoots,
                ...[...sub.values()].filter((b) => parameterIds.has(b.id!)).map((b) => b.root),
                ...exits.map((e) => e.root.root),
            ]),
        ];
        const functionEntry = functionRoots.map((r) => this.state(r));
        const bodyStart = this.builder.transitions.length;
        let result: FlowTy;
        if (n.body.type === 'lens') {
            const view = this.lens(n.body.lens, sub),
                write = this.solver.fresh();
            const owners = (b: Binding): Binding[] =>
                b.root.owners ? b.root.owners.flatMap(owners) : [b];
            if (
                (view.provenance ?? view.targets)
                    .flatMap(owners)
                    .some((t) => !exits.some((e) => e.root.root === t.root))
            )
                this.error('escaping-lens', n.loc, 'Returned lens must refer to a lens parameter');
            const read = view.read;
            view.put(write);
            result = flow(read, write);
        } else result = plain(this.linear(n.body, sub));
        exits.forEach((v) => {
            this.restored(v.root, n.loc);
            this.solver.unify(v.write, this.get(v.root, n.loc), n.loc);
        });
        if (n.ann) this.solver.unifyFlow(result, this.annotation(n.ann, vars), n.loc);
        this.builder.functions.push({
            node: this.builder.node(n),
            parameters,
            parameterPlaces,
            body: this.builder.node(n.body),
            transitions: [bodyStart, this.builder.transitions.length],
            entry: functionEntry,
            exit: functionRoots.map((r) => this.state(r)),
        });
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
        if (n.value.type === 'lens' && n.value.lens.type !== 'id')
            return this.computedAlias(n, env, sub, p, isLens);
        if (n.value.type === 'lens') {
            const b = this.alias(n.value.lens, env);
            const type = this.get(b, n.loc);
            this.use(n.value.lens, b, 'lens');
            const before = this.state(b.root);
            const borrow: Borrow = { path: b.path, parent: b.permit, id: this.builder.borrow() };
            this.builder.borrows.push({
                id: borrow.id,
                node: this.builder.node(n),
                place: b.root.place!,
                path: [...b.path],
                parent: b.permit?.id,
            });
            b.root.borrows.add(borrow);
            this.transition('borrow-open', b, before);
            const alias = { ...b, permit: borrow };
            this.pattern(p, type, sub, alias);
            const close = () => {
                // End the borrow before checking the owner's restored state.
                const before = this.state(b.root);
                b.root.borrows.delete(borrow);
                this.restored(b, n.loc);
                if (n.value.type === 'lens')
                    this.record(n.value.lens, flow(type, this.get(b, n.loc)));
                this.transition('borrow-close', b, before);
                this.builder.scopes.push({
                    node: this.builder.node(n),
                    bindings: names(p).map((name) => sub.get(name)!.id!),
                    exit: [this.state(b.root)],
                });
            };
            if (isLens) {
                const view = this.lens(n.body as Lens, sub);
                return {
                    ...view,
                    pending: [...(view.pending ?? []), b],
                    stage: (t) => {
                        const finish = this.stage(view, t);
                        return () => {
                            finish();
                            close();
                        };
                    },
                    put: (t) => {
                        view.put(t);
                        close();
                    },
                };
            }
            const result = this.linear(n.body as Linear, sub);
            close();
            return result;
        }
        const type = this.linear(n.value, env);
        this.pattern(p, type, sub);
        // First-class functions are affine monotypes; only top-level definitions are reusable schemes.
        const close = () =>
            this.builder.scopes.push({
                node: this.builder.node(n),
                bindings: names(p).map((name) => sub.get(name)!.id!),
                exit: names(p).map((name) => this.state(sub.get(name)!.root)),
            });
        if (isLens) {
            const view = this.lens(n.body as Lens, sub);
            return {
                ...view,
                stage: (t) => {
                    const finish = this.stage(view, t);
                    return () => {
                        finish();
                        close();
                    };
                },
                put: (t) => {
                    view.put(t);
                    close();
                },
            };
        }
        const result = this.linear(n.body as Linear, sub);
        close();
        return result;
    }
    private computedAlias(
        n: (Linear | Lens) & { type: 'let' },
        env: Env,
        sub: Env,
        p: Pat,
        isLens: boolean,
    ): Ty | View {
        if (n.value.type !== 'lens') throw new Error('Expected lens');
        const view = this.lens(n.value.lens, env);
        const read = view.read;
        const focus = this.freshBinding(read);
        focus.root.owners = view.provenance ?? view.targets;
        focus.root.protectedOwners = view.targets;
        focus.root.empty = view.empty?.map((p) => [...p]) ?? [];
        const loan: Borrow = { path: [], id: this.builder.borrow() };
        const protections = view.targets.map((target) => {
            this.accessible(target, n.loc);
            const borrow: Borrow = { path: target.path, parent: target.permit, id: loan.id };
            target.root.borrows.add(borrow);
            return { target, borrow };
        });
        this.builder.borrows.push({
            id: loan.id,
            node: this.builder.node(n),
            place: focus.root.place!,
            path: [],
            owners: view.targets.map((b) => ({
                place: b.root.place!,
                path: [...b.path],
                permit: b.permit?.id,
            })),
        });
        focus.root.borrows.add(loan);
        this.pattern(p, read, sub, { ...focus, permit: loan });
        const close = () => {
            focus.root.borrows.delete(loan);
            this.restored(focus, n.loc);
            protections.forEach(({ target, borrow }) => target.root.borrows.delete(borrow));
            view.put(this.get(focus, n.loc));
            this.builder.scopes.push({
                node: this.builder.node(n),
                bindings: names(p).map((name) => sub.get(name)!.id!),
                exit: [this.state(focus.root), ...view.targets.map((b) => this.state(b.root))],
            });
        };
        if (isLens) {
            const result = this.lens(n.body as Lens, sub);
            return {
                ...result,
                pending: [...(result.pending ?? []), ...view.targets],
                stage: (t) => {
                    const finish = this.stage(result, t);
                    return () => {
                        finish();
                        close();
                    };
                },
                put: (type) => {
                    result.put(type);
                    close();
                },
            };
        }
        const result = this.linear(n.body as Linear, sub);
        close();
        return result;
    }
    private stage(view: View, type: Ty): () => void {
        return view.stage ? view.stage(type) : () => view.put(type);
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
            get empty() {
                return v.empty;
            },
            targets: v.targets,
            provenance: v.provenance,
            pending: v.pending,
            stage: (t) => {
                this.record(n, flow(v.read, write));
                this.solver.unify(write, t, n.loc);
                return this.stage(v, t);
            },
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
                this.use(n, b, 'lens');
                const self = this;
                return {
                    get read() {
                        return self.get(b, n.loc);
                    },
                    get empty() {
                        return b.root.empty
                            .filter((p) => self.overlaps(p, b.path))
                            .map((p) => p.slice(b.path.length));
                    },
                    stage: (t) => {
                        this.put(b, t, n.loc);
                        return () => {};
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
                    get empty() {
                        return views.flatMap((v, i) => (v.empty ?? []).map((p) => [i, ...p]));
                    },
                    targets,
                    provenance: views.flatMap((v) => v.provenance ?? v.targets),
                    pending: views.flatMap((v) => v.pending ?? []),
                    stage: (t) => {
                        const finishes = this.components(t, views.length, n.loc).map((v, i) =>
                            this.stage(views[i], v),
                        );
                        return () => finishes.forEach((f) => f());
                    },
                    put: (t) =>
                        this.components(t, views.length, n.loc).forEach((v, i) => views[i].put(v)),
                };
            }
            case 'apply':
                return this.call(n, env, true);
            case 'let':
                return this.letBody(n, env, true) as View;
            case 'case':
                return this.lensCase(n, env);
            case 'manual':
                return this.manual(n, env);
            case 'aslens':
                return this.aslens(n, env);
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
        const states = view?.targets.map((b) => this.revision(b));
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
            view.targets.some((b, i) => this.revision(b) !== states![i])
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
            provenance: view?.provenance,
            pending: view?.targets ?? [],
            stage: (t) => {
                this.solver.unify(write, t, n.loc);
                return () => view?.put(replacement);
            },
            put: (t) => {
                this.solver.unify(write, t, n.loc);
                view?.put(replacement);
            },
        };
    }
    private aslens(n: Lens & { type: 'aslens' }, env: Env): View {
        const read = this.linear(n.value, env);
        const temporary = this.freshBinding(read);
        this.declare(temporary, '$temporary', n, 'local');
        const bound = new Set(names(n.pat));
        const dependencies = [...new Set(free(n.body))]
            .filter((name) => !bound.has(name))
            .flatMap((name) => {
                const b = this.lookup(env, name, n.loc);
                return b.scheme ? [] : [b];
            });
        const record: (typeof this.builder.manuals)[number] = {
            node: this.builder.node(n),
            frontend: this.builder.node(n.value),
            temporary: temporary.id!,
            cleanup: this.builder.node(n.body),
            scoped: true,
            dependencies: [temporary.id!, ...dependencies.map((b) => b.id!)],
            staged: [],
            cleaned: [],
            restored: [],
        };
        this.builder.manuals.push(record);
        const stage = (type: Ty) => {
            this.put(temporary, type, n.loc);
            record.staged = [...this.states(env), this.state(temporary.root)];
            return () => {
                // Transfer the owned final contents into cleanup-local storage. These
                // bindings do not borrow an enclosing owner and need not be refilled.
                const final = this.consume(temporary, n.loc);
                const sub = new Map(env);
                this.pattern(n.pat, final, sub);
                this.linear(n.body, sub);
                const locals = names(n.pat).map((name) => sub.get(name)!);
                this.builder.scopes.push({
                    node: this.builder.node(n),
                    bindings: locals.map((b) => b.id!),
                    exit: locals.map((b) => this.state(b.root)),
                });
                record.cleaned = [...this.states(env), this.state(temporary.root)];
                record.restored = record.cleaned;
            };
        };
        return {
            read,
            targets: [temporary, ...dependencies],
            provenance: [],
            stage,
            put: (t) => stage(t)(),
        };
    }
    private manual(n: Lens & { type: 'manual' }, env: Env): View {
        const frontend = this.lens(n.frontend, env);
        const dependencies = [...new Set(free(n.backend))].flatMap((name) => {
            const binding = this.lookup(env, name, n.loc);
            return binding.scheme ? [] : [binding];
        });
        const all = [...frontend.targets, ...dependencies];
        const targets = all.filter(
            (b, i) =>
                !all.some(
                    (other, j) =>
                        other.root === b.root &&
                        other.permit === b.permit &&
                        other.path.length <= b.path.length &&
                        other.path.every((v, k) => b.path[k] === v) &&
                        (other.path.length < b.path.length || j < i),
                ),
        );
        const scoped = n.backend.type === 'fn' && n.backend.args.length === 0;
        const record: (typeof this.builder.manuals)[number] = {
            node: this.builder.node(n),
            frontend: this.builder.node(n.frontend),
            reconstruction: n.reconstructionPattern
                ? this.builder.node(n.reconstructionPattern)
                : undefined,
            cleanup: this.builder.node(
                scoped && n.backend.type === 'fn' ? n.backend.body : n.backend,
            ),
            scoped,
            dependencies: dependencies.map((b) => b.id!),
            staged: [],
            cleaned: [],
            restored: [],
        };
        this.builder.manuals.push(record);
        const stage = (type: Ty) => {
            const finish = this.stage(frontend, type);
            record.staged = this.states(env);
            return () => {
                if (
                    (frontend.pending ?? []).some((p) =>
                        dependencies.some(
                            (b) => b.root === p.root && this.overlaps(b.path, p.path),
                        ),
                    )
                )
                    this.error(
                        'use-while-borrowed',
                        n.loc,
                        'Cleanup accesses an owner before its computed focus is restored',
                    );
                if (scoped && n.backend.type === 'fn') {
                    if (n.backend.body.type === 'lens')
                        this.error('mode-mismatch', n.loc, 'Cleanup must return an owned value');
                    const result = this.linear(n.backend.body as Linear, env);
                    if (n.backend.ann)
                        this.solver.unifyFlow(
                            plain(result),
                            this.annotation(n.backend.ann, new Map()),
                            n.loc,
                        );
                    this.record(n.backend, plain(fn([], plain(result))));
                } else {
                    const cleanup = this.linear(n.backend, env);
                    this.solver.unify(cleanup, fn([], plain(this.solver.fresh())), n.loc);
                }
                record.cleaned = this.states(env);
                finish();
                record.restored = this.states(env);
            };
        };
        return {
            read: frontend.read,
            empty: frontend.empty,
            targets,
            // Compiler-generated reconstruction preserves the original owner's
            // escape restrictions; it is not an explicit owned-retention request.
            provenance: n.reconstructionPattern
                ? [this.lookup(env, n.reconstructionPattern.reconstructionOwner!.text, n.loc)]
                : [],
            pending: frontend.pending,
            stage,
            put: (type) => stage(type)(),
        };
    }
    private lensCase(n: Lens & { type: 'case' }, env: Env): View {
        if (n.value.type === 'lens')
            return this.error(
                'unsupported-lens-case',
                n.loc,
                'Matching a lens requires scoped restoration checking',
            );
        const scrutinee = this.linear(n.value, env);
        if (!n.cases.length) this.error('empty-case', n.loc, 'Case requires at least one branch');
        const roots = [...new Set([...env.values()].map((b) => b.root))];
        type Snapshot = {
            type: Ty;
            empty: number[][];
            borrows: Set<Borrow>;
            revisions: Map<string, number>;
        }[];
        const snapshot = (): Snapshot =>
            roots.map((r) => ({
                type: r.type,
                empty: r.empty.map((p) => [...p]),
                borrows: new Set(r.borrows),
                revisions: new Map(r.revisions),
            }));
        const restore = (states: Snapshot) =>
            roots.forEach((r, i) =>
                Object.assign(r, {
                    ...states[i],
                    empty: [...states[i].empty],
                    borrows: new Set(states[i].borrows),
                    revisions: new Map(states[i].revisions),
                }),
            );
        const initial = snapshot();
        const join = (states: Snapshot[]): Snapshot =>
            roots.map((_, i) => {
                const empty = states.flatMap((s) => s[i].empty);
                const erase = (type: Ty) => {
                    const root: Root = {
                        type,
                        empty: [],
                        borrows: new Set(),
                        revisions: new Map(),
                    };
                    for (const path of empty.filter(
                        (p) => !empty.some((q) => q.length < p.length && this.overlaps(p, q)),
                    ))
                        this.put({ root, path }, tuple(), n.loc, false);
                    return root.type;
                };
                const type = erase(states[0][i].type);
                for (const state of states.slice(1)) {
                    try {
                        this.solver.unify(type, erase(state[i].type), n.loc);
                    } catch (e) {
                        if (e instanceof TypeDiagnostic)
                            this.error(
                                'branch-state',
                                n.loc,
                                `Branches leave incompatible binding types: ${e.message}`,
                            );
                        throw e;
                    }
                }
                return {
                    type,
                    empty,
                    borrows: new Set(initial[i].borrows),
                    revisions: this.joinRevisions(states.map((s) => s[i].revisions)),
                };
            });
        const read = this.solver.fresh();
        const record: (typeof this.builder.branches)[number] = {
            node: this.builder.node(n),
            input: this.states(env),
            arms: [],
            output: [],
        };
        const arms = n.cases.map((arm) => {
            restore(initial);
            const sub = new Map(env);
            this.pattern(arm.pat, scrutinee, sub);
            const start = this.builder.transitions.length;
            const view = this.lens(arm.body, sub);
            this.solver.unify(read, view.read, arm.body.loc);
            const state = snapshot();
            record.arms.push({
                node: this.builder.node(arm.body),
                output: this.states(env),
                transitions: [start, this.builder.transitions.length],
            });
            return { view, state, empty: view.empty?.map((p) => [...p]) ?? [] };
        });
        const setup = join(arms.map((a) => a.state));
        restore(setup);
        record.output = this.states(env);
        this.builder.branches.push(record);
        const external = (b: Binding): Binding[] => {
            // Existing computed focuses are outer storage with their own permits.
            // Only branch-local backing needs tracing to its retained owners.
            if (!roots.includes(b.root))
                return (b.root.protectedOwners ?? b.root.owners)?.flatMap(external) ?? [];
            let permit = b.permit;
            const active = initial[roots.indexOf(b.root)].borrows;
            while (permit && !active.has(permit)) permit = permit.parent;
            return [{ ...b, permit }];
        };
        const targets = arms
            .flatMap((a) => a.view.targets.flatMap(external))
            .filter(
                (b, i, all) =>
                    !all.some(
                        (other, j) =>
                            other.root === b.root &&
                            other.permit === b.permit &&
                            other.path.length <= b.path.length &&
                            other.path.every((v, k) => b.path[k] === v) &&
                            (other.path.length < b.path.length || j < i),
                    ),
            );
        return {
            read,
            targets,
            empty: arms.flatMap((a) => a.empty),
            provenance: arms.flatMap((a) => a.view.provenance ?? a.view.targets),
            pending: arms.flatMap((a) => a.view.pending ?? []),
            stage: (type) => {
                const current = snapshot();
                const staged = arms.map((arm) => {
                    restore(
                        current.map((s, j) => ({
                            ...s,
                            borrows: new Set([
                                ...s.borrows,
                                ...[...arm.state[j].borrows].filter(
                                    (b) => !initial[j].borrows.has(b),
                                ),
                            ]),
                        })),
                    );
                    const finish = this.stage(arm.view, type);
                    return { state: snapshot(), finish };
                });
                restore(join(staged.map((a) => a.state)));
                return () => {
                    const updated = snapshot();
                    const outputs: Snapshot[] = [];
                    staged.forEach((arm, i) => {
                        restore(
                            updated.map((s, j) => ({
                                ...s,
                                borrows: new Set([
                                    ...s.borrows,
                                    ...[...arm.state[j].borrows].filter(
                                        (b) => !initial[j].borrows.has(b),
                                    ),
                                ]),
                            })),
                        );
                        arm.finish();
                        outputs.push(snapshot());
                        record.arms[i].restored = this.states(env);
                    });
                    restore(join(outputs).map((s, i) => ({ ...s, borrows: updated[i].borrows })));
                    record.restored = this.states(env);
                };
            },
            put: (type) => {
                const current = snapshot();
                const outputs: Snapshot[] = [];
                arms.forEach((arm, i) => {
                    restore(
                        current.map((s, j) => ({
                            ...s,
                            borrows: new Set([
                                ...s.borrows,
                                ...[...arm.state[j].borrows].filter(
                                    (b) => !initial[j].borrows.has(b),
                                ),
                            ]),
                        })),
                    );
                    arm.view.put(type);
                    outputs.push(snapshot());
                    record.arms[i].restored = this.states(env);
                });
                restore(join(outputs).map((s, i) => ({ ...s, borrows: current[i].borrows })));
                record.restored = this.states(env);
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
        const branchRecord: (typeof this.builder.branches)[number] = {
            node: this.builder.node(n),
            input: this.states(env),
            arms: [],
            output: [],
        };
        const initial = roots.map((r) => ({
            type: r.type,
            empty: [...r.empty],
            revisions: new Map(r.revisions),
        }));
        let joined: { type: Ty; empty: number[][]; revisions: Map<string, number> }[] | undefined;
        for (const branch of n.cases) {
            roots.forEach((r, i) => {
                r.type = initial[i].type;
                r.empty = [...initial[i].empty];
                r.revisions = new Map(initial[i].revisions);
            });
            const sub = new Map(env);
            this.pattern(branch.pat, scrutinee, sub);
            const firstTransition = this.builder.transitions.length;
            this.solver.unify(result, this.linear(branch.body, sub), branch.body.loc);
            branchRecord.arms.push({
                node: this.builder.node(branch.body),
                output: this.states(env),
                transitions: [firstTransition, this.builder.transitions.length],
            });
            if (!joined)
                joined = roots.map((r) => ({
                    type: r.type,
                    empty: [...r.empty],
                    revisions: new Map(r.revisions),
                }));
            else
                roots.forEach((r, i) => {
                    try {
                        const empty = [...joined![i].empty, ...r.empty];
                        const erase = (type: Ty): Ty => {
                            const root: Root = {
                                type,
                                empty: [],
                                borrows: new Set(),
                                revisions: new Map(),
                            };
                            for (const path of empty.sort((a, b) => b.length - a.length)) {
                                // An empty ancestor subsumes all of its descendants.
                                if (
                                    !empty.some(
                                        (p) => p.length < path.length && this.overlaps(p, path),
                                    )
                                )
                                    this.put({ root, path }, tuple(), n.loc);
                            }
                            return root.type;
                        };
                        const type = erase(joined![i].type);
                        this.solver.unify(type, erase(r.type), n.loc);
                        joined![i] = {
                            type,
                            empty,
                            revisions: this.joinRevisions([joined![i].revisions, r.revisions]),
                        };
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
        roots.forEach((r, i) => {
            r.type = joined![i].type;
            r.empty = joined![i].empty;
            r.revisions = new Map(joined![i].revisions);
        });
        branchRecord.output = this.states(env);
        this.builder.branches.push(branchRecord);
        return result;
    }
}
