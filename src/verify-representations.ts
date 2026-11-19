import { layoutDefinitionsKey } from './layout-definitions.ts';
import { mapSemantic, type Instance } from './typed-ir.ts';
import { createHash } from 'node:crypto';
import type { SemanticType, SemanticFlow } from './elaborated.ts';
import { BackendDiagnostic, targetKey } from './backend/target.ts';
import { typeKey, irPlain, type IRBlock, type IRUnit, type IRPattern } from './typed-ir.ts';
import { verifyTypedProgram } from './verify-ir.ts';
import type { SpecializedProgram } from './specialize.ts';
import type {
    RepresentationAnalysis,
    RepresentationVariant,
    ValueRepresentation,
} from './infer-representations.ts';
import type { Layout } from './layouts.ts';
import type { LensRep } from './representations.ts';

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
            case 'local-focus':
                return JSON.stringify({
                    kind: v.kind,
                    read: JSON.parse(repKey(v.read)),
                    replacement: JSON.parse(repKey(v.replacement)),
                });
            case 'lens':
                return JSON.stringify({ kind: 'lens', shape: v.shape });
            case 'native':
                return JSON.stringify({ kind: 'native', definition: v.definition });
            case 'callable-choice':
                if (!Array.isArray(v.options)) return fail('Missing callable alternatives');
                return JSON.stringify({
                    kind: v.kind,
                    options: v.options.map((c) => JSON.parse(repKey(c))),
                });
            case 'callable':
                if (!Array.isArray(v.captures)) return fail('Missing callable captures');
                return JSON.stringify({
                    kind: 'callable',
                    unit: v.unit,
                    function: v.function,
                    captures: v.captures.map((c) => JSON.parse(repKey(c))),
                });
            default:
                return fail('Unknown value representation');
        }
    };
    const target = targetKey(source.target);
    const schemas = analysis.layoutDefinitions ?? [];
    const schemaKey = schemas.length ? layoutDefinitionsKey(schemas) : '';
    const layouts = unique(analysis.layouts, (l) => l.id, 'layout');
    const shapes = unique(analysis.shapes, (s) => s.id, 'shape');
    const backings = unique(analysis.backings, (b) => b.id, 'backing');
    const variants = unique(analysis.variants, (v) => v.id, 'variant');
    const units = new Map(source.program.units.map((u) => [u.id, u]));
    const definitions = new Map(
        source.program.units.filter((u) => u.definition).map((u) => [u.definition!, u]),
    );
    const imports = new Map(source.program.imports.map((i) => [i.definition, i]));
    const layout = (id: string): Layout => layouts.get(id) ?? fail('Missing or foreign layout');
    const shape = (id: string): LensRep => shapes.get(id) ?? fail('Missing or foreign lens shape');
    const layoutId = (t: SemanticType): string =>
        JSON.stringify(['layout', target, typeKey(t), ...(schemaKey ? [schemaKey] : [])]);
    const typeEqual = (a: SemanticType, b: SemanticType) => {
        if (typeKey(a) !== typeKey(b)) fail('Representation semantic type mismatch');
    };
    const layoutOrder = new Map(analysis.layouts.map((l, i) => [l.id, i]));
    function storageType(t: SemanticType): void {
        if (!t || typeof t !== 'object') return fail('Missing layout semantic type');
        if (t.tag === 'tuple' && Array.isArray(t.items)) {
            t.items.forEach(storageType);
            return;
        }
        if (
            t.tag === 'con' &&
            Array.isArray(t.args) &&
            t.args.length === 0 &&
            ['Number', 'Bool'].includes(t.name)
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
                if (!l.type.args.length && ['Number', 'Bool'].includes(l.type.name))
                    storage = l.type.name === 'Number' ? 'f64' : 'bool';
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
    const containsCallable = (t: SemanticType): boolean =>
        t.tag === 'fn' || (t.tag === 'tuple' && t.items.some(containsCallable));
    function fit(v: ValueRepresentation, t: SemanticFlow): void {
        if (!v || typeof v !== 'object') return fail('Missing value representation');
        if (t.tag === 'flow') {
            if (v.kind === 'local-focus') {
                if (!containsCallable(t.read) && !containsCallable(t.write))
                    return fail('Noncanonical local callable focus');
                fit(v.read, irPlain(t.read));
                fit(v.replacement, irPlain(t.write));
                return;
            }
            // Semantic lens shapes only describe data storage. Do not let a
            // detached annotation select that path for a callable endpoint,
            // bypassing the independently checked local-focus provenance.
            if (containsCallable(t.read) || containsCallable(t.write))
                return fail('Callable lens endpoints require explicit focus provenance');
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
            typeEqual(layout(v.layout).type, t.value);
            return;
        }
        if (v.kind === 'callable-choice') {
            if (
                !Array.isArray(v.options) ||
                v.options.length < 2 ||
                v.options.some((o) => o.kind !== 'callable' && o.kind !== 'native')
            )
                return fail('Invalid callable alternatives');
            const keys = v.options.map(repKey);
            requireEqual(keys, [...new Set(keys)].sort(), 'Noncanonical callable alternatives');
            v.options.forEach((o) => fit(o, t));
            return;
        }
        if (v.kind === 'callable') {
            if (!Array.isArray(v.captures)) return fail('Missing callable captures');
            const fn = fnFor(v.unit, v.function);
            typeEqual(fn.type, t.value);
            if (fn.captures.length !== v.captures.length) fail('Callable capture arity mismatch');
            fn.captures.forEach((c, i) => fit(v.captures[i]!, irPlain(c.type)));
            return;
        }
        if (v.kind === 'native') {
            if (!imports.has(v.definition) || t.value.tag !== 'fn') fail('Unknown native callable');
            // Generic import instantiation is checked by the semantic IR verifier at its global instruction.
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
        places: Map<string, ValueRepresentation>;
        lenses: Map<string, LensRep>;
        focusOwners: Map<string, { place: string; path: number[] }>;
        finishes: Map<string, (state: State, apply: boolean) => void>;
        loanFinishes: Map<string, string>;
    };
    const fresh = (): State => ({
        values: new Map(),
        places: new Map(),
        lenses: new Map(),
        focusOwners: new Map(),
        finishes: new Map(),
        loanFinishes: new Map(),
    });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        places: new Map(s.places),
        lenses: new Map(s.lenses),
        focusOwners: new Map(s.focusOwners),
        finishes: new Map(s.finishes),
        loanFinishes: new Map(s.loanFinishes),
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
    function projectValue(v: ValueRepresentation, path: number[]): ValueRepresentation {
        if (!path.length) return v;
        if (v.kind === 'aggregate')
            return projectValue(
                v.items[path[0]!] ?? fail('Invalid aggregate projection'),
                path.slice(1),
            );
        if (v.kind !== 'data') return fail('Invalid callable projection');
        let t = layout(v.layout).type;
        for (const index of path) {
            if (t.tag !== 'tuple' || !t.items[index]) return fail('Invalid data projection');
            t = t.items[index]!;
        }
        return { kind: 'data', layout: layoutId(t) };
    }
    function replaceValue(
        v: ValueRepresentation,
        path: number[],
        replacement: ValueRepresentation,
    ): ValueRepresentation {
        if (!path.length) return replacement;
        let members: ValueRepresentation[];
        if (v.kind === 'aggregate') members = [...v.items];
        else if (v.kind === 'data') {
            const t = layout(v.layout).type;
            if (t.tag !== 'tuple') return fail('Invalid focus owner projection');
            members = t.items.map((t) => ({ kind: 'data', layout: layoutId(t) }));
        } else return fail('Invalid focus owner projection');
        const index = path[0]!;
        members[index] = replaceValue(
            members[index] ?? fail('Invalid focus owner projection'),
            path.slice(1),
            replacement,
        );
        if (members.every((m) => m.kind === 'data'))
            return {
                kind: 'data',
                layout: layoutId({
                    tag: 'tuple',
                    items: members.map(
                        (m) =>
                            layout((m as Extract<ValueRepresentation, { kind: 'data' }>).layout)
                                .type,
                    ),
                }),
            };
        return { kind: 'aggregate', items: members };
    }
    function bind(p: IRPattern, v: ValueRepresentation, s: State): void {
        if (p.kind === 'constructor') checkConstructor(p.name, p.instance);
        if (p.kind === 'bind') s.places.set(p.slot.place, v);
        else if (p.kind === 'tuple')
            p.items.forEach((child, i) => bind(child, projectValue(v, [i]), s));
        else if (p.kind === 'constructor') {
            if (v.kind !== 'data') return fail('Tuple pattern needs data storage');
            p.items.forEach((child) =>
                bind(child, { kind: 'data', layout: layoutId(child.type) }, s),
            );
        }
    }
    function nativeResult(
        callee: Extract<ValueRepresentation, { kind: 'native' }>,
        args: ValueRepresentation[],
        result: ValueRepresentation,
    ): ValueRepresentation {
        if (callee.definition !== 'native/fst' || result.kind !== 'lens') return result;
        const parent = lens(args[0]!);
        if (parent.kind === 'tuple') return { kind: 'lens', shape: parent.items[0]! };
        const read = layout(parent.read).type,
            write = layout(parent.replacement).type;
        if (read.tag !== 'tuple' || write.tag !== 'tuple')
            return fail('Invalid native fst endpoints');
        const backing = JSON.stringify([
            'backing',
            layoutId(read.items[0]!),
            layoutId(write.items[0]!),
        ]);
        return { kind: 'lens', shape: JSON.stringify(['thin', backing]) };
    }
    function nativeCall(
        callee: Extract<ValueRepresentation, { kind: 'native' }>,
        target: string,
        args: ValueRepresentation[],
        v: ValueRepresentation,
    ): void {
        if (target !== callee.definition) fail('Wrong native call target');
        if (v.kind === 'lens') {
            if (callee.definition !== 'native/fst' || !args[0])
                fail('Missing native returned-lens contract');
            topology(projectedShape(lens(args[0]), [0]), lens(v));
        } else if (v.kind !== 'data') fail('Unsupported native callable result');
    }
    function verifyJoin(v: ValueRepresentation, results: ValueRepresentation[]): void {
        if (results.length && results.every((r) => repKey(r) === repKey(results[0]!))) {
            requireEqual(v, results[0], 'Uniform join representation changed');
            return;
        }
        if (v.kind === 'aggregate') {
            const members = results.map((r) =>
                r.kind === 'aggregate' && r.items.length === v.items.length
                    ? r.items
                    : fail('Aggregate join member changed'),
            );
            v.items.forEach((child, n) =>
                verifyJoin(
                    child,
                    members.map((items) => items[n]!),
                ),
            );
        } else if (v.kind === 'callable-choice') {
            const options = results.flatMap((r) =>
                r.kind === 'callable-choice'
                    ? r.options
                    : r.kind === 'callable' || r.kind === 'native'
                      ? [r]
                      : fail('Non-callable join member'),
            );
            requireEqual(
                v.options.map(repKey),
                [...new Set(options.map(repKey))].sort(),
                'Callable join alternatives changed',
            );
        } else results.forEach((r) => requireEqual(v, r, 'Branch needs a representation adapter'));
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
        const checkedCleanupJoins = new Set<string>();
        const usedValues = new Set<string>(),
            usedCalls = new Set<string>();
        edges.set(owner, new Set());
        function deferredStorageUse(
            body: IRBlock,
            place: string,
            delayed = false,
            writes = false,
        ): boolean {
            const actionUses = (actions: IRBlock['cleanup'] | undefined) =>
                actions?.some((a) =>
                    a.kind === 'release'
                        ? unit.loans.some(
                              (l) =>
                                  l.id === a.loan &&
                                  (l.place === place || l.owners?.some((s) => s.place === place)),
                          )
                        : a.slot.place === place && (!writes || a.kind !== 'drop-place'),
                ) ?? false;
            const result = annotations.get(body.result)?.representation;
            if ((delayed || result?.kind === 'lens') && actionUses(body.cleanup)) return true;
            return body.instructions.some((i) => {
                if (
                    delayed &&
                    (i.op === 'acquire' || (!writes && i.op === 'move')) &&
                    i.slot.place === place
                )
                    return true;
                if (i.op === 'manual')
                    return (
                        (!writes && i.holds.some((s) => s.place === place)) ||
                        deferredStorageUse(i.cleanup, place, true, writes)
                    );
                if (i.op === 'scope') return deferredStorageUse(i.body, place, delayed, writes);
                if (i.op === 'case')
                    return i.cases.some(
                        (arm) =>
                            deferredStorageUse(arm.body, place, delayed, writes) ||
                            actionUses(arm.restored) ||
                            (delayed && actionUses(arm.setup)),
                    );
                return false;
            });
        }
        function block(b: IRBlock, s: State): ValueRepresentation {
            const deferred: { value: string; body: IRBlock }[] = [];
            function borrowedLoans(value: string, body: IRBlock): string[] {
                const loans: string[] = [];
                for (const use of body.instructions) {
                    if (use.op === 'borrow' && use.lens === value) loans.push(use.loan);
                    if (use.op === 'scope') loans.push(...borrowedLoans(value, use.body));
                }
                return loans;
            }

            for (const i of b.instructions) {
                if (i.op === 'bind') {
                    bind(i.pattern, get(s, i.value), s);
                    continue;
                }
                if (i.op === 'borrow') {
                    const loan = unit.loans.find((l) => l.id === i.loan)!;
                    const focus = get(s, i.lens);
                    if (focus.kind === 'local-focus') {
                        if (
                            loan.owners ||
                            JSON.stringify(s.focusOwners.get(i.lens)?.path) !==
                                JSON.stringify(loan.path) ||
                            s.focusOwners.get(i.lens)?.place !== loan.place
                        )
                            return fail('Callable aliases require a direct owned-local loan');
                    } else if (loan.owners) s.lenses.set(loan.place, lens(focus));
                    s.loanFinishes.set(i.loan, i.lens);
                    continue;
                }
                const v =
                    annotations.get(i.out.id)?.representation ??
                    fail('Missing temporary annotation');
                if (usedValues.has(i.out.id)) fail('Repeated temporary annotation use');
                usedValues.add(i.out.id);
                fit(v, i.out.type);
                if (i.op !== 'manual' && annotations.get(i.out.id)!.cleanupStorage !== undefined)
                    fail('Unexpected cleanup storage annotation');
                if (i.op !== 'case' && annotations.get(i.out.id)!.cleanupJoins !== undefined)
                    fail('Unexpected cleanup join annotation');
                if (i.op !== 'case' && annotations.get(i.out.id)!.storageJoins !== undefined)
                    fail('Unexpected storage join annotation');
                switch (i.op) {
                    case 'constant':
                    case 'string':
                        if (v.kind !== 'data') fail('Data operation has a callable representation');
                        break;
                    case 'swap': {
                        const focus = get(s, i.lens);
                        if (focus.kind === 'local-focus') {
                            requireEqual(v, focus.read, 'Callable swap old provenance changed');
                            requireEqual(
                                get(s, i.value),
                                focus.replacement,
                                'Callable swap replacement provenance changed',
                            );
                            const owner =
                                s.focusOwners.get(i.lens) ?? fail('Nonlocal callable focus swap');
                            s.places.set(
                                owner.place,
                                replaceValue(
                                    s.places.get(owner.place) ??
                                        fail('Missing callable focus owner'),
                                    owner.path,
                                    focus.replacement,
                                ),
                            );
                        } else {
                            if (v.kind !== 'data') fail('Swap lacks callable focus provenance');
                            const owner = s.focusOwners.get(i.lens);
                            if (owner)
                                s.places.set(
                                    owner.place,
                                    replaceValue(
                                        s.places.get(owner.place)!,
                                        owner.path,
                                        get(s, i.value),
                                    ),
                                );
                        }
                        s.finishes.get(i.lens)?.(s, true);
                        break;
                    }
                    case 'tuple':
                        if (i.out.type.tag !== 'plain') return fail('Tuple produced a lens');
                        requireEqual(
                            v,
                            containsCallable(i.out.type.value)
                                ? { kind: 'aggregate', items: i.items.map((id) => get(s, id)) }
                                : { kind: 'data', layout: layoutId(i.out.type.value) },
                            'Tuple member provenance changed',
                        );
                        break;
                    case 'construct':
                        if (v.kind !== 'data') fail('Constructor has a callable representation');
                        checkConstructor(i.name, i.instance);
                        break;
                    case 'move': {
                        const stored = s.places.get(i.slot.place);
                        if (stored && stored.kind !== 'data') {
                            requireEqual(
                                v,
                                projectValue(stored, i.slot.path),
                                'Moved callable provenance changed',
                            );
                        } else if (v.kind !== 'data') fail('Moved callable lacks provenance');
                        break;
                    }
                    case 'acquire': {
                        if (v.kind === 'local-focus') {
                            if (
                                i.out.type.tag !== 'flow' ||
                                s.lenses.has(i.slot.place) ||
                                (b.instructions.filter(
                                    (use) => use.op === 'swap' && use.lens === i.out.id,
                                ).length !== 1 &&
                                    borrowedLoans(i.out.id, b).length !== 1 &&
                                    !b.instructions.some(
                                        (use) => use.op === 'manual' && use.lens === i.out.id,
                                    ))
                            )
                                return fail(
                                    'Callable focuses require a direct whole-owned-local swap',
                                );
                            const owner = s.places.get(i.slot.place);
                            const stored = owner && projectValue(owner, i.slot.path);
                            requireEqual(
                                v.read,
                                containsCallable(i.out.type.read)
                                    ? (stored ?? fail('Callable focus lacks owned provenance'))
                                    : { kind: 'data', layout: layoutId(i.out.type.read) },
                                'Callable focus read provenance changed',
                            );
                            s.focusOwners.set(i.out.id, {
                                place: i.slot.place,
                                path: [...i.slot.path],
                            });
                            const borrowed = borrowedLoans(i.out.id, b);
                            if (borrowed.length) {
                                const loan = unit.loans.find((l) => l.id === borrowed[0])!;
                                if (
                                    loan.owners ||
                                    loan.place !== i.slot.place ||
                                    JSON.stringify(loan.path) !== JSON.stringify(i.slot.path)
                                )
                                    return fail(
                                        'Callable aliases require a direct owned-local loan',
                                    );
                            }
                            if (
                                borrowed.length ||
                                b.instructions.some(
                                    (use) => use.op === 'manual' && use.lens === i.out.id,
                                )
                            ) {
                                const write = i.out.type.write;
                                s.finishes.set(i.out.id, (state, apply) => {
                                    if (apply)
                                        requireEqual(
                                            v.replacement,
                                            containsCallable(write)
                                                ? projectValue(
                                                      state.places.get(i.slot.place) ??
                                                          fail('Missing callable alias owner'),
                                                      i.slot.path,
                                                  )
                                                : { kind: 'data', layout: layoutId(write) },
                                            'Callable alias final replacement provenance changed',
                                        );
                                });
                            }
                            break;
                        }
                        if (
                            i.slot.path.length &&
                            !s.lenses.has(i.slot.place) &&
                            s.places.has(i.slot.place)
                        )
                            s.focusOwners.set(i.out.id, {
                                place: i.slot.place,
                                path: [...i.slot.path],
                            });
                        const incoming = s.lenses.get(i.slot.place),
                            actual = lens(v);
                        if (incoming) topology(projectedShape(incoming, i.slot.path), actual);
                        else if (actual.kind !== 'thin') fail('Owned acquisition must be thin');
                        break;
                    }
                    case 'manual': {
                        const frontend = get(s, i.lens);
                        const owner = s.focusOwners.get(i.lens);
                        if (frontend.kind === 'local-focus') {
                            if (v.kind !== 'local-focus' || !owner)
                                return fail('Manual callable focus lacks a logical owner');
                            requireEqual(
                                v.read,
                                frontend.read,
                                'Manual callable read provenance changed',
                            );
                            s.focusOwners.set(i.out.id, owner);
                        } else topology(lens(frontend), lens(v));
                        if (i.out.type.tag !== 'flow') return fail('Manual produced data');
                        const write = i.out.type.write;
                        const frontendFinish = s.finishes.get(i.lens);
                        let analyzed = false;
                        const finish = (state: State, apply: boolean) => {
                            const annotation = annotations.get(i.out.id)!;
                            if (apply && v.kind === 'local-focus')
                                requireEqual(
                                    v.replacement,
                                    containsCallable(write)
                                        ? projectValue(state.places.get(owner!.place)!, owner!.path)
                                        : { kind: 'data', layout: layoutId(write) },
                                    'Manual callable replacement provenance changed',
                                );
                            if (!analyzed) {
                                analyzed = true;
                                const restored = clone(state);
                                block(i.cleanup, restored);
                                const transitions = [...state.places].flatMap(([place, before]) => {
                                    const after = restored.places.get(place)!;
                                    return same(before, after) ? [] : [{ place, before, after }];
                                });
                                requireEqual(
                                    annotation.cleanupStorage,
                                    transitions.length ? transitions : undefined,
                                    'Cleanup storage transitions changed',
                                );
                            }
                            if (apply) {
                                annotation.cleanupStorage?.forEach(({ place, before, after }) => {
                                    requireEqual(
                                        state.places.get(place),
                                        before,
                                        'Cleanup storage input provenance changed',
                                    );
                                    state.places.set(place, after);
                                });
                                frontendFinish?.(state, true);
                            }
                        };
                        s.finishes.set(i.out.id, finish);
                        deferred.push({ value: i.out.id, body: i.cleanup });
                        break;
                    }
                    case 'lens-tuple': {
                        const actual = lens(v);
                        if (actual.kind !== 'tuple') return fail('Lens tuple lost its topology');
                        requireEqual(
                            actual.items,
                            i.items.map((id) => lens(get(s, id)).id),
                            'Lens tuple children changed',
                        );
                        const finishes = i.items.map((id) => s.finishes.get(id));
                        if (finishes.some(Boolean))
                            s.finishes.set(i.out.id, (state, apply) => {
                                for (const finish of finishes) finish?.(state, apply);
                            });
                        break;
                    }
                    case 'global': {
                        const target = definitions.get(i.instance.definition);
                        if (target) {
                            const closure = target.entry.instructions[0];
                            if (closure?.op !== 'closure') return fail('Invalid global entry');
                            requireEqual(
                                v,
                                {
                                    kind: 'callable',
                                    unit: target.id,
                                    function: closure.function,
                                    captures: [],
                                },
                                'Global callable provenance changed',
                            );
                        } else
                            requireEqual(
                                v,
                                { kind: 'native', definition: i.instance.definition },
                                'Native callable provenance changed',
                            );
                        break;
                    }
                    case 'closure':
                        requireEqual(
                            v,
                            {
                                kind: 'callable',
                                unit: unit.id,
                                function: i.function,
                                captures: i.captures.map((c) => get(s, c.value)),
                            },
                            'Closure capture provenance changed',
                        );
                        break;
                    case 'scope': {
                        const nested = clone(s);
                        requireEqual(
                            v,
                            block(i.body, nested),
                            'Scope result representation mismatch',
                        );
                        s.places.forEach((_, place) =>
                            s.places.set(place, nested.places.get(place)!),
                        );
                        const finish = nested.finishes.get(i.body.result);
                        if (finish) {
                            const retained = clone(nested);
                            const enclosing = [...s.places.keys()];
                            s.finishes.set(i.out.id, (current, apply) => {
                                const restored = clone(retained);
                                for (const place of enclosing)
                                    restored.places.set(place, current.places.get(place)!);
                                finish(restored, apply);
                                if (apply)
                                    for (const place of enclosing)
                                        current.places.set(place, restored.places.get(place)!);
                            });
                        }
                        break;
                    }
                    case 'case': {
                        if (i.out.type.tag === 'flow' && lens(v).kind !== 'thin')
                            fail('Selected-branch adapter must expose a thin focus');
                        const states: State[] = [];
                        const results = i.cases.map((arm) => {
                            const branch = clone(s);
                            bind(arm.pattern, get(s, i.value), branch);
                            const result = block(arm.body, branch);
                            states.push(branch);
                            return result;
                        });
                        const joins = annotations.get(i.out.id)!.storageJoins;
                        const divergent = [...s.places.keys()].filter((place) =>
                            states.some(
                                (state) =>
                                    !same(states[0]!.places.get(place)!, state.places.get(place)!),
                            ),
                        );
                        requireEqual(
                            joins?.map((j) => j.place),
                            divergent.length ? divergent : undefined,
                            'Branch storage join coverage changed',
                        );
                        s.places.forEach((_, place) => {
                            const current = (
                                states[0] ?? fail('Branch has no storage continuation')
                            ).places.get(place)!;
                            if (divergent.includes(place)) {
                                const joined = joins!.find((j) => j.place === place)!;
                                const uses = (writes = false) =>
                                    i.out.type.tag === 'flow' &&
                                    i.cases.some((arm) =>
                                        deferredStorageUse(
                                            {
                                                ...arm.body,
                                                cleanup: [
                                                    ...arm.body.cleanup,
                                                    ...(arm.restored ?? []),
                                                ],
                                            },
                                            place,
                                            false,
                                            writes,
                                        ),
                                    );
                                requireEqual(
                                    joined.restoration,
                                    uses(true) ? 'replace' : uses() ? 'consume' : undefined,
                                    'Selected storage restoration contract changed',
                                );
                                const arms = states.map((state) => state.places.get(place)!);
                                requireEqual(
                                    joined.arms,
                                    arms,
                                    'Branch storage arm provenance changed',
                                );
                                verifyJoin(joined.result, arms);
                                s.places.set(place, joined.result);
                            } else s.places.set(place, current);
                        });
                        if (i.out.type.tag === 'flow') results.forEach(lens);
                        else verifyJoin(v, results);
                        if (i.out.type.tag === 'flow') {
                            const finishes = i.cases.map((arm, n) =>
                                states[n]!.finishes.get(arm.body.result),
                            );
                            if (joins?.some((j) => j.restoration === 'replace'))
                                i.cases.forEach((arm, n) => {
                                    if (
                                        !finishes[n] &&
                                        joins.some(
                                            (j) =>
                                                j.restoration === 'replace' &&
                                                deferredStorageUse(
                                                    {
                                                        ...arm.body,
                                                        cleanup: [
                                                            ...arm.body.cleanup,
                                                            ...(arm.restored ?? []),
                                                        ],
                                                    },
                                                    j.place,
                                                    false,
                                                    true,
                                                ),
                                        )
                                    )
                                        fail(
                                            'Deferred callable storage replacement requires a restoration adapter',
                                        );
                                });
                            const places = [...s.places.keys()];
                            if (finishes.some(Boolean))
                                s.finishes.set(i.out.id, (current, apply) => {
                                    if (!apply) return;
                                    const completed = states.map((setup, n) => {
                                        const restored = clone(setup);
                                        for (const place of places)
                                            restored.places.set(place, current.places.get(place)!);
                                        joins
                                            ?.filter((j) => j.restoration === 'replace')
                                            .forEach((j) =>
                                                restored.places.set(
                                                    j.place,
                                                    setup.places.get(j.place)!,
                                                ),
                                            );
                                        finishes[n]?.(restored, true);
                                        return restored;
                                    });
                                    checkedCleanupJoins.add(i.out.id);
                                    const cleanupJoins = annotations.get(i.out.id)!.cleanupJoins;
                                    const divergent = places.filter((place) =>
                                        completed.some(
                                            (state) =>
                                                !same(
                                                    state.places.get(place),
                                                    completed[0]!.places.get(place),
                                                ) ||
                                                joins?.some(
                                                    (j) =>
                                                        j.place === place &&
                                                        j.restoration === 'replace',
                                                ),
                                        ),
                                    );
                                    requireEqual(
                                        cleanupJoins?.map((j) => j.place),
                                        divergent.length ? divergent : undefined,
                                        'Cleanup storage join coverage changed',
                                    );
                                    for (const place of places) {
                                        const arms = completed.map((state) =>
                                            state.places.get(place)!,
                                        );
                                        const joined = cleanupJoins?.find((j) => j.place === place);
                                        if (joined) {
                                            requireEqual(
                                                joined.arms,
                                                arms,
                                                'Cleanup storage arm provenance changed',
                                            );
                                            verifyJoin(joined.result, arms);
                                        }
                                        current.places.set(place, joined?.result ?? arms[0]!);
                                    }
                                });
                        }
                        break;
                    }
                    case 'call': {
                        const call = calls.get(i.out.id) ?? fail('Missing call annotation');
                        usedCalls.add(i.out.id);
                        const callee = get(s, i.callee),
                            args = i.args.map((id) => get(s, id));
                        requireEqual(call.arguments, args, 'Call argument representations changed');
                        requireEqual(call.result, v, 'Call result annotation mismatch');
                        if (callee.kind === 'callable' || callee.kind === 'callable-choice') {
                            const options =
                                callee.kind === 'callable-choice' ? callee.options : [callee];
                            const targets =
                                callee.kind === 'callable-choice' ? call.targets : [call.target];
                            if (!Array.isArray(targets) || targets.length !== options.length)
                                return fail('Dynamic call target coverage mismatch');
                            if (callee.kind === 'callable-choice')
                                requireEqual(
                                    call.target,
                                    JSON.stringify(['dispatch', targets]),
                                    'Dynamic call identity mismatch',
                                );
                            else if (call.targets !== undefined)
                                fail('Static call has dynamic targets');
                            const results: ValueRepresentation[] = [];
                            options.forEach((option, index) => {
                                if (option.kind === 'native') {
                                    const raw = nativeResult(option, args, v);
                                    nativeCall(option, targets[index]!, args, raw);
                                    results.push(raw);
                                    return;
                                }
                                const target =
                                    variants.get(targets[index]!) ??
                                    fail('Call references an absent variant');
                                if (
                                    target.unit !== option.unit ||
                                    target.function !== option.function
                                )
                                    fail('Call selects the wrong callable body');
                                requireEqual(
                                    target.captures,
                                    option.captures,
                                    'Call capture contract mismatch',
                                );
                                requireEqual(
                                    target.arguments,
                                    args,
                                    'Call variant argument contract mismatch',
                                );
                                results.push(target.result);
                                edges.get(owner)!.add(target.id);
                            });
                            if (callee.kind === 'callable-choice' && v.kind === 'callable-choice') {
                                const members = results.flatMap((r) =>
                                    r.kind === 'callable-choice'
                                        ? r.options
                                        : r.kind === 'callable' || r.kind === 'native'
                                          ? [r]
                                          : fail('Non-callable dynamic result'),
                                );
                                requireEqual(
                                    v.options.map(repKey),
                                    [...new Set(members.map(repKey))].sort(),
                                    'Dynamic result alternatives changed',
                                );
                            } else if (
                                callee.kind === 'callable-choice' &&
                                v.kind === 'aggregate'
                            ) {
                                verifyJoin(v, results);
                            } else if (callee.kind === 'callable-choice' && v.kind === 'lens') {
                                const first = results[0]!;
                                if (results.every((r) => same(r, first)))
                                    requireEqual(v, first, 'Uniform lens result changed');
                                else {
                                    if (lens(v).kind !== 'thin')
                                        fail('Dynamic lens adapter must expose a thin focus');
                                    results.forEach((r) => {
                                        const source = lens(r),
                                            target = lens(v);
                                        if (
                                            source.read !== target.read ||
                                            source.replacement !== target.replacement
                                        )
                                            fail('Dynamic lens endpoints changed');
                                    });
                                }
                            } else
                                results.forEach((result) =>
                                    requireEqual(
                                        result,
                                        v,
                                        'Call variant result contract mismatch',
                                    ),
                                );
                        } else if (callee.kind === 'native') {
                            if (call.targets !== undefined) fail('Native call has dynamic targets');
                            nativeCall(callee, call.target, args, v);
                        } else fail('Call operand is not callable');
                        const finishes = i.args.map((id) => s.finishes.get(id));
                        if (i.out.type.tag === 'flow') {
                            if (finishes.some(Boolean))
                                s.finishes.set(i.out.id, (state, apply) => {
                                    for (const finish of finishes) finish?.(state, apply);
                                });
                        } else for (const finish of finishes) finish?.(s, true);
                        break;
                    }
                }
                s.values.set(i.out.id, v);
            }
            const result = get(s, b.result);
            if (result.kind !== 'lens' && result.kind !== 'local-focus')
                for (const action of b.cleanup)
                    if (action.kind === 'release') {
                        const value = s.loanFinishes.get(action.loan);
                        if (value) s.finishes.get(value)?.(s, true);
                    }
            if (result.kind === 'lens') {
                const finish = s.finishes.get(b.result);
                const releases = b.cleanup.flatMap((action) => {
                    if (action.kind !== 'release') return [];
                    const value = s.loanFinishes.get(action.loan);
                    const release = value && s.finishes.get(value);
                    return release ? [release] : [];
                });
                if (releases.length)
                    s.finishes.set(b.result, (state, apply) => {
                        finish?.(state, apply);
                        releases.forEach((release) => release(state, apply));
                    });
            }
            for (const cleanup of deferred.reverse()) s.finishes.get(cleanup.value)!(s, false);
            return result;
        }
        const result = block(body, state);
        if (result.kind === 'lens') state.finishes.get(body.result)?.(clone(state), true);
        for (const annotation of annotations.values()) {
            if (annotation.cleanupJoins !== undefined && !checkedCleanupJoins.has(annotation.value))
                fail('Unexpected cleanup join annotation');
            if (
                annotation.storageJoins?.some(
                    (j) =>
                        j.restoration === 'replace' &&
                        !annotation.cleanupJoins?.some((after) => after.place === j.place),
                )
            )
                fail(
                    'Deferred callable storage replacement requires a completed restoration contract',
                );
        }
        if (usedValues.size !== annotations.size || usedCalls.size !== calls.size)
            fail('Extra value or call annotations');
        return result;
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
            state.places.set(fn.captures[i]!.place, c);
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
        if (root.result.kind === 'callable-choice')
            fail('Dynamic callable entry roots require a host adapter');
        if (root.result.kind === 'native') fail('Native entry roots require a host contract');
        if (root.result.kind === 'callable') {
            if (exported.length !== 1)
                fail('Callable root requires one incoming representation contract');
            const e = exported[0]!,
                v = variants.get(e.variant) ?? fail('Missing exported variant');
            if (v.unit !== root.result.unit || v.function !== root.result.function)
                fail('Exported callable provenance mismatch');
            requireEqual(v.captures, root.result.captures, 'Exported capture contract mismatch');
            requireEqual(v.arguments, e.arguments, 'Exported argument contract mismatch');
            requireEqual(v.result, e.result, 'Exported result contract mismatch');
        } else if (exported.length) fail('Expression root has an invocation contract');
        fit(root.result, irPlain(unit.signature.type));
        requireEqual(
            root.result,
            verifyBody(unit, unit.entry, entry, fresh(), `entry:${i}`),
            'Root result differs from its entry',
        );
        if (exported[0]) edges.get(`entry:${i}`)!.add(exported[0].variant);
    });
    if (
        analysis.exports.some(
            (e) => !Number.isInteger(e.entry) || e.entry < 0 || e.entry >= analysis.roots.length,
        )
    )
        fail('Unknown export entry');
    const reached = new Set<string>();
    const visit = (id: string): void => {
        if (reached.has(id)) return;
        reached.add(id);
        edges.get(id)?.forEach(visit);
    };
    analysis.entries.forEach((_, i) => visit(`entry:${i}`));
    for (const id of variants.keys()) if (!reached.has(id)) fail('Unreachable function variant');
}
