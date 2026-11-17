import { readLines } from '../../parser-generator/lexer.ts';
import { grammar } from '../../src/laminar-parser.ts';
import type { Decl, FileItem } from '../../src/ast.ts';
import { Checker } from '../../src/check.ts';
import { lowerTypedProgram } from '../../src/lower-typed.ts';
import type { Elaboration } from '../../src/elaborated.ts';
export function typedProgram(source: string) {
    const checker = new Checker(),
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
        const checked = checker.check(item, declaration);
        elaborations.push(checked.elaboration);
        if (item.type === 'fn' && item.name) checker.publish(checked);
        declaration = undefined;
    }
    return lowerTypedProgram(elaborations);
}
