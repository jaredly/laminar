import { it, expect } from 'bun:test';
import { readLine } from './nnodes.ts';
import { parseLinear } from './flowparse.ts';
import { toTS } from './flowtots.ts';

// it("should do it", () => {
//     const value = parseLinear(readLine("fn united(~x) { ~() }"));
//     expect(toTS({ globals: [] }, value)).toEqual("lol");
// });
