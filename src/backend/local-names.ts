import type { ConcreteBlock, ConcreteCode, ConcreteProgram } from '../concrete-ir.ts';
import type { SlotRef } from '../typed-ir.ts';
import { patternSlots, sourceBinding, type NameAllocator } from './names.ts';

type Instruction = ConcreteBlock['instructions'][number];

/**
 * Source names for one generated function's parameters and locals, recovered from
 * the retained IR's binding records. Shadowed bindings and distinct storage
 * versions of one binding receive deterministic suffixes. `allocator` is the
 * function's namespace; it must already reserve every package-level name a body
 * can mention.
 */
export function localNames(program: ConcreteProgram, c: ConcreteCode, allocator: NameAllocator) {
    const irUnit = program.semantic.program.units.find((u) => u.id === c.unit)!;
    const bindingNames = new Map<string, string>();
    const bindingName = (slot: SlotRef): string | undefined => {
        const binding = sourceBinding(irUnit.bindings, slot);
        if (!binding) return undefined;
        if (!bindingNames.has(binding.id))
            bindingNames.set(binding.id, allocator.source(binding.name));
        return bindingNames.get(binding.id)!;
    };
    const parameterNames = c.parameters.map((p, n) => {
        const slots = patternSlots(p.pattern);
        if (slots.length === 1 && !slots[0]!.path.length) {
            const name = bindingName(slots[0]!);
            if (name) return name;
        }
        const parts = slots
            .map((slot) => sourceBinding(irUnit.bindings, slot)?.name)
            .filter((n): n is string => !!n);
        return allocator.source(parts.length ? parts.join('_') : `argument${n}`);
    });
    const sourceSlots = c.parameters.flatMap((p) => patternSlots(p.pattern));
    sourceSlots.push(...c.captures.map((p) => ({ place: p.place, path: [] })));
    const producers = new Map<string, Instruction>();
    const localBindings: Extract<Instruction, { op: 'bind' }>[] = [];
    const scan = (b: ConcreteBlock) => {
        for (const i of b.instructions) {
            if ('out' in i) producers.set(i.out.id, i);
            if (i.op === 'bind') {
                localBindings.push(i);
                sourceSlots.push(...patternSlots(i.pattern));
            }
            if (i.op === 'move' || i.op === 'acquire') sourceSlots.push(i.slot);
            if (i.op === 'scope') scan(i.body);
            if (i.op === 'aslens') scan(i.cleanup);
            if (i.op === 'case') i.cases.forEach((a) => scan(a.body));
        }
    };
    scan(c.body);
    const referenced = new Set(sourceSlots.map((slot) => sourceBinding(irUnit.bindings, slot)?.id));
    // Give source declarations their names before allocating any versions or
    // temporaries, including destructured parameters and captured bindings.
    for (const binding of irUnit.bindings)
        if (referenced.has(binding.id) && !bindingNames.has(binding.id))
            bindingNames.set(binding.id, allocator.source(binding.name));
    const preferred = new Map<string, string>();
    const prefer = (id: string, name: string) => {
        const i = producers.get(id);
        if (i?.op === 'scope') prefer(i.body.result, name);
        else if (!preferred.has(id)) preferred.set(id, name);
    };
    for (const i of localBindings) {
        for (const slot of patternSlots(i.pattern)) bindingName(slot);
        if (i.pattern.kind === 'bind') {
            const name = bindingName(i.pattern.slot);
            if (name) prefer(i.value, name);
        }
    }
    const named = new Set(parameterNames);
    /** The first storage version keeps the source name; later ones get suffixes. */
    const versionName = (base: string) => {
        if (!named.has(base)) {
            named.add(base);
            return base;
        }
        return allocator.unique(base);
    };
    /**
     * The source binding an instruction's result corresponds to, if any: the binding
     * it initializes, the binding a move reads, or (for a native lens operation) the
     * binding its lens borrows. See `takesName` for whether its local uses it.
     */
    const hint = (
        i: Extract<Instruction, { out: unknown }>,
        lensSlot: (id: string) => SlotRef | undefined,
    ): string | undefined =>
        preferred.get(i.out.id) ??
        (i.op === 'move'
            ? bindingName(i.slot)
            : i.op === 'invoke' &&
                program.wrappers.find((w) => w.id === i.wrapper)?.kind === 'native'
              ? (() => {
                    const slot = lensSlot(i.args[0]!);
                    return slot && bindingName(slot);
                })()
              : undefined);
    return { parameterNames, bindingName, versionName, hint };
}

/** Constants and capture-free callables stay unnamed even when bound: they inline. */
export const takesName = (i: Extract<Instruction, { out: unknown }>): boolean =>
    i.op !== 'constant' && !(i.op === 'make-callable' && !i.captures.length);
