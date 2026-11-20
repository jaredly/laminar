import { targetConfig, type TargetConfig } from '../backend/target.ts';

/**
 * Stopgap Zig target until `src/backend/target.ts` gains a `'zig'` ABI and toolchain
 * (docs/zig-codegen-plan.md, Phase 0). Concrete IR uses the target only for layout
 * table identity and cache keys, so this validated native C11 profile is sufficient
 * for lowering. The triple, version string, and feature tag keep its keys distinct
 * from real clang targets. Replace once the target schema accepts Zig.
 */
export function zigTarget(zigVersion: string): TargetConfig {
    return targetConfig({
        schemaVersion: 1,
        triple: 'native-zig',
        pointerBits: 64,
        byteOrder: 'little',
        abi: 'c11',
        toolchain: { compiler: 'clang', version: `zig ${zigVersion}` },
        runtime: 'native',
        features: ['zig-stopgap'],
    });
}
