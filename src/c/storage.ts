import * as shared from '../backend/storage.ts';
import type { Expr } from '../backend/imperative/code.ts';

/** `address`: this leaf is a live read through that pointer, not a snapshot.
 * `lvalue`: the same storage spelled as an lvalue (otherwise `*address`). */
export type Leaf = {
    expression: Expr;
    layout: string;
    address?: Expr;
    lvalue?: Expr;
    /** `address` points into a heap box that data owns, so it outlives the frame. */
    heap?: boolean;
};
export type Data = shared.Data<Leaf>;
export type Cell = shared.Cell<Leaf>;
export type View = shared.View<Leaf>;
export class Storage extends shared.Storage<Leaf> {}
