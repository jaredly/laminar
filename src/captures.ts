import { itemValues, names, type Linear, type Lens, type Pat, type Term } from './ast.ts';

/** Preserve value/lens positions through nested calls; a lens callee is still a value use. */
export function captureUses(body: Term, bound: Set<string>) {
    const values = new Set<string>(),
        lenses = new Set<string>();
    const bind = (scope: Set<string>, pat: Pat) => new Set([...scope, ...names(pat)]);
    const use = (name: string, scope: Set<string>, lens: boolean) => {
        if (!scope.has(name)) (lens ? lenses : values).add(name);
    };
    const letScope = (n: (Linear | Lens) & { type: 'let' }, scope: Set<string>) => {
        term(n.value, scope);
        return n.pat.type === 'drop' && n.value.type === 'fn' && n.value.name
            ? new Set([...scope, n.value.name])
            : bind(scope, n.pat);
    };
    const term = (n: Term, scope: Set<string>): void => {
        if (n.type === 'lens') lens(n.lens, scope);
        else linear(n, scope);
    };
    const linear = (n: Linear, scope: Set<string>): void => {
        switch (n.type) {
            case 'id':
            case 'op':
                use(n.text, scope, false);
                return;
            case 'number':
            case 'bool':
                return;
            case 'string':
                n.interp.forEach((v) => linear(v.value, scope));
                return;
            case 'tuple':
            case 'vector':
                n.items.forEach((v) => linear(v, scope));
                return;
            case 'index':
                linear(n.target, scope);
                term(n.index, scope);
                return;
            case 'field':
                linear(n.target, scope);
                return;
            case 'constructor':
                n.args.forEach((v) => linear(v, scope));
                return;
            case 'record':
                n.fields.forEach((f) => linear(f.value, scope));
                return;
            case 'update':
                itemValues(n.items).forEach((v) => linear(v, scope));
                return;
            case 'assign':
                lens(n.lens, scope);
                linear(n.value, scope);
                return;
            case 'apply':
                linear(n.fn, scope);
                n.args.forEach((v) => term(v, scope));
                return;
            case 'fn':
                term(n.body, new Set([...scope, ...n.args.flatMap((a) => names(a.pat))]));
                return;
            case 'let':
                linear(n.body, letScope(n, scope));
                return;
            case 'case':
                term(n.value, scope);
                n.cases.forEach((c) => linear(c.body, bind(scope, c.pat)));
                return;
        }
    };
    const lens = (n: Lens, scope: Set<string>): void => {
        switch (n.type) {
            case 'id':
                use(n.text, scope, true);
                return;
            case 'tuple':
                n.items.forEach((v) => lens(v, scope));
                return;
            case 'index':
                lens(n.target, scope);
                term(n.index, scope);
                return;
            case 'field':
                lens(n.target, scope);
                return;
            case 'apply':
                linear(n.fn, scope);
                n.args.forEach((v) => term(v, scope));
                return;
            case 'aslens':
                linear(n.value, scope);
                linear(n.body, bind(scope, n.pat));
                return;
            case 'let':
                lens(n.body, letScope(n, scope));
                return;
            case 'case':
                term(n.value, scope);
                n.cases.forEach((c) => lens(c.body, bind(scope, c.pat)));
                return;
        }
    };
    term(body, bound);
    return { values, lenses };
}
