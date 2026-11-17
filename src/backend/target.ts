import { freezeTree } from '../elaborated.ts';

export type TargetConfig = {
    schemaVersion: 1;
    triple: string;
    pointerBits: 32 | 64;
    byteOrder: 'little' | 'big';
    abi: 'c11';
    toolchain: { compiler: 'clang' | 'gcc' | 'emscripten'; version: string };
    runtime: 'native' | 'emscripten-node' | 'emscripten-browser';
    features: readonly string[];
};

export class BackendDiagnostic extends Error {
    constructor(
        public code: string,
        message: string,
        public node?: string,
    ) {
        super(message);
        this.name = 'BackendDiagnostic';
    }
}

/** A build host never supplies defaults for a target's physical layout. */
export function targetConfig(config: TargetConfig): TargetConfig {
    if (config.schemaVersion !== 1 || !config.triple.trim() || !config.toolchain.version.trim())
        throw new BackendDiagnostic(
            'invalid-target',
            'Target triple and exact compiler identity are required',
        );
    if (
        ![32, 64].includes(config.pointerBits) ||
        !['little', 'big'].includes(config.byteOrder) ||
        config.abi !== 'c11'
    )
        throw new BackendDiagnostic(
            'invalid-target',
            'Unsupported address width, byte order, or ABI',
        );
    if (
        config.runtime.startsWith('emscripten') &&
        (config.toolchain.compiler !== 'emscripten' ||
            config.pointerBits !== 32 ||
            config.byteOrder !== 'little' ||
            config.triple !== 'wasm32-unknown-emscripten')
    )
        throw new BackendDiagnostic(
            'invalid-target',
            'The initial Emscripten profiles require wasm32 little-endian Emscripten',
        );
    if (config.runtime === 'native' && config.triple.startsWith('wasm'))
        throw new BackendDiagnostic(
            'invalid-target',
            'A Wasm target needs an explicit host runtime profile',
        );
    return freezeTree({
        ...config,
        toolchain: { ...config.toolchain },
        features: [...new Set(config.features)].sort(),
    });
}

/** Canonical key for physical layouts and concrete specializations, not semantic inference. */
export function targetKey(config: TargetConfig): string {
    const c = targetConfig(config);
    return JSON.stringify([
        c.schemaVersion,
        c.triple,
        c.pointerBits,
        c.byteOrder,
        c.abi,
        c.toolchain.compiler,
        c.toolchain.version,
        c.runtime,
        c.features,
    ]);
}

export function wasm32Emscripten(
    compilerVersion: string,
    runtime: 'emscripten-node' | 'emscripten-browser' = 'emscripten-node',
): TargetConfig {
    return targetConfig({
        schemaVersion: 1,
        triple: 'wasm32-unknown-emscripten',
        pointerBits: 32,
        byteOrder: 'little',
        abi: 'c11',
        toolchain: { compiler: 'emscripten', version: compilerVersion },
        runtime,
        features: [],
    });
}
