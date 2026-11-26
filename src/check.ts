import type { Bound } from './constraints.ts';
import { freezeTree } from './elaborated.ts';
import type { Decl, File, Linear, TypeDecl } from './ast.ts';
import { linearToExpr, type Scope } from './decompose.ts';
import type { Expr } from './expr.ts';
import {
    Inferencer,
    type Inference,
    type TypeDefinition,
    type TypeDefinitions,
    type TypeEnvironment,
} from './infer.ts';
import { builtinTypes, constructorTypes } from './builtins.ts';
import { TypeDiagnostic, type Scheme } from './types.ts';
import { desugarRecords } from './desugar-records.ts';
import { verifyElaboration } from './backend/verify-elaboration.ts';
import type { Elaboration, SemanticType } from './elaborated.ts';
import { importScheme, lowerTypedProgram, lowerTypedUnit } from './lower-typed.ts';
import type { IRScheme, IRUnit, TypedProgram } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import { pureMode, type Policy } from './mode.ts';
import { isLinear } from './linear.ts';
import { desugarPlain } from './desugar-plain.ts';

export type CheckedExpression = Inference & { readonly ast: Linear };

/** Owns persistent definition schemes. A failed check never publishes a definition. */
export class Checker {
    private environment: Map<string, Scheme>;
    private constructors: Map<string, Scheme>;
    private types = new Map<string, TypeDefinition>();
    private definitionIds = new Map<string, string>();
    private nextExpression = 0;
    private checked = new WeakMap<
        CheckedExpression,
        {
            ast: Linear;
            names: string[];
            scheme: Scheme;
            definitionId: string;
            elaboration: Elaboration;
            acceptsLinear: ReadonlySet<number>;
            imports: IRScheme[];
        }
    >();
    constructor(
        environment: TypeEnvironment | undefined = undefined,
        constructors: TypeEnvironment = constructorTypes(),
        private unitId = 'unit',
        /** Where the pure and dual languages differ; the checker consults it in later phases. */
        readonly policy: Policy = pureMode,
    ) {
        this.environment = structuredClone(
            new Map(environment ?? builtinTypes(policy.linearTypes)),
        );
        this.constructors = structuredClone(new Map(constructors));
        for (const name of this.environment.keys()) this.definitionIds.set(name, `native/${name}`);
    }
    get definitions(): TypeEnvironment {
        return structuredClone(this.environment);
    }

    /** Constructor schemes, including those introduced by declared unions. */
    get constructorDefinitions(): TypeEnvironment {
        return structuredClone(this.constructors);
    }
    private constructorImports(): IRScheme[] {
        return [...this.constructors].map(([name, scheme]) => {
            const entry = importScheme(`constructor/${name}`, scheme);
            const t = entry.type;
            if (
                t.tag === 'fn' &&
                t.result.tag === 'plain' &&
                t.result.value.tag === 'con' &&
                this.declaredLinear(t.result.value.name)
            )
                entry.linearResult = true;
            return entry;
        });
    }
    /** Typed-IR imports: the natives this checker started with, plus every constructor. */
    get imports(): IRScheme[] {
        return [
            ...[...this.environment]
                .filter(([name]) => this.definitionIds.get(name) === `native/${name}`)
                .map(([name, scheme]) => importScheme(`native/${name}`, scheme)),
            ...this.constructorImports(),
        ];
    }
    /** Per published definition: the parameters that consume a linear closure. */
    private acceptsLinear = new Map<string, ReadonlySet<number>>();
    private declaredLinear = (name: string): boolean => {
        const definition = this.types.get(name);
        return definition?.kind === 'union' && !!definition.linear;
    };

