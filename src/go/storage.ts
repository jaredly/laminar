import * as shared from '../backend/storage.ts';

export type Expression = string | (() => string);
export const expression = (value: Expression): string =>
    typeof value === 'string' ? value : value();
// key distinguishes deferred values without evaluating them during storage joins.
export type Leaf = {
    layout: string;
    address?: string;
    constructed?: { name: string; payload: Data };
} & ({ expression: string; key?: undefined } | { expression: Expression; key: string });
export type Data = shared.Data<Leaf>;
export type Cell = shared.Cell<Leaf>;
export type View = shared.View<Leaf>;
export class Storage extends shared.Storage<Leaf> {}
