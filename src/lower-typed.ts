import type { Linear, Lens, Pat } from './ast.ts';
import type { Elaboration, SemanticFlow, SemanticType, BindingRecord } from './elaborated.ts';
import { freezeTree } from './elaborated.ts';
import type { Ty, Scheme } from './types.ts';
import { builtinTypes, constructorTypes } from './builtins.ts';
import { BackendDiagnostic } from './backend/target.ts';
import { verifyElaboration } from './backend/verify-elaboration.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import {
    encodeNumber,
    irPlain,
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
            case 'fn':
                return { tag: 'fn', args: t.args.map(flow), result: flow(t.result) };
        }
    };
    const flow = (f: import('./types.ts').FlowTy): SemanticFlow =>
        f.tag === 'plain'
            ? irPlain(type(f.value))
            : { tag: 'flow', read: type(f.read), write: type(f.write) };
    return { definition, quantified: [...vars.values()], type: type(scheme.body) };
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
              : [];
    const drops = (p: IRPattern): Cleanup[] =>
        [...new Set(slots(p).map((s) => s.place))].map((place) => ({
            kind: 'drop-place',
            slot: { place, path: [] },
        }));
    const call = (n: (Linear | Lens) & { type: 'apply' }, b: IRBlock): IRValue => {
        const last = n.args[n.args.length - 1];
        const finalLens = last?.type === 'lens' ? lens(last.lens, b) : undefined;
        const callee = linear(n.fn, b);
        const args = n.args.map((a) => (a.type === 'lens' ? finalLens!.id : linear(a, b).id));
        return emit(b, n, { op: 'call', callee: callee.id, args });
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
            nested.cleanup.push({ kind: 'release', loan: loan.id });
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
                return emit(
                    b,
                    n,
                    bound.definition
                        ? { op: 'global', instance: instance(n) }
                        : { op: 'move', slot: ref(bound) },
                );
            }
            case 'string':
                return emit(b, n, {
                    op: 'string',
                    head: n.head,
                    parts: n.interp.map((p) => ({ value: linear(p.value, b).id, tail: p.tail })),
                });
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
                        const value = emit(b, n, { op: 'move', slot: ref(from) }, irPlain(c.type));
                        return { place: to.place, value: value.id, type: c.type };
                    });
                const body = block(n.body);
                body.result = (
                    n.body.type === 'lens' ? lens(n.body.lens, body) : linear(n.body, body)
                ).id;
                const parameters = n.args.map((a, i) => ({
                    pattern: pattern(a.pat),
                    lensPlace: a.pat.type === 'lens' ? f.parameterPlaces[i][0] : undefined,
                }));
                parameters.forEach((p, i) => {
                    const argument = t.args[i];
                    body.cleanup.push(
                        ...(p.lensPlace && argument.tag === 'flow'
                            ? [
                                  {
                                      kind: 'restored' as const,
                                      slot: { place: p.lensPlace, path: [] },
                                      type: argument.write,
                                  },
                              ]
                            : drops(p.pattern)),
                    );
                });
                body.cleanup.push(
                    ...captures.map((c) => ({
                        kind: 'drop-place' as const,
                        slot: { place: c.place, path: [] },
                    })),
                );
                const functionId = `${id(n)}/function`;
                functions.push({
                    id: functionId,
                    origin: id(n),
                    type: t,
                    captures: captures.map((c) => ({ place: c.place, type: c.type })),
                    parameters,
                    body,
                });
                return emit(b, n, {
                    op: 'closure',
                    function: functionId,
                    captures: captures.map(({ place, value }) => ({ place, value })),
                });
            }
            case 'case': {
                if (n.value.type === 'lens')
                    return fail('Lens cases have not been semantically checked', n);
                const value = linear(n.value, b);
                const join = e.branches.find((v) => v.node === id(n))!;
                const cases = n.cases.map((arm, i) => {
                    const p = pattern(arm.pat),
                        body = block(arm.body);
                    body.result = linear(arm.body, body).id;
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
            case 'tuple':
                return emit(b, n, { op: 'lens-tuple', items: n.items.map((v) => lens(v, b).id) });
            case 'apply':
                return call(n, b);
            case 'let':
                return letBody(n, b, true);
            case 'case': {
                if (n.value.type === 'lens') return fail('Borrowed matching is not checked', n);
                const value = linear(n.value, b);
                const join = e.branches.find((v) => v.node === id(n))!;
                const cases = n.cases.map((arm, i) => {
                    const p = pattern(arm.pat),
                        body = block(arm.body);
                    body.result = lens(arm.body, body).id;
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
                return fail(`Unchecked lens form ${n.type}`, n);
        }
    };
    const entry = block(e.source);
    entry.result = linear(e.source, entry).id;
    return freezeTree({
        id: e.id,
        definition: e.source.type === 'fn' && e.source.name ? e.id : undefined,
        signature: { quantified: e.signature.quantified, type: e.signature.type },
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
