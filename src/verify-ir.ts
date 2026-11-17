import type { SemanticFlow, SemanticType } from './elaborated.ts';
import { BackendDiagnostic } from './backend/target.ts';
import {
    flowKey,
    typeKey,
    irPlain,
    irCon,
    irUnit,
    mapSemantic,
    type TypedProgram,
    type IRUnit,
    type IRBlock,
    type IRPattern,
    type Instance,
    type SlotRef,
    type Cleanup,
    type IRScheme,
} from './typed-ir.ts';

type Slot = { type: SemanticType; empty: number[][]; version: number };
type Cap =
    | { kind: 'place'; slot: SlotRef }
    | { kind: 'tuple'; items: Cap[] }
    | {
          kind: 'call';
          read: SemanticType;
          write: SemanticType;
          effects: { cap: Cap; type: SemanticType }[];
          guards: { place: string; version: number }[];
      }
    | { kind: 'scope'; inner: Cap; cleanup: Cleanup[]; retire: string[] };
type Value = { type: SemanticFlow; cap?: Cap };
type State = {
    slots: Map<string, Slot>;
    values: Map<string, Value>;
    loans: Map<string, { cap: Cap; type: SemanticFlow & { tag: 'flow' } }>;
};

/** Independent typed-IR validation: does not inspect source ASTs, inference state, or evaluator values. */
export function verifyTypedProgram(program: TypedProgram): void {
    const fail = (message: string, origin?: string): never => {
        throw new BackendDiagnostic('invalid-ir', message, origin);
    };
    const numberLiteral = (v: unknown): boolean =>
        typeof v === 'number'
            ? Number.isFinite(v) && !Object.is(v, -0)
            : !!v &&
              typeof v === 'object' &&
              'number' in v &&
              ['NaN', 'Infinity', '-Infinity', '-0'].includes(String(v.number));
    const valueType = (t: SemanticFlow): SemanticType =>
        t.tag === 'plain' ? t.value : fail('Expected an owned value type');
    const functionType = (t: SemanticType): SemanticType & { tag: 'fn' } =>
        t.tag === 'fn' ? t : fail('Expected a function type');
    const tupleItems = (t: SemanticType): SemanticType[] =>
        t.tag === 'tuple' ? t.items : fail('Expected a tuple type');
    const validType = (t: SemanticType): void => {
        if (!t || typeof t !== 'object') fail('Missing semantic type');
        switch (t.tag) {
            case 'variable':
                if (typeof t.id !== 'string' || !t.id || t.rigid)
                    fail('Invalid or escaped rigid type variable');
                return;
            case 'con':
                if (typeof t.name !== 'string' || !t.name) fail('Invalid type constructor');
                t.args.forEach(validType);
                return;
            case 'tuple':
                t.items.forEach(validType);
                return;
            case 'fn':
                t.args.forEach(validFlow);
                validFlow(t.result);
                return;
            default:
                fail('Unknown semantic type');
        }
    };
    const validFlow = (t: SemanticFlow): void => {
        if (t.tag === 'plain') validType(t.value);
        else if (t.tag === 'flow') {
            validType(t.read);
            validType(t.write);
        } else fail('Invalid semantic mode');
    };
    const eq = (a: SemanticType, b: SemanticType, origin?: string) => {
        validType(a);
        validType(b);
        if (typeKey(a) !== typeKey(b))
            fail(`Type mismatch: ${typeKey(a)} versus ${typeKey(b)}`, origin);
    };
    const feq = (a: SemanticFlow, b: SemanticFlow, origin?: string) => {
        validFlow(a);
        validFlow(b);
        if (flowKey(a) !== flowKey(b)) fail('Value/lens type mismatch', origin);
    };
    const prefix = (a: number[], b: number[]) =>
        a.length <= b.length && a.every((v, i) => v === b[i]);
    const overlap = (a: number[], b: number[]) => prefix(a, b) || prefix(b, a);
    if (program.schemaVersion !== 1) fail('Unknown IR version');
    const closedScheme = (
        scheme: { quantified: string[]; type: SemanticType },
        definition: string,
    ): void => {
        validType(scheme.type);
        const allowed = new Set(scheme.quantified);
        if (
            allowed.size !== scheme.quantified.length ||
            scheme.quantified.some((p, i) => p !== `${definition}/q${i}`)
        )
            fail('Invalid quantified type parameters');
        mapSemantic(scheme.type, (id) => {
            if (!allowed.has(id)) fail('Unbound variable in exported signature');
            return undefined;
        });
    };
    const definitions = new Map<string, IRScheme>();
    for (const imported of program.imports) {
        if (definitions.has(imported.definition)) fail('Duplicate import');
        closedScheme(imported, imported.definition);
        definitions.set(imported.definition, imported);
    }
    const units = new Set<string>();
    for (const u of program.units) {
        if (units.has(u.id)) fail('Duplicate unit identity');
        units.add(u.id);
        closedScheme(u.signature, u.id);
        if (u.definition) {
            if (definitions.has(u.definition)) fail('Duplicate definition');
            definitions.set(u.definition, { definition: u.definition, ...u.signature });
        }
        verifyUnit(u);
    }
    function verifyUnit(u: IRUnit): void {
        const origins = new Set(u.origins.map((n) => n.id));
        const emitted = new Set<string>();
        const fs = new Map(u.functions.map((f) => [f.id, f]));
        if (fs.size !== u.functions.length) fail('Duplicate function identity');
        const loans = new Map(u.loans.map((l) => [l.id, l]));
        if (loans.size !== u.loans.length) fail('Duplicate loan identity');
        const source = (id: string) => {
            if (!origins.has(id)) fail('Missing source origin', id);
        };
        const fresh = (): State => ({ slots: new Map(), values: new Map(), loans: new Map() });
        const clone = (s: State): State => ({
            slots: new Map(
                [...s.slots].map(([id, v]) => [id, { ...v, empty: v.empty.map((p) => [...p]) }]),
            ),
            values: new Map(s.values),
            loans: new Map(s.loans),
        });
        const take = (s: State, id: string): Value => {
            const v =
                s.values.get(id) ?? fail(`Undefined, out-of-scope, or consumed temporary ${id}`);
            s.values.delete(id);
            return v;
        };
        const plain = (v: Value): SemanticType => valueType(v.type);
        const cap = (v: Value): Cap =>
            v.type.tag === 'flow' && v.cap ? v.cap : fail('Expected a lens capability');
        const access = (s: State, r: SlotRef): Slot => {
            if (r.path.some((p) => !Number.isSafeInteger(p) || p < 0)) fail('Invalid slot path');
            const slot = s.slots.get(r.place) ?? fail(`Unknown or retired place ${r.place}`);
            const permits = new Set<string>();
            let id = r.permit;
            while (id) {
                if (permits.has(id)) fail('Cyclic loan permission');
                const loan = loans.get(id) ?? fail('Unknown loan permission');
                if (!s.loans.has(id)) fail('Loan permission is out of scope');
                if (loan.place !== r.place || !prefix(loan.path, r.path))
                    fail('Loan permission does not cover the requested place');
                permits.add(id);
                id = loan.parent;
            }
            for (const [id] of s.loans) {
                const loan = loans.get(id)!;
                if (
                    [{ place: loan.place, path: loan.path }, ...(loan.owners ?? [])].some(
                        (owner) => owner.place === r.place && overlap(owner.path, r.path),
                    ) &&
                    !permits.has(id)
                )
                    fail('Use while exclusively borrowed');
            }
            return slot;
        };
        const focus = (s: State, r: SlotRef): SemanticType => {
            let type = access(s, r).type;
            for (const index of r.path) {
                if (type.tag !== 'tuple' || !type.items[index]) fail('Invalid focus projection');
                type = tupleItems(type)[index];
            }
            return type;
        };
        const full = (s: State, r: SlotRef) => !access(s, r).empty.some((p) => overlap(p, r.path));
        const write = (s: State, r: SlotRef, value: SemanticType, empty = false): void => {
            const slot = access(s, r);
            const update = (t: SemanticType, path: number[]): SemanticType => {
                if (!path.length) return value;
                if (t.tag !== 'tuple' || !t.items[path[0]])
                    return fail('Cannot update this projection');
                return {
                    tag: 'tuple',
                    items: t.items.map((v, i) => (i === path[0] ? update(v, path.slice(1)) : v)),
                };
            };
            slot.type = update(slot.type, r.path);
            slot.empty = slot.empty.filter((p) => !overlap(p, r.path));
            if (empty) slot.empty.push(r.path);
            slot.version++;
        };
        const targets = (c: Cap): SlotRef[] =>
            c.kind === 'place'
                ? [c.slot]
                : c.kind === 'tuple'
                  ? c.items.flatMap(targets)
                  : c.kind === 'scope'
                    ? targets(c.inner)
                    : c.effects.flatMap((e) => targets(e.cap));
        const read = (s: State, c: Cap): SemanticType =>
            c.kind === 'place'
                ? focus(s, c.slot)
                : c.kind === 'tuple'
                  ? { tag: 'tuple', items: c.items.map((v) => read(s, v)) }
                  : c.kind === 'scope'
                    ? read(s, c.inner)
                    : c.read;
        const empty = (s: State, c: Cap): number[][] => {
            switch (c.kind) {
                case 'place':
                    return access(s, c.slot)
                        .empty.filter((p) => overlap(p, c.slot.path))
                        .map((p) => p.slice(c.slot.path.length));
                case 'tuple':
                    return c.items.flatMap((v, i) => empty(s, v).map((p) => [i, ...p]));
                case 'scope':
                    return empty(s, c.inner);
                case 'call':
                    return [];
            }
        };
        const apply = (s: State, c: Cap, type: SemanticType): void => {
            switch (c.kind) {
                case 'place':
                    write(s, c.slot, type);
                    return;
                case 'tuple':
                    if (type.tag !== 'tuple' || type.items.length !== c.items.length)
                        fail('Tuple lens replacement shape mismatch');
                    c.items.forEach((v, i) =>
                        apply(s, v, (type as SemanticType & { tag: 'tuple' }).items[i]),
                    );
                    return;
                case 'call':
                    eq(type, c.write);
                    if (c.guards.some((g) => s.slots.get(g.place)?.version !== g.version))
                        fail('Computed lens owner changed before restoration');
                    c.effects.forEach((e) => apply(s, e.cap, e.type));
                    return;
                case 'scope':
                    apply(s, c.inner, type);
                    cleanup(s, c.cleanup);
                    c.retire.forEach((p) => {
                        if (s.slots.has(p) && full(s, { place: p, path: [] }))
                            fail('Deferred scope value has no disposal');
                        s.slots.delete(p);
                    });
                    return;
            }
        };
        const cleanup = (s: State, actions: Cleanup[]): void => {
            for (const action of actions) {
                if (action.kind === 'release') {
                    const borrowed = s.loans.get(action.loan) ?? fail('Unbalanced loan release');
                    s.loans.delete(action.loan);
                    const loan = loans.get(action.loan)!;
                    if (loan.owners) {
                        const focus = { place: loan.place, path: [] };
                        if (!full(s, focus)) fail('Unrestored borrowed focus');
                        const replacement = read(s, { kind: 'place', slot: focus });
                        eq(replacement, borrowed.type.write);
                        apply(s, borrowed.cap, replacement);
                        s.slots.delete(loan.place);
                        continue;
                    }
                    const refs = targets(borrowed.cap);
                    if (refs.some((r) => !full(s, r))) fail('Unrestored borrowed focus');
                    eq(read(s, borrowed.cap), borrowed.type.write);
                } else if (action.kind === 'restored') {
                    if (!full(s, action.slot)) fail('Unrestored lens parameter');
                    eq(focus(s, action.slot), action.type);
                } else if (action.kind === 'drop-place') {
                    access(s, action.slot);
                    write(s, action.slot, irUnit(), true);
                } else fail('Unknown cleanup operation');
            }
        };
        const allocate = (s: State, place: string, type: SemanticType): void => {
            if (s.slots.has(place)) fail('Place allocated twice');
            s.slots.set(place, { type, empty: [], version: 0 });
        };
        const instantiate = (i: Instance): SemanticType => {
            const scheme =
                definitions.get(i.definition) ?? fail(`Unknown definition ${i.definition}`);
            const args = new Map(i.arguments.map((a) => [a.parameter, a.type]));
            if (
                args.size !== i.arguments.length ||
                args.size !== scheme.quantified.length ||
                scheme.quantified.some((p) => !args.has(p))
            )
                fail('Wrong specialization type arguments');
            const type = mapSemantic(scheme.type, (id) => args.get(id));
            eq(type, i.type);
            return type;
        };
        const pattern = (
            s: State,
            p: IRPattern,
            t: SemanticType,
            alias?: string,
            path: number[] = [],
        ): void => {
            eq(p.type, t);
            switch (p.kind) {
                case 'bind':
                    if (alias) {
                        if (
                            p.slot.place !== alias ||
                            JSON.stringify(p.slot.path) !== JSON.stringify(path)
                        )
                            fail('Lens parameter binding has an invalid projection');
                    } else {
                        if (p.slot.path.length || p.slot.permit)
                            fail('Owned pattern binding is not an owning slot');
                        allocate(s, p.slot.place, t);
                    }
                    return;
                case 'drop':
                    return;
                case 'literal':
                    if (
                        !numberLiteral(p.value) &&
                        typeof p.value !== 'boolean' &&
                        typeof p.value !== 'string'
                    )
                        fail('Invalid literal pattern payload');
                    eq(
                        t,
                        irCon(
                            numberLiteral(p.value)
                                ? 'Number'
                                : typeof p.value === 'boolean'
                                  ? 'Bool'
                                  : 'String',
                        ),
                    );
                    return;
                case 'tuple':
                    if (t.tag !== 'tuple' || t.items.length !== p.items.length)
                        fail('Tuple pattern arity mismatch');
                    p.items.forEach((v, i) => pattern(s, v, tupleItems(t)[i], alias, [...path, i]));
                    return;
                case 'constructor': {
                    if (alias) fail('Constructor alias patterns are unsupported');
                    if (p.instance.definition !== `constructor/${p.name}`)
                        fail('Constructor pattern tag/signature mismatch');
                    const sig = functionType(instantiate(p.instance));
                    if (sig.args.length !== p.items.length)
                        fail('Invalid constructor pattern arity');
                    eq(valueType(sig.result), t);
                    p.items.forEach((v, i) => pattern(s, v, valueType(sig.args[i])));
                    return;
                }
                default:
                    fail('Unknown pattern kind');
            }
        };
        const verifyBlock = (b: IRBlock, s: State): Value => {
            source(b.origin);
            const oldPlaces = new Set(s.slots.keys()),
                localValues: string[] = [];
            for (const i of b.instructions) {
                source(i.origin);
                if (i.op === 'bind') {
                    pattern(s, i.pattern, plain(take(s, i.value)));
                    continue;
                }
                if (i.op === 'borrow') {
                    const v = take(s, i.lens),
                        c = cap(v),
                        loan = loans.get(i.loan) ?? fail('Unknown lexical loan');
                    if (loan.owners) {
                        if (s.loans.has(i.loan) || loan.path.length || loan.parent)
                            fail('Invalid computed loan acquisition');
                        const refs = targets(c);
                        const key = (r: SlotRef) =>
                            JSON.stringify([r.place, r.path, r.permit ?? null]);
                        if (JSON.stringify(refs.map(key)) !== JSON.stringify(loan.owners.map(key)))
                            fail('Computed loan owner protection mismatch');
                        refs.forEach((r) => access(s, r));
                        eq(read(s, c), (v.type as SemanticFlow & { tag: 'flow' }).read);
                        allocate(s, loan.place, (v.type as SemanticFlow & { tag: 'flow' }).read);
                        s.slots.get(loan.place)!.empty = empty(s, c);
                        s.loans.set(i.loan, {
                            cap: c,
                            type: v.type as SemanticFlow & { tag: 'flow' },
                        });
                        continue;
                    }
                    if (
                        s.loans.has(i.loan) ||
                        c.kind !== 'place' ||
                        loan.place !== c.slot.place ||
                        JSON.stringify(loan.path) !== JSON.stringify(c.slot.path) ||
                        loan.parent !== c.slot.permit
                    )
                        fail('Invalid lexical loan acquisition');
                    eq(read(s, c), (v.type as SemanticFlow & { tag: 'flow' }).read);
                    s.loans.set(i.loan, { cap: c, type: v.type as SemanticFlow & { tag: 'flow' } });
                    continue;
                }
                if (emitted.has(i.out.id)) fail('Duplicate temporary identity', i.origin);
                emitted.add(i.out.id);
                validFlow(i.out.type);
                let result: Value = { type: i.out.type };
                switch (i.op) {
                    case 'constant':
                        if (
                            i.value !== null &&
                            !numberLiteral(i.value) &&
                            typeof i.value !== 'boolean'
                        )
                            fail('Invalid constant payload');
                        feq(
                            i.out.type,
                            irPlain(
                                i.value === null
                                    ? irUnit()
                                    : irCon(typeof i.value === 'boolean' ? 'Bool' : 'Number'),
                            ),
                        );
                        break;
                    case 'string':
                        i.parts.forEach((p) => plain(take(s, p.value)));
                        feq(i.out.type, irPlain(irCon('String')));
                        break;
                    case 'tuple':
                        feq(
                            i.out.type,
                            irPlain({ tag: 'tuple', items: i.items.map((v) => plain(take(s, v))) }),
                        );
                        break;
                    case 'construct': {
                        if (i.instance.definition !== `constructor/${i.name}`)
                            fail('Constructor tag/signature mismatch');
                        const f = functionType(instantiate(i.instance));
                        if (f.args.length !== i.items.length) fail('Constructor arity mismatch');
                        i.items.forEach((v, n) => eq(plain(take(s, v)), valueType(f.args[n])));
                        feq(i.out.type, irPlain(valueType(f.result)));
                        break;
                    }
                    case 'global':
                        if (i.instance.definition.startsWith('constructor/'))
                            fail('Constructor signature used as a global value');
                        feq(i.out.type, irPlain(instantiate(i.instance)));
                        break;
                    case 'move': {
                        if (!full(s, i.slot)) fail('Use after move', i.origin);
                        feq(i.out.type, irPlain(focus(s, i.slot)));
                        write(s, i.slot, irUnit(), true);
                        break;
                    }
                    case 'acquire':
                        if (i.out.type.tag !== 'flow') fail('Acquire produces a non-lens');
                        access(s, i.slot);
                        result.cap = { kind: 'place', slot: i.slot };
                        break;
                    case 'lens-tuple': {
                        const items = i.items.map((id) => take(s, id));
                        if (items.some((v) => v.type.tag !== 'flow') || i.out.type.tag !== 'flow')
                            fail('Invalid tuple lens modes');
                        const inputs = items.map((v) => v.type as SemanticFlow & { tag: 'flow' });
                        feq(i.out.type, {
                            tag: 'flow',
                            read: { tag: 'tuple', items: inputs.map((v) => v.read) },
                            write: { tag: 'tuple', items: inputs.map((v) => v.write) },
                        });
                        result.cap = { kind: 'tuple', items: items.map(cap) };
                        const refs = targets(result.cap);
                        refs.forEach((a, n) =>
                            refs.slice(n + 1).forEach((b) => {
                                if (a.place === b.place && overlap(a.path, b.path))
                                    fail('Overlapping tuple lens');
                            }),
                        );
                        break;
                    }
                    case 'swap': {
                        const target = take(s, i.lens),
                            replacement = plain(take(s, i.value)),
                            c = cap(target);
                        const t = target.type as SemanticFlow & { tag: 'flow' };
                        eq(read(s, c), t.read);
                        eq(replacement, t.write);
                        feq(i.out.type, irPlain(t.read));
                        apply(s, c, replacement);
                        break;
                    }
                    case 'call': {
                        const f = functionType(plain(take(s, i.callee)));
                        if (f.args.length !== i.args.length) fail('Call arity mismatch');
                        const effects: { cap: Cap; type: SemanticType }[] = [];
                        i.args.forEach((id, index) => {
                            const v = take(s, id);
                            feq(v.type, f.args[index]);
                            if (v.type.tag === 'flow') {
                                const c = cap(v);
                                eq(read(s, c), v.type.read);
                                effects.push({ cap: c, type: v.type.write });
                            }
                        });
                        feq(i.out.type, f.result);
                        if (f.result.tag === 'plain')
                            effects.forEach((e) => apply(s, e.cap, e.type));
                        else
                            result.cap = {
                                kind: 'call',
                                read: f.result.read,
                                write: f.result.write,
                                effects,
                                guards: effects
                                    .flatMap((e) => targets(e.cap))
                                    .map((r) => ({
                                        place: r.place,
                                        version: access(s, r).version,
                                    })),
                            };
                        break;
                    }
                    case 'closure': {
                        const f = fs.get(i.function) ?? fail('Unknown closure function');
                        feq(i.out.type, irPlain(f.type));
                        if (f.captures.length !== i.captures.length)
                            fail('Closure environment mismatch');
                        i.captures.forEach((c, n) => {
                            if (c.place !== f.captures[n].place) fail('Capture target mismatch');
                            eq(plain(take(s, c.value)), f.captures[n].type);
                        });
                        break;
                    }
                    case 'scope':
                        result = verifyBlock(i.body, s);
                        feq(result.type, i.out.type);
                        break;
                    case 'case': {
                        const t = plain(take(s, i.value));
                        if (!i.cases.length) fail('Empty case');
                        const branches = i.cases.map((c) => {
                            const branch = clone(s);
                            pattern(branch, c.pattern, t);
                            const v = verifyBlock(c.body, branch);
                            feq(v.type, i.out.type);
                            for (const place of branch.slots.keys())
                                if (!s.slots.has(place)) {
                                    if (full(branch, { place, path: [] }))
                                        fail('Case pattern value has no disposal');
                                    branch.slots.delete(place);
                                }
                            return { state: branch, result: v };
                        });
                        if (i.out.type.tag !== 'plain')
                            fail('Lens case results require semantic support');
                        const first = branches[0].state;
                        for (const other of branches.slice(1)) {
                            if (
                                JSON.stringify([...first.loans.keys()]) !==
                                JSON.stringify([...other.state.loans.keys()])
                            )
                                fail('Branch borrow-state mismatch');
                            for (const [id, slot] of s.slots) {
                                const a = first.slots.get(id)!,
                                    b = other.state.slots.get(id)!;
                                eq(a.type, b.type);
                                a.version = Math.max(a.version, b.version);
                                const paths = (ps: number[][]) =>
                                    [...new Set(ps.map((p) => JSON.stringify(p)))].sort().join(';');
                                if (paths(a.empty) !== paths(b.empty))
                                    fail('Branch availability was not normalized with edge drops');
                            }
                            if (
                                JSON.stringify([...first.values.keys()]) !==
                                JSON.stringify([...other.state.values.keys()])
                            )
                                fail('Branch temporary consumption mismatch');
                        }
                        s.slots = first.slots;
                        s.values = first.values;
                        s.loans = first.loans;
                        break;
                    }
                    default:
                        fail('Unknown IR operation');
                }
                s.values.set(i.out.id, result);
                localValues.push(i.out.id);
            }
            const result = take(s, b.result);
            if (localValues.some((id) => s.values.has(id)))
                fail('Temporary was neither consumed nor explicitly discarded', b.origin);
            const retire = [...s.slots.keys()].filter((id) => !oldPlaces.has(id));
            if (result.type.tag === 'flow')
                result.cap = { kind: 'scope', inner: cap(result), cleanup: b.cleanup, retire };
            else {
                cleanup(s, b.cleanup);
                retire.forEach((id) => {
                    if (s.slots.has(id) && full(s, { place: id, path: [] }))
                        fail('Owned scope value has no disposal');
                    s.slots.delete(id);
                });
            }
            return result;
        };
        for (const f of u.functions) {
            source(f.origin);
            validType(f.type);
            const state = fresh();
            f.captures.forEach((c) => allocate(state, c.place, c.type));
            if (f.parameters.length !== f.type.args.length)
                fail('Function parameter arity mismatch');
            const lensPlaces = new Set<string>();
            f.parameters.forEach((p, n) => {
                const argument = f.type.args[n];
                if (argument.tag === 'flow') {
                    if (!p.lensPlace) fail('Missing lens parameter place');
                    allocate(state, p.lensPlace!, argument.read);
                    lensPlaces.add(p.lensPlace!);
                    pattern(state, p.pattern, argument.read, p.lensPlace);
                } else {
                    if (p.lensPlace) fail('Plain parameter has a lens place');
                    pattern(state, p.pattern, argument.value);
                }
            });
            const result = verifyBlock(f.body, state);
            feq(result.type, f.type.result);
            if (result.type.tag === 'flow') {
                const c = cap(result);
                const owners = (r: SlotRef): SlotRef[] => {
                    const loan = [...loans.values()].find(
                        (l) => state.loans.has(l.id) && l.place === r.place && l.owners,
                    );
                    return loan ? loan.owners!.flatMap(owners) : [r];
                };
                if (
                    targets(c)
                        .flatMap(owners)
                        .some((r) => !lensPlaces.has(r.place))
                )
                    fail('Lens return escapes owned local storage', f.origin);
                eq(read(state, c), result.type.read);
                apply(state, c, result.type.write);
            }
            f.parameters.forEach((p, n) => {
                if (p.lensPlace) {
                    if (!full(state, { place: p.lensPlace, path: [] }))
                        fail('Lens parameter was not restored');
                    const argument = f.type.args[n];
                    if (argument.tag !== 'flow') fail('Lens parameter has no flow contract');
                    eq(
                        focus(state, { place: p.lensPlace, path: [] }),
                        (argument as SemanticFlow & { tag: 'flow' }).write,
                    );
                }
            });
            if (state.loans.size || state.values.size)
                fail('Function has outstanding loans or temporaries');
            for (const [id] of state.slots)
                if (!lensPlaces.has(id) && full(state, { place: id, path: [] }))
                    fail('Function-owned value has no disposal');
        }
        if (
            u.definition &&
            (u.entry.instructions.length !== 1 ||
                u.entry.instructions[0].op !== 'closure' ||
                u.entry.instructions[0].captures.length)
        )
            fail('A reusable definition must create one closed function');
        const state = fresh(),
            entry = verifyBlock(u.entry, state);
        feq(entry.type, irPlain(u.signature.type));
        if (state.loans.size || state.values.size || state.slots.size)
            fail('Entry leaks owned slots, loans, or temporaries');
    }
}
