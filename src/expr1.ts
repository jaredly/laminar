import { Loc } from './ast.ts';

// pat w/ debruijn

export type Patd =
    | Idd
    | { type: 'bool'; value: boolean; loc: Loc }
    | { type: 'number'; value: number; loc: Loc }
    | { type: 'drop'; id: number | null; loc: Loc }
    | { type: 'tuple'; items: Patd[]; loc: Loc }
    | { type: 'string'; text: string; loc: Loc }
    | { type: 'constructor'; name: string; args: Patd[]; loc: Loc };
// NOTE: No lenses
export type Stmt = Expr | { type: 'let'; pat: Patd; value: Expr; loc: Loc; point?: true };
export type Idd = { type: 'idd'; text: string; id: number; loc: Loc };
export type Swap = { type: 'swap'; pat: Patd; value: Expr; loc: Loc };
export type Expr =
    | Idd
    | Swap
    // | { type: 'addr'; inner: Expr; loc: Loc }
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