    /** Variables whose values can be discarded along an exit path. */
    private dropRequirements(elaboration: Elaboration): Set<string> {
        const loc = (node: string) => elaboration.nodes.find((n) => n.id === node)?.loc ?? 0;
        const lost = new Set<string>();
        for (const scope of elaboration.scopes) {
            const owned = new Set(
                elaboration.bindings
                    .filter(
                        (b) =>
                            scope.bindings.includes(b.id) && b.kind === 'local' && !b.path.length,
                    )
                    .map((b) => b.place),
            );
            for (const state of scope.exit) {
                if (!owned.has(state.place) || state.empty.some((path) => !path.length)) continue;
                if (isLinear(state.type, this.declaredLinear))
                    throw new TypeDiagnostic(
                        'linear-unconsumed',
                        loc(scope.node),
                        'A linear value must be consumed before its scope ends',
                    );
                // Left behind here, so it cannot turn out to be linear where this is used.
                variables(state.type).forEach((id) => lost.add(id));
            }
        }
        // `_` drops what it matches.
        for (const node of elaboration.nodes) {
            if (node.kind !== 'drop' || node.type?.tag !== 'plain') continue;
            if (isLinear(node.type.value, this.declaredLinear))
                throw new TypeDiagnostic(
                    'linear-unconsumed',
                    node.loc ?? 0,
                    '`_` drops a linear value; bind it and consume it',
                );
            variables(node.type.value).forEach((id) => lost.add(id));
        }
        // Consumed on one path is not consumed on all of them.
        for (const branch of elaboration.branches) {
            if (branch.restored) continue;
            for (const after of branch.output)
                for (const arm of branch.arms) {
                    const state = arm.output.find((s) => s.place === after.place)!;
                    for (const path of after.empty) {
                        if (state.empty.some((p) => p.every((v, i) => path[i] === v))) continue;
                        const type = project(state.type, path);
                        if (!type) continue;
                        variables(type).forEach((id) => lost.add(id));
                        if (isLinear(type, this.declaredLinear))
                            throw new TypeDiagnostic(
                                'linear-unconsumed',
                                loc(branch.node),
                                'A linear value consumed by one branch must be consumed by all of them',
                            );
                    }
                }
        }
        // A closure that is not linear may be dropped, so what it holds must not be.
        for (const capture of elaboration.captures) {
            const closure = elaboration.nodes.find((n) => n.id === capture.node)?.type;
            if (closure?.tag !== 'plain' || closure.value.tag !== 'fn' || closure.value.linear)
                continue;
            if (isLinear(capture.type, this.declaredLinear))
                throw new TypeDiagnostic(
                    'linear-unconsumed',
                    loc(capture.node),
                    'This closure holds a linear value that was only known to be linear after the closure was checked; annotate its type',
                );
            variables(capture.type).forEach((id) => lost.add(id));
        }
        // A parameter the function owns and never consumes is dropped, so it cannot be linear:
        // a concrete linear type is an error here, and a type variable is bound like a copy's.

        for (const f of elaboration.functions) {
            const owned = new Set(f.parameterPlaces.filter((_, i) => f.ownedParameters[i]).flat());
            for (const state of f.exit) {
                if (!owned.has(state.place) || state.empty.some((path) => path.length === 0))
                    continue;
                if (isLinear(state.type, this.declaredLinear))
                    throw new TypeDiagnostic(
                        'linear-unconsumed',
                        loc(f.node),
                        'A linear parameter must be consumed before the function ends',
                    );
                variables(state.type).forEach((id) => lost.add(id));
            }
        }
        return lost;
    }

    get typeDefinitions(): TypeDefinitions {
        return structuredClone(this.types);
    }

    /** Declare a type alias or union. A failed declaration publishes nothing. */
    addType(node: TypeDecl): void {
        if (node.linear && !this.policy.linearTypes)
            throw new TypeDiagnostic('dual-only', node.loc, '`type linear` needs dual mode');
        if (node.linear && node.type === 'type-alias')
            throw new TypeDiagnostic(
                'linear-alias',
                node.loc,
                'A linear type must be a union: an alias is transparent, so it cannot keep its own linearity',
            );
        const { definition, constructors } = new Inferencer(
            this.environment,
            this.constructors,
            undefined,
            this.types,
        ).typeDeclaration(node);
        if (this.policy.linearTypes && !node.linear)
            for (const scheme of constructors.values())
                if (
                    scheme.body.tag === 'fn' &&
                    scheme.body.args.some(
                        (a) => a.tag === 'plain' && isLinear(a.value, this.declaredLinear),
                    )
                )
                    throw new TypeDiagnostic(
                        'linear-field',
                        node.loc,
                        `Type ${node.name.text} holds a linear value, so it must be declared \`type linear ${node.name.text}\``,
                    );
        this.types.set(node.name.text, definition);
        for (const [name, scheme] of constructors) this.constructors.set(name, scheme);
    }

