import * as shared from '../backend/storage.ts';
import type { Expr } from '../backend/imperative/code.ts';

export type Leaf = { expression: Expr; layout: string };
export type Data = shared.Data<Leaf>;
export type Cell = shared.Cell<Leaf>;
export type View = shared.View<Leaf>;
export class Storage extends shared.Storage<Leaf> {}
