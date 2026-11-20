import type { IRBlock } from './typed-ir.ts';

/**
 * Whether an SSA value is used for anything other than being the callee of a call
 * in its defining block (including nested blocks and the block result). A value
 * that does not escape keeps its statically known code; one that escapes may reach
 * indirect calls, so its code joins its type's member set. Shared by representation
 * inference and its independent verifier.
 */
export function escapes(value: string, body: IRBlock): boolean {
    const text = JSON.stringify(body);
    const quoted = JSON.stringify(value);
    let total = 0;
    for (let at = text.indexOf(quoted); at >= 0; at = text.indexOf(quoted, at + 1)) total++;
    const calls = text.split(`"callee":${quoted}`).length - 1;
    // One occurrence is the defining instruction's output.
    return total - 1 - calls > 0;
}
