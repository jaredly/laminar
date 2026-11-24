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
import { lensBranchSamples } from './lens-branch-samples.ts';
import { computedAliases } from './computed-alias-samples.ts';
import { capturedCleanupSamples } from './captured-cleanup-samples.ts';
import { callableJoinSamples } from './callable-join-samples.ts';
import { indirectCallSamples, unconstrainedClosureSamples } from './indirect-call-samples.ts';
import { phase5Samples } from '../c/phase5-samples.ts';
import { backendCorpus } from './corpus.ts';
import { nominalSamples } from './nominal-samples.ts';
import { aslensNominalSamples, borrowedNominalSamples } from './nominal-pattern-samples.ts';
import { stringSamples } from './string-samples.ts';
import { runtimeImportSamples } from './runtime-import-samples.ts';
import { vectorSamples } from './vector-samples.ts';
/** Host I/O samples give their stdin and expected output; others perform no I/O. */
export type ExecutionSample = {
    name: string;
    source: string;
    expected: unknown;
    stdin?: string;
    output?: string;
    /** A file the program writes, checked on every backend. */
    file?: { path: string; bytes: number[] };
};
export const samples: ExecutionSample[] = [
    ...enabledMigrationSamples,
    ...demandSamples,
    ...deferredStorageSamples,
    ...lensStorageJoinSamples,
    ...storageJoinSamples,
    ...aggregateResultSamples,
    ...aggregateJoinSamples,
    ...callableFocusSamples,
    ...callableStorageSamples,
    // Phase 7 runtime data: nominal unions and strings.
    ...backendCorpus,
    ...nominalSamples.map((s) => ({ ...s, name: `nominal: ${s.name}` })),
    ...[...borrowedNominalSamples, ...aslensNominalSamples].map(([name, source, expected]) => ({
        name: `nominal pattern: ${name}`,
        source,
        expected,
    })),
    ...stringSamples.map((s) => ({ ...s, name: `string: ${s.name}` })),
    ...runtimeImportSamples.map((s) => ({ ...s, name: `import: ${s.name}` })),
    ...vectorSamples.map((s) => ({ ...s, name: `vector: ${s.name}` })),
    ...capturedCleanupSamples,
    ...indirectCallSamples,
    ...unconstrainedClosureSamples,
    ...callableJoinSamples,
    ...nativeJoinSamples,
    ...callableResultSamples,
    ...lensResultSamples,
    ...phase5Samples,
    ...computedAliases,
    ...lensBranchSamples,
    ...borrowedPatternSamples.map((s) => ({ ...s, name: `borrowed: ${s.name}` })),
    ...aslensSamples.map((s) => ({ ...s, name: `aslens: ${s.name}` })),
    { name: 'lexical-alias', source: '{let x = 1\n {let y = ~x\n y := y + 1}\n x}', expected: 2 },
    { name: 'empty-swap', source: '{let x = 1\n x := x + 1}', expected: null },
    { name: 'full-swap-order', source: '{let x = 1\n (x := 2, x := 3, x)}', expected: [1, 2, 3] },
    { name: 'nested-swap-order', source: '{let x = 1\n (x := (x := 2), x)}', expected: [2, 1] },
    { name: 'double-division', source: '3 / 2', expected: 1.5 },
    { name: 'nan', source: '0 / 0', expected: { number: 'NaN' } },
    { name: 'infinity', source: '1 / 0', expected: { number: 'Infinity' } },
    { name: 'negative-zero', source: '0 / (0 - 1)', expected: { number: '-0' } },
];
