import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { goTarget, targetConfig, targetKey, BackendDiagnostic } from '../../src/backend/target.ts';
import { printGo, identifier } from '../../src/go/syntax.ts';
import { buildAndRunGo, getVersion } from '../../src/go/build.ts';

const goAvailable = spawnSync('go', ['version']).status === 0;

describe('Phase 0: Go Target Configuration', () => {
    it('creates a valid Go target configuration', () => {
        const config = goTarget('go1.26.3');
        expect(config.schemaVersion).toBe(1);
        expect(config.abi).toBe('go');
        expect(config.toolchain.compiler).toBe('go');
        expect(config.toolchain.version).toBe('go1.26.3');
        expect(config.runtime).toBe('go');
        expect(config.pointerBits).toBe(64);
        expect(config.byteOrder).toBe('little');

        const key = targetKey(config);
        expect(key).toContain('"go"');
    });

    it('rejects mismatched Go ABI and compiler', () => {
        expect(() =>
            targetConfig({
                schemaVersion: 1,
                triple: 'native',
                pointerBits: 64,
                byteOrder: 'little',
                abi: 'go',
                toolchain: { compiler: 'clang', version: '14.0' },
                runtime: 'go',
                features: [],
            }),
        ).toThrow('Go ABI requires the Go compiler toolchain');
    });
});

describe('Phase 0: Go Syntax Printing', () => {
    it('validates identifiers', () => {
        expect(identifier('fn0')).toBe('fn0');
        expect(identifier('_valid_123')).toBe('_valid_123');
        expect(() => identifier('123bad')).toThrow('Invalid Go identifier');
        expect(() => identifier('bad-dash')).toThrow('Invalid Go identifier');
    });

    it('prints a complete Go file with imports and functions', () => {
        const source = printGo({
            packageName: 'main',
            imports: ['fmt', 'math'],
            declarations: ['type L0 struct {\n\tItem0 float64\n\tItem1 bool\n}'],
            functions: [
                {
                    signature: 'func compute(x float64) float64',
                    body: [
                        {
                            head: 'if x > 0',
                            body: ['return math.Sqrt(x)'],
                        },
                        'return 0',
                    ],
                },
                {
                    signature: 'func main()',
                    body: ['fmt.Println(compute(4.0))'],
                },
            ],
        });

        expect(source).toContain('package main');
        expect(source).toContain('import (\n\t"fmt"\n\t"math"\n)');
        expect(source).toContain('type L0 struct');
        expect(source).toContain('func compute(x float64) float64 {');
        expect(source).toContain('\tif x > 0 {');
        expect(source).toContain('\t\treturn math.Sqrt(x)');
        expect(source).toContain('\t}');
    });
});

(goAvailable ? describe : describe.skip)('Phase 0: Go Build and Execution', () => {
    it('retrieves compiler version', async () => {
        const version = await getVersion('go');
        expect(version).toContain('go version');
    });

    it(
        'compiles, formats, runs, and captures JSON output',
        async () => {
            const source = printGo({
                packageName: 'main',
                imports: ['fmt'],
                declarations: [],
                functions: [
                    {
                        signature: 'func main()',
                        body: [
                            'fmt.Println("42")',
                            'fmt.Println("true")',
                            'fmt.Println("[1, 2, 3]")',
                        ],
                    },
                ],
            });

            const results = await buildAndRunGo(source, {
                expected: [42, true, [1, 2, 3]],
            });

            expect(results).toEqual([42, true, [1, 2, 3]]);
        },
        30000,
    );

    it(
        'catches and reports syntax errors as go-fmt',
        async () => {
            const syntaxErrorSource = `package main
func main() {
    this_is_a_syntax_error +++
}
`;
            try {
                await buildAndRunGo(syntaxErrorSource);
                expect().fail('Expected fmt to fail');
            } catch (error) {
                expect(error).toBeInstanceOf(BackendDiagnostic);
                const diag = error as BackendDiagnostic;
                expect(diag.code).toBe('go-fmt');
                const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                await rm(directory, { recursive: true, force: true });
            }
        },
        30000,
    );

    it(
        'catches and reports type errors as go-build',
        async () => {
            const typeErrorSource = printGo({
                packageName: 'main',
                declarations: [],
                functions: [
                    {
                        signature: 'func main()',
                        body: ['var x int = "not an int"', '_ = x'],
                    },
                ],
            });
            try {
                await buildAndRunGo(typeErrorSource);
                expect().fail('Expected build to fail');
            } catch (error) {
                expect(error).toBeInstanceOf(BackendDiagnostic);
                const diag = error as BackendDiagnostic;
                expect(diag.code).toBe('go-build');
                const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                await rm(directory, { recursive: true, force: true });
            }
        },
        30000,
    );

    it(
        'catches and reports runtime panics as go-runtime',
        async () => {
            const panicSource = printGo({
                packageName: 'main',
                declarations: [],
                functions: [
                    {
                        signature: 'func main()',
                        body: ['panic("unmatched case")'],
                    },
                ],
            });

            try {
                await buildAndRunGo(panicSource);
                expect().fail('Expected runtime trap');
            } catch (error) {
                expect(error).toBeInstanceOf(BackendDiagnostic);
                const diag = error as BackendDiagnostic;
                expect(diag.code).toBe('go-runtime');
                const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                await rm(directory, { recursive: true, force: true });
            }
        },
        30000,
    );
});
