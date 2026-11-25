import { captureUses } from './captures.ts';
import { names, type FnArg, type Id, type Lens, type Linear, type Pat, type Term } from './ast.ts';
import { TypeDiagnostic } from './types.ts';

/**
 * Dual mode's binding modes, as a rewrite in front of the checker. A binding is either `mut`
 * (exclusive and lensable, consumed by a read, as in the pure language) or plain (shared and
 * immutable, readable any number of times). Plain is the default; `let mut`, `fn (mut x)`,
 * `~x` parameters, `let x = ~lens` aliases and the names a borrowed `match ~x` binds are `mut`.
 *
 * Reading a plain binding is rewritten to `dup(~x)`, so a shared value is, for now, a deep copy
 * that nothing can tell apart from sharing. The checker, IR and backends see only the pure
 * language. Borrowing or assigning a plain binding is an error. A closure that reads a plain
 * binding captures a copy and rebinds the name plain inside its body.
 */
type Mode = 'plain' | 'mut';
type Scope = ReadonlyMap<string, Mode>;

export type PlainResult = {
    ast: Linear;
    /** Source offsets of the plain binders, for the checks that need their types. */
    plainBinders: Set<number>;
};

const ids = (pat: Pat): Id[] => {
    switch (pat.type) {
        case 'id':
            return [pat];
        case 'tuple':
            return pat.items.flatMap(ids);
        case 'constructor':
            return pat.args.flatMap(ids);
        case 'record':
            return pat.fields.flatMap((f) => ids(f.pat));
        case 'lens':
            return ids(pat.inner);
        default:
            return [];
    }
};

