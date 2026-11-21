import type { Expr } from './ast.ts';
import * as shared from '../backend/storage.ts';

/** Logical cells over Zig expression trees, so `tidy` can rewrite them. */
export type Leaf = { expression: Expr; layout: string };
export type Data = shared.Data<Leaf>;
export type Cell = shared.Cell<Leaf>;
export type View = shared.View<Leaf>;
export class Storage extends shared.Storage<Leaf> {}
