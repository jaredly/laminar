import type { Decl, File, Linear } from './ast.ts';
import { linearToExpr, type Scope } from './decompose.ts';
import type { Expr } from './expr.ts';
import { Inferencer, type Inference, type TypeEnvironment } from './infer.ts';
import { builtinTypes, constructorTypes } from './builtins.ts';
import { TypeDiagnostic, type Scheme } from './types.ts';
import { verifyElaboration } from './backend/verify-elaboration.ts';
import type { Elaboration } from './elaborated.ts';
import { importScheme, lowerTypedProgram, lowerTypedUnit } from './lower-typed.ts';
import type { IRScheme, IRUnit, TypedProgram } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';

export type CheckedExpression = Inference & { readonly ast: Linear };

/** Owns persistent definition schemes. A failed check never publishes a definition. */
export class Checker {
    private environment: Map<string, Scheme>;
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
            imports: IRScheme[];
        }
    >();
    constructor(
        environment: TypeEnvironment = builtinTypes(),
        private constructors: TypeEnvironment = constructorTypes(),
        private unitId = 'unit',
    ) {
        this.environment = structuredClone(new Map(environment));
        this.constructors = structuredClone(new Map(constructors));
        for (const name of environment.keys()) this.definitionIds.set(name, `native/${name}`);
    }
    get definitions(): TypeEnvironment {
        return structuredClone(this.environment);
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
        const inference = new Inferencer(this.environment, this.constructors, {
            id,
            definitions: this.definitionIds,
        }).infer(ast, declaration);
        verifyElaboration(inference.elaboration);
        const result = { ...inference, ast: inference.elaboration.source };
        this.checked.set(result, {
            ast: inference.elaboration.source,
            names: [...this.environment.keys()],
            scheme: structuredClone(inference.scheme),
            definitionId: inference.elaboration.id,
            elaboration: inference.elaboration,
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
        return linearToExpr({ scope, counter: { current: 0 } }, stored.ast);
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
        ir: expressions.map((e) => checker.lower(e)),
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
    const imports = [
        ...[...environment].map(([name, scheme]) => importScheme(`native/${name}`, scheme)),
        ...[...constructors].map(([name, scheme]) => importScheme(`constructor/${name}`, scheme)),
    ];
    return {
        program: lowerTypedProgram(
            expressions.map((e) => e.elaboration),
            imports,
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
