import type { Linear, Lens, Pat } from './ast.ts';
import type { Elaboration, SemanticFlow, SemanticType, BindingRecord } from './elaborated.ts';
import { freezeTree, semanticRecord, semanticNeeds, needsProperty } from './elaborated.ts';
import { Solver, type Ty, type Scheme } from './types.ts';
import { builtinTypes, constructorTypes } from './builtins.ts';
import { BackendDiagnostic } from './backend/target.ts';
import { verifyElaboration } from './backend/verify-elaboration.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import {
    encodeNumber,
    irPlain,
    subpatterns,
    type RecordPart,
    type TypedProgram,
    type IRUnit,
    type IRBlock,
    type IRPattern,
    type IRValue,
    type Instruction,
    type IRFunction,
    type SlotRef,
    type Instance,
    type IRScheme,
    type Cleanup,
} from './typed-ir.ts';

type Producing = Exclude<Instruction, { op: 'bind' | 'borrow' }>;
type Operation = Producing extends infer I
    ? I extends Producing
        ? Omit<I, 'out' | 'origin'>
        : never
    : never;

export function importScheme(definition: string, scheme: Scheme): IRScheme {
    const vars = new Map(scheme.quantified.map((id, i) => [id, `${definition}/q${i}`]));
    const type = (t: Ty): SemanticType => {
        switch (t.tag) {
            case 'meta': {
                const id = vars.get(t.id);
                if (!id)
                    throw new BackendDiagnostic(
                        'open-import',
                        `Import ${definition} has unbound type variables`,
                    );
                return { tag: 'variable', id, rigid: false };
            }
            case 'rigid':
                throw new BackendDiagnostic('open-import', 'Rigid variable in import');
            case 'con':
                return { ...t, args: t.args.map(type) };
            case 'tuple':
                return { ...t, items: t.items.map(type) };
            case 'record':
                return semanticRecord(
                    t.fields.map((f) => ({ name: f.name, type: type(f.type) })),
                    t.rest && type(t.rest),
                );
            case 'fn':
                return {
                    tag: 'fn',
                    args: t.args.map(flow),
                    result: flow(t.result),
                    ...(t.capture ? { capture: t.capture } : {}),
                    ...needsProperty(t.needs && type(t.needs)),
                };
            case 'needs':
                return semanticNeeds(
                    t.entries.map((e) => ({ name: e.name, type: type(e.type) })),
                    t.rest && type(t.rest),
                );
        }
    };
    const flow = (f: import('./types.ts').FlowTy): SemanticFlow =>
        f.tag === 'plain'
            ? {
                  tag: 'plain',
                  value: type(f.value),
                  ...(new Solver().ownership(f) === 'shared' ? { mode: 'shared' as const } : {}),
              }
            : {
                  tag: 'flow',
                  read: type(f.read),
                  write: type(f.write),
                  ...(new Solver().lensOwnership(f.owned) === 'owned'
                      ? { owned: true as const }
                      : {}),
              };
    return {
        definition,
        ...(scheme.bounds && { bounds: structuredClone(scheme.bounds) }),
        ...(scheme.rows && { rows: structuredClone(scheme.rows) }),
        ...(scheme.callsOnce && { callsOnce: scheme.callsOnce }),
        quantified: [...vars.values()],
        type: type(scheme.body),
    };
}
export function defaultIRImports(): IRScheme[] {
    return [
        ...[...builtinTypes()].map(([n, s]) => importScheme(`native/${n}`, s)),
        ...[...constructorTypes()].map(([n, s]) => importScheme(`constructor/${n}`, s)),
    ];
}

