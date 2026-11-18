import { freezeTree } from './elaborated.ts';
import { BackendDiagnostic, targetKey } from './backend/target.ts';
import {
    inferRepresentations,
    type RepresentationAnalysis,
    type RepresentationVariant,
    type ValueRepresentation,
} from './infer-representations.ts';
import { verifyRepresentations } from './verify-representations.ts';
import { representationKey } from './representation-key.ts';
import { ConcreteLayoutTable, concreteName } from './concrete-layouts.ts';
import {
    specializeProgram,
    type SpecializedProgram,
    type SpecializationRoot,
} from './specialize.ts';
import type { TargetConfig } from './backend/target.ts';
import { typeKey, type TypedProgram } from './typed-ir.ts';
import { layoutDefinitionsKey, type NominalLayoutDefinition } from './layout-definitions.ts';
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
} from './concrete-ir.ts';
import { verifyConcreteProgram } from './verify-concrete.ts';

type Contract = {
    target: string;
    targets?: string[];
    arguments: ValueRepresentation[];
    result: ValueRepresentation;
};
type Group = {
    descriptor: ValueRepresentation;
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
    const table = new ConcreteLayoutTable(semantic.target, analysis.layoutDefinitions),
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
    const group = (v: ValueRepresentation): Group => {
        if (v.kind !== 'callable' && v.kind !== 'native' && v.kind !== 'callable-choice')
            return fail('A callable layout requires a callable descriptor');
        const key = representationKey(v);
        let g = groups.get(key);
        if (!g) {
            g = { descriptor: v, key, contracts: new Map() };
            groups.set(key, g);
            if (v.kind === 'callable') v.captures.forEach(discover);
            if (v.kind === 'callable-choice') v.options.forEach(discover);
        }
        return g;
    };
    function discover(v: ValueRepresentation): void {
        if (v.kind === 'callable' || v.kind === 'native' || v.kind === 'callable-choice') group(v);
    }
    const contractKey = (c: Contract): string =>
        JSON.stringify([c.target, c.arguments.map(representationKey), representationKey(c.result)]);
    function rawResult(g: Group, c: Contract): ValueRepresentation | undefined {
        const variant = variants.get(c.target);
        if (variant) return variant.result;
        if (g.descriptor.kind !== 'native' || c.target !== 'native/fst' || c.result.kind !== 'lens')
            return undefined;
        const argument = c.arguments[0]!;
        if (argument.kind !== 'lens') return fail('Missing native lens argument');
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
        const raw = rawResult(g, call);
        if (
            g.descriptor.kind !== 'callable-choice' &&
            raw &&
            representationKey(raw) !== representationKey(call.result)
        )
            addContract(g, { ...call, result: raw });
        if (g.descriptor.kind === 'callable-choice')
            g.descriptor.options.forEach((option, n) =>
                addContract(group(option), {
                    target: call.targets![n]!,
                    arguments: call.arguments,
                    result: call.result,
                }),
            );
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
                    const g = group(callee);
                    addContract(g, call);
                } else if (i.op === 'scope') walk(i.body);
                else if (i.op === 'manual') walk(i.cleanup);
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
    analysis.exports.forEach((e) => {
        const g = group(analysis.roots[e.entry]!.result),
            contract = { target: e.variant, arguments: e.arguments, result: e.result };
        g.contracts.set(contractKey(contract), contract);
    });
    // A nested branch may already expose a narrower erased wrapper. Give that
    // wrapper the entries needed when it is moved into a larger runtime join.
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups.values()) {
            if (g.descriptor.kind !== 'callable-choice') continue;
            const members = g.descriptor.options.map(representationKey);
            for (const source of groups.values()) {
                if (source === g || source.descriptor.kind !== 'callable-choice') continue;
                const indices = source.descriptor.options.map((o) =>
                    members.indexOf(representationKey(o)),
                );
                if (indices.some((n) => n < 0)) continue;
                for (const contract of g.contracts.values()) {
                    const targets = indices.map((n) => contract.targets![n]!);
                    const c = {
                        target: JSON.stringify(['dispatch', targets]),
                        targets,
                        arguments: contract.arguments,
                        result: contract.result,
                    };
                    if (!source.contracts.has(contractKey(c))) {
                        addContract(source, c);
                        changed = true;
                    }
                }
            }
        }
    }
    const graphKey = JSON.stringify([
        layoutDefinitionsKey(analysis.layoutDefinitions),
        analysis.variants.map((v) => v.key).sort(),
        [...groups.values()]
            .map((g) => [g.key, [...g.contracts.keys()].sort()])
            .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    ]);
    const codeName = (variant: string) =>
        concreteName('code', JSON.stringify([targetKey(semantic.target), graphKey, variant]));
    // Each discovered invocation belongs to the same concrete environment group wherever reified.
    const shapeLayouts = new Map<string, string>();
    const layout = (v: ValueRepresentation): string => {
        if (v.kind === 'aggregate')
            return fail('Callable aggregate storage requires an explicit physical adapter');
        if (v.kind === 'data') return table.data(dataLayouts.get(v.layout)!.type);
        if (v.kind === 'callable' || v.kind === 'native' || v.kind === 'callable-choice')
            return callable(group(v)).layout;
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
        if (g.descriptor.kind === 'callable-choice') {
            const targets = g.descriptor.options.map((option, n) => {
                const member = group(option),
                    physical = callable(member);
                const memberContract = {
                    target: c.targets![n]!,
                    arguments: c.arguments,
                    result: c.result,
                };
                const entry = wrapper(member, memberContract, physical.environment);
                if (entry.abi !== abi) return fail('Dynamic callable ABI mismatch');
                return { callable: physical.id, wrapper: entry.id };
            });
            const w: ConcreteWrapper = {
                id,
                key,
                kind: 'dispatch',
                abi,
                environment,
                targets,
                ownership: 'selected-environment',
            };
            wrappers.set(id, w);
            return w;
        }
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
            if (c.result.kind !== 'callable-choice') return fail('Unsupported result adapter');
            const source = wrapper(g, { ...c, result: raw }, environment);
            const from = callable(group(raw)),
                to = callable(group(c.result));
            const adapter = joinArm(from, to);
            const w: ConcreteWrapper = {
                id,
                key,
                kind: 'adapt-result',
                abi,
                environment,
                source: source.id,
                from: from.id,
                to: to.id,
                entries: adapter.entries,
                ownership: 'transfer-result',
            };
            wrappers.set(id, w);
            return w;
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
    function callable(g: Group): CallableLayout {
        if (g.record) return g.record;
        if (g.building) return fail('Recursive callable ABI needs an explicit recursive signature');
        g.building = true;
        const captures = g.descriptor.kind === 'callable' ? g.descriptor.captures : [];
        const environment = table.record(
            ['environment', g.key, captures.map(layout)],
            'record',
            captures.map((v, i) => ({ name: `capture${i}`, kind: 'value', layout: layout(v) })),
        );
        const disposeABI = table.abi([], unitLayout);
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
            abi: disposeABI,
            environment,
            captures: captures.map(layout),
            ownership: 'drop-captures-and-free',
        });
        const contracts = [...g.contracts.values()].sort((a, b) =>
            contractKey(a) < contractKey(b) ? -1 : 1,
        );
        const entries = contracts.map((c, index) => {
            const w = wrapper(g, c, environment);
            return { wrapper: w.id, abi: w.abi, field: `invoke${index}` };
        });
        const fields: ConcreteField[] = [
            {
                name: 'environment',
                kind: 'pointer',
                ...(g.descriptor.kind === 'callable-choice' ? {} : { layout: environment }),
            },
            { name: 'dispose', kind: 'code', abi: disposeABI },
            ...entries.map((e) => ({ name: e.field, kind: 'code' as const, abi: e.abi })),
        ];
        const physical = table.record(
            ['callable', g.key, contracts.map(contractKey), environment, entries.map((e) => e.abi)],
            'record',
            fields,
        );
        g.record = {
            id: concreteName('callable', JSON.stringify([g.key, physical])),
            descriptor: g.descriptor,
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
    const joinArm = (source: CallableLayout, target: CallableLayout) => ({
        callable: source.id,
        entries: target.entries.map((entry) => {
            const dispatch = wrappers.get(entry.wrapper)!;
            if (dispatch.kind !== 'dispatch') return fail('Join target lacks dispatch contract');
            const from =
                source.entries.find((candidate) => {
                    const w = wrappers.get(candidate.wrapper)!;
                    return (
                        candidate.abi === entry.abi &&
                        (w.kind === 'dispatch'
                            ? w.targets.every((t) =>
                                  dispatch.targets.some(
                                      (d) => d.callable === t.callable && d.wrapper === t.wrapper,
                                  ),
                              )
                            : dispatch.targets.some(
                                  (t) =>
                                      t.callable === source.id && t.wrapper === candidate.wrapper,
                              ))
                    );
                }) ?? fail('Join source lacks compatible invocation entry');
            return { source: from.field, target: entry.field };
        }),
    });
    const lowerBody = (
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
                if (i.op === 'manual') {
                    const frontend = values.get(i.lens)!,
                        result = values.get(i.out.id)!;
                    if (frontend.kind !== 'lens' || result.kind !== 'lens')
                        return fail('Manual restoration requires lens representations');
                    return {
                        ...i,
                        out,
                        cleanup: lower(i.cleanup),
                        restoration: {
                            kind: 'deferred',
                            frontend: frontend.shape,
                            result: result.shape,
                            order: ['stage', 'cleanup', 'dispose-result', 'restore', 'release'],
                            retention: 'through-enclosing-cleanup',
                        },
                    };
                }
                if (i.op === 'scope') return { ...i, out, body: lower(i.body) };
                if (i.op === 'case')
                    return {
                        ...i,
                        out,
                        cases: i.cases.map((c) => ({ ...c, body: lower(c.body) })),
                        ...(values.get(i.out.id)!.kind === 'callable-choice'
                            ? {
                                  callableJoin: {
                                      kind: 'erased-environment' as const,
                                      result: callable(group(values.get(i.out.id)!)).id,
                                      arms: i.cases.map((arm) =>
                                          joinArm(
                                              callable(group(values.get(arm.body.result)!)),
                                              callable(group(values.get(i.out.id)!)),
                                          ),
                                      ),
                                  },
                              }
                            : {}),
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
                    const c = callable(group(values.get(i.out.id)!));
                    return {
                        op: 'make-callable',
                        origin: i.origin,
                        out,
                        callable: c.id,
                        captures: i.op === 'closure' ? i.captures : [],
                    };
                }
                if (i.op === 'call') {
                    const g = group(values.get(i.callee)!),
                        c = callable(g),
                        contract = calls.get(i.out.id)!;
                    const w = wrapper(g, contract, c.environment),
                        entry = c.entries.find((e) => e.wrapper === w.id)!;
                    return {
                        op: 'invoke',
                        origin: i.origin,
                        out,
                        callee: i.callee,
                        args: i.args,
                        wrapper: w.id,
                        abi: w.abi,
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
        const c = callable(
            group({ kind: 'callable', unit: u.id, function: fn.id, captures: v.captures }),
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
            body: lowerBody(fn.body, v),
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
            body: lowerBody(units.get(e.unit)!.entry, e),
        });
    });
    groups.forEach(callable);
    const finished = table.finish();
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
        maxInstances?: number;
        maxVariants?: number;
        layoutDefinitions?: readonly NominalLayoutDefinition[];
    } = {},
): ConcreteProgram {
    const semantic = specializeProgram(generic, target, roots, {
        maxInstances: options.maxInstances,
    });
    const analysis = inferRepresentations(semantic, {
        maxVariants: options.maxVariants,
        layoutDefinitions: options.layoutDefinitions,
        entryArguments: roots.flatMap((r, i) =>
            r.parameters ? [{ unit: semantic.roots[i]!, entry: i, arguments: r.parameters }] : [],
        ),
    });
    return lowerConcreteProgram(semantic, analysis);
}
