import { comparableUnions } from './constraints.ts';
import {
    ElaborationBuilder,
    type Elaboration,
    type ElaborationContext,
    type BindingRecord,
    type RawState,
    type Step,
} from './elaborated.ts';
import { captureUses } from './captures.ts';
import { isLinear } from './linear.ts';
import {
    free,
    names,
    type Linear,
    type Lens,
    type Pat,
    type Term,
    type Type,
    type Decl,
    type Id,
    type TypeDecl,
    type RecordItem,
} from './ast.ts';
import {
    Solver,
    TypeDiagnostic,
    con,
    tuple,
    record,
    fn,
    plain,
    flow,
    mono,
    mapFlow,
    printType,
    FIXED,
    OWNED,
    BORROWED_LENS,
    OWNED_LENS,
    REPLACEABLE,
    SHARED,
    CHANNEL,
    reads,
    mapType,
    type Ty,
    type FlowTy,
    type Scheme,
    type RecordTy,
} from './types.ts';

type Borrow = { path: Step[]; parent?: Borrow; id: string };
type OnceParameters = readonly number[] | undefined;
const commonOnceParameters = (a: OnceParameters, b: OnceParameters): OnceParameters =>
    a && b && a.filter((i) => b.includes(i));
type Root = {
    /** Evidence for the function value currently occupying this whole place. */
    callsOnce?: OnceParameters;
    /** Provenance retained while this computed focus owns deferred restoration. */
    owners?: Binding[];
    // Exclusive protection is independent of permission to retain owned backing.
    protectedOwners?: Binding[];
    place?: string;
    type: Ty;
    empty: Step[][];
    /**
     * The type each emptied path held when it was last moved out; a move leaves unit behind.
     * Only read for a path that is empty now.
     */
    vacated?: Map<string, Ty>;
    borrows: Set<Borrow>;
    revisions: Map<string, number>;
    /**
     * Set when this place is an owned lens. `permit` is the one its own binding holds: a
     * reborrow has a different one, so only the whole, original binding can move.
     */
    ownedLens?: { permit?: Borrow };
    /** The owned lens left for another holder, which also ends it. */
    moved?: boolean;
};
type Binding = {
    id?: string;
    root: Root;
    path: Step[];
    scheme?: Scheme;
    permit?: Borrow;
    /**
     * Set on a user-written alias of a non-replaceable lens (`let r = ~find(...)`): the whole
     * value has no storage, so it cannot be assigned, moved out or passed as a stored lens.
     * Absent means replaceable. Only the whole binding (empty path) is affected; aliases copy
     * it, except the owner alias that `normalizeBorrowed` generates for a match.
     */
    replaceable?: Ty;
};
type Env = Map<string, Binding>;
/** A spread's value: what it holds now, what it held before any moves, and the emptied fields. */
type SpreadValue = { current: Ty; original: Ty; holes: Set<string> };
type View = {
    /** Stage final focus contents now; the returned action completes restoration. */
    provenance?: Binding[];
    empty?: Step[][];
    read: Ty;
    put: (type: Ty) => void;
    targets: Binding[];
    /**
     * Whether the whole value can be replaced; absent means `REPLACEABLE`. Only a
     * constructor of lenses over a multi-constructor type is `FIXED`.
     */
    replaceable?: Ty;
    /** Whether this lens may move to another holder; absent means borrowed. */
    owned?: Ty;
    /** The binding that loses the lens if it moves; absent for a temporary. */
    holder?: Binding;
};
/** One lens argument of a call, from its setup until the call returns it or takes it. */
type LensArgument = {
    source: Lens;
    view: View;
    /** The targets' revisions just after setup. */
    revisions: number[];
    replacement: Ty;
    /** Unknown until the callee is: its signature says whether this call borrows or moves. */
    owned: Ty;
};
export type InferOptions = {
    /** Linear types exist, so a closure may take an owned lens or become linear. */
    linearTypes?: boolean;
    plainBinders?: ReadonlySet<number>;
};
export type TypeEnvironment = ReadonlyMap<string, Scheme>;
/** User-declared type names. Unions are nominal; aliases expand at each use. */
export type TypeDefinition =
    | { kind: 'union'; params: string[]; linear?: boolean }
    | { kind: 'alias'; params: string[]; body: Type };
export type TypeDefinitions = ReadonlyMap<string, TypeDefinition>;
const builtinTypeArity: Record<string, number> = {
    Number: 0,
    Int: 0,
    Bool: 0,
    String: 0,
    World: 0,
    Handle: 0,
    Chan: 1,
    List: 1,
    Vector: 1,
};
export const isBuiltinTypeName = (name: string) => Object.hasOwn(builtinTypeArity, name);
export type Inference = {
    type: Ty;
    scheme: Scheme;
    types: ReadonlyMap<object, FlowTy>;
    bindings: ReadonlyMap<object, BindingRecord>;
    elaboration: Elaboration;
    /** Parameters that are only ever called, once on every path, so they take linear closures. */
    acceptsLinear: ReadonlySet<number>;
};

