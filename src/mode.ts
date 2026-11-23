/**
 * Laminar has two languages that are never mixed in one program (docs/mut-and-linear-plan.md):
 *
 * - `pure`: the paper's language. Every binding is consume-once and `dup` is explicit.
 * - `dual`: adds `mut`, `linear`, scalar copying and shared immutable values.
 *
 * The checker consults a {@link Policy} at the points where the languages differ. Later phases
 * add those decision methods; today `pure` is the only implemented policy, and it answers with
 * the paper's behavior.
 */
export type Mode = 'pure' | 'dual';
export const modes: readonly Mode[] = ['pure', 'dual'];

export type Policy = { readonly mode: Mode };

export const pureMode: Policy = { mode: 'pure' };

/** The policy for a mode, or undefined while that mode is not implemented. */
export function policyFor(mode: Mode): Policy | undefined {
    return mode === 'pure' ? pureMode : undefined;
}

/** `// laminar: dual` on the first line that is not blank selects the file's mode. */
const pragma = /^\s*\/\/\s*laminar:\s*(\S*)\s*$/;

/** The mode a source file declares, `undefined` when it declares none, or the bad value. */
export function declaredMode(source: string): Mode | undefined | { invalid: string } {
    for (const line of source.split('\n')) {
        if (!line.trim()) continue;
        const match = pragma.exec(line);
        if (!match) return undefined;
        const value = match[1]!;
        return (modes as readonly string[]).includes(value)
            ? (value as Mode)
            : { invalid: value };
    }
    return undefined;
}