export function desugarPlain(source: Linear): PlainResult {
    const plainBinders = new Set<number>();
    let fresh = 0;
    const bind = (scope: Scope, pat: Pat, mode: Mode): Scope => {
        const next = new Map(scope);
        for (const id of ids(pat)) {
            next.set(id.text, mode);
            if (mode === 'plain') plainBinders.add(id.loc);
        }
        return next;
    };
    /** The binding a field/index place hangs off, if it is one. */
    const rootOf = (n: { type: string }): Id | undefined => {
        let node = n as Linear | Lens;
        while (node.type === 'field' || node.type === 'index') node = node.target;
        return node.type === 'id' ? node : undefined;
    };
    /** A value-position place (`p.x`, `p[i]`) as the lens a share read borrows. */
    const placeOf = (n: Linear | Lens, scope: Scope): Lens => {
        switch (n.type) {
            case 'field':
                return { ...n, target: placeOf(n.target, scope) } as Lens;
            case 'index':
                return {
                    ...n,
                    target: placeOf(n.target, scope),
                    index: term(n.index, scope),
                } as Lens;
            default:
                return n as Lens;
        }
    };
    const copyOf = (place: Lens, loc: number): Linear => ({
        type: 'apply',
        fn: { type: 'id', text: 'dup', loc },
        args: [{ type: 'lens', lens: place }],
        share: true,
        loc,
    });
    const term = (n: Term, scope: Scope): Term =>
        n.type === 'lens' ? { ...n, lens: lens(n.lens, scope) } : linear(n, scope);

    /** A borrowed place: only a `mut` binding can be borrowed; copy a plain one with `dup(x)`. */
    const place = (n: Lens, scope: Scope): void => {
        const root = rootOf(n);
        if (root && scope.get(root.text) === 'plain')
            throw new TypeDiagnostic(
                'plain-lens',
                root.loc,
                `${root.text} is not mut, so it cannot be borrowed or assigned; declare it \`mut\`, or copy it with \`dup(${root.text})\``,
            );
    };

    const letScope = (n: { pat: Pat; value: Term; mut?: boolean }, scope: Scope): Scope => {
        // A named function, or an alias of a lens, is owned and consumed like a pure binding.
        const mode: Mode =
            n.mut ||
            n.value.type === 'lens' ||
            (n.pat.type === 'drop' && n.value.type === 'fn' && n.value.name)
                ? 'mut'
                : 'plain';
        const next = bind(scope, n.pat, mode);
        if (n.pat.type === 'drop' && n.value.type === 'fn' && n.value.name)
            return new Map(next).set(n.value.name, 'mut');
        return next;
    };
    const arm = (value: Term, c: { pat: Pat; mut?: boolean }, scope: Scope): Scope =>
        bind(scope, c.pat, value.type === 'lens' || c.mut ? 'mut' : 'plain');

    const linear = (n: Linear, scope: Scope): Linear => {
        switch (n.type) {
            case 'id':
                return scope.get(n.text) === 'plain' ? copyOf(n, n.loc) : n;
            case 'op':
            case 'number':
            case 'bool':
                return n;
            case 'string':
                return {
                    ...n,
                    interp: n.interp.map((p) => ({ ...p, value: linear(p.value, scope) })),
                };
            case 'tuple':
            case 'vector':
                return { ...n, items: n.items.map((v) => linear(v, scope)) };
            case 'index':
            case 'field': {
                // A place under a plain binding is read as a shared value.
                const root = rootOf(n);
                if (root && scope.get(root.text) === 'plain')
                    return copyOf(placeOf(n, scope), n.loc);
                return n.type === 'index' ? { ...n, index: term(n.index, scope) } : n;
            }
            case 'constructor':
                return { ...n, args: n.args.map((v) => linear(v, scope)) };
            case 'record':
                return {
                    ...n,
                    fields: n.fields.map((f) => ({ ...f, value: linear(f.value, scope) })),
                };
            case 'assign':
                place(n.lens, scope);
                return { ...n, lens: lens(n.lens, scope), value: linear(n.value, scope) };
            case 'apply':
                // `spawn(task)` is the task's own call, run detached: the task is an ordinary
                // closure, so it owns what it captured and the checker's rules for closures
                // (no borrowing, moves consume) are what make it safe to run elsewhere.
                if (
                    n.fn.type === 'id' &&
                    n.fn.text === 'spawn' &&
                    !scope.has('spawn') &&
                    n.args.length === 1 &&
                    n.args[0]!.type !== 'lens'
                )
                    return {
                        type: 'let',
                        pat: { type: 'drop', loc: n.loc },
                        value: {
                            type: 'apply',
                            fn: linear(n.args[0] as Linear, scope),
                            args: [],
                            detached: true,
                            loc: n.loc,
                        },
                        body: { type: 'tuple', items: [], loc: n.loc },
                        loc: n.loc,
                    };
                return application(n, scope);
            case 'fn':
                return closure(n, scope);
            case 'let': {
                return {
                    ...n,
                    value: term(n.value, scope),
                    body: linear(n.body, letScope(n, scope)),
                };
            }
            case 'case':
                return {
                    ...n,
                    value: term(n.value, scope),
                    cases: n.cases.map(({ mut: _, ...c }) => ({
                        ...c,
                        body: linear(c.body, arm(n.value, { ...c, mut: _ }, scope)),
                    })),
                };
        }
    };

    /**
     * `dup(e)` on a value: an owned deep copy of a shared one. Lowered to the same unshared copy a
     * plain read makes internally (a plain read is the `share` flavour of it); source cannot borrow
     * a plain binding, so this is the only way to write it. A non-binding expression is bound to a
     * plain temporary first. A `mut` binding would be moved and then copied, so it must say
     * `dup(~x)`.
     */
    const dupValue = (n: Linear & { type: 'apply' }, scope: Scope): Linear => {
        const arg = n.args[0] as Linear;
        const loc = n.loc;
        const borrow = (name: string, at: number): Linear => ({
            ...n,
            args: [{ type: 'lens', lens: { type: 'id', text: name, loc: at } }],
        });
        if (arg.type === 'id') {
            if (scope.get(arg.text) === 'mut')
                throw new TypeDiagnostic(
                    'dup-of-owned',
                    arg.loc,
                    `${arg.text} is \`mut\`, so \`dup(${arg.text})\` would move it; write \`dup(~${arg.text})\` to copy it`,
                );
            if (scope.get(arg.text) === 'plain') return borrow(arg.text, arg.loc);
        }
        const temporary = `$dup${fresh++}`;
        return {
            type: 'let',
            pat: { type: 'id', text: temporary, loc },
            value: linear(arg, scope),
            body: borrow(temporary, loc),
            loc,
        };
    };

    const application = <T extends Linear | Lens>(n: T & { type: 'apply' }, scope: Scope): T => {
        if (
            n.type === 'apply' &&
            n.fn.type === 'id' &&
            n.fn.text === 'dup' &&
            !scope.has('dup') &&
            n.args.length === 1 &&
            n.args[0].type !== 'lens'
        )
            return dupValue(n as Linear & { type: 'apply' }, scope) as T;
        // A callee is consumed, not copied: closures are affine and cannot be duplicated.
        const fn = n.fn.type === 'id' ? n.fn : linear(n.fn, scope);
        return { ...n, fn, args: n.args.map((a) => term(a, scope)) };
    };

    const closure = (n: Linear & { type: 'fn' }, scope: Scope): Linear => {
        const argMode = (a: FnArg): Mode => (a.mut || a.pat.type === 'lens' ? 'mut' : 'plain');
        let inner = scope;
        for (const a of n.args) inner = bind(inner, a.pat, argMode(a));
        const bound = new Set(n.args.flatMap((a) => names(a.pat)));
        const { values } = captureUses(n.body, bound);
        const captured = [...values].filter((name) => scope.get(name) === 'plain');
        const args = n.args.map(({ mut: _, ...a }, i) => ({
            ...a,
            shared: argMode(n.args[i]) === 'plain',
        }));
        let body = term(n.body, inner);
        const loc = n.loc;
        const temporaries = captured.map((name) => `$plain${fresh++}`);
        // Inside the body the copy is bound plain again, under the original name.
        captured.forEach((name, i) => {
            const rebind = {
                pat: { type: 'id', text: name, loc } as Pat,
                value: { type: 'id', text: temporaries[i], loc } as Term,
            };
            body =
                body.type === 'lens'
                    ? { type: 'lens', lens: { type: 'let', ...rebind, body: body.lens, loc } }
                    : { type: 'let', ...rebind, body, loc };
        });
        let result: Linear = { ...n, args, body };
        captured.forEach((name, i) => {
            const index = captured.length - 1 - i;
            result = {
                type: 'let',
                pat: { type: 'id', text: temporaries[index], loc },
                value: copyOf({ type: 'id', text: captured[index], loc }, loc),
                body: result,
                loc,
            };
        });
        return result;
    };

    const lens = (n: Lens, scope: Scope): Lens => {
        switch (n.type) {
            case 'id':
            case 'field':
                place(n, scope);
                return n;
            case 'index':
                place(n.target, scope);
                return { ...n, index: term(n.index, scope) };
            case 'tuple':
                return { ...n, items: n.items.map((v) => lens(v, scope)) };
            case 'constructor':
                return { ...n, args: n.args.map((v) => lens(v, scope)) };
            case 'apply':
                return application(n, scope);
            case 'aslens':
                // The pattern is an owned temporary that the body consumes.
                return {
                    ...n,
                    value: linear(n.value, scope),
                    body: linear(n.body, bind(scope, n.pat, 'mut')),
                };
            case 'let': {
                return {
                    ...n,
                    value: term(n.value, scope),
                    body: lens(n.body, letScope(n, scope)),
                };
            }
            case 'case':
                return {
                    ...n,
                    value: term(n.value, scope),
                    cases: n.cases.map(({ mut: _, ...c }) => ({
                        ...c,
                        body: lens(c.body, arm(n.value, { ...c, mut: _ }, scope)),
                    })),
                };
        }
    };

    return { ast: linear(source, new Map()), plainBinders };
}
