import type * as shared from '../backend/imperative/writeback.ts';
import type { Leaf } from './storage.ts';

export { lowerWritebacks, type JoinGroup } from '../backend/imperative/writeback.ts';
export type PendingJoin = shared.PendingJoin<Leaf>;
export type Writeback = shared.Writeback<Leaf>;
export type WriteDestination = shared.WriteDestination<Leaf>;
