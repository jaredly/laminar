import {
    layoutDefinitionsKey,
    layoutSchemaKey,
    relevantDefinitions,
} from './layout-definitions.ts';
import { mapSemantic } from './typed-ir.ts';
import { BackendDiagnostic, targetKey } from './backend/target.ts';
import { concreteName } from './concrete-layouts.ts';
import { memberKey, representationKey } from './representation-key.ts';
import { verifyRepresentations } from './verify-representations.ts';
import { typeKey, type IRBlock } from './typed-ir.ts';
import type { SemanticType } from './elaborated.ts';
import type {
    CallableMember,
    ValueRepresentation,
    RepresentationVariant,
} from './infer-representations.ts';
import type {
    ConcreteProgram,
    ConcreteLayout,
    ConcreteField,
    ConcreteBlock,
    ConcreteCode,
    CallableLayout,
    ConcreteWrapper,
} from './concrete-ir.ts';

/** Verify detached concrete records, their ABI references, and their correspondence to verified IR. */
export function verifyConcreteProgram(p: ConcreteProgram): void {
    const fail = (message: string): never => {
        throw new BackendDiagnostic('invalid-concrete-ir', message);
    };
    const canonical = (v: unknown): string =>
        JSON.stringify(v, (_k, x) =>
            x && typeof x === 'object' && !Array.isArray(x)
                ? Object.fromEntries(
                      Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                  )
                : x,
        );
    const eq = (a: unknown, b: unknown, message: string) => {
        if (canonical(a) !== canonical(b)) fail(message);
    };
    const unique = <T>(xs: readonly T[], id: (x: T) => string, label: string): Map<string, T> => {
        if (!Array.isArray(xs)) return fail(`Missing ${label} table`);
        const out = new Map<string, T>();
        for (const x of xs) {
            if (!x || typeof x !== 'object') return fail(`Malformed ${label}`);
            const k = id(x);
            if (typeof k !== 'string' || out.has(k)) fail(`Invalid or duplicate ${label}`);
            out.set(k, x);
        }
        return out;
    };
    if (p.schemaVersion !== 1) fail('Unknown concrete IR version');
    verifyRepresentations(p.semantic, p.analysis);
    const target = targetKey(p.target);
    if (target !== targetKey(p.semantic.target))
        fail('Concrete target differs from semantic target');
    const ls = unique(p.layouts, (l) => l.id, 'layout'),
        abis = unique(p.abis, (a) => a.id, 'ABI'),
        ws = unique(p.wrappers, (w) => w.id, 'wrapper'),
        cs = unique(p.callables, (c) => c.id, 'callable'),
        code = unique(p.code, (c) => c.id, 'code');
    const layout = (id: string): ConcreteLayout => ls.get(id) ?? fail('Absent concrete layout');
    const abi = (id: string) => abis.get(id) ?? fail('Absent concrete ABI');
    const wrapper = (id: string) => ws.get(id) ?? fail('Absent concrete wrapper');
    const physicalKey = (parts: unknown[]) => JSON.stringify(['physical-layout', target, ...parts]);
    const lid = (parts: unknown[]) => concreteName('layout', physicalKey(parts));
    const aid = (args: string[], result: string) =>
        concreteName('abi', JSON.stringify(['call-abi', target, 'opaque-pointer', args, result]));
    const concreteFields = (id: string, kind: ConcreteLayout['kind'], fields: ConcreteField[]) => {
        const l = layout(id);
        if (l.kind !== kind) fail('Incorrect concrete storage kind');
        eq(l.fields, fields, 'Incorrect concrete storage fields');
    };
    for (const l of ls.values()) {
        if (l.id !== concreteName('layout', l.key)) fail('Noncanonical physical layout ID');
        let parts: unknown[];
        try {
            parts = JSON.parse(l.key);
        } catch {
            return fail('Malformed physical layout key');
        }
        if (parts[0] !== 'physical-layout' || parts[1] !== target)
            fail('Wrong-target physical layout');
        if (!['f64', 'bool', 'string', 'unit', 'record', 'union', 'vector'].includes(l.kind))
            fail('Unknown concrete storage kind');
        unique(l.fields, (f) => f.name, 'layout field');
        for (const f of l.fields) {
            if (f.kind === 'value') layout(f.layout);
            else if (f.kind === 'pointer') {
                if (f.layout) layout(f.layout);
            } else if (f.kind === 'code') abi(f.abi);
            else fail('Unknown concrete field kind');
        }
    }
    const active = new Set<string>(),
        done = new Set<string>(),
        order = new Map(p.layouts.map((l, i) => [l.id, i]));
    const visit = (id: string): void => {
        if (active.has(id)) fail('Infinitely sized by-value layout');
        if (done.has(id)) return;
        active.add(id);
        for (const f of layout(id).fields)
            if (f.kind === 'value') {
                visit(f.layout);
                if (order.get(f.layout)! >= order.get(id)!)
                    fail('By-value layout dependency order');
            }
        active.delete(id);
        done.add(id);
    };
    ls.forEach((l) => visit(l.id));
    for (const a of abis.values()) {
        if (a.environment !== 'opaque-pointer') fail('Unresolved environment ABI');
        a.arguments.forEach(layout);
        layout(a.result);
        const key = JSON.stringify(['call-abi', target, 'opaque-pointer', a.arguments, a.result]);
        if (a.key !== key || a.id !== concreteName('abi', key)) fail('Noncanonical call ABI');
    }
    const unitType: SemanticType = { tag: 'tuple', items: [] };
    const nominalSchemas = p.analysis.layoutDefinitions ?? [];
    const seenData = new Set<string>();
    function data(t: SemanticType): string {
        if (t.tag === 'fn') return typeRecord(typeKey(t)).layout;
        const containsCallable = (t: SemanticType): boolean =>
            t.tag === 'fn' || (t.tag === 'tuple' && t.items.some(containsCallable));
        if (t.tag === 'tuple' && containsCallable(t)) {
            const items = t.items.map(data),
                id = lid(['aggregate', items]);
            concreteFields(
                id,
                'record',
                items.map((layout, i) => ({ name: `item${i}`, kind: 'value', layout })),
            );
            return id;
        }
        const schema = layoutSchemaKey(nominalSchemas, t);
        const id = lid(['data', typeKey(t), ...(schema ? [schema] : [])]);
        if (seenData.has(id)) return id;
        seenData.add(id);
        if (t.tag === 'tuple')
            concreteFields(
                id,
                t.items.length ? 'record' : 'unit',
                t.items.map((x, i) => ({ name: `item${i}`, kind: 'value', layout: data(x) })),
            );
        else if (t.tag === 'con' && !t.args.length && ['Number', 'Bool', 'String'].includes(t.name))
            concreteFields(
                id,
                t.name === 'Number' ? 'f64' : t.name === 'Bool' ? 'bool' : 'string',
                [],
            );
        else if (t.tag === 'con') {
            const d = nominalSchemas.find((d) => d.name === t.name);
            if (!d || d.parameters.length !== t.args.length)
                return fail('Missing physical nominal layout schema');
            const substitution = new Map(d.parameters.map((p, i) => [p, t.args[i]!]));
            concreteFields(
                id,
                d.kind,
                d.fields.map((f) => ({
                    name: f.name,
                    kind: f.indirect ? 'pointer' : 'value',
                    layout: data(mapSemantic(f.type, (p) => substitution.get(p))),
                })),
            );
        } else return fail('Unsolved or unsupported physical data layout');
        return id;
    }
    const unitLayout = data(unitType),
        shapes = new Map(p.analysis.shapes.map((s) => [s.id, s])),
        semanticLayouts = new Map(p.analysis.layouts.map((l) => [l.id, l]));
    // Callable records: one per callable type (`['type', T]`) and one per member and
    // type (`['member', T, member]`), keyed exactly as concrete lowering groups them.
    const groupKeyOf = (c: CallableLayout): string =>
        c.descriptor.kind === 'callable'
            ? JSON.stringify(['type', c.type])
            : JSON.stringify(['member', c.type, memberKey(c.descriptor as CallableMember)]);
    const memberGroupKey = (m: CallableMember, type: string): string =>
        JSON.stringify(['member', type, memberKey(m)]);
    const callableByGroup = unique(p.callables, groupKeyOf, 'callable descriptor');
    const typeRecord = (type: string): CallableLayout =>
        callableByGroup.get(JSON.stringify(['type', type])) ??
        fail('Missing concrete callable descriptor');
    const memberRecord = (m: CallableMember, type: string): CallableLayout =>
        callableByGroup.get(memberGroupKey(m, type)) ?? fail('Missing concrete callable member');
    const memberSets = new Map(p.analysis.callables.map((c) => [c.type, c.members]));
    const membersOf = (type: string): CallableMember[] => memberSets.get(type) ?? [];
    const fnTypeKey = (m: { unit: string; function: string }): string =>
        typeKey(
            p.semantic.program.units
                .find((u) => u.id === m.unit)!
                .functions.find((f) => f.id === m.function)!.type,
        );
    const seenShapes = new Set<string>();
    function storage(v: ValueRepresentation): string {
        if (v.kind === 'aggregate') {
            const items = v.items.map(storage);
            const id = lid(['aggregate', items]);
            concreteFields(
                id,
                'record',
                items.map((id, i) => ({ name: `item${i}`, kind: 'value', layout: id })),
            );
            return id;
        }
        if (v.kind === 'data') return data(semanticLayouts.get(v.layout)!.type);
        if (v.kind === 'callable') return typeRecord(v.type).layout;
        const id = lid(['lens', v.shape]);
        if (seenShapes.has(v.shape)) return id;
        seenShapes.add(v.shape);
        const s = shapes.get(v.shape) ?? fail('Absent logical lens shape');
        const replacement = data(semanticLayouts.get(s.replacement)!.type),
            restore = aid([replacement], unitLayout);
        abi(restore);
        const fields: ConcreteField[] =
            s.kind === 'thin'
                ? [
                      {
                          name: 'read',
                          kind: 'pointer',
                          layout: data(semanticLayouts.get(s.read)!.type),
                      },
                      ...(s.read === s.replacement
                          ? []
                          : [
                                {
                                    name: 'replacement',
                                    kind: 'pointer' as const,
                                    layout: replacement,
                                },
                            ]),
                  ]
                : s.items.map((child, i) => ({
                      name: `item${i}`,
                      kind: 'value',
                      layout: storage({ kind: 'lens', shape: child }),
                  }));
        fields.push(
            { name: 'restore', kind: 'code', abi: restore },
            { name: 'context', kind: 'pointer' },
        );
        concreteFields(id, 'record', fields);
        return id;
    }
    const contractKey = (c: {
        target: string;
        arguments: ValueRepresentation[];
        result: ValueRepresentation;
    }) =>
        JSON.stringify([c.target, c.arguments.map(representationKey), representationKey(c.result)]);
    const contracts = new Map<
        string,
        Map<
            string,
            {
                target: string;
                targets?: string[];
                arguments: ValueRepresentation[];
                result: ValueRepresentation;
            }
        >
    >();
    // Derived callable groups: every discovered callable type with its listed members,
    // and every member reified by code (variants and closure/global instructions).
    const typeGroups = new Set<string>(),
        descriptors = new Set<string>();
    const discoverMember = (m: CallableMember, type: string): void => {
        if (descriptors.has(memberGroupKey(m, type))) return;
        descriptors.add(memberGroupKey(m, type));
        if (m.kind === 'closure') m.captures.forEach(discover);
    };
    function discover(v: ValueRepresentation): void {
        if (v.kind === 'aggregate') v.items.forEach(discover);
        if (v.kind === 'callable' && !typeGroups.has(v.type)) {
            typeGroups.add(v.type);
            descriptors.add(JSON.stringify(['type', v.type]));
            membersOf(v.type).forEach((m) => discoverMember(m, v.type));
        }
    }
    function rawResult(
        descriptor: ValueRepresentation | CallableMember,
        contract: { target: string; arguments: ValueRepresentation[]; result: ValueRepresentation },
    ): ValueRepresentation | undefined {
        const variant = p.analysis.variants.find((v) => v.id === contract.target);
        if (variant) return variant.result;
        if (
            descriptor.kind === 'native' &&
            descriptor.definition === 'native/[]' &&
            contract.result.kind === 'lens'
        ) {
            const arg = contract.arguments[1];
            if (arg?.kind !== 'lens') return undefined;
            const parent = shapes.get(arg.shape)!;
            if (parent.kind !== 'thin') return fail('Invalid native index argument');
            const vector = semanticLayouts.get(parent.read)!.type;
            if (vector.tag !== 'con' || vector.name !== 'Vector')
                return fail('Invalid native index endpoints');
            const e = p.analysis.layouts.find(
                (l) => typeKey(l.type) === typeKey(vector.args[0]!),
            )!.id;
            return {
                kind: 'lens',
                shape: JSON.stringify(['thin', JSON.stringify(['backing', e, e])]),
            };
        }
        if (
            descriptor.kind !== 'native' ||
            descriptor.definition !== 'native/fst' ||
            contract.result.kind !== 'lens'
        )
            return undefined;
        const arg = contract.arguments[0]!;
        if (arg.kind !== 'lens') return undefined;
        const parent = shapes.get(arg.shape)!;
        if (parent.kind === 'tuple') return { kind: 'lens', shape: parent.items[0]! };
        const read = semanticLayouts.get(parent.read)!.type,
            write = semanticLayouts.get(parent.replacement)!.type;
        if (read.tag !== 'tuple' || write.tag !== 'tuple')
            return fail('Invalid native fst endpoints');
        const r = p.analysis.layouts.find((l) => typeKey(l.type) === typeKey(read.items[0]!))!.id;
        const w = p.analysis.layouts.find((l) => typeKey(l.type) === typeKey(write.items[0]!))!.id;
        return { kind: 'lens', shape: JSON.stringify(['thin', JSON.stringify(['backing', r, w])]) };
    }
    function addContract(type: string, c: RepresentationVariant['calls'][number]): void {
        if (!contracts.has(type)) contracts.set(type, new Map());
        contracts.get(type)!.set(contractKey(c), c);
    }
    const units = new Map(p.semantic.program.units.map((u) => [u.id, u]));
    const index = (b: IRBlock, r: Pick<RepresentationVariant, 'values' | 'calls'>): void => {
        const values = new Map(r.values.map((v) => [v.value, v.representation])),
            calls = new Map(r.calls.map((c) => [c.value, c]));
        r.values.forEach((v) => discover(v.representation));
        const walk = (body: IRBlock): void => {
            for (const i of body.instructions) {
                if (i.op === 'call') {
                    const callee = values.get(i.callee)!,
                        call = calls.get(i.out.id)!;
                    if (callee.kind !== 'callable') return fail('Call operand is not callable');
                    // Indirect calls are entries of the callee type's record.
                    if (!call.callee) addContract(callee.type, call);
                } else if (i.op === 'scope') walk(i.body);
                else if (i.op === 'aslens') walk(i.cleanup);
                else if (i.op === 'case') i.cases.forEach((c) => walk(c.body));
            }
        };
        walk(b);
    };
    p.analysis.variants.forEach((v) => {
        v.arguments.forEach(discover);
        v.captures.forEach(discover);
        discover(v.result);
        index(units.get(v.unit)!.functions.find((f) => f.id === v.function)!.body, v);
    });
    p.analysis.entries.forEach((e) => index(units.get(e.unit)!.entry, e));
    const discoverType = (t: SemanticType): void => {
        if (t.tag === 'fn') discover({ kind: 'callable', type: typeKey(t) });
        else if (t.tag === 'tuple') t.items.forEach(discoverType);
    };
    p.analysis.layouts.forEach((l) => discoverType(l.type));
    const graphKey = JSON.stringify([
        layoutDefinitionsKey(
            relevantDefinitions(
                p.analysis.layoutDefinitions,
                p.analysis.layouts.map((l) => l.type),
            ),
        ),
        p.analysis.variants.map((v) => v.key).sort(),
        [...typeGroups]
            .map((t) => [JSON.stringify(['type', t]), [...(contracts.get(t)?.keys() ?? [])].sort()])
            .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    ]);
    if (p.graphKey !== graphKey) fail('Concrete graph cache identity mismatch');
    const codeName = (variant: string) =>
        concreteName('code', JSON.stringify([target, graphKey, variant]));
    const usedWrappers = new Set<string>();
    type EntryContract = {
        target: string;
        targets?: string[];
        arguments: ValueRepresentation[];
        result: ValueRepresentation;
    };
    /** Checks one wrapper of record `c` for `contract`, including its sources. */
    function checkEntry(c: CallableLayout, w: ConcreteWrapper, contract: EntryContract): void {
        const k = groupKeyOf(c);
        const expectedABI = aid(contract.arguments.map(storage), storage(contract.result));
        const wk = JSON.stringify([
            'wrapper',
            target,
            graphKey,
            k,
            contractKey(contract),
            expectedABI,
            c.environment,
        ]);
        if (
            w.abi !== expectedABI ||
            w.environment !== c.environment ||
            w.key !== wk ||
            w.id !== concreteName('wrapper', wk)
        )
            fail('Invalid concrete wrapper contract');
        if (c.descriptor.kind === 'callable') return fail('Type entries cannot name code wrappers');
        if (w.kind === 'adapt-lens-result') {
            const raw = rawResult(c.descriptor, contract);
            if (raw?.kind !== 'lens' || contract.result.kind !== 'lens')
                return fail('Missing lens result contract');
            const from = shapes.get(raw.shape)!,
                to = shapes.get(contract.result.shape)!;
            if (
                to.kind !== 'thin' ||
                from.read !== to.read ||
                from.replacement !== to.replacement ||
                from.id === to.id
            )
                fail('Invalid lens result normalization');
            const rawABI = aid(contract.arguments.map(storage), storage(raw));
            const rawContract = { ...contract, result: raw };
            const rawKey = JSON.stringify([
                'wrapper',
                target,
                graphKey,
                k,
                contractKey(rawContract),
                rawABI,
                c.environment,
            ]);
            const source = wrapper(concreteName('wrapper', rawKey));
            if (
                !['invoke', 'native'].includes(source.kind) ||
                w.source !== source.id ||
                w.from !== from.id ||
                w.to !== to.id ||
                w.ownership !== 'restore-source-and-release'
            )
                fail('Invalid lens result restoration adapter');
            eq(w.order, ['restore-source', 'release'], 'Lens result restoration order changed');
            usedWrappers.add(source.id);
            checkEntry(c, source, rawContract);
        } else if (w.kind === 'invoke') {
            const callee = code.get(w.code) ?? fail('Wrapper references absent code');
            const exact = p.analysis.variants.find((v) => v.id === contract.target);
            // Exact variants receive exactly their analyzed argument representations.
            if (
                exact &&
                exact.arguments.some(
                    (a, n) => representationKey(a) !== representationKey(contract.arguments[n]!),
                )
            )
                fail('Invoke wrapper argument contract mismatch');
            if (
                w.code !== codeName(contract.target) ||
                callee.abi !== w.abi ||
                callee.environment !== w.environment ||
                w.ownership !== 'transfer-captures-and-free'
            )
                fail('Invoke wrapper/code ABI mismatch');
        } else if (w.kind === 'native') {
            if (
                w.definition !== contract.target ||
                !p.semantic.program.imports.some((x) => x.definition === w.definition) ||
                w.ownership !== 'no-environment'
            )
                fail('Native wrapper contract mismatch');
        } else fail('Invocation uses a disposer');
    }
    for (const c of cs.values()) {
        const k = groupKeyOf(c),
            caps = c.descriptor.kind === 'closure' ? c.descriptor.captures : [];
        if (c.id !== concreteName('callable', JSON.stringify([k])))
            fail('Noncanonical callable ID');
        if (c.environment !== lid(['environment', caps.map(storage)]))
            fail('Incorrect environment identity');
        concreteFields(
            c.environment,
            'record',
            caps.map((v, i) => ({ name: `capture${i}`, kind: 'value', layout: storage(v) })),
        );
        const dispose = wrapper(c.dispose);
        usedWrappers.add(dispose.id);
        if (
            dispose.kind !== 'dispose' ||
            dispose.environment !== c.environment ||
            dispose.abi !== aid([], unitLayout) ||
            dispose.ownership !== 'drop-captures-and-free'
        )
            return fail('Invalid disposer contract');
        eq(dispose.captures, caps.map(storage), 'Disposer capture layout mismatch');
        const dk = JSON.stringify(['dispose', target, k, c.environment, caps.map(storage)]);
        if (dispose.key !== dk || dispose.id !== concreteName('wrapper', dk))
            fail('Invalid disposer name');
        if (c.descriptor.kind === 'callable') {
            // A callable type's record declares one ABI per indirect-call contract.
            if (c.type !== c.descriptor.type) fail('Callable record type mismatch');
            const expectedContracts = [...(contracts.get(c.type)?.values() ?? [])].sort((a, b) =>
                contractKey(a) < contractKey(b) ? -1 : 1,
            );
            if (c.entries.length !== expectedContracts.length)
                fail('Callable entry coverage mismatch');
            eq(
                c.entries,
                expectedContracts.map((contract, i) => ({
                    abi: aid(contract.arguments.map(storage), storage(contract.result)),
                    field: `invoke${i}`,
                })),
                'Callable entry coverage or ABI changed',
            );
            const expectedLayout = lid(['callable', c.entries.map((e) => e.abi)]);
            if (c.layout !== expectedLayout) fail('Callable layout identity mismatch');
            concreteFields(c.layout, 'record', [
                { name: 'environment', kind: 'pointer' },
                { name: 'dispose', kind: 'code', abi: dispose.abi },
                ...c.entries.map((e) => ({ name: e.field, kind: 'code' as const, abi: e.abi })),
            ]);
        } else {
            // A member's record is its type's record; a listed member fills each entry
            // with its own wrapper, an unlisted (direct-only) one with none.
            const owner = typeRecord(c.type);
            if (c.layout !== owner.layout) fail('Member callable layout mismatch');
            if (c.descriptor.kind === 'closure' && fnTypeKey(c.descriptor) !== c.type)
                fail('Member callable type mismatch');
            const listed = membersOf(c.type).findIndex(
                (m) => memberKey(m) === memberKey(c.descriptor as CallableMember),
            );
            eq(
                c.entries,
                listed < 0
                    ? []
                    : owner.entries.map((entry, index) => {
                          const contract = [...(contracts.get(c.type)?.values() ?? [])].sort(
                              (a, b) => (contractKey(a) < contractKey(b) ? -1 : 1),
                          )[index]!;
                          const memberContract = {
                              target: contract.targets![listed]!,
                              arguments: contract.arguments,
                              result: contract.result,
                          };
                          const key = JSON.stringify([
                              'wrapper',
                              target,
                              graphKey,
                              k,
                              contractKey(memberContract),
                              entry.abi,
                              c.environment,
                          ]);
                          const w = wrapper(concreteName('wrapper', key));
                          usedWrappers.add(w.id);
                          checkEntry(c, w, memberContract);
                          return { wrapper: w.id, abi: entry.abi, field: entry.field };
                      }),
                'Member callable entries changed',
            );
        }
    }
    const verifyBody = (
        unitId: string,
        original: IRBlock,
        body: ConcreteBlock,
        r: Pick<RepresentationVariant, 'values' | 'calls'>,
    ): void => {
        const reps = new Map(r.values.map((v) => [v.value, v.representation])),
            calls = new Map(r.calls.map((c) => [c.value, c]));
        const walk = (src: IRBlock, dst: ConcreteBlock): void => {
            eq(
                {
                    origin: dst.origin,
                    result: dst.result,
                    layout: dst.layout,
                    cleanup: dst.cleanup,
                },
                {
                    origin: src.origin,
                    result: src.result,
                    layout: storage(reps.get(src.result)!),
                    cleanup: src.cleanup,
                },
                'Concrete block contract mismatch',
            );
            if (dst.instructions.length !== src.instructions.length)
                fail('Concrete instruction coverage mismatch');
            src.instructions.forEach((i, n) => {
                const o = dst.instructions[n]!;
                if (i.op === 'bind' || i.op === 'borrow') {
                    eq(o, i, 'Changed logical binding or borrow');
                    return;
                }
                if (!('out' in o)) return fail('Missing concrete output');
                eq(
                    o.out,
                    { ...i.out, layout: storage(reps.get(i.out.id)!) },
                    'Concrete output layout/type mismatch',
                );
                if (i.op === 'aslens') {
                    if (o.op !== 'aslens') return fail('Temporary lens operation changed');
                    eq(
                        { ...o, out: undefined, cleanup: undefined },
                        { ...i, out: undefined, cleanup: undefined },
                        'Temporary lens contract changed',
                    );
                    walk(i.cleanup, o.cleanup);
                } else if (i.op === 'scope') {
                    if (o.op !== 'scope') return fail('Scope operation changed');
                    eq(o.origin, i.origin, 'Scope origin changed');
                    if ('retainedStorage' in o) fail('Unexpected retained storage contract');
                    walk(i.body, o.body);
                } else if (i.op === 'case') {
                    if (o.op !== 'case') return fail('Case operation changed');
                    if (
                        o.origin !== i.origin ||
                        o.value !== i.value ||
                        o.cases.length !== i.cases.length
                    )
                        fail('Case contract changed');
                    const join =
                        i.out.type.tag === 'flow'
                            ? {
                                  kind: 'selected',
                                  arms: i.cases.map(
                                      (c) =>
                                          (
                                              reps.get(c.body.result)! as {
                                                  kind: 'lens';
                                                  shape: string;
                                              }
                                          ).shape,
                                  ),
                                  result: (reps.get(i.out.id)! as { kind: 'lens'; shape: string })
                                      .shape,
                              }
                            : undefined;
                    if ('cleanupJoins' in o || 'storageJoins' in o)
                        fail('Unexpected storage adapter');
                    eq(o.lensJoin, join, 'Selected-branch restoration adapter changed');
                    if ('aggregateJoin' in o) fail('Obsolete aggregate join adapter');
                    // Callable values share their type's record: joins are moves.
                    if ('callableJoin' in o) fail('Obsolete callable join adapter');
                    i.cases.forEach((c, j) => {
                        eq(o.cases[j]!.setup, c.setup, 'Case setup normalization changed');
                        eq(
                            o.cases[j]!.restored,
                            c.restored,
                            'Case restoration normalization changed',
                        );
                        eq(o.cases[j]!.pattern, c.pattern, 'Case pattern changed');
                        walk(c.body, o.cases[j]!.body);
                    });
                } else if (i.op === 'global' || i.op === 'closure') {
                    if (i.out.type.tag !== 'plain') return fail('Callable produced a lens');
                    let member: CallableMember;
                    if (i.op === 'closure')
                        member = {
                            kind: 'closure',
                            unit: unitId,
                            function: i.function,
                            captures: i.captures.map((c) => reps.get(c.value)!),
                        };
                    else {
                        const target = p.semantic.program.units.find(
                            (u) => u.definition === i.instance.definition,
                        );
                        const entry = target?.entry.instructions[0];
                        member =
                            target && entry?.op === 'closure'
                                ? {
                                      kind: 'closure',
                                      unit: target.id,
                                      function: entry.function,
                                      captures: [],
                                  }
                                : { kind: 'native', definition: i.instance.definition };
                    }
                    const type = typeKey(i.out.type.value);
                    discoverMember(member, type);
                    const c = memberRecord(member, type);
                    eq(
                        o,
                        {
                            op: 'make-callable',
                            origin: i.origin,
                            out: o.out,
                            callable: c.id,
                            captures: i.op === 'closure' ? i.captures : [],
                        },
                        'Reified callable construction changed',
                    );
                } else if (i.op === 'call') {
                    if (o.op !== 'invoke') return fail('Call was not concretized');
                    const callee = reps.get(i.callee)!,
                        contract = calls.get(i.out.id)!;
                    if (callee.kind !== 'callable') return fail('Call operand is not callable');
                    const expectedABI = aid(
                        contract.arguments.map(storage),
                        storage(contract.result),
                    );
                    if (contract.callee) {
                        // A direct call invokes its known member's exact wrapper.
                        const member = memberRecord(contract.callee, callee.type);
                        const wrapperKey = JSON.stringify([
                            'wrapper',
                            target,
                            graphKey,
                            groupKeyOf(member),
                            contractKey(contract),
                            expectedABI,
                            member.environment,
                        ]);
                        const w = wrapper(concreteName('wrapper', wrapperKey));
                        usedWrappers.add(w.id);
                        checkEntry(member, w, contract);
                        eq(
                            o,
                            {
                                op: 'invoke',
                                origin: i.origin,
                                out: o.out,
                                callee: i.callee,
                                args: i.args,
                                wrapper: w.id,
                                abi: w.abi,
                            },
                            'Concrete invocation target/ABI changed',
                        );
                        return;
                    }
                    // An indirect call invokes its type record's entry for this contract.
                    const c = typeRecord(callee.type);
                    const entries = [...(contracts.get(callee.type)?.values() ?? [])].sort(
                        (a, b) => (contractKey(a) < contractKey(b) ? -1 : 1),
                    );
                    const index = entries.findIndex(
                        (e) => contractKey(e) === contractKey(contract),
                    );
                    const entry = c.entries[index] ?? fail('Missing invocation slot');
                    eq(
                        o,
                        {
                            op: 'invoke',
                            origin: i.origin,
                            out: o.out,
                            callee: i.callee,
                            args: i.args,
                            abi: entry.abi,
                            field: entry.field,
                        },
                        'Concrete invocation target/ABI changed',
                    );
                } else eq(o, { ...i, out: o.out }, 'Concrete operation changed');
            });
        };
        walk(original, body);
    };
    const expectedCode = new Set<string>();
    for (const v of p.analysis.variants) {
        const c = code.get(codeName(v.id)) ?? fail('Missing representation-specialized code');
        expectedCode.add(c.id);
        const fn = units.get(v.unit)!.functions.find((f) => f.id === v.function)!,
            member: CallableMember = {
                kind: 'closure',
                unit: v.unit,
                function: v.function,
                captures: v.captures,
            };
        discoverMember(member, fnTypeKey(v));
        const callable = memberRecord(member, fnTypeKey(v));
        eq(
            {
                unit: c.unit,
                function: c.function,
                abi: c.abi,
                environment: c.environment,
                captures: c.captures,
                parameters: c.parameters,
            },
            {
                unit: v.unit,
                function: v.function,
                abi: aid(v.arguments.map(storage), storage(v.result)),
                environment: callable.environment,
                captures: fn.captures.map((x, i) => ({
                    place: x.place,
                    layout: storage(v.captures[i]!),
                })),
                parameters: fn.parameters.map((x, i) => ({
                    ...x,
                    layout: storage(v.arguments[i]!),
                })),
            },
            'Concrete function ABI/storage contract mismatch',
        );
        verifyBody(v.unit, fn.body, c.body, v);
    }
    const expectedEntries: string[] = [];
    p.analysis.entries.forEach((e, i) => {
        const exported = p.analysis.exports.find((x) => x.entry === i);
        if (exported) {
            expectedEntries.push(codeName(exported.variant));
            return;
        }
        const id = concreteName('entry', JSON.stringify([target, graphKey, e.unit, i])),
            c = code.get(id) ?? fail('Missing concrete entry');
        expectedCode.add(id);
        expectedEntries.push(id);
        eq(
            {
                unit: c.unit,
                function: c.function,
                abi: c.abi,
                environment: c.environment,
                captures: c.captures,
                parameters: c.parameters,
            },
            {
                unit: e.unit,
                function: undefined,
                abi: aid([], storage(p.analysis.roots[i]!.result)),
                environment: unitLayout,
                captures: [],
                parameters: [],
            },
            'Concrete entry ABI mismatch',
        );
        verifyBody(e.unit, units.get(e.unit)!.entry, c.body, e);
    });
    eq(p.entries, expectedEntries, 'Entry code coverage mismatch');
    eq(
        [...callableByGroup.keys()].sort(),
        [...descriptors].sort(),
        'Concrete callable coverage mismatch',
    );
    if (usedWrappers.size !== ws.size) fail('Unreferenced concrete wrapper');
    if (expectedCode.size !== code.size) fail('Unreferenced concrete code');
    eq(
        p.forward,
        {
            layouts: [...ls.keys()].sort(),
            abis: [...abis.keys()].sort(),
            code: [...code.keys()].sort(),
        },
        'Incomplete forward declarations',
    );
}