    check(ast: Linear, declaration?: Decl): CheckedExpression {
        if (ast.type === 'fn' && ast.name && this.environment.has(ast.name))
            throw new TypeDiagnostic(
                'duplicate-definition',
                ast.loc,
                `Definition ${ast.name} already exists`,
            );
        const id =
            ast.type === 'fn' && ast.name
                ? `${this.unitId}/definition/${encodeURIComponent(ast.name)}`
                : `${this.unitId}/expression/${this.nextExpression++}`;
        let plainBinders = new Set<number>();
        if (this.policy.plainBindings) ({ ast, plainBinders } = desugarPlain(ast));
        else {
            const mut = findMut(ast);
            if (mut !== undefined)
                throw new TypeDiagnostic('dual-only', mut, '`mut` needs dual mode');
        }
        const inference = new Inferencer(
            this.environment,
            this.constructors,
            { id, definitions: this.definitionIds },
            this.types,
            {
                linearTypes: this.policy.linearTypes,
                plainBinders,
                acceptsLinear: this.acceptsLinear,
            },
        ).infer(ast, declaration);
        verifyElaboration(inference.elaboration);
        const bounds: Bound[] = [...(inference.scheme.bounds ?? [])];
        if (this.policy.linearTypes) {
            const lost = this.dropRequirements(inference.elaboration);
            inference.elaboration.signature.quantified.forEach((id, parameter) => {
                if (
                    lost.has(id) &&
                    !bounds.some((b) => b.parameter === parameter && b.predicate === 'Droppable')
                )
                    bounds.unshift({ predicate: 'Droppable', parameter });
            });
        }
        const scheme = bounds.length ? { ...inference.scheme, bounds } : inference.scheme;
        const elaboration = bounds.length
            ? freezeTree({
                  ...inference.elaboration,
                  signature: {
                      ...inference.elaboration.signature,
                      bounds: structuredClone(bounds),
                  },
              })
            : inference.elaboration;
        const result = { ...inference, scheme, elaboration, ast: elaboration.source };
        this.checked.set(result, {
            ast: inference.elaboration.source,
            names: [...this.environment.keys()],
            scheme: structuredClone(scheme),
            definitionId: inference.elaboration.id,
            elaboration,
            acceptsLinear: inference.acceptsLinear,
            imports: [
                ...[...this.environment].map(([name, scheme]) =>
                    importScheme(this.definitionIds.get(name)!, scheme),
                ),
                ...this.constructorImports(),
            ],
        });
        return result;
    }
    lower(expression: CheckedExpression): Expr {
        const stored = this.checked.get(expression);
        if (!stored) throw new Error('Expression was not checked by this checker');
        const scope: Scope = Object.fromEntries(
            stored.names.map((name) => [name, { type: 'builtin' }]),
        );
        if (stored.ast.type === 'fn' && stored.ast.name)
            scope[stored.ast.name] = { type: 'builtin' };
        return linearToExpr({ scope, counter: { current: 0 } }, desugarRecords(stored.ast));
    }
    lowerTyped(expression: CheckedExpression): IRUnit {
        const stored = this.checked.get(expression);
        if (!stored) throw new Error('Expression was not checked by this checker');
        const unit = lowerTypedUnit(stored.elaboration);
        verifyTypedProgram({ schemaVersion: 1, imports: stored.imports, units: [unit] });
        return unit;
    }
    publish(expression: CheckedExpression): void {
        const stored = this.checked.get(expression);
        if (!stored || stored.ast.type !== 'fn' || !stored.ast.name)
            throw new Error('Expected an owned checked definition');
        if (this.environment.has(stored.ast.name))
            throw new TypeDiagnostic(
                'duplicate-definition',
                stored.ast.loc,
                `Definition ${stored.ast.name} already exists`,
            );
        this.environment.set(stored.ast.name, structuredClone(stored.scheme));
        this.definitionIds.set(stored.ast.name, stored.definitionId);
        this.acceptsLinear.set(stored.definitionId, stored.acceptsLinear);
    }
    define(
        ast: Linear & { type: 'fn' },
        declaration?: Decl,
    ): { checked: CheckedExpression; ir: Expr } {
        if (!ast.name)
            throw new TypeDiagnostic('unnamed-definition', ast.loc, 'Definition needs a name');
        const checked = this.check(ast, declaration);
        const ir = this.lower(checked);
        this.publish(checked);
        return { checked, ir };
    }
}

