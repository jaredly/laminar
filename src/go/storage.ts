import * as shared from '../backend/storage.ts';
import type { Expr } from '../backend/imperative/code.ts';

export type Expression = Expr | (() => Expr);
export const expression = (value: Expression): Expr =>
    typeof value === 'function' ? value() : value;
// key distinguishes deferred values without evaluating them during storage joins.
export type Leaf = {
    layout: string;
    address?: Expr;
    constructed?: { name: string; payload: Data };
} & ({ expression: Expr; key?: undefined } | { expression: Expression; key: string });
export type Data = shared.Data<Leaf>;
export type Cell = shared.Cell<Leaf>;
export type View = shared.View<Leaf>;
export class Storage extends shared.Storage<Leaf> {}
