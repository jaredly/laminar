/**
 * Programs the ABI-keyed callable migration (docs/abi-callable-representations.md)
 * must accept. Each records the milestone that enables it; until then the current
 * identity-precise analysis rejects it and the test is skipped. Enabled samples join
 * the behavioral corpus and run on typed IR, the legacy reference and native/Wasm C.
 */
export type MigrationMilestone = 'M1' | 'M2' | 'M3' | 'M4';
export const abiMigrationSamples: {
    name: string;
    milestone: MigrationMilestone;
    source: string;
    expected: unknown;
}[] = [
    {
        name: 'recursively nested capturing closures',
        milestone: 'M1',
        source: 'fn nest(k, f) {match k {0 -> f\n j -> nest(j - 1, fn () f())}}\n{let g = nest(3, fn () 1)\n g()}',
        expected: 1,
    },
    {
        name: 'scattered dispatch with differing installed closures',
        milestone: 'M1',
        source: 'fn ex1(new, ~(x, y)) {x := new}\nfn ex2(new, ~(x, y)) {let o = x := fn () 9\n new}\n{let f = fn () 3\n let n = 4\n let e = match true {true -> ex1\n false -> ex2}\n let old = e(fn () 7, ~(f, n))\n (old(), f(), n)}',
        expected: [3, 7, 4],
    },
    {
        name: 'recursive lens result with alternating inputs',
        milestone: 'M1',
        source: 'fn deep(k, ~(x, y)) ~{match k {0 -> x\n j -> deep(j - 1, ~(y, x))}}\n{let p = (fn () 3, fn () 4)\n let old = deep(1, ~p) := fn () 7\n let (f, g) = p\n (old(), f(), g())}',
        expected: [4, 3, 7],
    },
];
/** The milestones landed so far; samples at or before these run everywhere. */
export const enabledMilestones: MigrationMilestone[] = ['M1'];
export const enabledMigrationSamples = abiMigrationSamples.filter((s) =>
    enabledMilestones.includes(s.milestone),
);
