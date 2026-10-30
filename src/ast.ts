export type Id = { type: 'id'; text: string; loc: Loc };

// pat w/ debruijn
export type Patd =
    | Idd
    | { type: 'drop'; id: number | null; loc: Loc }
    | { type: 'tuple'; items: Patd[]; loc: Loc }
    | { type: 'constructor'; name: string; args: Patd[]; loc: Loc };
// NOTE: No lenses

export type Pat =
    | Id
    | { type: 'drop'; loc: Loc }
    | { type: 'tuple'; items: Pat[]; loc: Loc }
    | { type: 'constructor'; name: string; args: Pat[]; loc: Loc }
    // | { type: 'list'; items: Pat[]; tail?: Pat; loc: Loc }
    | { type: 'lens'; inner: Pat; loc: Loc };

export type Loc = number;

export type Type =
    | Id
    | { type: 'lens'; left: Type; right?: Type }
    | { type: 'tuple'; items: Type[] }
    | { type: 'fn'; args: Type[]; body: Type };

export type File = FileItem[];
export type FileItem = Linear | Decl;
export type Decl = { type: 'decl'; name: Id; ann: Type; loc: number };

export type Lens =
    | Id
    | { type: 'manual'; frontend: Linear; backend: Linear; loc: Loc }
    | { type: 'aslens'; pat: Pat; value: Linear; body: Linear; loc: Loc }
    | { type: 'let'; pat: Pat; value: Term; body: Lens; loc: Loc }
    | { type: 'apply'; fn: Linear; args: Term[]; loc: Loc }
    | { type: 'tuple'; items: Lens[]; loc: Loc }
    | { type: 'case'; value: Term; cases: { pat: Pat; body: Lens }[]; loc: Loc };
// Note: constructor cannot be a sound lens.

export type Term = Linear | { type: 'lens'; lens: Lens };

export type LinearCase = { pat: Pat; body: Linear };
export type LensCase = { pat: Pat; body: Lens };

export type LinearOps =
    // | { type: 'attr'; attr: string }
    // | { type: 'index'; index: Linear }
    { type: 'apply'; args: Term[] };

export type Op = { type: 'op'; text: string; loc: Loc };
export type FnArg = { pat: Pat; typ?: Type };
export type LinearInterp = { value: Linear; tail: string };

export type Linear =
    | Id
    | Op
    | { type: 'assign'; lens: Lens; value: Linear; loc: Loc }
    | { type: 'const'; value: number | boolean | null; loc: Loc }
    | {
          type: 'string';
          head: string;
          interp: { value: Linear; tail: string }[];
          loc: Loc;
      }
    // unlens???
    | { type: 'let'; pat: Pat; value: Term; body: Linear; loc: Loc }
    | {
          type: 'fn';
          name?: string | null;
          args: FnArg[];
          ann?: Type | null;
          body: Term;
          loc: Loc;
      }
    | { type: 'apply'; fn: Linear; args: Term[]; isLens?: boolean; loc: Loc }
    | { type: 'tuple'; items: Linear[]; loc: Loc }
    | { type: 'constructor'; name: string; args: Linear[]; loc: Loc }
    | { type: 'case'; value: Term; cases: { pat: Pat; body: Linear }[]; loc: Loc };

export type Stmt = Expr | { type: 'let'; pat: Patd; value: Expr; loc: Loc };
// | { type: 'expr'; expr: Expr }
// | { type: 'block'; items: Stmt[] }
// | { type: 'return'; value: Expr; loc: Loc };

export type Idd = { type: 'idd'; text: string; id: number; loc: Loc };

export type Swap = { type: 'swap'; pat: Patd; value: Expr; loc: Loc };
export type Expr =
    | Idd
    | Swap
    | { type: 'block'; block: Stmt[]; result: Expr; cleanup: Swap[]; loc: Loc }
    | { type: 'const'; value: number | boolean | null; loc: Loc }
    | {
          type: 'string';
          head: string;
          interp: { value: Expr; tail: string }[];
          loc: Loc;
      }
    | {
          type: 'fn';
          args: Patd[];
          body: Expr;
          loc: Loc;
      }
    | { type: 'apply'; fn: Expr; args: Expr[]; loc: Loc }
    | { type: 'tuple'; items: Expr[]; loc: Loc }
    | { type: 'constructor'; name: string; args: Expr[]; loc: Loc }
    | { type: 'case'; value: Expr; cases: { pat: Patd; body: Expr }[]; loc: Loc };

export const names = (pat: Pat): string[] => {
    switch (pat.type) {
        case 'id':
            return [pat.text];
        case 'drop':
            return [];
        // case 'list':
        //     return pat.items.flatMap(names).concat(pat.tail ? names(pat.tail) : []);
        case 'tuple':
            return pat.items.flatMap(names);
        case 'constructor':
            return pat.args.flatMap(names);
        case 'lens':
            return names(pat.inner);
    }
};

export const free = (expr: Term | Lens): string[] => {
    switch (expr.type) {
        case 'aslens': {
            const one = free(expr.value);
            const bound = names(expr.pat);
            const two = free(expr.body);
            return one.concat(two.filter((t) => !one.includes(t) && !bound.includes(t)));
        }
        case 'manual': {
            return free(expr.frontend).concat(free(expr.backend));
        }
        case 'string': {
            let res: string[] = [];
            expr.interp.forEach((item) => {
                free(item.value).forEach((name) => {
                    if (!res.includes(name)) res.push(name);
                });
            });
            return res;
        }
        case 'id':
        case 'op':
            return [expr.text];
        case 'const':
            return [];
        case 'let': {
            const one = free(expr.value);
            const bound = names(expr.pat);
            const two = free(expr.body);
            return one.concat(two.filter((t) => !one.includes(t) && !bound.includes(t)));
        }
        case 'case': {
            const res = free(expr.value);
            expr.cases.forEach((kase) => {
                const bound = names(kase.pat);
                free(kase.body)
                    .filter((t) => !bound.includes(t))
                    .forEach((name) => {
                        if (!res.includes(name)) res.push(name);
                    });
            });
            return res;
        }
        // case "additive_product":
        //     throw new Error("not uet");
        case 'tuple':
            return expr.items.flatMap(free);
        // case "ifs":
        //     throw new Error("nop");
        case 'fn': {
            const bound = expr.args.flatMap((arg) => names(arg.pat));
            return free(expr.body).filter((t) => !bound.includes(t));
        }
        case 'apply': {
            return free(expr.fn).concat(expr.args.flatMap(free));
        }
        case 'lens':
            return free(expr.lens);
        case 'constructor': {
            throw new Error('nop');
        }
        case 'assign': {
            return free(expr.value).concat(free(expr.lens));
        }
    }
};

export const patdBinds = (pat: Patd) => {
    switch (pat.type) {
        case 'idd':
            return true;
        case 'drop':
            return false;
        case 'tuple':
            return pat.items.some(patdBinds);
        case 'constructor':
            return pat.args.some(patdBinds);
    }
};
