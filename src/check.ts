import type { Decl, File, Linear } from './ast.ts';
import { linearToExpr, type Scope } from './decompose.ts';
import type { Expr } from './expr.ts';
import { Inferencer, type Inference, type TypeEnvironment } from './infer.ts';
import { builtinTypes, constructorTypes } from './builtins.ts';
import { TypeDiagnostic, type Scheme } from './types.ts';

export type CheckedExpression = Inference & { readonly ast: Linear };

/** Owns persistent definition schemes. A failed check never publishes a definition. */
export class Checker {
    private environment: Map<string, Scheme>;
    private checked = new WeakMap<
        CheckedExpression,
        { ast: Linear; names: string[]; scheme: Scheme }
    >();
    constructor(
        environment: TypeEnvironment = builtinTypes(),
        private constructors: TypeEnvironment = constructorTypes(),
    ) {
        this.environment = structuredClone(new Map(environment));
        this.constructors = structuredClone(new Map(constructors));
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
        const inference = new Inferencer(this.environment, this.constructors).infer(
            ast,
            declaration,
        );
        const result = { ...inference, ast };
        this.checked.set(result, {
            ast: structuredClone(ast),
            names: [...this.environment.keys()],
            scheme: structuredClone(inference.scheme),
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
): {
    expressions: CheckedExpression[];
    ir: Expr[];
    definitions: TypeEnvironment;
} {
    const checker = new Checker(environment, constructors);
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
    return {
        expressions,
        ir: expressions.map((e) => checker.lower(e)),
        definitions: checker.definitions,
    };
}
