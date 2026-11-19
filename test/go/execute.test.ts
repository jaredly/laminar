import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { goTarget, targetConfig } from '../../src/backend/target.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { printGo } from '../../src/go/syntax.ts';

// Bun schedules concurrent tests in groups; cap expensive compiler jobs at four.
let active = 0;
const waiting: (() => void)[] = [];
export async function withBuildSlot<T>(work: () => Promise<T>): Promise<T> {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
        return await work();
    } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
    }
}

const goVersionResult = spawnSync('go', ['version'], { encoding: 'utf8' });
const goAvailable = goVersionResult.status === 0;

export const goNativeTarget = goAvailable
    ? goTarget(goVersionResult.stdout.trim())
    : undefined;

describe('Go Backend Execution Harness', () => {
    (goAvailable ? it : it.skip)('executes a smoke test with build slot concurrency', async () => {
        await withBuildSlot(async () => {
            const source = printGo({
                packageName: 'main',
                imports: ['fmt'],
                declarations: [],
                functions: [
                    {
                        signature: 'func main()',
                        body: ['fmt.Println("100")'],
                    },
                ],
            });

            const results = await buildAndRunGo(source, { expected: [100] });
            expect(results).toEqual([100]);
        });
    });

    (goAvailable ? it : it.skip)('detects expected runtime trap', async () => {
        await withBuildSlot(async () => {
            const source = printGo({
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
                await buildAndRunGo(source);
                expect().fail('Expected runtime trap');
            } catch (error) {
                expect((error as { code?: string }).code).toBe('go-runtime');
                const directory = String(error).match(/Artifacts: (.+)/)![1]!;
                await rm(directory, { recursive: true, force: true });
            }
        });
    });
});