/** Check the entire source file before decomposing any item. */
export function checkFile(
    file: File,
    environment: TypeEnvironment = builtinTypes(),
    constructors: TypeEnvironment = constructorTypes(),
    unitId = 'unit',
): {
    expressions: CheckedExpression[];
    ir: Expr[];
    definitions: TypeEnvironment;
} {
    const { checker, expressions } = checkItems(file, environment, constructors, unitId);
    return {
        expressions,
        // Lowered on demand: the legacy decomposition cannot express every checked program.
        get ir() {
            return expressions.map((e) => checker.lower(e));
        },
        definitions: checker.definitions,
    };
}

/** Checked, verified generic IR, with no legacy decomposition or source re-inference. */
export function checkTypedFile(
    file: File,
    environment: TypeEnvironment = builtinTypes(),
    constructors: TypeEnvironment = constructorTypes(),
    unitId = 'unit',
): { program: TypedProgram; definitions: TypeEnvironment } {
    const { checker, expressions } = checkItems(file, environment, constructors, unitId);
    return {
        program: lowerTypedProgram(
            expressions.map((e) => e.elaboration),
            checker.imports,
        ),
        definitions: checker.definitions,
    };
}

function checkItems(
    file: File,
    environment: TypeEnvironment,
    constructors: TypeEnvironment,
    unitId: string,
): { checker: Checker; expressions: CheckedExpression[] } {
    const checker = new Checker(environment, constructors, unitId);
    const expressions: CheckedExpression[] = [];
    let declaration: Decl | undefined;
    for (const item of file) {
        if (item.type === 'decl') {
            if (declaration)
                throw new TypeDiagnostic(
                    'orphan-declaration',
                    declaration.loc,
                    'Declaration has no implementation',
                );
            declaration = item;
            continue;
        }
        if (item.type === 'type-alias' || item.type === 'union') {
            if (declaration)
                throw new TypeDiagnostic(
                    'orphan-declaration',
                    declaration.loc,
                    'Declaration has no implementation',
                );
            checker.addType(item);
            continue;
        }
        const checked = checker.check(item, declaration);
        expressions.push(checked);
        if (item.type === 'fn' && item.name) checker.publish(checked);
        declaration = undefined;
    }
    if (declaration)
        throw new TypeDiagnostic(
            'orphan-declaration',
            declaration.loc,
            'Declaration has no implementation',
        );
    return { checker, expressions };
}

/** The offset of the first `mut` in a tree, which only dual mode accepts. */
function findMut(tree: unknown): number | undefined {
    if (!tree || typeof tree !== 'object') return undefined;
    if (Array.isArray(tree)) return tree.map(findMut).find((loc) => loc !== undefined);
    const node = tree as { mut?: boolean; loc?: number; pat?: { loc?: number } };
    if (node.mut === true) return node.loc ?? node.pat?.loc ?? 0;
    return Object.values(node)
        .map(findMut)
        .find((loc) => loc !== undefined);
}

function project(type: SemanticType, path: number[]): SemanticType | undefined {
    if (!path.length) return type;
    const items =
        type.tag === 'tuple'
            ? type.items
            : type.tag === 'record'
              ? type.fields.map((f) => f.type)
              : undefined;
    const item = items?.[path[0]];
    return item && project(item, path.slice(1));
}

function variables(type: SemanticType): string[] {
    switch (type.tag) {
        case 'variable':
            return [type.id];
        case 'con':
            // Holding a channel holds nothing of what it carries.
            return type.name === 'Chan' ? [] : type.args.flatMap(variables);
        case 'tuple':
            return type.items.flatMap(variables);
        case 'record':
            return type.fields.flatMap((f) => variables(f.type));
        case 'fn':
            return [];
    }
}