/** Source typing has finished. This pass only consumes retained, verified elaboration. */
export function lowerTypedUnit(e: Elaboration): IRUnit {
    verifyElaboration(e);
    let next = 0;
    const functions: IRFunction[] = [];
    const id = (node: object): string => (node as { nodeId: string }).nodeId;
    const fail = (message: string, node: object): never => {
        throw new BackendDiagnostic('typed-lowering', message, id(node));
    };
    const type = (node: object): SemanticFlow =>
        e.nodes.find((n) => n.id === id(node))?.type ?? fail('Missing occurrence type', node);
    const plainType = (node: object): SemanticType => {
        const t = type(node);
        return t.tag === 'plain' ? t.value : fail('Expected a plain occurrence type', node);
    };
    const binding = (node: object): BindingRecord => {
        const b = e.uses.find((u) => u.node === id(node))?.binding;
        return e.bindings.find((v) => v.id === b) ?? fail('Missing resolved binding', node);
    };
    const ref = (b: BindingRecord): SlotRef => ({
        place: b.place,
        path: [...b.path],
        permit: b.borrow,
    });
    const declaration = (p: Pat): BindingRecord =>
        e.bindings.find((b) => b.declaration === id(p)) ?? fail('Missing pattern declaration', p);
    const instance = (node: object): Instance => {
        const i = e.instantiations.find((i) => i.node === id(node));
        return i
            ? { definition: i.definition, arguments: i.arguments, type: i.type }
            : fail('Missing generic instantiation', node);
    };
    /** Where an owned lens binding keeps its lens: a scope's loan, or a parameter or capture. */
    const holder = (b: BindingRecord): { loan: string } | { place: string } =>
        b.borrow ? { loan: b.borrow } : { place: b.place };
    /** Holders that have given their lens away on the path being lowered. */
    type Given = { from: { loan: string } | { place: string }; declared: number };
    let given = new Map<string, Given>();
    const holderKey = (h: { loan: string } | { place: string }) => JSON.stringify(h);
    /** The cleanup that ends a lens its holder still has. */
    const endHolder = (h: { loan: string } | { place: string }): Cleanup =>
        'loan' in h
            ? { kind: 'release', loan: h.loan }
            : { kind: 'end', slot: { place: h.place, path: [] } };
    const give = (
        block: IRBlock,
        node: object,
        bindingId: string,
        result: SemanticFlow,
    ): IRValue => {
        const b =
            e.bindings.find((v) => v.id === bindingId) ?? fail('Missing moved lens binding', node);
        const from = holder(b);
        given.set(holderKey(from), { from, declared: e.bindings.indexOf(b) });
        return emit(block, node, { op: 'give', from }, result);
    };
    const emit = (
        block: IRBlock,
        node: object,
        operation: Operation,
        result = type(node),
    ): IRValue => {
        const out = { id: `${e.id}/v${next++}`, type: result };
        block.instructions.push({ ...operation, origin: id(node), out } as Producing);
        return out;
    };
    const block = (node: object): IRBlock => ({
        origin: id(node),
        instructions: [],
        result: '',
        cleanup: [],
    });
    const pattern = (p: Pat): IRPattern => {
        const result = patternInner(p);
        const owner = p.reconstructionOwner;
        if (owner) {
            result.reconstructionOwner = ref(binding(owner));
            result.reconstructionId = id(p);
        }
        return result;
    };
    const patternInner = (p: Pat): IRPattern => {
        if (p.type === 'lens') return pattern(p.inner);
        const t = plainType(p);
        switch (p.type) {
            case 'id':
                return { kind: 'bind', type: t, slot: ref(declaration(p)) };
            case 'drop':
                return { kind: 'drop', type: t };
            case 'number':
                return { kind: 'literal', type: t, value: encodeNumber(p.value) };
            case 'bool':
                return { kind: 'literal', type: t, value: p.value };
            case 'string':
                return { kind: 'literal', type: t, value: p.text };
            case 'tuple':
                return { kind: 'tuple', type: t, items: p.items.map(pattern) };
            case 'record':
                return {
                    kind: 'record',
                    type: t,
                    fields: p.fields.map((f) => ({ name: f.name, pattern: pattern(f.pat) })),
                    ...(p.rest ? { rest: pattern(p.rest) } : {}),
                };
            case 'constructor':
                return {
                    kind: 'constructor',
                    type: t,
                    name: p.name,
                    items: p.args.map(pattern),
                    instance: instance(p),
                };
        }
    };
    const slots = (p: IRPattern): SlotRef[] =>
        p.kind === 'bind'
            ? [p.slot]
            : p.kind === 'tuple' || p.kind === 'constructor'
              ? p.items.flatMap(slots)
              : p.kind === 'record'
                ? subpatterns(p).flatMap(slots)
                : [];
    const drops = (p: IRPattern): Cleanup[] =>
        [...new Set(slots(p).map((s) => s.place))].map((place) => ({
            kind: 'drop-place',
            slot: { place, path: [] },
        }));
    const call = (n: (Linear | Lens) & { type: 'apply' }, b: IRBlock): IRValue => {
        // Lenses are set up first, wherever they are written.
        const lenses = new Map<unknown, IRValue>();
        for (const a of n.args) {
            if (a.type !== 'lens') continue;
            const move = e.lensMoves.find((m) => m.node === id(a.lens));
            lenses.set(a, move ? give(b, a.lens, move.binding, type(a.lens)) : lens(a.lens, b));
        }
        const callee = linear(n.fn, b);
        const args = n.args.map((a) => (a.type === 'lens' ? lenses.get(a)!.id : linear(a, b).id));
        return emit(b, n, {
            op: 'call',
            callee: callee.id,
            args,
            ...((n as { share?: boolean }).share ? { share: true as const } : {}),
            ...((n as { detached?: boolean }).detached ? { detached: true as const } : {}),
        });
    };
    const letBody = (
        n: (Linear | Lens) & { type: 'let' },
        b: IRBlock,
        lensBody: boolean,
    ): IRValue => {
        const nested = block(n);
        if (n.value.type === 'lens') {
            const view = lens(n.value.lens, b);
            const loan =
                e.borrows.find((loan) => loan.node === id(n)) ?? fail('Missing lexical borrow', n);
            nested.instructions.push({ op: 'borrow', origin: id(n), loan: loan.id, lens: view.id });
            nested.result = (
                lensBody ? lens(n.body as Lens, nested) : linear(n.body as Linear, nested)
            ).id;
            // A lens given away in the scope is no longer this scope's to end.
            if (!given.delete(holderKey({ loan: loan.id })))
                nested.cleanup.push({ kind: 'release', loan: loan.id });
            return emit(b, n, { op: 'scope', body: nested });
        } else {
            const value = linear(n.value, b);
            let p: IRPattern;
            if (n.pat.type === 'drop' && n.value.type === 'fn' && n.value.name) {
                const functionName = n.value.name;
                const bound =
                    e.bindings.find(
                        (v) =>
                            v.name === functionName &&
                            v.kind === 'local' &&
                            e.scopes.some((s) => s.node === id(n) && s.bindings.includes(v.id)),
                    ) ?? fail('Missing local named function binding', n);
                p = { kind: 'bind', slot: ref(bound), type: bound.initialType };
            } else p = pattern(n.pat);
            nested.instructions.push({ op: 'bind', origin: id(n), value: value.id, pattern: p });
            nested.cleanup.push(...drops(p));
        }
        nested.result = (
            lensBody ? lens(n.body as Lens, nested) : linear(n.body as Linear, nested)
        ).id;
        return emit(b, n, { op: 'scope', body: nested });
    };
    const linear = (n: Linear, b: IRBlock): IRValue => {
        switch (n.type) {
            case 'number':
                return emit(b, n, { op: 'constant', value: encodeNumber(n.value) });
            case 'bool':
                return emit(b, n, { op: 'constant', value: n.value });
            case 'id':
            case 'op': {
                const bound = binding(n);
                if (!bound.definition) return emit(b, n, { op: 'move', slot: ref(bound) });
                const global = instance(n),
                    used = type(n);
                // One that needs nothing, used where its type has needs, gets an adapter.
                if (
                    used.tag === 'plain' &&
                    used.value.tag === 'fn' &&
                    used.value.needs &&
                    global.type.tag === 'fn' &&
                    !global.type.needs
                ) {
                    const value = emit(b, n, { op: 'global', instance: global }, {
                        ...used,
                        value: global.type,
                    } as SemanticFlow);
                    return emit(b, n, { op: 'widen', value: value.id });
                }
                return emit(b, n, { op: 'global', instance: global });
            }
            case 'string':
                return emit(b, n, {
                    op: 'string',
                    head: n.head,
                    parts: n.interp.map((p) => ({ value: linear(p.value, b).id, tail: p.tail })),
                });
            case 'field':
                return emit(b, n, { op: 'move', slot: ref(binding(n)) });
            case 'tuple': {
                if (n.items.length === 1) return linear(n.items[0], b);
                return emit(
                    b,
                    n,
                    n.items.length
                        ? { op: 'tuple', items: n.items.map((v) => linear(v, b).id) }
                        : { op: 'constant', value: null },
                );
            }
            case 'record': {
                // Evaluate in source order, then lay the values out in name order.
                const values = new Map(n.fields.map((f) => [f.name, linear(f.value, b).id]));
                return emit(b, n, {
                    op: 'tuple',
                    items: [...values.keys()].sort().map((name) => values.get(name)!),
                });
            }
            case 'update': {
                const place = (v: Linear) =>
                    v.type === 'field' || (v.type === 'id' && !binding(v).definition);
                // Operands first, in source order; spread places are taken by the instruction.
                const values = n.items.map((item) =>
                    item.value && !(item.kind === 'spread' && place(item.value))
                        ? linear(item.value, b)
                        : undefined,
                );
                return emit(b, n, {
                    op: 'record',
                    parts: n.items.map((item, i): RecordPart => {
                        const value = values[i];
                        if (item.kind === 'field')
                            return {
                                kind: 'field',
                                op: item.op,
                                name: item.name,
                                ...(value ? { value: value.id } : {}),
                            };
                        return {
                            kind: 'spread',
                            source: value
                                ? { value: value.id }
                                : { slot: ref(binding(item.value)) },
                            type: plainType(item.value),
                        };
                    }),
                });
            }
            case 'need':
                return emit(b, n, { op: 'need', name: n.name });
            case 'inject': {
                let value = linear(n.value, b);
                const type = value.type.tag === 'plain' ? value.type.value : undefined;
                // The function stored needs nothing: what it did need is supplied here.
                if (type?.tag === 'fn' && type.needs) {
                    const { needs: _, ...supplied } = type;
                    value = emit(b, n.value, { op: 'supply', value: value.id }, {
                        ...value.type,
                        value: supplied,
                    } as SemanticFlow);
                }
                const body = block(n.body);
                body.result = linear(n.body, body).id;
                return emit(b, n, { op: 'inject', name: n.name, value: value.id, body });
            }
            case 'constructor':
                return emit(b, n, {
                    op: 'construct',
                    name: n.name,
                    items: n.args.map((v) => linear(v, b).id),
                    instance: instance(n),
                });
            case 'apply':
                return call(n, b);
            case 'assign': {
                const target = lens(n.lens, b),
                    value = linear(n.value, b);
                return emit(b, n, { op: 'swap', lens: target.id, value: value.id });
            }
            case 'let':
                return letBody(n, b, false);
            case 'fn': {
                const f =
                    e.functions.find((f) => f.node === id(n)) ??
                    fail('Missing function metadata', n);
                const t = plainType(n);
                if (t.tag !== 'fn') return fail('Function has a non-function type', n);
                const captures = e.captures
                    .filter((c) => c.node === id(n))
                    .map((c) => {
                        const from = e.bindings.find((v) => v.id === c.from)!,
                            to = e.bindings.find((v) => v.id === c.to)!;
                        const move = e.lensMoves.find(
                            (m) => m.node === id(n) && m.binding === c.from,
                        );
                        if (!move) {
                            const value = emit(
                                b,
                                n,
                                { op: 'move', slot: ref(from) },
                                irPlain(c.type),
                            );
                            return { place: to.place, value: value.id, type: c.type };
                        }
                        const write = move.write ?? fail('Missing captured lens contract', n);
                        const value = give(b, n, c.from, { tag: 'flow', read: c.type, write });
                        return { place: to.place, value: value.id, type: c.type, lens: { write } };
                    });
                // The body is its own path: it holds what it captured and was passed.
                const outer = given;
                given = new Map();
                const body = block(n.body);
                body.result = (
                    n.body.type === 'lens' ? lens(n.body.lens, body) : linear(n.body, body)
                ).id;
                const parameters = n.args.map((a, i) => ({
                    pattern: pattern(a.pat),
                    lensPlace: a.pat.type === 'lens' ? f.parameterPlaces[i][0] : undefined,
                }));
                /** End an owned lens this function holds, unless it passed it on. */
                const ends = (place: string): Cleanup[] =>
                    given.has(holderKey({ place })) ? [] : [endHolder({ place })];
                const disposals = parameters.map((p, i): Cleanup[] => {
                    const argument = t.args[i];
                    return p.lensPlace && argument.tag === 'flow'
                        ? argument.owned
                            ? ends(p.lensPlace)
                            : [
                                  {
                                      kind: 'restored' as const,
                                      slot: { place: p.lensPlace, path: [] },
                                      type: argument.write,
                                  },
                              ]
                        : drops(p.pattern);
                });
                // Owned lenses end last to first, each in the place of a lens parameter.
                const lensDisposals = disposals.filter((_, i) => parameters[i].lensPlace).reverse();
                body.cleanup.push(
                    ...disposals.flatMap((actions, i) =>
                        parameters[i].lensPlace ? lensDisposals.shift()! : actions,
                    ),
                );
                body.cleanup.push(
                    ...captures.flatMap((c): Cleanup[] =>
                        c.lens
                            ? ends(c.place)
                            : [{ kind: 'drop-place', slot: { place: c.place, path: [] } }],
                    ),
                );
                given = outer;
                const functionId = `${id(n)}/function`;
                functions.push({
                    id: functionId,
                    origin: id(n),
                    type: t,
                    captures: captures.map((c) => ({
                        place: c.place,
                        type: c.type,
                        ...(c.lens ? { lens: c.lens } : {}),
                    })),
                    parameters,
                    body,
                });
                return emit(b, n, {
                    op: 'closure',
                    function: functionId,
                    captures: captures.map(({ place, value }) => ({ place, value })),
                });
            }
            case 'vector':
            case 'index':
                return fail('Vector syntax is expanded before lowering', n);
            case 'case': {
                if (n.value.type === 'lens')
                    return fail('Lens cases have not been semantically checked', n);
                const value = linear(n.value, b);
                const join = e.branches.find((v) => v.node === id(n))!;
                const before = new Map(given);
                const armGiven: (typeof given)[] = [];
                const cases = n.cases.map((arm, i) => {
                    const p = pattern(arm.pat),
                        body = block(arm.body);
                    given = new Map(before);
                    body.result = linear(arm.body, body).id;
                    armGiven.push(given);
                    // Drop live branch-edge values that the affine join makes unavailable.
                    for (const output of join.output) {
                        const before = join.arms[i].output.find((s) => s.place === output.place)!;
                        for (const path of output.empty)
                            if (
                                !before.empty.some(
                                    (p) =>
                                        p.length <= path.length && p.every((v, j) => path[j] === v),
                                )
                            ) {
                                const permit = [...e.bindings]
                                    .reverse()
                                    .find(
                                        (v) =>
                                            v.place === output.place &&
                                            v.borrow &&
                                            before.borrows.includes(v.borrow) &&
                                            e.borrows
                                                .find((loan) => loan.id === v.borrow)!
                                                .path.every((part, index) => path[index] === part),
                                    )?.borrow;
                                body.cleanup.push({
                                    kind: 'drop-place',
                                    slot: { place: output.place, path, permit },
                                });
                            }
                    }
                    body.cleanup.push(...drops(p));
                    return { pattern: p, body };
                });
                // A lens that one branch gives away is gone afterwards, so the others end it
                // on their own edge.
                given = new Map(armGiven.flatMap((g) => [...g]));
                // Newest first, the order their scopes would have ended them in.
                const newest = [...given].sort(([, a], [, b]) => b.declared - a.declared);
                cases.forEach((arm, i) => {
                    for (const [key, { from }] of newest)
                        if (!armGiven[i]!.has(key)) arm.body.cleanup.push(endHolder(from));
                });
                return emit(b, n, { op: 'case', value: value.id, cases });
            }
        }
    };
    const edgeDrops = (
        before: Elaboration['branches'][number]['output'],
        after: Elaboration['branches'][number]['output'],
    ): Cleanup[] =>
        after.flatMap((output) => {
            const input = before.find((s) => s.place === output.place)!;
            return output.empty
                .filter(
                    (path) =>
                        !input.empty.some(
                            (p) => p.length <= path.length && p.every((v, i) => path[i] === v),
                        ),
                )
                .map((path) => {
                    const permit = [...e.bindings]
                        .reverse()
                        .find(
                            (v) =>
                                v.place === output.place &&
                                v.borrow &&
                                input.borrows.includes(v.borrow) &&
                                e.borrows
                                    .find((l) => l.id === v.borrow)!
                                    .path.every((v, i) => path[i] === v),
                        )?.borrow;
                    return {
                        kind: 'drop-place' as const,
                        slot: { place: output.place, path, permit },
                    };
                });
        });
    const lens = (n: Lens, b: IRBlock): IRValue => {
        switch (n.type) {
            case 'id':
                return emit(b, n, { op: 'acquire', slot: ref(binding(n)) });
            case 'field':
                return emit(b, n, { op: 'acquire', slot: ref(binding(n)) });
            case 'tuple':
                return emit(b, n, { op: 'lens-tuple', items: n.items.map((v) => lens(v, b).id) });
            case 'constructor': {
                const [read, write] = e.instantiations.filter((i) => i.node === id(n));
                if (!read || !write) return fail('Missing constructor lens instantiations', n);
                const generic = (i: typeof read): Instance => ({
                    definition: i.definition,
                    arguments: i.arguments,
                    type: i.type,
                });
                return emit(b, n, {
                    op: 'lens-construct',
                    name: n.name,
                    items: n.args.map((v) => lens(v, b).id),
                    instance: generic(read),
                    writeInstance: generic(write),
                });
            }
            case 'apply':
                return call(n, b);
            case 'let':
                return letBody(n, b, true);
            case 'aslens': {
                const record =
                    e.temporaryLenses.find((m) => m.node === id(n)) ??
                    fail('Missing temporary lens restoration metadata', n);
                const backing =
                    e.bindings.find((v) => v.id === record.temporary) ??
                    fail('Missing temporary lens backing', n);
                const value = linear(n.value, b);
                const cleanup = block(n.body);
                const final = emit(cleanup, n.pat, { op: 'move', slot: ref(backing) });
                const p = pattern(n.pat);
                const refutable = (p: IRPattern): boolean =>
                    p.kind === 'literal' ||
                    p.kind === 'constructor' ||
                    (p.kind === 'tuple' && p.items.some(refutable)) ||
                    (p.kind === 'record' && subpatterns(p).some(refutable));
                if (refutable(p)) {
                    const matched = block(n.body);
                    matched.result = linear(n.body, matched).id;
                    matched.cleanup.push(...drops(p));
                    cleanup.result = emit(cleanup, n.body, {
                        op: 'case',
                        value: final.id,
                        cases: [{ pattern: p, body: matched }],
                    }).id;
                } else {
                    cleanup.instructions.push({
                        op: 'bind',
                        origin: id(n.pat),
                        value: final.id,
                        pattern: p,
                    });
                    cleanup.result = linear(n.body, cleanup).id;
                    cleanup.cleanup.push(...drops(p));
                }
                return emit(b, n, {
                    op: 'aslens',
                    initial: value.id,
                    backing: backing.place,
                    holds: record.dependencies
                        .filter((id) => id !== backing.id)
                        .map((id) => ref(e.bindings.find((v) => v.id === id)!)),
                    cleanup,
                    ...(n.reconstructionPattern
                        ? { reconstruction: pattern(n.reconstructionPattern) }
                        : {}),
                });
            }
            case 'index':
                return fail('Vector syntax is expanded before lowering', n);
            case 'case': {
                if (n.value.type === 'lens') return fail('Borrowed matching is not checked', n);
                const value = linear(n.value, b);
                const join = e.branches.find((v) => v.node === id(n))!;
                const before = given.size;
                const cases = n.cases.map((arm, i) => {
                    const p = pattern(arm.pat),
                        body = block(arm.body);
                    body.result = lens(arm.body, body).id;
                    if (given.size !== before)
                        throw new BackendDiagnostic(
                            'unsupported-owned-lens',
                            'An owned lens cannot yet move inside a lens-valued branch',
                            id(arm.body),
                        );
                    body.cleanup.push(...drops(p));
                    return {
                        pattern: p,
                        body,
                        setup: edgeDrops(join.arms[i].output, join.output),
                        restored: edgeDrops(join.arms[i].restored!, join.restored!),
                    };
                });
                return emit(b, n, { op: 'case', value: value.id, cases });
            }
            default:
                return fail('Unchecked lens form', n);
        }
    };
    const entry = block(e.source);
    entry.result = linear(e.source, entry).id;
    return freezeTree({
        id: e.id,
        definition: e.source.type === 'fn' && e.source.name ? e.id : undefined,
        signature: {
            ...(e.signature.bounds && { bounds: e.signature.bounds }),
            ...(e.signature.rows && { rows: e.signature.rows }),
            ...(e.signature.callsOnce && { callsOnce: e.signature.callsOnce }),
            quantified: e.signature.quantified,
            type: e.signature.type,
        },
        origins: e.nodes.map((n) => ({ id: n.id, loc: n.loc })),
        bindings: e.bindings,
        loans: e.borrows,
        functions,
        entry,
    });
}

export function lowerTypedProgram(
    elaborations: readonly Elaboration[],
    imports = defaultIRImports(),
): TypedProgram {
    const program: TypedProgram = {
        schemaVersion: 1,
        imports: structuredClone(imports),
        units: elaborations.map(lowerTypedUnit),
    };
    verifyTypedProgram(program);
    return freezeTree(program);
}
