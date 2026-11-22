import { freezeTree, type SemanticType } from './elaborated.ts';
import { BackendDiagnostic, targetKey } from './backend/target.ts';
import {
    inferRepresentations,
    type RepresentationAnalysis,
    type RepresentationVariant,
    type ValueRepresentation,
    type CallableMember,
} from './infer-representations.ts';
import { verifyRepresentations } from './verify-representations.ts';
import { memberKey, representationKey } from './representation-key.ts';
import { ConcreteLayoutTable, concreteName } from './concrete-layouts.ts';
import {
    specializeProgram,
    type SpecializedProgram,
    type SpecializationRoot,
} from './specialize.ts';
import type { TargetConfig } from './backend/target.ts';
import { typeKey, type TypedProgram } from './typed-ir.ts';
import {
    layoutDefinitionsKey,
    relevantDefinitions,
    type NominalLayoutDefinition,
} from './layout-definitions.ts';
import type { EntryRepresentationArgument } from './infer-representations.ts';
import type { IRBlock, IRUnit } from './typed-ir.ts';
import type {
    ConcreteProgram,
    ConcreteWrapper,
    CallableLayout,
    ConcreteBlock,
    ConcreteInstruction,
    ConcreteCode,
    ConcreteField,
    ConcreteLayout,
} from './concrete-ir.ts';
import { verifyConcreteProgram } from './verify-concrete.ts';

type Contract = {
    target: string;
    targets?: string[];
    arguments: ValueRepresentation[];
    result: ValueRepresentation;
};
type Group = {
    descriptor: CallableLayout['descriptor'];
    /** The semantic function type key of every value of this record. */
    type: string;
    key: string;
    contracts: Map<string, Contract>;
    building?: boolean;
    record?: CallableLayout;
};

