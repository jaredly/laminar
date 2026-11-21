import * as shared from '../backend/storage.ts';

export type Leaf = { expression: string; layout: string };
export type Data = shared.Data<Leaf>;
export type Cell = shared.Cell<Leaf>;
export type View = shared.View<Leaf>;
export class Storage extends shared.Storage<Leaf> {}
