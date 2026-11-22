import { Declaration, reachableNames } from '../backend/reachable.ts';
import { printGoStatements, type GoFile } from './syntax.ts';

/** Lexical references in generated Go. Literals and comments cannot retain a
 * helper/type merely by spelling its name. This is a conservative package graph,
 * not local-variable usage analysis or printed identifier substitution. */
const tokens = (code: string): string[] =>
    [
        ...code.matchAll(
            /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`[^`]*`|[A-Za-z_]\w*|\./g,
        ),
    ]
        .map((m) => m[0])
        .filter((t) => /^[A-Za-z_]/.test(t) || t === '.');

export function reachableGo(file: GoFile): GoFile {
    const declarations = file.declarations ?? [];
    const functions = file.functions ?? [];
    const name = (s: string | Declaration) =>
        s instanceof Declaration
            ? s.name
            : /^(?:type|const|var|func)\s+([A-Za-z_]\w*)/.exec(s)?.[1];
    const graph = new Map<string, string[]>();
    for (const d of declarations) {
        const n = name(d);
        if (!n) throw Error('Unnamed generated Go declaration');
        graph.set(n, d instanceof Declaration ? [...d.dependencies] : tokens(d));
    }
    for (const f of functions) {
        const n = name(f.signature)!;
        graph.set(n, [
            ...(graph.get(n) ?? []),
            ...tokens(f.signature + '\n' + printGoStatements(f.body).join('\n')),
        ]);
    }
    const roots = ['main', 'init'];
    // Initializers are roots even when their result is unused.
    for (const d of declarations)
        if (d instanceof Declaration ? d.root : /^var\b[\s\S]*=/.test(d)) roots.push(name(d)!);
    const live = reachableNames(graph, roots);
    const keptDeclarations = declarations.filter((d) => live.has(name(d)!));
    const keptFunctions = functions.filter((f) => live.has(name(f.signature)!));
    const used = tokens(
        keptDeclarations.join('\n') +
            '\n' +
            keptFunctions
                .map((f) => f.signature + '\n' + printGoStatements(f.body).join('\n'))
                .join('\n'),
    );
    return {
        ...file,
        declarations: keptDeclarations,
        functions: keptFunctions,
        imports: file.imports?.filter((p) =>
            used.some((t, n) => t === p.split('/').at(-1) && used[n + 1] === '.'),
        ),
    };
}