/** Materialize representation variants as independently verifiable code and explicit typed callables. */
export function lowerConcreteProgram(
    input: SpecializedProgram,
    provided?: RepresentationAnalysis,
): ConcreteProgram {
    const semantic = freezeTree(structuredClone(input));
    const analysis = freezeTree(structuredClone(provided ?? inferRepresentations(semantic)));
    verifyRepresentations(semantic, analysis);
    const table = new ConcreteLayoutTable(semantic.target, analysis.layoutDefinitions, 512, (t) =>
            typeLayout(typeGroup(typeKey(t))),
        ),
        unitType = { tag: 'tuple' as const, items: [] };
    const unitLayout = table.data(unitType),
        groups = new Map<string, Group>(),
        wrappers = new Map<string, ConcreteWrapper>();
    const units = new Map(semantic.program.units.map((u) => [u.id, u]));
    const variants = new Map(analysis.variants.map((v) => [v.id, v]));
    const dataLayouts = new Map(analysis.layouts.map((l) => [l.id, l]));
    const shapes = new Map(analysis.shapes.map((s) => [s.id, s]));
    const fail = (message: string): never => {
        throw new BackendDiagnostic('unsolved-concrete-abi', message);
    };
    // Callable records: one ABI table per callable type and one per member,
    // sharing the type's record layout and entry
    // order, so a member's value already is a value of its type.
    const members = new Map(analysis.callables.map((c) => [c.type, c.members]));
    const typeGroup = (type: string): Group => {
        const key = JSON.stringify(['type', type]);
        let g = groups.get(key);
        if (!g) {
            g = { descriptor: { kind: 'callable', type }, type, key, contracts: new Map() };
            groups.set(key, g);
            (members.get(type) ?? []).forEach((m) => memberGroup(m, type));
        }
        return g;
    };
    const memberGroup = (m: CallableMember, type: string): Group => {
        const key = JSON.stringify(['member', type, memberKey(m)]);
        let g = groups.get(key);
        if (!g) {
            g = { descriptor: m, type, key, contracts: new Map() };
            groups.set(key, g);
            if (m.kind === 'closure') m.captures.forEach(discover);
        }
        return g;
    };
    const memberOf = (code: { unit: string; function: string }, captures: ValueRepresentation[]) =>
        ({ kind: 'closure', unit: code.unit, function: code.function, captures }) as const;
    const fnTypeKey = (unit: string, fn: string): string =>
        typeKey(units.get(unit)!.functions.find((f) => f.id === fn)!.type);
    function discover(v: ValueRepresentation): void {
        if (v.kind === 'aggregate') v.items.forEach(discover);
        if (v.kind === 'callable') typeGroup(v.type);
    }
    const contractKey = (c: Contract): string =>
        JSON.stringify([c.target, c.arguments.map(representationKey), representationKey(c.result)]);
    function rawResult(g: Group, c: Contract): ValueRepresentation | undefined {
        const variant = variants.get(c.target);
        if (variant) return variant.result;
        if (
            g.descriptor.kind === 'native' &&
            c.target === 'native/[]' &&
            c.result.kind === 'lens'
        ) {
            const argument = c.arguments[1];
            if (argument?.kind !== 'lens') return undefined;
            const shape = shapes.get(argument.shape)!;
            if (shape.kind !== 'thin') return fail('Invalid native index argument');
            const vector = dataLayouts.get(shape.read)!.type;
            if (vector.tag !== 'con' || vector.name !== 'Vector')
                return fail('Invalid native index endpoints');
            const e = analysis.layouts.find(
                (l) => typeKey(l.type) === typeKey(vector.args[0]!),
            )!.id;
            return {
                kind: 'lens',
                shape: JSON.stringify(['thin', JSON.stringify(['backing', e, e])]),
            };
        }
        if (g.descriptor.kind !== 'native' || c.target !== 'native/fst' || c.result.kind !== 'lens')
            return undefined;
        const argument = c.arguments[0]!;
        if (argument.kind !== 'lens') return undefined;
        const shape = shapes.get(argument.shape)!;
        if (shape.kind === 'tuple') return { kind: 'lens', shape: shape.items[0]! };
        const read = dataLayouts.get(shape.read)!.type,
            write = dataLayouts.get(shape.replacement)!.type;
        if (read.tag !== 'tuple' || write.tag !== 'tuple') return fail('Invalid native projection');
        const r = analysis.layouts.find((l) => typeKey(l.type) === typeKey(read.items[0]!))!.id;
        const w = analysis.layouts.find((l) => typeKey(l.type) === typeKey(write.items[0]!))!.id;
        return { kind: 'lens', shape: JSON.stringify(['thin', JSON.stringify(['backing', r, w])]) };
    }
    function addContract(g: Group, call: Contract): void {
        g.contracts.set(contractKey(call), call);
    }
    function index(body: IRBlock, record: Pick<RepresentationVariant, 'values' | 'calls'>): void {
        const values = new Map(record.values.map((v) => [v.value, v.representation]));
        const calls = new Map(record.calls.map((c) => [c.value, c]));
        record.values.forEach((v) => discover(v.representation));
        const walk = (b: IRBlock) => {
            for (const i of b.instructions) {
                if (i.op === 'call') {
                    const callee = values.get(i.callee) ?? fail('Missing callable annotation'),
                        call = calls.get(i.out.id)!;
                    if (callee.kind !== 'callable') return fail('Call operand is not callable');
                    // Indirect calls are entries of the callee type's record; direct
                    // calls use their member's exact wrapper.
                    if (!call.callee) addContract(typeGroup(callee.type), call);
                } else if (i.op === 'scope') walk(i.body);
                else if (i.op === 'aslens') walk(i.cleanup);
                else if (i.op === 'case') i.cases.forEach((c) => walk(c.body));
            }
        };
        walk(body);
    }
    for (const v of analysis.variants) {
        v.arguments.forEach(discover);
        v.captures.forEach(discover);
        discover(v.result);
        const fn = units.get(v.unit)!.functions.find((f) => f.id === v.function)!;
        index(fn.body, v);
    }
    analysis.entries.forEach((e) => index(units.get(e.unit)!.entry, e));
    const discoverType = (t: SemanticType): void => {
        if (t.tag === 'fn') typeGroup(typeKey(t));
        else if (t.tag === 'tuple') t.items.forEach(discoverType);
    };
    analysis.layouts.forEach((l) => discoverType(l.type));
    const graphKey = JSON.stringify([
        layoutDefinitionsKey(
            relevantDefinitions(
                analysis.layoutDefinitions,
                analysis.layouts.map((l) => l.type),
            ),
        ),
        analysis.variants.map((v) => v.key).sort(),
        [...groups.values()]
            .filter((g) => g.descriptor.kind === 'callable')
            .map((g) => [g.key, [...g.contracts.keys()].sort()])
            .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    ]);
    const codeName = (variant: string) =>
        concreteName('code', JSON.stringify([targetKey(semantic.target), graphKey, variant]));
    // Each discovered invocation belongs to the same concrete environment group wherever reified.
    const shapeLayouts = new Map<string, string>();
    const layout = (v: ValueRepresentation): string => {
        if (v.kind === 'aggregate') {
            const items = v.items.map(layout);
            return table.record(
                ['aggregate', items],
                'record',
                items.map((id, i) => ({ name: `item${i}`, kind: 'value', layout: id })),
            );
        }
        if (v.kind === 'data') return table.data(dataLayouts.get(v.layout)!.type);
        if (v.kind === 'callable') return typeLayout(typeGroup(v.type));
        const prior = shapeLayouts.get(v.shape);
        if (prior) return prior;
        const s = shapes.get(v.shape)!;
        const replacement = table.data(dataLayouts.get(s.replacement)!.type);
        const restore = table.abi([replacement], unitLayout);
        const fields: ConcreteField[] =
            s.kind === 'thin'
                ? [
                      {
                          name: 'read',
                          kind: 'pointer',
                          layout: table.data(dataLayouts.get(s.read)!.type),
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
                : s.items.map((id, i) => ({
                      name: `item${i}`,
                      kind: 'value',
                      layout: layout({ kind: 'lens', shape: id }),
                  }));
        fields.push(
            { name: 'restore', kind: 'code', abi: restore },
            { name: 'context', kind: 'pointer' },
        );
        const id = table.record(['lens', v.shape], 'record', fields);
        shapeLayouts.set(v.shape, id);
        return id;
    };
    function wrapper(g: Group, c: Contract, environment: string): ConcreteWrapper {
        const abi = table.abi(c.arguments.map(layout), layout(c.result));
        const key = JSON.stringify([
            'wrapper',
            targetKey(semantic.target),
            graphKey,
            g.key,
            contractKey(c),
            abi,
            environment,
        ]);
        const id = concreteName('wrapper', key);
        const prior = wrappers.get(id);
        if (prior) return prior;
        if (g.descriptor.kind === 'callable') return fail('Type entries have no code wrapper');
        const raw = rawResult(g, c);
        if (raw && representationKey(raw) !== representationKey(c.result)) {
            if (raw.kind === 'lens' && c.result.kind === 'lens') {
                const source = wrapper(g, { ...c, result: raw }, environment);
                const w: ConcreteWrapper = {
                    id,
                    key,
                    kind: 'adapt-lens-result',
                    abi,
                    environment,
                    source: source.id,
                    from: raw.shape,
                    to: c.result.shape,
                    ownership: 'restore-source-and-release',
                    order: ['restore-source', 'release'],
                };
                wrappers.set(id, w);
                return w;
            }
            return fail('Unsupported result adapter');
        }
        const w: ConcreteWrapper = variants.has(c.target)
            ? {
                  id,
                  key,
                  kind: 'invoke',
                  abi,
                  environment,
                  code: codeName(c.target),
                  ownership: 'transfer-captures-and-free',
              }
            : {
                  id,
                  key,
                  kind: 'native',
                  abi,
                  environment,
                  definition: c.target,
                  ownership: 'no-environment',
              };
        wrappers.set(id, w);
        return w;
    }
    // Build environments independently of entries so member captures may refer
    // to their own callable type.
    const environments = new Map<string, { environment: string; dispose: string }>();
    function memberEnvironment(g: Group): { environment: string; dispose: string } {
        const prior = environments.get(g.key);
        if (prior) return prior;
        const captures = g.descriptor.kind === 'closure' ? g.descriptor.captures : [];
        const environment = table.record(
            // Environments are keyed by capture layouts, like callable storage.
            ['environment', captures.map(layout)],
            'record',
            captures.map((v, i) => ({ name: `capture${i}`, kind: 'value', layout: layout(v) })),
        );
        const disposeKey = JSON.stringify([
            'dispose',
            targetKey(semantic.target),
            g.key,
            environment,
            captures.map(layout),
        ]);
        const dispose = concreteName('wrapper', disposeKey);
        wrappers.set(dispose, {
            id: dispose,
            key: disposeKey,
            kind: 'dispose',
            abi: table.abi([], unitLayout),
            environment,
            captures: captures.map(layout),
            ownership: 'drop-captures-and-free',
        });
        const result = { environment, dispose };
        environments.set(g.key, result);
        return result;
    }
    // A callable type's physical record follows from its entry ABIs alone, so member
    // environments (which may capture values of the same type) can name it while the
    // type's member entries are still being built.
    const typeLayouts = new Map<string, string>();
    const sortedContracts = (g: Group): Contract[] =>
        [...g.contracts.values()].sort((a, b) => (contractKey(a) < contractKey(b) ? -1 : 1));
    function typeLayout(g: Group): string {
        const prior = typeLayouts.get(g.key);
        if (prior) return prior;
        const abis = sortedContracts(g).map((c) =>
            table.abi(c.arguments.map(layout), layout(c.result)),
        );
        const physical = table.record(['callable', abis], 'record', [
            { name: 'environment', kind: 'pointer' },
            { name: 'dispose', kind: 'code', abi: table.abi([], unitLayout) },
            ...abis.map((abi, n) => ({ name: `invoke${n}`, kind: 'code' as const, abi })),
        ]);
        typeLayouts.set(g.key, physical);
        return physical;
    }
    // Group keys are unique, so record identities need not wait for layouts.
    const callableId = (g: Group): string => concreteName('callable', JSON.stringify([g.key]));
    function callable(g: Group): CallableLayout {
        if (g.record) return g.record;
        if (g.building) return fail('Recursive callable ABI needs an explicit recursive signature');
        g.building = true;
        const { environment, dispose } = memberEnvironment(g);
        let entries: CallableLayout['entries'];
        let physical: string;
        if (g.descriptor.kind === 'callable') {
            // The type record declares its indirect-call ABIs without naming code.
            physical = typeLayout(g);
            entries = sortedContracts(g).map((c, index) => ({
                abi: table.abi(c.arguments.map(layout), layout(c.result)),
                field: `invoke${index}`,
            }));
        } else {
            // A member's record is its type's record. Members that may reach indirect
            // calls fill every entry with their own wrapper for that contract; a value
            // used only as a direct callee carries no entries.
            physical = typeLayout(typeGroup(g.type));
            const owner = callable(typeGroup(g.type));
            const listed = (members.get(g.type) ?? []).findIndex(
                (m) => memberKey(m) === memberKey(g.descriptor as CallableMember),
            );
            entries =
                listed < 0
                    ? []
                    : owner.entries.map((entry, index) => {
                          const contract = sortedContracts(typeGroup(g.type))[index]!;
                          const w = wrapper(
                              g,
                              {
                                  target: contract.targets![listed]!,
                                  arguments: contract.arguments,
                                  result: contract.result,
                              },
                              environment,
                          );
                          if (w.abi !== entry.abi) return fail('Callable member ABI mismatch');
                          return { wrapper: w.id, abi: entry.abi, field: entry.field };
                      });
        }
        g.record = {
            id: callableId(g),
            descriptor: g.descriptor,
            type: g.type,
            layout: physical,
            environment,
            dispose,
            entries,
        };
        g.building = false;
        return g.record;
    }
    const sorted = <T extends { id: string }>(xs: T[]): T[] =>
        xs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const lowerBody = (
        currentUnit: string,
        body: IRBlock,
        record: Pick<RepresentationVariant, 'values' | 'calls'>,
    ): ConcreteBlock => {
        const values = new Map(record.values.map((v) => [v.value, v.representation]));
        const calls = new Map(record.calls.map((c) => [c.value, c]));
        const lower = (b: IRBlock): ConcreteBlock => ({
            origin: b.origin,
            result: b.result,
            layout: layout(values.get(b.result)!),
            cleanup: structuredClone(b.cleanup),
            instructions: b.instructions.map((i): ConcreteInstruction => {
                if (i.op === 'borrow' || i.op === 'bind') return structuredClone(i);
                const out = { ...i.out, layout: layout(values.get(i.out.id)!) };
                if (i.op === 'aslens') return { ...i, out, cleanup: lower(i.cleanup) };
                if (i.op === 'scope')
                    return {
                        ...i,
                        out,
                        body: lower(i.body),
                    };
                if (i.op === 'case')
                    return {
                        ...i,
                        out,
                        cases: i.cases.map((c) => ({ ...c, body: lower(c.body) })),
                        ...(i.out.type.tag === 'flow'
                            ? {
                                  lensJoin: {
                                      kind: 'selected' as const,
                                      arms: i.cases.map(
                                          (c) =>
                                              (
                                                  values.get(c.body.result)! as {
                                                      kind: 'lens';
                                                      shape: string;
                                                  }
                                              ).shape,
                                      ),
                                      result: (
                                          values.get(i.out.id)! as { kind: 'lens'; shape: string }
                                      ).shape,
                                  },
                              }
                            : {}),
                    };
                if (i.op === 'global' || i.op === 'closure') {
                    if (i.out.type.tag !== 'plain') return fail('Callable produced a lens');
                    const type = typeKey(i.out.type.value);
                    let member: CallableMember;
                    if (i.op === 'closure')
                        member = memberOf(
                            { unit: currentUnit, function: i.function },
                            i.captures.map((c) => values.get(c.value)!),
                        );
                    else {
                        const target = semantic.program.units.find(
                            (u) => u.definition === i.instance.definition,
                        );
                        const entry = target?.entry.instructions[0];
                        member =
                            target && entry?.op === 'closure'
                                ? memberOf({ unit: target.id, function: entry.function }, [])
                                : { kind: 'native', definition: i.instance.definition };
                    }
                    const c = callable(memberGroup(member, type));
                    return {
                        op: 'make-callable',
                        origin: i.origin,
                        out,
                        callable: c.id,
                        captures: i.op === 'closure' ? i.captures : [],
                    };
                }
                if (i.op === 'call') {
                    const contract = calls.get(i.out.id)!;
                    const calleeValue = values.get(i.callee)!;
                    if (calleeValue.kind !== 'callable')
                        return fail('Call operand is not callable');
                    if (contract.callee) {
                        // A direct call: the member's exact wrapper, not a record entry.
                        const g = memberGroup(contract.callee, calleeValue.type);
                        const w = wrapper(g, contract, memberEnvironment(g).environment);
                        return {
                            op: 'invoke',
                            origin: i.origin,
                            out,
                            callee: i.callee,
                            args: i.args,
                            wrapper: w.id,
                            abi: w.abi,
                        };
                    }
                    const g = typeGroup(calleeValue.type),
                        c = callable(g);
                    const index = sortedContracts(g).findIndex(
                        (candidate) => contractKey(candidate) === contractKey(contract),
                    );
                    const entry = c.entries[index] ?? fail('Missing invocation slot');
                    return {
                        op: 'invoke',
                        origin: i.origin,
                        out,
                        callee: i.callee,
                        args: i.args,
                        abi: entry.abi,
                        field: entry.field,
                    };
                }
                return { ...i, out };
            }),
        });
        return lower(body);
    };
    const code: ConcreteCode[] = analysis.variants.map((v) => {
        const u = units.get(v.unit)!,
            fn = u.functions.find((f) => f.id === v.function)!;
        const c = memberEnvironment(
            memberGroup(memberOf({ unit: u.id, function: fn.id }, v.captures), typeKey(fn.type)),
        );
        return {
            id: codeName(v.id),
            unit: u.id,
            function: fn.id,
            abi: table.abi(v.arguments.map(layout), layout(v.result)),
            environment: c.environment,
            captures: fn.captures.map((c, i) => ({
                place: c.place,
                layout: layout(v.captures[i]!),
            })),
            parameters: fn.parameters.map((p, i) => ({ ...p, layout: layout(v.arguments[i]!) })),
            body: lowerBody(u.id, fn.body, v),
        };
    });
    const entries: string[] = [];
    analysis.entries.forEach((e, i) => {
        const exported = analysis.exports.find((x) => x.entry === i);
        if (exported) {
            entries.push(codeName(exported.variant));
            return;
        }
        const id = concreteName(
            'entry',
            JSON.stringify([targetKey(semantic.target), graphKey, e.unit, i]),
        );
        entries.push(id);
        code.push({
            id,
            unit: e.unit,
            abi: table.abi([], layout(analysis.roots[i]!.result)),
            environment: unitLayout,
            captures: [],
            parameters: [],
            body: lowerBody(e.unit, units.get(e.unit)!.entry, e),
        });
    });
    groups.forEach(callable);
    const finished = table.finish();
    markBoxReuse(
        code.map((c) => c.body),
        new Map(finished.layouts.map((l) => [l.id, l])),
    );
    const output: ConcreteProgram = {
        schemaVersion: 1,
        target: semantic.target,
        graphKey,
        semantic,
        analysis,
        layouts: finished.layouts,
        abis: finished.abis,
        wrappers: sorted([...wrappers.values()]),
        callables: sorted([...groups.values()].map((g) => g.record!)),
        code: sorted(code),
        entries,
        forward: {
            layouts: finished.forward,
            abis: finished.abis.map((a) => a.id).sort(),
            code: code.map((c) => c.id).sort(),
        },
    };
    verifyConcreteProgram(output);
    return freezeTree(output);
}

/** Whole phase-3 path from generic IR with explicit semantic and representation entry arguments. */
export function compileConcreteProgram(
    generic: TypedProgram,
    target: TargetConfig,
    roots: readonly (SpecializationRoot & { parameters?: EntryRepresentationArgument[] })[],
    options: {
        specializeLenses?: readonly string[];
        maxInstances?: number;
        maxVariants?: number;
        maxWorkItems?: number;
        layoutDefinitions?: readonly NominalLayoutDefinition[];
    } = {},
): ConcreteProgram {
    const semantic = specializeProgram(generic, target, roots, {
        maxInstances: options.maxInstances,
    });
    const analysis = inferRepresentations(semantic, {
        specializeLenses: options.specializeLenses,
        maxVariants: options.maxVariants,
        maxWorkItems: options.maxWorkItems,
        layoutDefinitions: options.layoutDefinitions,
        entryArguments: roots.flatMap((r, i) =>
            r.parameters ? [{ unit: semantic.roots[i]!, entry: i, arguments: r.parameters }] : [],
        ),
    });
    return lowerConcreteProgram(semantic, analysis);
}

/**
 * Pair each borrowed match that destructures a boxed constructor with the
 * reconstruction that rebuilds it, so the box is rewritten in place. Reuse needs
 * the same constructor and the same union layout (hence payload layout), and a
 * plain-valued case, whose temporary lenses are all restored inside the arm.
 * Everything else keeps freeing and allocating. When the temporary lens over the
 * payload is same-layout and binds every field, it is also marked `inPlace`.
 */
function markBoxReuse(bodies: ConcreteBlock[], layouts: Map<string, ConcreteLayout>): void {
    type Arm = { layout: string; name: string };
    const boxed = (layout: string, name: string): boolean =>
        layouts.get(layout)?.fields.some((f) => f.name === name && f.kind === 'pointer') ?? false;
    const retained = new Map<string, { arm: { retains?: string }; layout: string; name: string }>();
    const candidates: { aslens: { inPlace?: string }; id: string }[] = [];
    const visit = (
        block: ConcreteBlock,
        open: Map<string, Arm>,
        reconstructing: string | undefined,
        valueLayouts: Map<string, string>,
    ): void => {
        for (const i of block.instructions) {
            if (i.op === 'bind' || i.op === 'borrow') continue;
            valueLayouts.set(i.out.id, i.out.layout);
            if (i.op === 'scope') visit(i.body, open, reconstructing, valueLayouts);
            else if (i.op === 'aslens') {
                visit(i.cleanup, open, i.reconstruction?.reconstructionId, valueLayouts);
                const r = i.reconstruction;
                if (
                    r?.reconstructionId &&
                    r.kind === 'constructor' &&
                    r.items.every((item) => item.kind === 'bind') &&
                    !layouts.get(i.out.layout)?.fields.some((f) => f.name === 'replacement')
                )
                    candidates.push({ aslens: i, id: r.reconstructionId });
            } else if (i.op === 'case') {
                i.cases.forEach((arm) => {
                    const inner = new Map(open);
                    const layout = valueLayouts.get(i.value);
                    const p = arm.pattern;
                    if (
                        !i.lensJoin &&
                        layout &&
                        p.kind === 'constructor' &&
                        p.reconstructionId &&
                        boxed(layout, p.name)
                    ) {
                        inner.set(p.reconstructionId, { layout, name: p.name });
                        retained.set(p.reconstructionId, { arm, layout, name: p.name });
                    }
                    visit(arm.body, inner, reconstructing, valueLayouts);
                });
            } else if (i.op === 'construct' && reconstructing) {
                const arm = open.get(reconstructing);
                const root = block.instructions.find(
                    (s): s is Extract<ConcreteInstruction, { op: 'swap' }> => s.op === 'swap',
                );
                if (
                    arm &&
                    root?.value === i.out.id &&
                    arm.name === i.name &&
                    arm.layout === i.out.layout &&
                    !i.reuses
                )
                    i.reuses = reconstructing;
            }
        }
    };
    bodies.forEach((b) => visit(b, new Map(), undefined, new Map()));
    // A retained box must be reused exactly where the arm said; otherwise release it normally.
    const reused = new Set<string>();
    const collect = (block: ConcreteBlock): void => {
        for (const i of block.instructions) {
            if (i.op === 'bind' || i.op === 'borrow') continue;
            if (i.op === 'construct' && i.reuses) reused.add(i.reuses);
            if (i.op === 'scope') collect(i.body);
            else if (i.op === 'aslens') collect(i.cleanup);
            else if (i.op === 'case') i.cases.forEach((a) => collect(a.body));
        }
    };
    bodies.forEach(collect);
    for (const [id, { arm }] of retained) if (reused.has(id)) arm.retains = id;
    // With the box retained and every field keeping its layout, the temporary's
    // storage can be the box payload itself.
    for (const { aslens, id } of candidates)
        if (reused.has(id) && retained.get(id)?.arm.retains === id) aslens.inPlace = id;
}
