import { spawnSync } from 'node:child_process';
import {
    BackendDiagnostic,
    goTarget,
    targetConfig,
    wasm32Emscripten,
    type TargetConfig,
} from './target.ts';

/** Target selections the compiler command understands. */
export type TargetName = 'native' | 'wasm32' | 'go';
export const targetNames: readonly TargetName[] = ['native', 'wasm32', 'go'];

const tool = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status !== 0)
        throw new BackendDiagnostic(
            'missing-toolchain',
            `${command} is required for this target but could not be run`,
        );
    return result.stdout.trim() || result.stderr.trim();
};

/**
 * Describe a target from the toolchain that will build it. Layout never comes from
 * the machine running the compiler: the native target asks clang for its triple,
 * pointer width and byte order.
 */
export function detectTarget(name: TargetName): TargetConfig {
    switch (name) {
        case 'native': {
            const version = tool('clang', ['--version']);
            const macros = tool('clang', ['-dM', '-E', '-x', 'c', '/dev/null']);
            return targetConfig({
                schemaVersion: 1,
                triple: tool('clang', ['-dumpmachine']),
                pointerBits:
                    Number(macros.match(/#define __SIZEOF_POINTER__ (\d+)/)?.[1]) === 4 ? 32 : 64,
                byteOrder: /#define __BYTE_ORDER__ __ORDER_BIG_ENDIAN__/.test(macros)
                    ? 'big'
                    : 'little',
                abi: 'c11',
                toolchain: { compiler: 'clang', version },
                runtime: 'native',
                features: [],
            });
        }
        case 'wasm32':
            return wasm32Emscripten(tool('emcc', ['--version']));
        case 'go':
            return goTarget(tool('go', ['version']));
        default:
            throw new BackendDiagnostic('invalid-target', `Unknown target ${String(name)}`);
    }
}
