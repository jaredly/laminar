export type Id = { type: 'id'; text: string; loc: Loc };
export type Pat =
    | Id
    | { type: 'drop' }
    | { type: 'tuple'; items: Pat[] }
    | { type: 'constructor'; name: string; args: Pat[] }
    | { type: 'lens'; inner: Pat };
export type Loc = number;

export type Type =
    | Id
    | { type: 'lens'; left: Type; right?: Type }
    | { type: 'tuple'; items: Type[] }
    | { type: 'fn'; args: Type[]; body: Type };

export type File = FileItem[];
export type FileItem = Linear | { type: 'decl'; name: Id; ann: Type };

export type Lens =
    | Id
    | { type: 'aslens'; pat: Pat; value: Linear; body: Linear }
    | { type: 'let'; pat: Pat; value: Term; body: Lens }
    | { type: 'apply'; fn: Linear; args: Term[] }
    | { type: 'tuple'; items: Lens[] }
    | { type: 'case'; value: Term; cases: { pat: Pat; body: Lens }[] };

export type Term = Linear | { type: 'lens'; lens: Lens };

export type LinearCase = { pat: Pat; body: Linear };

export type LinearOps =
    // | { type: 'attr'; attr: string }
    // | { type: 'index'; index: Linear }
    { type: 'apply'; args: Linear[] };

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

export const names = (pat: Pat): string[] => {
    switch (pat.type) {
        case 'id':
            return [pat.text];
        case 'drop':
            return [];
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
