import { readLines } from '../../parser-generator/lexer.ts';
import { grammar } from '../../src/laminar-parser.ts';
import type { Decl, FileItem } from '../../src/ast.ts';
import { Checker } from '../../src/check.ts';
import { lowerTypedProgram } from '../../src/lower-typed.ts';
import type { Elaboration } from '../../src/elaborated.ts';
import type { TypeEnvironment } from '../../src/infer.ts';
import { declaredMode, policyFor } from '../../src/mode.ts';
export function typedProgram(
    source: string,
    opts?: { environment?: TypeEnvironment; constructors?: TypeEnvironment },
) {
    // A `// laminar: dual` pragma selects the dual language, as it does for the compiler.
    const declared = declaredMode(source);
    const checker = new Checker(
            opts?.environment,
            opts?.constructors,
            undefined,
            typeof declared === 'string' ? policyFor(declared) : undefined,
        ),
        elaborations: Elaboration[] = [];
    let declaration: Decl | undefined;
    for (const node of readLines(source).nodes) {
        const parsed = grammar.parse<FileItem>('FileItem', node);
        if (parsed.type === 'failure') throw Error('Parse failure');
        const item = parsed.value;
        if (item.type === 'decl') {
            declaration = item;
            continue;
        }
        if (item.type === 'type-alias' || item.type === 'union') {
            checker.addType(item);
            continue;
        }
        const checked = checker.check(item, declaration);
        elaborations.push(checked.elaboration);
        if (item.type === 'fn' && item.name) checker.publish(checked);
        declaration = undefined;
    }
    return lowerTypedProgram(elaborations, checker.imports);
}