/** One solver per checked expression/definition; environments contain finalized schemes. */
export class Inferencer {
    readonly solver = new Solver();
    private types = new Map<object, FlowTy>();
    /** The ownership of each expression: shared if it is a plain read or holds one. */
    private modes = new Map<object, Ty>();
    private resultModes = new Map<object, Ty>();
    private bindings = new Map<object, Binding>();
    private builder: ElaborationBuilder;
    private current?: object;
    /** Variable reads that consume a closure exactly once: calls, and accepting arguments. */
    private consumingUses = new Set<string>();
    private rootFunction?: object;
    private rootDeclaration?: Decl;
    private callsOnce = new WeakMap<object, OnceParameters>();
    /**
     * Checks that need every type known. A function can turn out to be one-use after a call
     * that passed it has been checked, when a channel carries it further on.
     */
    private deferred: (() => void)[] = [];
    private globalParameters = new Map<string, { local: number; parameter: string }[]>();
    private constructors: Map<string, Scheme>;
    constructor(
        private globals: TypeEnvironment = new Map(),
        constructors: TypeEnvironment = new Map(),
        context: ElaborationContext = { id: 'unit/expression' },
        private typeDefinitions: TypeDefinitions = new Map(),
        private options: InferOptions = {},
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
                    return [name, { ...scheme, body, quantified }];
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
            case 'record':
                return record(
                    t.fields.map((f) => ({ name: f.name, type: this.replace(f.type, vars) })),
                    t.rest && this.replace(t.rest, vars),
                );
            case 'fn':
                return fn(
                    t.args.map((v) => mapFlow(v, (t) => this.replace(t, vars))),
                    mapFlow(t.result, (t) => this.replace(t, vars)),
                    t.linear,
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
        const initialType = this.get(b, 0);
        const loc = (node as { loc?: number } | undefined)?.loc;
        if (kind === 'local' && loc !== undefined && this.options.plainBinders?.has(loc))
            this.solver.require('Copyable', initialType, loc, [
                'linear-plain',
                `${name} holds a linear value, so it must be declared \`mut\``,
            ]);
        b.id = this.builder.binding({
            name,
            declaration: node ? this.builder.node(node) : undefined,
            definition,
            place: b.root.place!,
            path: [...b.path],
            kind,
            borrow: b.permit?.id,
            initialType,
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
    private replaceAt(type: Ty, path: Step[], value: Ty, loc: number): Ty {
        const [step, ...rest] = path;
        if (step === undefined) return value;
        const p = this.solver.prune(type);
        if (typeof step === 'string') {
            if (p.tag !== 'record' || !p.fields.some((f) => f.name === step))
                return this.error('alias-shape', loc, 'Aliased record shape changed');
            return record(
                p.fields.map((f) =>
                    f.name === step ? { ...f, type: this.replaceAt(f.type, rest, value, loc) } : f,
                ),
                p.rest,
            );
        }
        if (p.tag !== 'tuple' || step >= p.items.length)
            return this.error('alias-shape', loc, 'Aliased tuple shape changed');
        return tuple(
            ...p.items.map((v, i) => (i === step ? this.replaceAt(v, rest, value, loc) : v)),
        );
    }
    private use(node: object, b: Binding, mode: 'value' | 'lens'): void {
        this.bindings.set(node, b);
        this.builder.uses.push({ node: this.builder.node(node), binding: b.id!, mode });
    }
    private instantiate(name: string, scheme: Scheme, node: object, constructor = false): Ty {
        const result = this.solver.instantiateWithArguments(
            scheme,
            false,
            (node as { loc: number }).loc,
        );
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
    private sharedPattern = false;
    private lookup(env: Env, name: string, loc: number): Binding {
        return env.get(name) ?? this.error('unbound-name', loc, `Unbound name ${name}`);
    }
    private overlaps(a: Step[], b: Step[]): boolean {
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
        if (b.root.moved)
            this.error(
                'use-after-move',
                loc,
                'This owned lens has moved to another holder, which now ends it',
            );
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
        return this.at(b.root.type, b.path, loc);
    }
    private at(type: Ty, path: Step[], loc: number): Ty {
        let t = type;
        for (const step of path) {
            const p = this.solver.prune(t);
            if (typeof step === 'string' ? p.tag !== 'record' : p.tag !== 'tuple')
                this.error('alias-shape', loc, 'Aliased value no longer has its original shape');
            t =
                (typeof step === 'string'
                    ? (p as RecordTy).fields.find((f) => f.name === step)?.type
                    : (p as Ty & { tag: 'tuple' }).items[step]) ??
                this.error('alias-shape', loc, 'Aliased component is missing');
        }
        return t;
    }
    private put(b: Binding, value: Ty, loc: number, record = true): void {
        const before = this.state(b.root);
        this.accessible(b, loc);
        if (b.scheme)
            this.error('immutable-definition', loc, 'Reusable definitions cannot be lens targets');
        b.root.callsOnce = undefined;
        b.root.type = this.replaceAt(b.root.type, b.path, value, loc);
        const revisionPath = JSON.stringify(b.path);
        b.root.revisions.set(revisionPath, (b.root.revisions.get(revisionPath) ?? 0) + 1);
        b.root.empty = b.root.empty.filter((path) => !this.overlaps(path, b.path));
        if (record) this.transition('write', b, before);
    }
    private consume(b: Binding, loc: number): Ty {
        if (!b.path.length && b.replaceable) this.requireFlag(b.replaceable, loc, 'move it out');
        const type = this.get(b, loc);
        if (!this.available(b))
            this.error('use-after-move', loc, 'Value has already been consumed');
        this.vacate(b, type, loc);
        return type;
    }
    private vacate(b: Binding, type: Ty, loc: number): void {
        const before = this.state(b.root);
        this.put(b, tuple(), loc, false);
        b.root.empty.push(b.path);
        (b.root.vacated ??= new Map()).set(JSON.stringify(b.path), type);
        this.transition('move', b, before);
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
    private isOwnedLens(b: Binding): boolean {
        return !!b.root.ownedLens && !b.path.length && b.permit === b.root.ownedLens.permit;
    }
    /** The final contents of a lens that is ending, or that already left for another holder. */
    private ending(b: Binding, loc: number): Ty {
        if (b.root.moved) return b.root.type;
        this.restored(b, loc);
        return this.get(b, loc);
    }
    /** An owned lens takes its restore with it, so it must have a value to restore from. */
    private movable(b: Binding, loc: number): void {
        this.accessible(b, loc);
        if (!this.available(b))
            this.error('unrestored-lens', loc, 'An owned lens must hold a value when it moves');
    }
    private declaredLinear = (name: string): boolean => {
        const definition = this.typeDefinitions.get(name);
        return definition?.kind === 'union' && !!definition.linear;
    };
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

    /** Validate a type declaration against the definitions already in scope. */
    typeDeclaration(node: TypeDecl): {
        definition: TypeDefinition;
        constructors: Map<string, Scheme>;
    } {
        const name = node.name.text;
        if (isBuiltinTypeName(name) || this.typeDefinitions.has(name))
            this.error('duplicate-type', node.name.loc, `Type ${name} already exists`);
        const params = new Map<string, Ty>();
        for (const arg of node.args ?? []) {
            if (params.has(arg.text))
                this.error(
                    'duplicate-type-parameter',
                    arg.loc,
                    `Duplicate type parameter ${arg.text}`,
                );
            params.set(arg.text, this.solver.fresh());
        }
        const constructors = new Map<string, Scheme>();
        if (node.type === 'type-alias') {
            // The alias is not yet registered, so a self-reference is an unknown type.
            this.annotation(node.alias, params, true);
            return {
                definition: { kind: 'alias', params: [...params.keys()], body: node.alias },
                constructors,
            };
        }
        const definition: TypeDefinition = {
            kind: 'union',
            params: [...params.keys()],
            ...(node.linear ? { linear: true } : {}),
        };
        const result = plain(con(name, ...params.values()));
        // Unions are nominal, so constructors may refer to the union itself.
        const previous = this.typeDefinitions;
        this.typeDefinitions = new Map(previous).set(name, definition);
        try {
            for (const item of node.items) {
                const constructor = item.name.text;
                if (this.constructors.has(constructor) || constructors.has(constructor))
                    this.error(
                        'duplicate-constructor',
                        item.loc,
                        `Constructor ${constructor} already exists`,
                    );
                const types = (item.args ?? []).map((t) => this.valueAnnotation(t, params, true));
                const args = types.map((t) => reads(t));
                for (const type of types)
                    mapType(type, (t) => {
                        if (t.tag === 'record' && t.rest)
                            this.error(
                                'open-record-in-union',
                                item.loc,
                                'A union constructor cannot hold an open record yet; make the whole record a type parameter',
                            );
                        return undefined;
                    });
                constructors.set(constructor, this.solver.generalize(fn(args, result), []));
            }
        } finally {
            this.typeDefinitions = previous;
        }
        return { definition, constructors };
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
            this.seedOwnership(ast, self);
        }
        this.rootFunction = ast;
        this.rootDeclaration = declaration;
        const type = this.linear(ast, env);
        if (self) this.solver.unify(self, type, ast.loc);
        this.deferred.forEach((check) => check());
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
            // What the body needs a row to lack is part of the contract, as its bounds are.
            const rows = this.solver.rowConstraints(
                contract.quantified.map(
                    (id) => (contractInstance.arguments.get(id) as Ty & { tag: 'rigid' }).id,
                ),
            );
            scheme = rows.length ? { ...contract, rows } : contract;
        }
        this.solver.finishBounds(
            scheme,
            bodyVariables,
            comparableUnions(
                [...this.constructors].map(([name, s]) => ({
                    definition: `constructor/${name}`,
                    type: s.body,
                })),
            ),
            this.declaredLinear,
        );
        const callsOnce = this.callsOnce.get(ast);
        if (callsOnce?.length) scheme.callsOnce = callsOnce;
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
            acceptsLinear: new Set(callsOnce),
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
    /**
     * A self-call sees only a type variable while the body is checked, and an unknown callee
     * borrows. Where the signature says otherwise, give the recursion that shape up front.
     */
    private seedOwnership(n: Linear & { type: 'fn' }, self: Ty): void {
        const owns = n.args.some((a) => a.ownedLens);
        const produces = n.body.type === 'lens' && this.resultOwnership(n) === OWNED_LENS;
        if (!owns && !produces) return;
        const lens = (owned: Ty) =>
            flow(this.solver.fresh(), this.solver.fresh(), this.solver.fresh(), owned);
        const value = () => plain(this.solver.fresh(), this.solver.freshMode());
        this.solver.unify(
            self,
            fn(
                n.args.map((a) =>
                    a.pat.type === 'lens'
                        ? lens(a.ownedLens ? OWNED_LENS : BORROWED_LENS)
                        : value(),
                ),
                n.body.type === 'lens' ? lens(this.resultOwnership(n)) : value(),
            ),
            n.loc,
        );
    }
    /** A lens a function returns is owned exactly when the function borrows no lens. */
    private resultOwnership(n: Linear & { type: 'fn' }): Ty {
        return n.args.some((a) => a.pat.type === 'lens' && !a.ownedLens)
            ? BORROWED_LENS
            : OWNED_LENS;
    }
    /**
     * Resolve a named type. Builtins and declared types win over type variables; in a
     * `closed` scope (type declaration bodies) every variable must already be bound.
     */
    private constr(id: Id, args: Type[], vars: Map<string, Ty>, closed: boolean): FlowTy {
        const arity = (expected: number) => {
            if (args.length !== expected)
                this.error(
                    'type-arity',
                    id.loc,
                    `Type ${id.text} expects ${expected} argument${expected === 1 ? '' : 's'}, found ${args.length}`,
                );
        };
        if (isBuiltinTypeName(id.text)) {
            arity(builtinTypeArity[id.text]);
            const named = con(
                id.text === 'Int' ? 'Number' : id.text,
                ...args.map((t) => this.valueAnnotation(t, vars, closed)),
            );
            this.solver.channels(named);
            return plain(named);
        }
        const definition = this.typeDefinitions.get(id.text);
        if (definition) {
            arity(definition.params.length);
            const values = args.map((t) => this.valueAnnotation(t, vars, closed));
            if (definition.kind === 'union') return plain(con(id.text, ...values));
            // Alias bodies were validated as closed over their parameters at declaration.
            return this.annotation(
                definition.body,
                new Map(definition.params.map((name, i) => [name, values[i]])),
                true,
            );
        }
        if (args.length || !/^[a-z]/.test(id.text) || (closed && !vars.has(id.text)))
            this.error('unknown-type', id.loc, `Unknown type ${id.text}`);
        if (!vars.has(id.text)) vars.set(id.text, this.solver.fresh());
        return plain(vars.get(id.text)!);
    }
    private annotation(t: Type, vars: Map<string, Ty>, closed = false): FlowTy {
        switch (t.type) {
            case 'id': {
                return this.constr(t, [], vars, closed);
            }
            case 'lens': {
                const a = this.valueAnnotation(t.left, vars, closed);
                return flow(
                    a,
                    t.right ? this.valueAnnotation(t.right, vars, closed) : a,
                    t.replaceable === false ? FIXED : REPLACEABLE,
                    t.owned ? OWNED_LENS : BORROWED_LENS,
                );
            }
            case 'constr': {
                return this.constr(t.name, t.args ?? [], vars, closed);
            }
            case 'tuple':
                return plain(tuple(...t.items.map((v) => this.valueAnnotation(v, vars, closed))));
            case 'record': {
                const fields = this.uniqueFields(t.fields, t.loc).map((f) => ({
                    name: f.name,
                    type: this.valueAnnotation(f.type, vars, closed),
                }));
                const rest = !t.rest
                    ? undefined
                    : t.rest.text === '_' && !closed
                      ? this.solver.fresh()
                      : this.valueAnnotation(t.rest, vars, closed);
                return plain(this.solver.row(fields, rest, t.loc));
            }
            case 'fn': {
                const args = t.args.map((v) => this.annotation(v, vars, closed));
                let result = this.annotation(t.body, vars, closed);
                if (result.tag === 'flow') {
                    const borrows = args.some(
                        (a) => a.tag === 'flow' && this.solver.lensOwnership(a.owned) !== 'owned',
                    );
                    // The signature decides it, so a result is only ever written `~A`.
                    result = { ...result, owned: borrows ? BORROWED_LENS : OWNED_LENS };
                }
                return plain(fn(args, result));
            }
        }
    }
    private valueAnnotation(t: Type, vars: Map<string, Ty>, closed = false): Ty {
        const a = this.annotation(t, vars, closed);
        if (a.tag !== 'plain')
            return this.error(
                'mode-mismatch',
                'loc' in t ? t.loc : 0,
                'Lens types are only allowed in function argument/result positions',
            );
        return a.value;
    }
    private uniqueFields<F extends { name: string; loc: number }>(fields: F[], loc: number): F[] {
        const seen = new Set<string>();
        for (const f of fields) {
            if (seen.has(f.name))
                this.error('duplicate-field', f.loc ?? loc, `Duplicate record field ${f.name}`);
            seen.add(f.name);
        }
        return fields;
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
            case 'record': {
                if (source && p.rest)
                    this.error(
                        'unsupported-lens-rest',
                        p.rest.loc,
                        'A lens pattern cannot bind `...rest`; name the fields it focuses',
                    );
                if (p.rest && p.rest.type !== 'id' && p.rest.type !== 'drop')
                    this.error('invalid-rest', p.rest.loc, '`...` takes a name or `_`');
                const fields = this.uniqueFields(p.fields, p.loc).map((f) => ({
                    ...f,
                    type: this.solver.fresh(),
                }));
                const types = fields.map((f) => ({ name: f.name, type: f.type }));
                // The fields the pattern does not name.
                const tail = p.exact ? undefined : this.solver.fresh();
                const matched = this.solver.row(types, tail, p.loc);
                try {
                    this.solver.unify(type, matched, p.loc);
                } catch (e) {
                    if (p.exact && e instanceof TypeDiagnostic && e.code === 'type-mismatch')
                        this.error(
                            'type-mismatch',
                            p.loc,
                            `${e.message}. A borrowed match with constructors rebuilds its records, so a record pattern in it must list every field`,
                        );
                    throw e;
                }
                fields.forEach((f) =>
                    this.pattern(
                        f.pat,
                        f.type,
                        env,
                        source ? { ...source, path: [...source.path, f.name] } : undefined,
                        seen,
                    ),
                );
                if (p.rest) this.pattern(p.rest, tail!, env, undefined, seen);
                else if (tail && !source && !this.sharedPattern)
                    this.dropped(
                        tail,
                        p.loc,
                        'This pattern drops the fields it does not name, so they cannot be linear',
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
    /** A value of this type is discarded here. */
    private dropped(type: Ty, loc: number, message: string): void {
        if (this.options.linearTypes)
            this.solver.require('Droppable', type, loc, ['linear-unconsumed', message]);
    }
    private constructorType(name: string, args: Ty[], result: Ty, loc: number, node: object): void {
        const scheme =
            this.constructors.get(name) ??
            this.error('unknown-constructor', loc, `Unknown constructor ${name}`);
        this.solver.unify(
            this.instantiate(name, scheme, node, true),
            fn(
                args.map((a) => plain(a, this.solver.freshMode())),
                plain(result),
            ),
            loc,
        );
    }
    private modeOf(n: object): Ty {
        return this.modes.get(n) ?? OWNED;
    }
    /**
     * `value` goes into owned storage: an undecided mode (a call whose callee is not known yet)
     * must turn out owned, and a shared one is an error.
     */
    private requireOwned(value: object, loc: number, message: string): void {
        const mode = this.modeOf(value);
        if (this.solver.modeOf(mode) === 'unknown') this.solver.unifyMode(mode, OWNED, loc);
        if (this.solver.modeOf(mode) === 'shared') this.error('shared-into-mut', loc, message);
    }
    /** A value is shared when it is a plain read, or an aggregate or branch that holds one. */
    private expressionMode(n: Linear): Ty {
        const join = (parts: object[]): Ty =>
            parts.some((p) => this.solver.modeOf(this.modeOf(p)) === 'shared') ? SHARED : OWNED;
        switch (n.type) {
            case 'apply':
                return this.resultModes.get(n) ?? OWNED;
            case 'tuple':
            case 'vector':
                return join(n.items);
            case 'constructor':
                return join(n.args);
            case 'record':
                return join(n.fields.map((f) => f.value));
            case 'update':
                return join(n.items.flatMap((i) => (i.value ? [i.value] : [])));
            case 'let':
                return this.modeOf(n.body);
            case 'case':
                return join(n.cases.map((c) => c.body));
            default:
                return OWNED;
        }
    }
    private linear(n: Linear, env: Env): Ty {
        const previous = this.current;
        this.current = n;
        try {
            const t = this.linearInner(n, env);
            if (n.type === 'let') this.callsOnce.set(n, this.callsOnce.get(n.body));
            if (n.type === 'tuple' && n.items.length === 1)
                this.callsOnce.set(n, this.callsOnce.get(n.items[0]!));
            const mode = this.expressionMode(n);
            this.modes.set(n, mode);
            this.record(n, plain(t, mode));
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
                this.callsOnce.set(
                    n,
                    b.scheme?.callsOnce ?? (!b.path.length ? b.root.callsOnce : undefined),
                );
                return b.scheme ? this.instantiate(n.text, b.scheme, n) : this.consume(b, n.loc);
            }
            case 'number':
                return con('Number');
            case 'bool':
                return con('Bool');
            case 'string':
                n.interp.forEach(({ value }) =>
                    this.solver.require('Display', this.linear(value, env), value.loc),
                );
                return con('String');
            case 'tuple':
                return n.items.length === 1
                    ? this.linear(n.items[0], env)
                    : tuple(...n.items.map((v) => this.linear(v, env)));
            case 'record': {
                // Fields evaluate in source order; the type is order-independent.
                this.uniqueFields(n.fields, n.loc);
                return record(
                    n.fields.map((f) => ({ name: f.name, type: this.linear(f.value, env) })),
                );
            }
            case 'update':
                return this.update(n, env);
            case 'constructor': {
                const args = n.args.map((v) => this.linear(v, env)),
                    result = this.solver.fresh();
                this.constructorType(n.name, args, result, n.loc, n);
                return result;
            }
            case 'vector': {
                const element = this.solver.fresh();
                n.items.forEach((v) => this.solver.unify(element, this.linear(v, env), v.loc));
                return con('Vector', element);
            }
            case 'field': {
                const b = this.fieldPlace(n, env);
                this.use(n, b, 'value');
                return this.consume(b, n.loc);
            }
            case 'index':
                return this.error(
                    'index-value',
                    n.loc,
                    'Vector elements are accessed through a lens, e.g. dup(~v[i]) or v[i] := x',
                );
            case 'apply':
                return this.call(n, env, false).read;
            case 'assign': {
                const view = this.lens(n.lens, env);
                this.requireReplaceable(view, n.loc, 'assign to it');
                const states = view.targets.map((b) => this.revision(b));
                const value = this.linear(n.value, env);
                this.requireOwned(
                    n.value,
                    n.value.loc,
                    'A plain (shared) value cannot be assigned into `mut` storage; `dup(x)` it first',
                );
                if (
                    n.lens.type !== 'id' &&
                    n.lens.type !== 'field' &&
                    n.lens.type !== 'tuple' &&
                    view.targets.some((b, i) => this.revision(b) !== states[i])
                )
                    this.error(
                        'alias-conflict',
                        n.loc,
                        'Assignment RHS changes the owner of an active computed lens',
                    );
                const previous = view.read;
                const target =
                    n.lens.type === 'id' ? this.lookup(env, n.lens.text, n.loc) : undefined;
                if (target && !target.path.length) this.callsOnce.set(n, target.root.callsOnce);
                view.put(value);
                if (target && !target.path.length)
                    target.root.callsOnce = this.callsOnce.get(n.value);
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
    /** `r` or `r.a.b` naming storage, as opposed to an expression that makes a new value. */
    private isPlace(n: Linear, env: Env): boolean {
        if (n.type === 'field') return this.isPlace(n.target, env);
        if (n.type !== 'id') return false;
        const b = env.get(n.text);
        return !!b && !b.scheme;
    }
    /**
     * Move a record out of a spread place. Fields may already be empty; the caller requires an
     * operation to remove or replace each of those.
     */
    private takeSpread(n: Linear, env: Env): SpreadValue {
        const b =
            n.type === 'field' ? this.fieldPlace(n, env) : this.lookup(env, (n as Id).text, n.loc);
        this.accessible(b, n.loc);
        const within = (path: Step[]) =>
            path.length > b.path.length && b.path.every((step, i) => path[i] === step);
        if (b.root.empty.some((path) => !within(path) && this.overlaps(path, b.path)))
            this.error('use-after-move', n.loc, 'Value has already been consumed');
        if (!b.path.length && b.replaceable) this.requireFlag(b.replaceable, n.loc, 'move it out');
        const current = this.get(b, n.loc);
        const holes = b.root.empty.filter(within);
        // Restore the moved parts' types, outermost first, to see what the record held.
        let original = current;
        for (const path of [...holes].sort((x, y) => x.length - y.length))
            original = this.replaceAt(
                original,
                path.slice(b.path.length),
                b.root.vacated?.get(JSON.stringify(path)) ?? tuple(),
                n.loc,
            );
        this.use(n, b, 'value');
        this.record(n, plain(current, OWNED));
        this.modes.set(n, OWNED);
        this.vacate(b, current, n.loc);
        return {
            current,
            original,
            holes: new Set(holes.map((path) => path[b.path.length] as string)),
        };
    }
    /**
     * `{...a, x: e, y = e, -z, -w = e}`: the items apply left to right to an empty record.
     * Operands run first, then the spreads that are places are taken, so an operand can move
     * a field out of a record that is about to be spread, if an operation replaces it.
     */
    private update(n: Linear & { type: 'update' }, env: Env): Ty {
        if (!n.items.some((i) => i.kind === 'spread'))
            this.error(
                'record-literal-op',
                n.loc,
                'A record without a spread can only add fields, written `name: value`',
            );
        const values = new Map<RecordItem, SpreadValue>(),
            operands = new Map<RecordItem, Ty>();
        for (const item of n.items) {
            if (item.kind === 'field') {
                if (item.value) operands.set(item, this.linear(item.value, env));
            } else if (!this.isPlace(item.value, env)) {
                const type = this.linear(item.value, env);
                values.set(item, { current: type, original: type, holes: new Set() });
            }
        }
        for (const item of n.items)
            if (item.kind === 'spread' && !values.has(item))
                values.set(item, this.takeSpread(item.value, env));
        const spreads = [...values.keys()];
        const unknown = spreads.filter((item) => {
            const t = this.solver.prune(values.get(item)!.original);
            return t.tag === 'meta' || t.tag === 'rigid' || (t.tag === 'record' && !!t.rest);
        });
        if (spreads.length > 1 && unknown.length > 1)
            this.error(
                'unknown-spread',
                unknown[1]!.loc,
                'Records can be merged only when at most one of them has unknown fields at this point',
            );
        type Field = { type: Ty; current: Ty; hole: boolean };
        const fields = new Map<string, Field>();
        let rest: Ty | undefined;
        const add = (name: string, field: Field, loc: number) => {
            if (fields.has(name))
                this.error('duplicate-field', loc, `Duplicate record field ${name}`);
            if (rest) this.solver.requireLacks(rest, name, loc);
            fields.set(name, field);
        };
        /** Move fields that unification has revealed out of the remainder. */
        const settle = () => {
            const t = rest && this.solver.prune(rest);
            if (t?.tag !== 'record') return;
            for (const f of t.fields)
                fields.set(f.name, { type: f.type, current: f.type, hole: false });
            rest = t.rest;
        };
        const require = (name: string, loc: number): Field => {
            settle();
            if (!fields.has(name)) {
                const tail = rest && this.solver.prune(rest);
                if (tail?.tag !== 'meta')
                    this.error('unknown-field', loc, `Record has no field ${name}`);
                this.requireField(tail!, name, loc);
                settle();
            }
            return fields.get(name)!;
        };
        const drop = (field: Field, loc: number) =>
            this.dropped(
                field.current,
                loc,
                'This operation drops the old field value, so it cannot be linear',
            );
        for (const item of n.items) {
            settle();
            if (item.kind === 'spread') {
                const value = values.get(item)!;
                const t = this.solver.prune(value.original);
                if (t.tag === 'record') {
                    const current = this.solver.prune(value.current) as RecordTy;
                    for (const f of t.fields)
                        add(
                            f.name,
                            {
                                type: f.type,
                                current: current.fields.find((g) => g.name === f.name)!.type,
                                hole: value.holes.has(f.name),
                            },
                            item.loc,
                        );
                }
                const tail = t.tag === 'record' ? t.rest : t;
                if (tail) {
                    // Only one spread has unknown fields, so there is no remainder yet.
                    const row = this.solver.prune(tail);
                    if (row.tag !== 'meta' && row.tag !== 'rigid')
                        this.error(
                            'type-mismatch',
                            item.loc,
                            `Only a record can be spread, found ${printType(this.solver.resolve(row))}`,
                        );
                    this.solver.markRow(row as Ty & { tag: 'meta' | 'rigid' });
                    for (const name of fields.keys()) this.solver.requireLacks(row, name, item.loc);
                    rest = row;
                }
                continue;
            }
            const type = operands.get(item)!;
            if (item.op === 'extend') {
                add(item.name, { type, current: type, hole: false }, item.loc);
                continue;
            }
            const old = require(item.name, item.loc);
            if (item.op === 'update') this.solver.unify(old.type, type, item.loc);
            drop(old, item.loc);
            if (item.op === 'remove') fields.delete(item.name);
            else fields.set(item.name, { type, current: type, hole: false });
        }
        settle();
        for (const [name, field] of fields)
            if (field.hole)
                this.error(
                    'use-after-move',
                    n.loc,
                    `Field ${name} was moved out, so the spread must remove or replace it`,
                );
        return this.solver.row(
            [...fields].map(([name, f]) => ({ name, type: f.type })),
            rest,
            n.loc,
        );
    }
    private lambda(n: Linear & { type: 'fn' }, env: Env): Ty {
        const bound = new Set(n.args.flatMap((a) => names(a.pat)));
        const { values: captures, lenses: borrowed } = captureUses(n.body, bound);
        const sub = new Map(env),
            vars = new Map<string, Ty>();
        const captureRoots: Root[] = [];
        const lensCaptures = new Map<string, Binding>();
        for (const name of borrowed) {
            const b = this.lookup(env, name, n.loc);
            if (b.scheme) continue;
            if (!this.options.linearTypes || !this.isOwnedLens(b))
                this.error(
                    'borrowed-capture',
                    n.loc,
                    `Closure cannot borrow outer binding ${name}`,
                );
            lensCaptures.set(name, b);
        }
        const captureTypes: Ty[] = [];
        // An owned lens is captured whole, by move: the closure now ends it.
        const lensEnds: { captured: Binding; final: Ty }[] = [];
        for (const [name, b] of lensCaptures) {
            this.movable(b, n.loc);
            const type = this.get(b, n.loc),
                final = this.solver.fresh(),
                captured = this.freshBinding(type);
            // Whatever ends the lens in the body is what the producer's cleanup receives.
            this.put(b, final, n.loc);
            b.root.moved = true;
            captured.root.ownedLens = {};
            this.declare(captured, name, n, 'capture');
            this.builder.captures.push({
                node: this.builder.node(n),
                from: b.id!,
                to: captured.id!,
                type,
            });
            this.builder.lensMoves.push({
                node: this.builder.node(n),
                binding: b.id!,
                write: final,
            });
            sub.set(name, captured);
            captureRoots.push(captured.root);
            lensEnds.push({ captured, final });
        }
        for (const name of captures) {
            if (lensCaptures.has(name)) continue;
            const b = this.lookup(env, name, n.loc);
            if (!b.scheme) {
                const once = !b.path.length ? b.root.callsOnce : undefined;
                const type = this.consume(b, n.loc),
                    captured = this.freshBinding(type);
                captured.root.callsOnce = once;
                this.declare(captured, name, n, 'capture');
                this.builder.captures.push({
                    node: this.builder.node(n),
                    from: b.id!,
                    to: captured.id!,
                    type,
                });
                sub.set(name, captured);
                captureRoots.push(captured.root);
                captureTypes.push(type);
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
                const root = this.freshBinding(read),
                    write = this.solver.fresh();
                if (a.ownedLens) root.root.ownedLens = {};
                this.pattern(a.pat.inner, read, sub, root, seen);
                exits.push({ root, read, write });
                type = flow(read, write, REPLACEABLE, a.ownedLens ? OWNED_LENS : BORROWED_LENS);
            } else {
                // A plain parameter's value is not the function's to drop.
                this.sharedPattern = !!a.shared;
                this.pattern(a.pat, read, sub, undefined, seen);
                this.sharedPattern = false;
                type = plain(
                    read,
                    a.shared === undefined ? this.solver.freshMode() : a.shared ? SHARED : OWNED,
                );
            }
            parameters.push(names(a.pat).map((name) => sub.get(name)!.id!));
            parameterPlaces.push(
                a.pat.type === 'lens'
                    ? [exits[exits.length - 1].root.root.place!]
                    : [...new Set(names(a.pat).map((name) => sub.get(name)!.root.place!))],
            );
            if (a.typ) this.solver.unifyFlow(type, this.annotation(a.typ, vars), a.pat.loc, false);
            // A call to a parameter borrows unless its type is known, and a declaration is
            // otherwise only compared after the body. So it speaks first about owned lenses.
            const declared =
                n === this.rootFunction && this.rootDeclaration?.ann.type === 'fn'
                    ? this.rootDeclaration.ann.args[i]
                    : undefined;
            if (declared?.type === 'fn' && declared.args.some((t) => t.type === 'lens' && t.owned))
                this.solver.unifyFlow(type, this.annotation(declared, vars), a.pat.loc, false);
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
        const bodyStart = this.builder.transitions.length,
            branchStart = this.builder.branches.length;
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
            result = flow(read, write, view.replaceable, this.resultOwnership(n));
        } else {
            const value = this.linear(n.body, sub);
            result = plain(value, this.modeOf(n.body));
        }
        exits.forEach((v) => this.solver.unify(v.write, this.ending(v.root, n.loc), n.loc));
        lensEnds.forEach((v) => this.solver.unify(v.final, this.ending(v.captured, n.loc), n.loc));
        if (n.ann) this.solver.unifyFlow(result, this.annotation(n.ann, vars), n.loc, false);
        this.builder.functions.push({
            node: this.builder.node(n),
            parameters,
            parameterPlaces,
            ownedParameters: n.args.map((a) => a.pat.type !== 'lens' && a.shared !== true),
            body: this.builder.node(n.body),
            transitions: [bodyStart, this.builder.transitions.length],
            entry: functionEntry,
            exit: functionRoots.map((r) => this.state(r)),
        });
        if (this.options.linearTypes)
            this.callsOnce.set(n, this.acceptingParameters(n, args, parameters, sub, branchStart));
        const linear =
            !!this.options.linearTypes &&
            (lensEnds.length > 0 ||
                captureTypes.some((t) => isLinear(this.solver.resolve(t), this.declaredLinear)));
        return fn(args, result, linear);
    }
    /**
     * A function parameter takes a linear closure when the body can be seen to consume it:
     * every use calls it or passes it to a parameter that does, and every path has a use.
     */
    private acceptingParameters(
        n: Linear & { type: 'fn' },
        args: FlowTy[],
        parameters: string[][],
        sub: Env,
        branchStart: number,
    ): number[] {
        const accepted: number[] = [];
        n.args.forEach((a, i) => {
            const type = args[i];
            if (a.pat.type !== 'id' || a.shared !== false || type.tag !== 'plain') return;
            if (this.solver.prune(type.value).tag !== 'fn') return;
            const id = parameters[i][0],
                root = sub.get(a.pat.text)!.root;
            const consumed = (s: RawState) => s.empty.some((path) => !path.length);
            if (
                consumed(this.state(root)) &&
                !this.builder.captures.some((c) => c.from === id) &&
                this.builder.uses
                    .filter((u) => u.binding === id)
                    .every((u) => u.mode === 'value' && this.consumingUses.has(u.node)) &&
                this.builder.branches.slice(branchStart).every((branch) => {
                    const agrees = (joined: RawState[], arms: RawState[][]) => {
                        const after = joined.find((s) => s.place === root.place);
                        return (
                            !after ||
                            !consumed(after) ||
                            arms.every((arm) => consumed(arm.find((s) => s.place === root.place)!))
                        );
                    };
                    // A lens branch also runs a cleanup per arm, after its setup.
                    return (
                        agrees(
                            branch.output,
                            branch.arms.map((arm) => arm.output),
                        ) &&
                        (!branch.restored ||
                            agrees(
                                branch.restored,
                                branch.arms.map((arm) => arm.restored!),
                            ))
                    );
                })
            )
                accepted.push(i);
        });
        return accepted;
    }
    /**
     * Resolve `r.a.b` (a variable followed by field names) to a binding at the field's
     * path. A value of unknown type becomes a record with at least that field.
     */
    private fieldPlace(n: (Linear | Lens) & { type: 'field' }, env: Env): Binding {
        const target = n.target;
        const base =
            target.type === 'field'
                ? this.fieldPlace(target, env)
                : target.type === 'id'
                  ? this.lookup(env, target.text, target.loc)
                  : this.error(
                        'field-target',
                        n.loc,
                        'Fields can only be accessed on a variable or another field',
                    );
        if (base.scheme)
            this.error(
                'immutable-definition',
                n.loc,
                'Reusable definitions cannot be field-accessed',
            );
        this.requireField(this.get(base, n.loc), n.name, n.loc);
        const place: Binding = { ...base, id: undefined, path: [...base.path, n.name] };
        this.declare(place, n.name, n, 'projection');
        return place;
    }
    /** Refine `type`, a record or an unknown, until it shows a field `name`. */
    private requireField(type: Ty, name: string, loc: number): void {
        const t = this.solver.prune(type);
        const add = (row: Ty) =>
            this.solver.unify(
                row,
                this.solver.row([{ name, type: this.solver.fresh() }], this.solver.fresh(), loc),
                loc,
            );
        if (t.tag === 'meta') return add(t);
        if (t.tag !== 'record')
            return this.error(
                'unknown-record',
                loc,
                `Cannot access field ${name} on ${printType(this.solver.resolve(t))}, which is not a record`,
            );
        if (t.fields.some((f) => f.name === name)) return;
        const rest = t.rest && this.solver.prune(t.rest);
        if (rest?.tag === 'meta') return add(rest);
        this.error(
            'unknown-field',
            loc,
            `Record has no field ${name} (it has ${t.fields.map((f) => f.name).join(', ') || 'none'})`,
        );
    }
    private alias(n: Lens, env: Env): Binding {
        if (n.type === 'field') return this.fieldPlace(n, env);
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
        if (n.value.type === 'lens' && n.value.lens.type !== 'id' && n.value.lens.type !== 'field')
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
            const alias = {
                ...b,
                permit: borrow,
                replaceable: n.borrowedOwner ? undefined : b.replaceable,
            };
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
                    owned: undefined,
                    holder: undefined,
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
        if (n.mut)
            this.requireOwned(
                n.value,
                n.value.loc,
                'A plain (shared) value cannot initialize a `mut` binding; `dup(x)` it first',
            );
        this.pattern(p, type, sub);
        if (p.type === 'id') sub.get(p.text)!.root.callsOnce = this.callsOnce.get(n.value);
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
                owned: undefined,
                holder: undefined,
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
        // A match over a constructor lens names its scrutinee through a generated alias,
        // which is only matched and restored with the same constructor. A user-written
        // alias keeps the flag, so every whole-value use of it is checked.
        if (!n.borrowedOwner && view.replaceable) focus.replaceable = view.replaceable;
        focus.root.owners = view.provenance ?? view.targets;
        focus.root.protectedOwners = view.targets;
        focus.root.empty = view.empty?.map((p) => [...p]) ?? [];
        const loan: Borrow = { path: [], id: this.builder.borrow() };
        if (view.owned && this.solver.lensOwnership(view.owned) === 'owned' && !n.borrowedOwner)
            focus.root.ownedLens = { permit: loan };
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
            const final = this.ending(focus, n.loc);
            protections.forEach(({ target, borrow }) => target.root.borrows.delete(borrow));
            // The producer's cleanup is checked here wherever the lens ends.
            view.put(final);
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
                owned: undefined,
                holder: undefined,
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
    private lens(n: Lens, env: Env): View {
        const v = this.lensInner(n, env);
        // A lens occurrence has its own replacement metavariable for tooling.
        const write = this.solver.fresh();
        this.record(n, flow(v.read, write, v.replaceable));
        return {
            get read() {
                return v.read;
            },
            replaceable: v.replaceable,
            owned: v.owned,
            holder: v.holder,
            get empty() {
                return v.empty;
            },
            targets: v.targets,
            provenance: v.provenance,
            put: (t) => {
                this.record(n, flow(v.read, write, v.replaceable));
                this.solver.unify(write, t, n.loc);
                v.put(t);
            },
        };
    }
    private lensInner(n: Lens, env: Env): View {
        switch (n.type) {
            case 'field':
            case 'id': {
                const b = this.alias(n, env);
                this.accessible(b, n.loc);
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
                    put: (t) => this.put(b, t, n.loc),
                    targets: [b],
                    replaceable: b.path.length ? undefined : b.replaceable,
                    ...(this.isOwnedLens(b) ? { owned: OWNED_LENS, holder: b } : {}),
                };
            }
            case 'tuple': {
                const views = n.items.map((v) => this.lens(v, env));
                views.forEach((v, i) =>
                    this.requireReplaceable(v, n.items[i].loc, 'use it as a tuple item'),
                );
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
                    put: (t) =>
                        this.components(t, views.length, n.loc).forEach((v, i) => views[i].put(v)),
                };
            }
            case 'apply':
                return this.call(n, env, true);
            case 'index':
                throw new Error('Vector index lenses are expanded before inference');
            case 'let':
                return this.letBody(n, env, true) as View;
            case 'case':
                return this.lensCase(n, env);
            case 'constructor': {
                const views = n.args.map((v) => this.lens(v, env));
                views.forEach((v, i) =>
                    this.requireReplaceable(v, n.args[i].loc, 'nest it in a constructor'),
                );
                // The read side is the constructor applied to the fields' read types. The
                // write side is a second, independent instance applied to their write types.
                const read = this.solver.fresh();
                this.constructorType(
                    n.name,
                    views.map((v) => v.read),
                    read,
                    n.loc,
                    n,
                );
                const scheme = this.constructors.get(n.name)!;
                const writeFields = views.map(() => this.solver.fresh()),
                    write = this.solver.fresh();
                // Recorded as a second instantiation of the same node: the write instance.
                this.solver.unify(
                    this.instantiate(n.name, scheme, n, true),
                    fn(
                        writeFields.map((a) => plain(a, this.solver.freshMode())),
                        plain(write),
                    ),
                    n.loc,
                );
                const targets = views.flatMap((v) => v.targets);
                this.disjoint(targets, n.loc);
                return {
                    read,
                    get empty() {
                        return views.flatMap((v, i) => (v.empty ?? []).map((p) => [i, ...p]));
                    },
                    targets,
                    provenance: views.flatMap((v) => v.provenance ?? v.targets),
                    replaceable: this.constructorCount(n.name) === 1 ? REPLACEABLE : FIXED,
                    put: (t) => {
                        this.solver.unify(t, write, n.loc);
                        views.forEach((v, i) => v.put(writeFields[i]));
                    },
                };
            }
            case 'aslens':
                return this.aslens(n, env);
        }
    }
    /** Operations on the whole value of a lens (`:=`, aliasing, nesting) need it replaceable. */
    private requireReplaceable(view: View, loc: number, what: string): void {
        this.requireFlag(view.replaceable, loc, what);
    }
    private requireFlag(flag: Ty | undefined, loc: number, what: string): void {
        try {
            this.solver.unify(flag ?? REPLACEABLE, REPLACEABLE, loc);
        } catch (e) {
            if (e instanceof TypeDiagnostic && e.code === 'type-mismatch')
                this.error(
                    'not-replaceable',
                    loc,
                    `Cannot ${what}: this lens is built from a constructor of borrowed fields and has no storage for the whole value; match on it instead`,
                );
            throw e;
        }
    }
    /** How many constructors the data type of `name` has (1 means no tag to change). */
    private constructorCount(name: string): number {
        const resultName = (s: Scheme): string | undefined => {
            const body = this.solver.resolve(s.body);
            if (body.tag !== 'fn' || body.result.tag !== 'plain') return undefined;
            const r = body.result.value;
            return r.tag === 'con' ? r.name : undefined;
        };
        const target = resultName(this.constructors.get(name)!);
        let count = 0;
        for (const s of this.constructors.values()) if (resultName(s) === target) count++;
        return count;
    }
    /** No two targets may overlap; with `others`, no target may overlap one of those. */
    private disjoint(targets: Binding[], loc: number, others?: Binding[]): void {
        targets.forEach((a, i) =>
            (others ?? targets.slice(i + 1)).forEach((b) => {
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
        // Match decomposition: lenses are set up before the callee and the ordinary
        // arguments, wherever they are written, in the order they are written.
        const lenses = new Map<number, LensArgument>();
        n.args.forEach((a, i) => {
            if (a.type !== 'lens') return;
            const view = this.lens(a.lens, env);
            for (const earlier of lenses.values())
                this.disjoint(view.targets, n.loc, earlier.view.targets);
            lenses.set(i, {
                source: a.lens,
                view,
                revisions: view.targets.map((b) => this.revision(b)),
                replacement: this.solver.fresh(),
                owned: this.solver.fresh(),
            });
        });
        const callee = this.linear(n.fn, env);
        const signature = this.solver.prune(callee);
        for (const [i, { view }] of lenses) {
            const parameter = signature.tag === 'fn' ? signature.args[i] : undefined;
            if (
                view.holder &&
                parameter?.tag === 'flow' &&
                this.solver.lensOwnership(parameter.owned) === 'owned'
            )
                this.movable(view.holder, n.loc);
        }
        if (n.fn.type === 'id') this.consumingUses.add(this.builder.node(n.fn));
        const global =
            n.fn.type === 'id' && this.bindings.get(n.fn)?.scheme ? n.fn.text : undefined;
        const accepts = this.callsOnce.get(n.fn);
        // A copy of a callable has the same callback contract as its source.
        const copied = global === 'dup' ? lenses.get(0)?.source : undefined;
        const copy = copied?.type === 'id' ? this.lookup(env, copied.text, n.loc) : undefined;
        const copiedOnce = copy && !copy.path.length ? copy.root.callsOnce : undefined;
        const args = n.args.map((a, i) => {
            if (a.type === 'lens') {
                const { view, replacement, owned } = lenses.get(i)!;
                return flow(view.read, replacement, view.replaceable, owned);
            }
            const value = this.linear(a, env);
            if (accepts?.includes(i) && a.type === 'id')
                this.consumingUses.add(this.builder.node(a));
            this.recheckArgument(callee, i, value, accepts, a);
            const passed =
                global === 'chanSend' && i === 1
                    ? this.sent(value)
                    : this.argumentType(callee, i, value, accepts, a);
            return plain(passed, this.solver.freshMode());
        });
        for (const { source, view, revisions } of lenses.values())
            if (
                source.type !== 'id' &&
                source.type !== 'field' &&
                source.type !== 'tuple' &&
                view.targets.some((b, i) => this.revision(b) !== revisions[i])
            )
                this.error(
                    'alias-conflict',
                    n.loc,
                    'Arguments change the owner of an active computed lens',
                );
        const read = this.solver.fresh(),
            write = this.solver.fresh(),
            // Unknown until the callee's result is known (a self-call resolves it from the body).
            replaceable = this.solver.fresh(),
            resultMode = this.solver.freshMode(),
            resultOwned = this.solver.fresh();
        const known = this.solver.prune(callee);
        this.solver.unify(
            callee,
            fn(
                args,
                lensResult ? flow(read, write, replaceable, resultOwned) : plain(read, resultMode),
                known.tag === 'fn' && known.linear,
            ),
            n.loc,
        );
        // A callee that says nothing borrows.
        for (const flag of [
            ...[...lenses.values()].map((l) => l.owned),
            ...(lensResult ? [resultOwned] : []),
        ])
            if (this.solver.lensOwnership(flag) === 'unknown')
                this.solver.unify(flag, BORROWED_LENS, n.loc);
        const borrowed: LensArgument[] = [];
        for (const argument of lenses.values())
            if (this.solver.lensOwnership(argument.owned) === 'owned')
                this.moveLens(n, argument.source, argument.view, argument.replacement);
            else borrowed.push(argument);
        // Lenses end like nested scopes: the last one set up is restored first.
        const restore = () => [...borrowed].reverse().forEach((l) => l.view.put(l.replacement));
        this.resultModes.set(n, (n as { share?: boolean }).share ? SHARED : resultMode);
        n.args.forEach((a, i) => {
            const param = args[i];
            if (a.type === 'lens' || param.tag !== 'plain') return;
            const argument = this.solver.modeOf(this.modeOf(a));
            if (argument === 'shared' && this.solver.ownership(param) === 'unknown')
                // A shared argument can only go to a position that reads: settle an open one.
                this.solver.unifyMode(param.mode, SHARED, a.loc);
            if (this.solver.ownership(param) === 'owned')
                this.requireOwned(
                    a,
                    a.loc,
                    'A plain (shared) value cannot go where a `mut` one is expected; `dup(x)` it first',
                );
        });
        if (!lensResult) {
            restore();
            if (copy && !copy.path.length) {
                copy.root.callsOnce = copiedOnce;
                this.callsOnce.set(n, copiedOnce);
            }
            return { read, put: () => {}, targets: [] };
        }
        // A moved lens is the callee's now, so the result does not hang off the caller's storage.
        return {
            read,
            targets: borrowed.flatMap((l) => l.view.targets),
            provenance: borrowed.flatMap((l) => l.view.provenance ?? l.view.targets),
            replaceable,
            owned: resultOwned,
            put: (t) => {
                this.solver.unify(write, t, n.loc);
                restore();
            },
        };
    }
    private moveLens(n: Linear | Lens, source: Lens, view: View, replacement: Ty): void {
        const loc = (n as { loc: number }).loc;
        if (!view.owned || this.solver.lensOwnership(view.owned) !== 'owned')
            this.error(
                'borrowed-lens-move',
                loc,
                'This lens is borrowed, so it cannot move into a `mut ~` parameter. A lens is owned when it comes from a function that borrows no lens, or is itself a `mut ~` parameter',
            );
        if (view.holder) this.movable(view.holder, loc);
        view.put(replacement);
        if (view.holder) {
            view.holder.root.moved = true;
            this.builder.lensMoves.push({
                node: this.builder.node(source),
                binding: view.holder.id!,
            });
        }
    }
    /** What goes onto a channel: every function in it becomes one-use on the way. */
    private sent(value: Ty): Ty {
        const t = this.solver.prune(value);
        if (t.tag === 'fn') return fn(t.args, t.result, true);
        if (t.tag === 'tuple') return tuple(...t.items.map((v) => this.sent(v)));
        if (t.tag === 'record')
            return record(
                t.fields.map((f) => ({ name: f.name, type: this.sent(f.type) })),
                t.rest,
            );
        if (t.tag === 'con' && t.name !== CHANNEL)
            return con(t.name, ...t.args.map((v) => this.sent(v)));
        return value;
    }
    /**
     * Once everything is inferred, a function that turned out to be linear must still not
     * have been passed where it could be dropped or reused.
     */
    private recheckArgument(
        callee: Ty,
        index: number,
        value: Ty,
        accepts: OnceParameters,
        node: Linear,
    ): void {
        const known = this.solver.prune(callee);
        if (known.tag !== 'fn' || accepts?.includes(index)) return;
        const parameter = known.args[index];
        if (parameter?.tag !== 'plain') return;
        const expected = this.solver.prune(parameter.value);
        if (expected.tag !== 'fn' || expected.linear) return;
        this.deferred.push(() => {
            const argument = this.solver.prune(value);
            if (argument.tag === 'fn' && argument.linear) this.unaccepted(node);
        });
    }
    private unaccepted(node: Linear): never {
        return this.error(
            'linear-unconsumed',
            (node as { loc: number }).loc,
            'This closure must be called exactly once, and the function may drop or reuse it. Take it as a `mut` parameter and call it exactly once on every path',
        );
    }
    /**
     * Unification keeps linear closures apart from ordinary ones. A linear one may still go to
     * a function parameter that is known to consume it.
     */
    private argumentType(
        callee: Ty,
        index: number,
        value: Ty,
        accepts: OnceParameters,
        node: Linear,
    ): Ty {
        const argument = this.solver.prune(value);
        if (argument.tag !== 'fn') return value;
        const known = this.solver.prune(callee);
        if (known.tag !== 'fn') return value;
        const parameter = known.args[index];
        if (parameter?.tag !== 'plain') return value;
        const expected = this.solver.prune(parameter.value);
        // A type variable takes the closure as it is; the definition's drop and copy bounds apply.
        if (expected.tag !== 'fn') return value;
        // Calling a function exactly once is always allowed, so one that need not be may go
        // where one that must be is expected.
        if (expected.linear)
            return argument.linear ? value : fn(argument.args, argument.result, true);
        if (!argument.linear) return value;
        if (!accepts?.includes(index)) this.unaccepted(node);
        return fn(argument.args, argument.result);
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
        const record: (typeof this.builder.temporaryLenses)[number] = {
            node: this.builder.node(n),
            initial: this.builder.node(n.value),
            reconstruction: n.reconstructionPattern && this.builder.node(n.reconstructionPattern),
            temporary: temporary.id!,
            cleanup: this.builder.node(n.body),
            dependencies: [temporary.id!, ...dependencies.map((b) => b.id!)],
            staged: [],
            cleaned: [],
        };
        this.builder.temporaryLenses.push(record);
        const put = (type: Ty) => {
            this.put(temporary, type, n.loc);
            record.staged = [...this.states(env), this.state(temporary.root)];
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
        };
        return {
            read,
            targets: [temporary, ...dependencies],
            provenance: n.reconstructionPattern
                ? [this.lookup(env, n.reconstructionPattern.reconstructionOwner!.text, n.loc)]
                : [],
            put,
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
            empty: Step[][];
            borrows: Set<Borrow>;
            revisions: Map<string, number>;
            moved?: boolean;
            callsOnce?: OnceParameters;
        }[];
        const snapshot = (): Snapshot =>
            roots.map((r) => ({
                type: r.type,
                empty: r.empty.map((p) => [...p]),
                borrows: new Set(r.borrows),
                revisions: new Map(r.revisions),
                moved: r.moved,
                callsOnce: r.callsOnce,
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
                if (states.some((s) => !s[i].moved !== !states[0][i].moved))
                    this.error(
                        'branch-state',
                        n.loc,
                        'Every branch of a lens must move the same owned lenses',
                    );
                return {
                    type,
                    empty,
                    moved: states[0][i].moved,
                    callsOnce: states.map((s) => s[i].callsOnce).reduce(commonOnceParameters),
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
        const replaceable = this.solver.fresh();
        const arms = n.cases.map((arm) => {
            restore(initial);
            const sub = new Map(env);
            this.pattern(arm.pat, scrutinee, sub);
            const start = this.builder.transitions.length;
            const view = this.lens(arm.body, sub);
            this.solver.unify(read, view.read, arm.body.loc);
            this.solver.unifyReplaceable(
                replaceable,
                view.replaceable ?? REPLACEABLE,
                arm.body.loc,
            );
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
            replaceable,
            targets,
            empty: arms.flatMap((a) => a.empty),
            provenance: arms.flatMap((a) => a.view.provenance ?? a.view.targets),
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
            moved: r.moved,
            callsOnce: r.callsOnce,
        }));
        // Per outer place: whether some arm moved it, and whether some arm left it unrestorable.
        const moved = roots.map(() => false),
            unrestorable = roots.map(() => false);
        let joined:
            | {
                  type: Ty;
                  empty: Step[][];
                  revisions: Map<string, number>;
                  callsOnce: OnceParameters;
              }[]
            | undefined;
        for (const branch of n.cases) {
            roots.forEach((r, i) => {
                r.type = initial[i].type;
                r.empty = [...initial[i].empty];
                r.revisions = new Map(initial[i].revisions);
                r.moved = initial[i].moved;
                r.callsOnce = initial[i].callsOnce;
            });
            const sub = new Map(env);
            this.pattern(branch.pat, scrutinee, sub);
            const firstTransition = this.builder.transitions.length;
            this.solver.unify(result, this.linear(branch.body, sub), branch.body.loc);
            // An arm is the scope of what its pattern binds.
            const bound = names(branch.pat).map((name) => sub.get(name)!);
            if (bound.length)
                this.builder.scopes.push({
                    node: this.builder.node(branch.body),
                    bindings: bound.map((b) => b.id!),
                    exit: bound.map((b) => this.state(b.root)),
                });
            roots.forEach((r, i) => {
                if (r.moved) moved[i] = true;
                else if (r.empty.length) unrestorable[i] = true;
            });
            branchRecord.arms.push({
                node: this.builder.node(branch.body),
                output: this.states(env),
                transitions: [firstTransition, this.builder.transitions.length],
            });
            if (!joined)
                joined = roots.map((r) => ({
                    type: r.type,
                    callsOnce: r.callsOnce,
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
                            callsOnce: commonOnceParameters(joined![i].callsOnce, r.callsOnce),
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
            r.callsOnce = joined![i].callsOnce;
            r.empty = joined![i].empty;
            r.revisions = new Map(joined![i].revisions);
            // Moved on one path is moved afterwards; the other paths end it at the branch edge.
            if (moved[i] && unrestorable[i])
                this.error(
                    'unrestored-lens',
                    n.loc,
                    'An owned lens that one branch moves must hold a value in the others',
                );
            r.moved = moved[i] || initial[i].moved;
        });
        branchRecord.output = this.states(env);
        this.builder.branches.push(branchRecord);
        this.callsOnce.set(
            n,
            n.cases.map((arm) => this.callsOnce.get(arm.body)).reduce(commonOnceParameters),
        );
        return result;
    }
}
