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
            /** Type variables that must not be instantiated at a linear type. */
            copyBounds: Set<string>;
            imports: IRScheme[];
        }
    >();
    constructor(
        environment: TypeEnvironment = builtinTypes(),
        constructors: TypeEnvironment = constructorTypes(),
        private unitId = 'unit',
        /** Where the pure and dual languages differ; the checker consults it in later phases. */
        readonly policy: Policy = pureMode,
    ) {
        this.environment = structuredClone(new Map(environment));
        this.constructors = structuredClone(new Map(constructors));
        for (const name of environment.keys()) this.definitionIds.set(name, `native/${name}`);
    }
    get definitions(): TypeEnvironment {
        return structuredClone(this.environment);
    }

    /** Constructor schemes, including those introduced by declared unions. */
    get constructorDefinitions(): TypeEnvironment {
        return structuredClone(this.constructors);
    }
    /** Typed-IR imports: the natives this checker started with, plus every constructor. */
    get imports(): IRScheme[] {
        return [
            ...[...this.environment]
                .filter(([name]) => this.definitionIds.get(name) === `native/${name}`)
                .map(([name, scheme]) => importScheme(`native/${name}`, scheme)),
            ...[...this.constructors].map(([name, scheme]) =>
                importScheme(`constructor/${name}`, scheme),
            ),
        ];
    }
    /** Per published definition: the type variables its plain bindings and `dup`s copy. */
    private copyBounds = new Map<string, Set<string>>();
    private declaredLinear = (name: string): boolean => {
        const definition = this.types.get(name);
        return definition?.kind === 'union' && !!definition.linear;
    };

    /** Dual mode: a linear value is neither copied nor left unconsumed at the end of its scope. */
    private checkLinear(elaboration: Elaboration, plainBinders: Set<number>): Set<string> {
        const loc = (node: string) => elaboration.nodes.find((n) => n.id === node)?.loc ?? 0;
        for (const b of elaboration.bindings)
            if (
                b.kind === 'local' &&
                b.declaration &&
                plainBinders.has(loc(b.declaration)) &&
                isLinear(b.initialType, this.declaredLinear)
            )
                throw new TypeDiagnostic(
                    'linear-plain',
                    loc(b.declaration),
                    `${b.name} holds a linear value, so it must be declared \`mut\``,
                );
        // Type variables whose values this definition copies, so they cannot be linear.
        const copied = new Set<string>();
        const copy = (type: SemanticType, what: string, node: string) => {
            if (isLinear(type, this.declaredLinear))
                throw new TypeDiagnostic(
                    'dup-linear',
                    loc(node),
                    `${what} cannot copy a linear value`,
                );
            variables(type).forEach((id) => copied.add(id));
        };
        for (const b of elaboration.bindings)
            if (b.kind === 'local' && b.declaration && plainBinders.has(loc(b.declaration)))
                variables(b.initialType).forEach((id) => copied.add(id));
        for (const inst of elaboration.instantiations) {
            if (inst.definition === 'native/dup' && inst.type.tag === 'fn') {
                const argument = inst.type.args[0];
                const read = argument?.tag === 'flow' ? argument.read : argument?.value;
                if (read) copy(read, 'dup', inst.node);
                continue;
            }
            const bounds = this.copyBounds.get(inst.definition);
            if (!bounds) continue;
            const name = decodeURIComponent(inst.definition.split('/').at(-1)!);
            for (const argument of inst.arguments)
                if (bounds.has(argument.parameter))
                    copy(
                        argument.type,
                        `${name} (its plain bindings are copied, so it)`,
                        inst.node,
                    );
        }
        for (const scope of elaboration.scopes) {
            const owned = new Set(
                elaboration.bindings
                    .filter(
                        (b) =>
                            scope.bindings.includes(b.id) && b.kind === 'local' && !b.path.length,
                    )
                    .map((b) => b.place),
            );
            if (
                scope.exit.some(
                    (state) => owned.has(state.place) && isLinear(state.type, this.declaredLinear),
                )
            )
                throw new TypeDiagnostic(
                    'linear-unconsumed',
                    loc(scope.node),
                    'A linear value must be consumed before its scope ends',
                );
        }
        return new Set([...copied].filter((id) => elaboration.signature.quantified.includes(id)));
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
        ).infer(ast, declaration);
        verifyElaboration(inference.elaboration);
        const copyBounds = this.policy.linearTypes
            ? this.checkLinear(inference.elaboration, plainBinders)
            : new Set<string>();
        const result = { ...inference, ast: inference.elaboration.source };
        this.checked.set(result, {
            ast: inference.elaboration.source,
            names: [...this.environment.keys()],
            scheme: structuredClone(inference.scheme),
            definitionId: inference.elaboration.id,
            elaboration: inference.elaboration,
            copyBounds,
            imports: [
                ...[...this.environment].map(([name, scheme]) =>
                    importScheme(this.definitionIds.get(name)!, scheme),
                ),
                ...[...this.constructors].map(([name, scheme]) =>
                    importScheme(`constructor/${name}`, scheme),
                ),
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
        this.copyBounds.set(stored.definitionId, stored.copyBounds);
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

/** Every type variable in a type. */
function variables(type: SemanticType): string[] {
    switch (type.tag) {
        case 'variable':
            return [type.id];
        case 'con':
            return type.args.flatMap(variables);
        case 'tuple':
            return type.items.flatMap(variables);
        case 'record':
            return type.fields.flatMap((f) => variables(f.type));
        case 'fn':
            return [];
    }
}
