import { layoutSchemaKey } from './layout-definitions.ts';
import { mapSemantic, type Instance } from './typed-ir.ts';
import { createHash } from 'node:crypto';
import type { SemanticType, SemanticFlow } from './elaborated.ts';
import { BackendDiagnostic, targetKey } from './backend/target.ts';
import { typeKey, irPlain, type IRBlock, type IRUnit, type IRPattern } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import { memberKey } from './representation-key.ts';
import { escapes } from './callable-escape.ts';
import type { SpecializedProgram } from './specialize.ts';
import type {
    CallableMember,
    RepresentationAnalysis,
    RepresentationVariant,
    ValueRepresentation,
} from './infer-representations.ts';
import type { Layout } from './layouts.ts';
import type { LensRep } from './representations.ts';
import {
    canonicalLensTopology,
    canonicalCallLensTopology,
    canonicalLensPolicies,
    lensSpecializationSelectors,
    specializeLensCall,
} from './lens-specialization.ts';

/** Independent validation of serialized analysis against semantic IR; never invokes inference. */
export function verifyRepresentations(
    source: SpecializedProgram,
    analysis: RepresentationAnalysis,
): void {
    const fail = (message: string): never => {
        throw new BackendDiagnostic('invalid-representation-analysis', message);
    };
    const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
    function canonical(value: unknown): string {
        if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
        if (value && typeof value === 'object')
            return JSON.stringify(
                Object.entries(value)
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([k, v]) => [k, canonical(v)]),
            );
        return JSON.stringify(value);
    }
    const requireEqual = (a: unknown, b: unknown, message: string) => {
        if (!same(a, b)) fail(message);
    };
    function unique<T>(items: readonly T[], id: (v: T) => string, label: string): Map<string, T> {
        if (!Array.isArray(items)) fail(`Missing ${label} table`);
        const map = new Map<string, T>();
        for (const item of items) {
            if (!item || typeof item !== 'object') fail(`Malformed ${label} record`);
            const k = id(item);
            if (typeof k !== 'string' || !k) fail(`Missing ${label} identity`);
            if (map.has(k)) fail(`Duplicate ${label}: ${k}`);
            map.set(k, item);
        }
        return map;
    }
    verifyTypedProgram(source.program);
    if (analysis.schemaVersion !== 1) fail('Unknown representation analysis version');
    const selected = analysis.specializeLenses ?? [];
    const validSelectors = lensSpecializationSelectors(source);
    if (
        !Array.isArray(selected) ||
        selected.some((n) => typeof n !== 'string' || !validSelectors.has(n))
    )
        fail('Invalid lens specialization policy');
    if (
        !Array.isArray(analysis.roots) ||
        !Array.isArray(analysis.entries) ||
        !Array.isArray(analysis.exports)
    )
        fail('Missing analysis roots or entries');
    const repKey = (v: ValueRepresentation): string => {
        if (!v || typeof v !== 'object') return fail('Missing value representation');
        switch (v.kind) {
            case 'data':
                return JSON.stringify({ kind: 'data', layout: v.layout });
            case 'aggregate':
                if (!Array.isArray(v.items)) return fail('Missing aggregate members');
                return JSON.stringify({
                    kind: v.kind,
                    items: v.items.map((c) => JSON.parse(repKey(c))),
                });
            case 'lens':
                return JSON.stringify({ kind: 'lens', shape: v.shape });
            case 'callable':
                if (typeof v.type !== 'string') return fail('Missing callable type');
                return JSON.stringify({ kind: 'callable', type: v.type });
            default:
                return fail('Unknown value representation');
        }
    };
    const target = targetKey(source.target);
    const schemas = analysis.layoutDefinitions ?? [];
    const layouts = unique(analysis.layouts, (l) => l.id, 'layout');
    const shapes = unique(analysis.shapes, (s) => s.id, 'shape');
    const backings = unique(analysis.backings, (b) => b.id, 'backing');
    const variants = unique(analysis.variants, (v) => v.id, 'variant');
    const units = new Map(source.program.units.map((u) => [u.id, u]));
    const definitions = new Map(
        source.program.units.filter((u) => u.definition).map((u) => [u.definition!, u]),
    );
    const imports = new Map(source.program.imports.map((i) => [i.definition, i]));
    // Callable member sets: the analysis lists them; verification derives every
    // escaping member from the verified code and requires the same sets.
    const callableTypes = new Map<string, CallableMember[]>();
    const membersOf = (type: string): CallableMember[] => callableTypes.get(type) ?? [];
    const derived = new Map<string, Set<string>>();
    const derivedMember = (type: SemanticType, member: CallableMember): void => {
        const k = typeKey(type);
        if (!derived.has(k)) derived.set(k, new Set());
        derived.get(k)!.add(memberKey(member));
    };
    const layout = (id: string): Layout => layouts.get(id) ?? fail('Missing or foreign layout');
    const shape = (id: string): LensRep => shapes.get(id) ?? fail('Missing or foreign lens shape');
    const layoutId = (t: SemanticType): string =>
        JSON.stringify([
            'layout',
            target,
            typeKey(t),
            ...[layoutSchemaKey(schemas, t)].filter(Boolean),
        ]);
    const typeEqual = (a: SemanticType, b: SemanticType) => {
        if (typeKey(a) !== typeKey(b)) fail('Representation semantic type mismatch');
    };
    const layoutOrder = new Map(analysis.layouts.map((l, i) => [l.id, i]));
    function storageType(t: SemanticType): void {
        if (!t || typeof t !== 'object') return fail('Missing layout semantic type');
        if (t.tag === 'fn') return;
        if (t.tag === 'tuple' && Array.isArray(t.items)) {
            t.items.forEach(storageType);
            return;
        }
        if (
            t.tag === 'con' &&
            Array.isArray(t.args) &&
            t.args.length === 0 &&
            ['Number', 'Bool', 'String'].includes(t.name)
        )
            return;
        if (t.tag === 'con') {
            const d = schemas.find((d) => d.name === t.name);
            if (d && d.parameters.length === t.args.length) {
                t.args.forEach(storageType);
                return;
            }
        }
        fail('Unsupported concrete data layout');
    }
    for (const l of layouts.values()) {
        storageType(l.type);
        if (l.id !== layoutId(l.type)) fail('Noncanonical or wrong-target layout ID');
        let storage: Layout['storage'],
            dependencies: string[] = [];
        switch (l.type.tag) {
            case 'con': {
                if (!l.type.args.length && ['Number', 'Bool', 'String'].includes(l.type.name))
                    storage =
                        l.type.name === 'Number'
                            ? 'f64'
                            : l.type.name === 'Bool'
                              ? 'bool'
                              : 'string';
                else {
                    const t = l.type,
                        d = schemas.find((d) => d.name === t.name)!;
                    const substitution = new Map(d.parameters.map((p, i) => [p, t.args[i]!]));
                    storage = 'nominal';
                    dependencies = d.fields.map((f) =>
                        layoutId(mapSemantic(f.type, (p) => substitution.get(p))),
                    );
                    requireEqual(
                        l.indirect,
                        d.fields.map((f) => !!f.indirect),
                        'Nominal indirection contract mismatch',
                    );
                }
                break;
            }
            case 'fn':
                storage = 'callable';
                break;
            case 'tuple':
                storage = l.type.items.length ? 'tuple' : 'unit';
                dependencies = l.type.items.map(layoutId);
                break;
            default:
                return fail('Unresolved or callable data layout');
        }
        requireEqual(
            l.dependencies,
            dependencies,
            'Layout dependencies disagree with semantic tuple fields',
        );
        if (l.storage !== storage) fail('Incorrect storage kind');
        dependencies.forEach((id, i) => {
            layout(id);
            if (!l.indirect?.[i] && layoutOrder.get(id)! >= layoutOrder.get(l.id)!)
                fail('Layout dependencies must precede users');
        });
    }
    for (const b of backings.values()) {
        layout(b.read);
        layout(b.replacement);
        if (b.id !== JSON.stringify(['backing', b.read, b.replacement]))
            fail('Noncanonical backing ID');
        if (b.access !== (b.read === b.replacement ? 'same-layout' : 'separate-slots'))
            fail('Incorrect backing access convention');
    }
    const visiting = new Set<string>(),
        checked = new Set<string>();
    function checkShape(id: string): void {
        if (checked.has(id)) return;
        if (visiting.has(id)) fail('Cyclic lens shape');
        visiting.add(id);
        const s = shape(id),
            read = layout(s.read).type,
            write = layout(s.replacement).type;
        if (s.kind === 'thin') {
            const b = backings.get(s.backing) ?? fail('Missing lens backing');
            if (
                s.id !== JSON.stringify(['thin', s.backing]) ||
                b.read !== s.read ||
                b.replacement !== s.replacement
            )
                fail('Thin lens backing mismatch');
        } else if (s.kind === 'tuple') {
            if (!Array.isArray(s.items)) fail('Missing tuple shape items');
            if (s.id !== JSON.stringify(['lens-tuple', s.items]))
                fail('Noncanonical tuple shape ID');
            s.items.forEach(checkShape);
            typeEqual(read, {
                tag: 'tuple',
                items: s.items.map((i) => layout(shape(i).read).type),
            });
            typeEqual(write, {
                tag: 'tuple',
                items: s.items.map((i) => layout(shape(i).replacement).type),
            });
        } else fail('Unknown lens shape');
        visiting.delete(id);
        checked.add(id);
    }
    shapes.forEach((s) => checkShape(s.id));
    const fnFor = (unit: string, id: string) =>
        units.get(unit)?.functions.find((f) => f.id === id) ?? fail('Unknown callable function');
    const canonicalPolicies = canonicalLensPolicies(source);
    const canonicalArgument = (
        v: ValueRepresentation,
        type: string,
        argument: number,
        preserve = false,
    ): ValueRepresentation => {
        if (v.kind !== 'lens') return v;
        const topology = (id: string): ReturnType<typeof canonicalLensTopology> => {
            const r = shape(id);
            return r.kind === 'thin'
                ? { kind: 'thin' }
                : { kind: 'tuple', items: r.items.map(topology) };
        };
        const s = shape(v.shape),
            read = layout(s.read).type,
            write = layout(s.replacement).type;
        const build = (
            t: ReturnType<typeof canonicalLensTopology>,
            r: SemanticType,
            w: SemanticType,
        ): string =>
            t.kind === 'thin'
                ? JSON.stringify(['thin', JSON.stringify(['backing', layoutId(r), layoutId(w)])])
                : JSON.stringify([
                      'lens-tuple',
                      t.items.map((child, n) =>
                          build(
                              child,
                              (r as Extract<SemanticType, { tag: 'tuple' }>).items[n]!,
                              (w as Extract<SemanticType, { tag: 'tuple' }>).items[n]!,
                          ),
                      ),
                  ]);
        const result: ValueRepresentation = {
            kind: 'lens',
            shape: build(
                canonicalCallLensTopology(
                    canonicalPolicies,
                    type,
                    argument,
                    read,
                    write,
                    preserve ? topology(v.shape) : undefined,
                ),
                read,
                write,
            ),
        };
        shape(result.shape);
        return result;
    };
    const containsCallable = (t: SemanticType): boolean =>
        t.tag === 'fn' || (t.tag === 'tuple' && t.items.some(containsCallable));
    function fitMember(m: CallableMember, t: SemanticType): void {
        if (!m || typeof m !== 'object' || t.tag !== 'fn') return fail('Invalid callable member');
        if (m.kind === 'native') {
            if (!imports.has(m.definition)) fail('Unknown native callable');
            return;
        }
        if (m.kind !== 'closure' || !Array.isArray(m.captures))
            return fail('Invalid callable member');
        const fn = fnFor(m.unit, m.function);
        typeEqual(fn.type, t);
        if (fn.captures.length !== m.captures.length) fail('Callable capture arity mismatch');
        fn.captures.forEach((c, i) => fit(m.captures[i]!, irPlain(c.type)));
    }
    function fit(v: ValueRepresentation, t: SemanticFlow): void {
        if (!v || typeof v !== 'object') return fail('Missing value representation');
        if (t.tag === 'flow') {
            if (v.kind !== 'lens') return fail('Lens contract has a non-lens representation');
            const s = shape(v.shape);
            typeEqual(layout(s.read).type, t.read);
            typeEqual(layout(s.replacement).type, t.write);
            return;
        }
        if (v.kind === 'aggregate') {
            if (
                t.value.tag !== 'tuple' ||
                !Array.isArray(v.items) ||
                v.items.length !== t.value.items.length
            )
                return fail('Aggregate semantic shape mismatch');
            if (!containsCallable(t.value)) return fail('Noncanonical data aggregate');
            const types = t.value.items;
            v.items.forEach((child, i) => fit(child, irPlain(types[i]!)));
            return;
        }
        if (v.kind === 'data') {
            if (containsCallable(t.value))
                return fail('Noncanonical callable value representation');
            typeEqual(layout(v.layout).type, t.value);
            return;
        }
        if (v.kind === 'callable') {
            if (t.value.tag !== 'fn' || v.type !== typeKey(t.value))
                fail('Callable value type mismatch');
            return;
        }
        fail('Unknown or mismatched value representation');
    }
    function topology(a: LensRep, b: LensRep): void {
        if (a.kind !== b.kind) fail('Lens topology changed');
        if (a.kind === 'tuple' && b.kind === 'tuple') {
            if (a.items.length !== b.items.length) fail('Lens tuple topology arity changed');
            a.items.forEach((id, i) => topology(shape(id), shape(b.items[i]!)));
        }
    }
    const lens = (v: ValueRepresentation): LensRep =>
        v.kind === 'lens' ? shape(v.shape) : fail('Expected lens annotation');
    function projectedShape(s: LensRep, path: number[]): LensRep {
        // A projected thin location remains thin, even though its endpoints change.
        for (const index of path)
            if (s.kind === 'tuple') s = shape(s.items[index] ?? fail('Invalid lens projection'));
        return s;
    }
    type State = {
        values: Map<string, ValueRepresentation>;
        lenses: Map<string, LensRep>;
        known: Map<string, CallableMember>;
        knownPlaces: Map<string, CallableMember>;
    };
    const fresh = (): State => ({
        values: new Map(),
        lenses: new Map(),
        known: new Map(),
        knownPlaces: new Map(),
    });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        lenses: new Map(s.lenses),
        known: new Map(s.known),
        knownPlaces: new Map(s.knownPlaces),
    });
    const get = (s: State, id: string): ValueRepresentation =>
        s.values.get(id) ?? fail('Missing operand annotation');
    function checkConstructor(name: string, instance: Instance): void {
        const t = instance.type;
        if (t.tag !== 'fn' || t.result.tag !== 'plain' || t.result.value.tag !== 'con')
            return fail('Constructor lacks nominal result');
        const result = t.result.value,
            d = schemas.find((d) => d.name === result.name);
        if (!d) return fail('Constructor lacks a storage schema');
        const substitution = new Map(d.parameters.map((p, i) => [p, result.args[i]!]));
        const args = t.args.map((a) =>
            a.tag === 'plain' ? a.value : fail('Constructor field is a lens'),
        );
        if (d.kind === 'record') {
            if (d.fields.length !== args.length) fail('Record constructor/storage arity mismatch');
            d.fields.forEach((f, i) =>
                typeEqual(
                    mapSemantic(f.type, (p) => substitution.get(p)),
                    args[i]!,
                ),
            );
        } else {
            const field = d.fields.find((f) => f.name === name);
            if (!field) return fail('Constructor tag is absent from union storage');
            const payload: SemanticType =
                args.length === 1 ? args[0]! : { tag: 'tuple', items: args };
            typeEqual(
                mapSemantic(field.type, (p) => substitution.get(p)),
                payload,
            );
        }
    }
    function bind(p: IRPattern, _v: ValueRepresentation, _s: State): void {
        if (p.kind === 'constructor') checkConstructor(p.name, p.instance);
        if (p.kind === 'tuple' || p.kind === 'constructor') p.items.forEach((c) => bind(c, _v, _s));
    }
    const edges = new Map<string, Set<string>>();
    function verifyBody(
        unit: IRUnit,
        body: IRBlock,
        record: Pick<RepresentationVariant, 'values' | 'calls'>,
        state: State,
        owner: string,
    ): ValueRepresentation {
        const annotations = unique(record.values, (v) => v.value, 'value annotation');
        const calls = unique(record.calls, (c) => c.value, 'call annotation');
        const usedValues = new Set<string>(),
            usedCalls = new Set<string>();
        edges.set(owner, new Set());
        function block(b: IRBlock, s: State): ValueRepresentation {
            for (const i of b.instructions) {
                if (i.op === 'bind') {
                    bind(i.pattern, get(s, i.value), s);
                    const member = s.known.get(i.value);
                    if (i.pattern.kind === 'bind' && member)
                        s.knownPlaces.set(i.pattern.slot.place, member);
                    else s.knownPlaces.clear();
                    continue;
                }
                if (i.op === 'borrow') {
                    const loan = unit.loans.find((l) => l.id === i.loan)!;
                    if (loan.owners) s.lenses.set(loan.place, lens(get(s, i.lens)));
                    continue;
                }
                const annotation =
                    annotations.get(i.out.id) ?? fail('Missing temporary annotation');
                if (Object.keys(annotation).some((k) => !['value', 'representation'].includes(k)))
                    fail('Unexpected storage annotation');
                usedValues.add(i.out.id);
                const v = annotation.representation;
                repKey(v);
                fit(v, i.out.type);
                switch (i.op) {
                    case 'construct':
                        checkConstructor(i.name, i.instance);
                        break;
                    case 'constant':
                    case 'string':
                    case 'tuple':
                    case 'swap':
                        break;
                    case 'move': {
                        const member = !i.slot.path.length && s.knownPlaces.get(i.slot.place);
                        if (member) s.known.set(i.out.id, member);
                        s.knownPlaces.delete(i.slot.place);
                        break;
                    }
                    case 'acquire': {
                        s.knownPlaces.delete(i.slot.place);
                        const base = s.lenses.get(i.slot.place);
                        if (base) topology(projectedShape(base, i.slot.path), lens(v));
                        else if (lens(v).kind !== 'thin')
                            fail('Owned local must expose a thin lens');
                        break;
                    }
                    case 'aslens':
                        s.knownPlaces.clear();
                        if (lens(v).kind !== 'thin') fail('Temporary lens must have owned storage');
                        block(i.cleanup, clone(s));
                        break;
                    case 'lens-tuple': {
                        const r = lens(v);
                        if (r.kind !== 'tuple') return fail('Lens tuple lost its topology');
                        requireEqual(
                            r.items,
                            i.items.map((id) => lens(get(s, id)).id),
                            'Lens tuple children changed',
                        );
                        break;
                    }
                    case 'scope': {
                        s.knownPlaces.clear();
                        const nested = clone(s);
                        requireEqual(
                            v,
                            block(i.body, nested),
                            'Scope result representation mismatch',
                        );
                        const member = nested.known.get(i.body.result);
                        if (member) s.known.set(i.out.id, member);
                        break;
                    }
                    case 'case': {
                        s.knownPlaces.clear();
                        const results = i.cases.map((arm) => {
                            bind(arm.pattern, get(s, i.value), s);
                            return block(arm.body, clone(s));
                        });
                        if (i.out.type.tag === 'flow') {
                            if (lens(v).kind !== 'thin')
                                fail('Selected-branch adapter must expose a thin focus');
                        } else
                            results.forEach((r) =>
                                requireEqual(v, r, 'Branch needs a representation adapter'),
                            );
                        break;
                    }
                    case 'global':
                    case 'closure': {
                        if (i.out.type.tag !== 'plain') return fail('Callable produced a lens');
                        let member: CallableMember;
                        if (i.op === 'closure')
                            member = {
                                kind: 'closure',
                                unit: unit.id,
                                function: i.function,
                                captures: i.captures.map((c) => get(s, c.value)),
                            };
                        else {
                            const target = definitions.get(i.instance.definition),
                                entry = target?.entry.instructions[0];
                            if (target) {
                                if (entry?.op !== 'closure' || entry.captures.length)
                                    return fail('Reusable definition lacks a closed entry');
                                member = {
                                    kind: 'closure',
                                    unit: target.id,
                                    function: entry.function,
                                    captures: [],
                                };
                            } else member = { kind: 'native', definition: i.instance.definition };
                        }
                        fitMember(member, i.out.type.value);
                        s.known.set(i.out.id, member);
                        if (escapes(i.out.id, b)) derivedMember(i.out.type.value, member);
                        break;
                    }
                    case 'call': {
                        s.knownPlaces.clear();
                        const call = calls.get(i.out.id) ?? fail('Missing call annotation');
                        if (
                            Object.keys(call).some(
                                (k) =>
                                    ![
                                        'value',
                                        'target',
                                        'targets',
                                        'arguments',
                                        'result',
                                        'callee',
                                    ].includes(k),
                            )
                        )
                            fail('Unexpected call annotation');
                        usedCalls.add(i.out.id);
                        const calleeValue = get(s, i.callee),
                            incoming = i.args.map((id) => get(s, id));
                        if (calleeValue.kind !== 'callable')
                            return fail('Call operand is not callable');
                        const members = membersOf(calleeValue.type);
                        const known =
                            s.known.get(i.callee) ??
                            (members.length === 1 && members[0]!.kind === 'native'
                                ? members[0]
                                : undefined);
                        requireEqual(
                            call.callee && memberKey(call.callee),
                            known && memberKey(known),
                            'Call callee provenance changed',
                        );
                        const args =
                            known?.kind === 'native'
                                ? incoming
                                : incoming.map((a, n) =>
                                      canonicalArgument(
                                          a,
                                          calleeValue.type,
                                          n,
                                          specializeLensCall(source, selected, known),
                                      ),
                                  );
                        requireEqual(call.arguments, args, 'Call argument representations changed');
                        requireEqual(call.result, v, 'Call result annotation mismatch');
                        const options = known ? [known] : members,
                            targets = known ? [call.target] : call.targets;
                        if (!targets || targets.length !== options.length)
                            return fail('Dynamic call target coverage mismatch');
                        if (known) {
                            if (call.targets !== undefined) fail('Static call has dynamic targets');
                        } else
                            requireEqual(
                                call.target,
                                JSON.stringify(['dispatch', targets]),
                                'Dynamic call identity mismatch',
                            );
                        const results = options.map((option, n): ValueRepresentation => {
                            if (option.kind === 'native') {
                                if (targets[n] !== option.definition)
                                    fail('Wrong native call target');
                                if (v.kind === 'lens' && option.definition === 'native/[]') {
                                    if (i.out.type.tag !== 'flow')
                                        return fail('Native lens result type mismatch');
                                    return {
                                        kind: 'lens',
                                        shape: JSON.stringify([
                                            'thin',
                                            JSON.stringify([
                                                'backing',
                                                layoutId(i.out.type.read),
                                                layoutId(i.out.type.write),
                                            ]),
                                        ]),
                                    };
                                }
                                if (v.kind === 'lens') {
                                    if (option.definition !== 'native/fst' || !args[0])
                                        return fail('Missing native returned-lens contract');
                                    const r = projectedShape(lens(args[0]), [0]);
                                    // Re-derive the projected shape with the call's semantic endpoints.
                                    const retype = (
                                        r: LensRep,
                                        read: SemanticType,
                                        write: SemanticType,
                                    ): string => {
                                        if (r.kind === 'thin')
                                            return JSON.stringify([
                                                'thin',
                                                JSON.stringify([
                                                    'backing',
                                                    layoutId(read),
                                                    layoutId(write),
                                                ]),
                                            ]);
                                        if (read.tag !== 'tuple' || write.tag !== 'tuple')
                                            return fail('Invalid native fst topology');
                                        return JSON.stringify([
                                            'lens-tuple',
                                            r.items.map((id, j) =>
                                                retype(shape(id), read.items[j]!, write.items[j]!),
                                            ),
                                        ]);
                                    };
                                    if (i.out.type.tag !== 'flow')
                                        return fail('Native lens result type mismatch');
                                    return {
                                        kind: 'lens',
                                        shape: retype(r, i.out.type.read, i.out.type.write),
                                    };
                                }
                                return v;
                            }
                            const target =
                                variants.get(targets[n]!) ??
                                fail('Call references an absent variant');
                            if (target.unit !== option.unit || target.function !== option.function)
                                fail('Call selects the wrong callable body');
                            requireEqual(
                                target.captures,
                                option.captures,
                                'Call capture contract changed',
                            );
                            requireEqual(
                                target.arguments,
                                args,
                                'Call variant argument contract changed',
                            );
                            edges.get(owner)!.add(target.id);
                            return target.result;
                        });
                        if (
                            i.out.type.tag === 'flow' &&
                            (!results.length || results.some((r) => !same(r, results[0])))
                        ) {
                            if (lens(v).kind !== 'thin')
                                fail('Dynamic lens adapter must expose a thin focus');
                        } else
                            results.forEach((r) =>
                                requireEqual(v, r, 'Call result representation changed'),
                            );
                        break;
                    }
                }
                s.values.set(i.out.id, v);
            }
            return get(s, b.result);
        }
        const result = block(body, state);
        if (usedValues.size !== annotations.size || usedCalls.size !== calls.size)
            fail('Extra value or call annotations');
        return result;
    }
    if (!Array.isArray(analysis.callables)) fail('Missing callable member sets');
    requireEqual(
        analysis.callables.map((c) => c.type),
        [...new Set(analysis.callables.map((c) => c.type))].sort(),
        'Noncanonical callable member sets',
    );
    for (const c of analysis.callables) {
        if (c.signature?.tag !== 'fn' || typeKey(c.signature) !== c.type)
            fail('Callable member set signature mismatch');
        if (!Array.isArray(c.members)) fail('Missing callable members');
        const keys = c.members.map(memberKey);
        requireEqual(keys, [...new Set(keys)].sort(), 'Noncanonical callable members');
        c.members.forEach((m) => fitMember(m, c.signature));
        callableTypes.set(c.type, c.members);
    }
    for (const v of variants.values()) {
        if (!Array.isArray(v.arguments) || !Array.isArray(v.captures))
            fail('Missing variant arguments or captures');
        const unit = units.get(v.unit) ?? fail('Unknown variant unit'),
            fn = fnFor(v.unit, v.function);
        const expectedKey = JSON.stringify([
            'representation-variant',
            target,
            JSON.stringify([unit.id, fn.id]),
            v.captures.map(repKey),
            v.arguments.map(repKey),
        ]);
        if (
            v.key !== expectedKey ||
            v.id !== `rep_${createHash('sha256').update(v.key).digest('hex')}`
        )
            fail('Noncanonical variant key or name');
        if (v.arguments.length !== fn.type.args.length || v.captures.length !== fn.captures.length)
            fail('Variant parameter/capture arity mismatch');
        const state = fresh();
        v.arguments.forEach((a, i) => {
            fit(a, fn.type.args[i]!);
            const p = fn.parameters[i]!;
            if (p.lensPlace) state.lenses.set(p.lensPlace, lens(a));
            else bind(p.pattern, a, state);
        });
        v.captures.forEach((c, i) => {
            fit(c, irPlain(fn.captures[i]!.type));
        });
        fit(v.result, fn.type.result);
        requireEqual(
            v.result,
            verifyBody(unit, fn.body, v, state, v.id),
            'Variant result differs from its body',
        );
    }
    requireEqual(
        analysis.roots.map((r) => r.unit),
        source.roots,
        'Root coverage mismatch',
    );
    if (analysis.entries.length !== analysis.roots.length) fail('Entry coverage mismatch');
    analysis.roots.forEach((root, i) => {
        const entry = analysis.entries[i]!,
            unit = units.get(root.unit) ?? fail('Unknown analysis root');
        if (entry.unit !== root.unit) fail('Entry root mismatch');
        const exported = analysis.exports.filter((e) => e.entry === i);
        fit(root.result, irPlain(unit.signature.type));
        const rootState = fresh();
        requireEqual(
            root.result,
            verifyBody(unit, unit.entry, entry, rootState, `entry:${i}`),
            'Root result differs from its entry',
        );
        if (root.result.kind === 'callable') {
            const member = rootState.known.get(unit.entry.result);
            if (member?.kind === 'native') fail('Native entry roots require a host contract');
            if (member?.kind !== 'closure')
                return fail('Dynamic callable entry roots require a host adapter');
            if (exported.length !== 1)
                fail('Callable root requires one incoming representation contract');
            const e = exported[0]!,
                v = variants.get(e.variant) ?? fail('Missing exported variant');
            if (v.unit !== member.unit || v.function !== member.function)
                fail('Exported callable provenance mismatch');
            requireEqual(v.captures, member.captures, 'Exported capture contract mismatch');
            requireEqual(v.arguments, e.arguments, 'Exported argument contract mismatch');
            requireEqual(v.result, e.result, 'Exported result contract mismatch');
        } else if (exported.length) fail('Expression root has an invocation contract');
        if (exported[0]) edges.get(`entry:${i}`)!.add(exported[0].variant);
    });
    if (
        analysis.exports.some(
            (e) => !Number.isInteger(e.entry) || e.entry < 0 || e.entry >= analysis.roots.length,
        )
    )
        fail('Unknown export entry');
    // Every listed member is reachable from verified code through an escaping value,
    // and every escaping value's code is listed for its type.
    requireEqual(
        [...derived.keys()].sort().map((k) => [k, [...derived.get(k)!].sort()]),
        analysis.callables
            .filter((c) => c.members.length)
            .map((c) => [c.type, c.members.map(memberKey)]),
        'Callable member sets changed',
    );
    const reached = new Set<string>();
    const visit = (id: string): void => {
        if (reached.has(id)) return;
        reached.add(id);
        edges.get(id)?.forEach(visit);
    };
    analysis.entries.forEach((_, i) => visit(`entry:${i}`));
    for (const id of variants.keys()) if (!reached.has(id)) fail('Unreachable function variant');
}
