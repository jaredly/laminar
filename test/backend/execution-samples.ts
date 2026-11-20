/** Shared behavioral corpus; expected results are preserved across the ABI migration. */
import { demandSamples } from './demand-samples.ts';
import { enabledMigrationSamples } from './abi-migration-samples.ts';
import { deferredStorageSamples } from './deferred-storage-samples.ts';
import { lensStorageJoinSamples } from './lens-storage-join-samples.ts';
import { storageJoinSamples } from './storage-join-samples.ts';
import { aggregateResultSamples } from './aggregate-result-samples.ts';
import { aggregateJoinSamples } from './aggregate-join-samples.ts';
import { callableFocusSamples } from './callable-focus-samples.ts';
import { callableStorageSamples } from './callable-storage-samples.ts';
import { lensResultSamples } from './lens-result-samples.ts';
import { callableResultSamples } from './callable-result-samples.ts';
import { nativeJoinSamples } from './native-join-samples.ts';
import { borrowedPatternSamples } from './borrowed-pattern-samples.ts';
import { aslensSamples } from './aslens-samples.ts';
import { manualRestorationSamples } from './manual-restoration-samples.ts';
import { lensBranchSamples } from './lens-branch-samples.ts';
import { computedAliases } from './computed-alias-samples.ts';
import { capturedCleanupSamples } from './captured-cleanup-samples.ts';
import { callableJoinSamples } from './callable-join-samples.ts';
import { indirectCallSamples } from './indirect-call-samples.ts';
import { phase5Samples } from '../c/phase5-samples.ts';
import { backendCorpus } from './corpus.ts';
export const samples = [
    ...enabledMigrationSamples,
    ...demandSamples,
    ...deferredStorageSamples,
    ...lensStorageJoinSamples,
    ...storageJoinSamples,
    ...aggregateResultSamples,
    ...aggregateJoinSamples,
    ...callableFocusSamples,
    ...callableStorageSamples,
    ...backendCorpus.filter((s) => s.phase <= 6),
    ...capturedCleanupSamples,
    ...indirectCallSamples,
    ...callableJoinSamples,
    ...nativeJoinSamples,
    ...callableResultSamples,
    ...lensResultSamples,
    ...phase5Samples,
    ...computedAliases,
    ...lensBranchSamples,
    ...borrowedPatternSamples.map((s) => ({ ...s, name: `borrowed: ${s.name}` })),
    ...aslensSamples.map((s) => ({ ...s, name: `aslens: ${s.name}` })),
    ...manualRestorationSamples.map((s) => ({ ...s, name: `manual: ${s.name}` })),
    { name: 'lexical-alias', source: '{let x = 1\n {let y = ~x\n y := y + 1}\n x}', expected: 2 },
    { name: 'empty-swap', source: '{let x = 1\n x := x + 1}', expected: null },
    { name: 'full-swap-order', source: '{let x = 1\n (x := 2, x := 3, x)}', expected: [1, 2, 3] },
    { name: 'nested-swap-order', source: '{let x = 1\n (x := (x := 2), x)}', expected: [2, 1] },
    { name: 'double-division', source: '3 / 2', expected: 1.5 },
    { name: 'nan', source: '0 / 0', expected: { number: 'NaN' } },
    { name: 'infinity', source: '1 / 0', expected: { number: 'Infinity' } },
    { name: 'negative-zero', source: '0 / (0 - 1)', expected: { number: '-0' } },
];
