import { typeKey, type IRBlock } from './typed-ir.ts';
import type { SemanticType } from './elaborated.ts';
import type { SpecializedProgram } from './specialize.ts';
import type { CallableMember, LensTopology } from './infer-representations.ts';

/** Canonical ABI topology; local storage is free to remain thin or scattered. */
export function canonicalLensTopology(read: SemanticType, write: SemanticType): LensTopology {
    return read.tag === 'tuple' &&
        write.tag === 'tuple' &&
        read.items.length > 0 &&
        read.items.length === write.items.length
        ? {
              kind: 'tuple',
              items: read.items.map((t, n) => canonicalLensTopology(t, write.items[n]!)),
          }
        : { kind: 'thin' };
}
export function lensSpecializationSelectors(source: SpecializedProgram): Set<string> {
    return new Set([
        '*',
        ...source.generic.units.flatMap((u) => [
            ...u.functions.map((f) => f.id),
            ...u.bindings
                .filter((b) => b.kind === 'global' && b.definition === u.definition)
                .map((b) => b.name),
        ]),
    ]);
}
/** Indirect calls use one canonical ABI for every member. Intrinsics preserve
 * their own projection contracts; explicitly selected direct bodies may vary. */
export function specializeLensCall(
    source: SpecializedProgram,
    selected: readonly string[],
    callee?: CallableMember,
): boolean {
    if (selected.includes('*')) return true;
    if (callee?.kind === 'native') return true;
    if (!callee) return false;
    if (selected.includes('*') || selected.includes(callee.function)) return true;
    const origin = source.instances.find((i) => i.id === callee.unit)?.source;
    const unit = source.generic.units.find((u) => u.id === origin);
    const name = unit?.bindings.find(
        (b) => b.kind === 'global' && b.definition === unit.definition,
    )?.name;
    return !!name && selected.includes(name);
}

export type CanonicalLensPolicies = Map<string, Map<number, Set<string>>>;
/** A fixed policy per semantic callable type also gives direct and indirect calls
 * the same ABI. Intermediate empty/reconstructed slots constrain which tuple
 * nodes can be scattered; those constraints are correctness facts, not tuning. */
export function canonicalLensPolicies(source: SpecializedProgram): CanonicalLensPolicies {
    const policies: CanonicalLensPolicies = new Map();
    for (const unit of source.program.units)
        for (const fn of unit.functions) {
            const key = typeKey(fn.type);
            const args = policies.get(key) ?? new Map<number, Set<string>>();
            policies.set(key, args);
            fn.parameters.forEach((parameter, n) => {
                const type = fn.type.args[n]!;
                if (!parameter.lensPlace || type.tag !== 'flow') return;
                const base = canonicalLensTopology(type.read, type.write);
                const opaque = args.get(n) ?? new Set<string>();
                args.set(n, opaque);
                const constrain = (
                    topology: LensTopology,
                    r: SemanticType,
                    w: SemanticType,
                    path: number[],
                ) => {
                    if (topology.kind === 'thin') return;
                    if (
                        r.tag !== 'tuple' ||
                        w.tag !== 'tuple' ||
                        r.items.length !== topology.items.length ||
                        w.items.length !== topology.items.length
                    ) {
                        opaque.add(path.join('.'));
                        return;
                    }
                    topology.items.forEach((t, n) =>
                        constrain(t, r.items[n]!, w.items[n]!, [...path, n]),
                    );
                };
                const scan = (b: IRBlock) => {
                    for (const i of b.instructions) {
                        if (
                            i.op === 'acquire' &&
                            i.slot.place === parameter.lensPlace &&
                            i.out.type.tag === 'flow'
                        ) {
                            let node = base;
                            for (const index of i.slot.path) {
                                if (node.kind === 'thin') break;
                                node = node.items[index]!;
                            }
                            constrain(node, i.out.type.read, i.out.type.write, i.slot.path);
                        }
                        if (i.op === 'scope') scan(i.body);
                        if (i.op === 'aslens') scan(i.cleanup);
                        if (i.op === 'case') i.cases.forEach((a) => scan(a.body));
                    }
                };
                scan(fn.body);
                if (
                    unit.loans.some(
                        (l) =>
                            l.place !== parameter.lensPlace &&
                            l.owners?.some((o) => o.place === parameter.lensPlace),
                    )
                )
                    opaque.add('');
            });
        }
    return policies;
}
export function canonicalCallLensTopology(
    policies: CanonicalLensPolicies,
    type: string,
    argument: number,
    read: SemanticType,
    write: SemanticType,
    requested?: LensTopology,
): LensTopology {
    const opaque = policies.get(type)?.get(argument);
    const apply = (t: LensTopology, path: number[]): LensTopology =>
        t.kind === 'thin' || opaque?.has(path.join('.'))
            ? { kind: 'thin' }
            : { kind: 'tuple', items: t.items.map((child, n) => apply(child, [...path, n])) };
    return apply(requested ?? canonicalLensTopology(read, write), []);
}
