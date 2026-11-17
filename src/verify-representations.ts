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
    if (!Array.isArray(analysis.roots) || !Array.isArray(analysis.entries))
        fail('Missing analysis roots or entries');
    const repKey = (v: ValueRepresentation): string => {
        if (!v || typeof v !== 'object') return fail('Missing value representation');
        switch (v.kind) {
            case 'data':
                return JSON.stringify({ kind: 'data', layout: v.layout });
            case 'lens':
                return JSON.stringify({ kind: 'lens', shape: v.shape });
            case 'native':
                return JSON.stringify({ kind: 'native', definition: v.definition });
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
    const layoutId = (t: SemanticType): string => JSON.stringify(['layout', target, typeKey(t)]);
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
        fail('Unsupported concrete data layout');
    }
    for (const l of layouts.values()) {
        storageType(l.type);
        if (l.id !== layoutId(l.type)) fail('Noncanonical or wrong-target layout ID');
        let storage: Layout['storage'],
            dependencies: string[] = [];
        switch (l.type.tag) {
            case 'con':
                if (l.type.args.length || !['Number', 'Bool'].includes(l.type.name))
                    fail('Unsupported concrete data layout');
                storage = l.type.name === 'Number' ? 'f64' : 'bool';
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
        dependencies.forEach((id) => {
            layout(id);
            if (layoutOrder.get(id)! >= layoutOrder.get(l.id)!)
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
    function fit(v: ValueRepresentation, t: SemanticFlow): void {
        if (!v || typeof v !== 'object') return fail('Missing value representation');
        if (t.tag === 'flow') {
            if (v.kind !== 'lens') return fail('Lens contract has a non-lens representation');
            const s = shape(v.shape);
            typeEqual(layout(s.read).type, t.read);
            typeEqual(layout(s.replacement).type, t.write);
            return;
        }
        if (v.kind === 'data') {
            typeEqual(layout(v.layout).type, t.value);
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
    };
    const fresh = (): State => ({ values: new Map(), places: new Map(), lenses: new Map() });
    const clone = (s: State): State => ({
        values: new Map(s.values),
        places: new Map(s.places),
        lenses: new Map(s.lenses),
    });
    const get = (s: State, id: string): ValueRepresentation =>
        s.values.get(id) ?? fail('Missing operand annotation');
    function bind(p: IRPattern, v: ValueRepresentation, s: State): void {
        if (p.kind === 'bind') s.places.set(p.slot.place, v);
        else if (p.kind === 'tuple') {
            if (v.kind !== 'data') return fail('Tuple pattern needs data storage');
            p.items.forEach((child) =>
                bind(child, { kind: 'data', layout: layoutId(child.type) }, s),
            );
        }
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
                    continue;
                }
                if (i.op === 'borrow') continue;
                const v =
                    annotations.get(i.out.id)?.representation ??
                    fail('Missing temporary annotation');
                if (usedValues.has(i.out.id)) fail('Repeated temporary annotation use');
                usedValues.add(i.out.id);
                fit(v, i.out.type);
                switch (i.op) {
                    case 'constant':
                    case 'string':
                    case 'construct':
                    case 'tuple':
                    case 'swap':
                        if (v.kind !== 'data') fail('Data operation has a callable representation');
                        break;
                    case 'move': {
                        const stored = s.places.get(i.slot.place);
                        if (stored && stored.kind !== 'data') {
                            if (i.slot.path.length)
                                fail('Callable aggregate projection is unsupported');
                            requireEqual(v, stored, 'Moved callable provenance changed');
                        } else if (v.kind !== 'data') fail('Moved callable lacks provenance');
                        break;
                    }
                    case 'acquire': {
                        const incoming = s.lenses.get(i.slot.place),
                            actual = lens(v);
                        if (incoming) topology(projectedShape(incoming, i.slot.path), actual);
                        else if (actual.kind !== 'thin') fail('Owned acquisition must be thin');
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
                    case 'scope':
                        requireEqual(
                            v,
                            block(i.body, clone(s)),
                            'Scope result representation mismatch',
                        );
                        break;
                    case 'case':
                        i.cases.forEach((arm) => {
                            const branch = clone(s);
                            bind(arm.pattern, get(s, i.value), branch);
                            requireEqual(
                                v,
                                block(arm.body, branch),
                                'Branch needs a representation adapter',
                            );
                        });
                        break;
                    case 'call': {
                        const call = calls.get(i.out.id) ?? fail('Missing call annotation');
                        usedCalls.add(i.out.id);
                        const callee = get(s, i.callee),
                            args = i.args.map((id) => get(s, id));
                        requireEqual(call.arguments, args, 'Call argument representations changed');
                        requireEqual(call.result, v, 'Call result annotation mismatch');
                        if (callee.kind === 'callable') {
                            const target =
                                variants.get(call.target) ??
                                fail('Call references an absent variant');
                            if (target.unit !== callee.unit || target.function !== callee.function)
                                fail('Call selects the wrong callable body');
                            requireEqual(
                                target.captures,
                                callee.captures,
                                'Call capture contract mismatch',
                            );
                            requireEqual(
                                target.arguments,
                                args,
                                'Call variant argument contract mismatch',
                            );
                            requireEqual(target.result, v, 'Call variant result contract mismatch');
                            edges.get(owner)!.add(target.id);
                        } else if (callee.kind === 'native') {
                            if (call.target !== callee.definition) fail('Wrong native call target');
                            if (v.kind === 'lens') {
                                if (callee.definition !== 'native/fst' || !args[0])
                                    fail('Missing native returned-lens contract');
                                topology(projectedShape(lens(args[0]), [0]), lens(v));
                            } else if (v.kind !== 'data')
                                fail('Unsupported native callable result');
                        } else fail('Call operand is not callable');
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
        if (root.result.kind === 'callable' || root.result.kind === 'native')
            fail('Callable roots require an explicit argument representation contract');
        fit(root.result, irPlain(unit.signature.type));
        requireEqual(
            root.result,
            verifyBody(unit, unit.entry, entry, fresh(), `entry:${i}`),
            'Root result differs from its entry',
        );
    });
    const reached = new Set<string>();
    const visit = (id: string): void => {
        if (reached.has(id)) return;
        reached.add(id);
        edges.get(id)?.forEach(visit);
    };
    analysis.entries.forEach((_, i) => visit(`entry:${i}`));
    for (const id of variants.keys()) if (!reached.has(id)) fail('Unreachable function variant');
}
