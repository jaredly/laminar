import type { SemanticFlow, SemanticType } from './elaborated.ts';
import { BackendDiagnostic } from './backend/target.ts';
import {
    typeKey,
    valueKey,
    irPlain,
    irCon,
    irUnit,
    mapSemantic,
    type Instruction,
    type TypedProgram,
    type IRUnit,
    type IRBlock,
    type IRPattern,
    type Instance,
    type SlotRef,
    type Cleanup,
    type IRScheme,
} from './typed-ir.ts';

type Revisions = Map<string, number>;
type Slot = { type: SemanticType; empty: number[][]; version: Revisions };
type Cap =
    | { kind: 'place'; slot: SlotRef }
    | { kind: 'tuple'; items: Cap[] }
    /** A tag plus field lenses with no storage of its own; `fields` are the write field types. */
    | {
          kind: 'constructor';
          read: SemanticType;
          write: SemanticType;
          fields: SemanticType[];
          items: Cap[];
      }
    | {
          kind: 'call';
          read: SemanticType;
          write: SemanticType;
          effects: { cap: Cap; type: SemanticType }[];
          guards: { place: string; path: number[]; version: number }[];
      }
    | { kind: 'scope'; inner: Cap; cleanup: Cleanup[]; retire: string[] }
    | {
          kind: 'aslens';
          backing: SlotRef;
          holds: SlotRef[];
          cleanup: IRBlock;
          reconstructionOwner?: SlotRef;
      }
    /**
     * An owned lens taken out of its holder. It borrows nothing, and ending it means leaving
     * `write` behind; `inner` is the producer's own capability when the holder was a scope.
     */
    | { kind: 'given'; read: SemanticType; write: SemanticType; inner?: Cap }
    | {
          kind: 'choice';
          read: SemanticType;
          refs: SlotRef[];
          places: string[];
          versions: Map<string, Revisions>;
          baseLoans: string[];
          guards: { place: string; path: number[]; version: number }[];
          arms: { state: State; cap: Cap; restored: Cleanup[] }[];
      };
type Value = { type: SemanticFlow; cap?: Cap };
type State = {
    slots: Map<string, Slot>;
    values: Map<string, Value>;
    loans: Map<string, { cap: Cap; type: SemanticFlow & { tag: 'flow' } }>;
    /** Places holding an owned lens that is still theirs to end, with what it must hold. */
    held: Map<string, SemanticType>;
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
    /** Records are tuples of their name-sorted fields at the IR level. */
    const tupleItems = (t: SemanticType): SemanticType[] =>
        t.tag === 'tuple'
            ? t.items
            : t.tag === 'record'
              ? t.fields.map((f) => f.type)
              : fail('Expected a tuple type');
    const isProduct = (t: SemanticType) => t.tag === 'tuple' || t.tag === 'record';
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
            case 'record':
                t.fields.forEach((f) => validType(f.type));
                if (t.fields.some((f, i) => i && t.fields[i - 1].name >= f.name))
                    fail('Record fields must be unique and sorted');
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
        if (valueKey(a) !== valueKey(b)) fail('Value/lens type mismatch', origin);
    };
    const prefix = (a: number[], b: number[]) =>
        a.length <= b.length && a.every((v, i) => v === b[i]);
    const overlap = (a: number[], b: number[]) => prefix(a, b) || prefix(b, a);
    // Each exact write path has a counter. A focus observes writes to itself,
    // descendants, and ancestors, but not disjoint siblings of the same root.
    const revision = (versions: Revisions | undefined, path: number[]): number =>
        versions
            ? [...versions].reduce(
                  (n, [key, count]) => n + (overlap(JSON.parse(key), path) ? count : 0),
                  0,
              )
            : -1;
    const joinVersions = (versions: Revisions[]): Revisions =>
        new Map(
            [...new Set(versions.flatMap((v) => [...v.keys()]))].map((key) => [
                key,
                Math.max(...versions.map((v) => v.get(key) ?? 0)),
            ]),
        );
    // Transfer writes since a branch join while retaining that arm's own history.
    const advance = (original: Revisions, current: Revisions, base: Revisions): Revisions =>
        new Map(
            [...new Set([...original.keys(), ...current.keys(), ...base.keys()])].map((key) => [
                key,
                (original.get(key) ?? 0) + (current.get(key) ?? 0) - (base.get(key) ?? 0),
            ]),
        );
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
        // A reconstruction contract must correspond to an actual selected input
        // pattern, and its deferred swap must rebuild that exact tag/field tree.
        const reconstructionPatterns = new Map<string, IRPattern>();
        const reconstructions: {
            temporary: Extract<Instruction, { op: 'aslens' }>;
            inputs: Map<string, Instruction>;
        }[] = [];
        const outputs = (instructions: Instruction[]) =>
            new Map(instructions.flatMap((i) => ('out' in i ? [[i.out.id, i] as const] : [])));
        const indexPattern = (p: IRPattern): void => {
            if (p.reconstructionOwner || p.reconstructionId) {
                if (
                    !p.reconstructionOwner ||
                    !p.reconstructionId ||
                    reconstructionPatterns.has(p.reconstructionId)
                )
                    fail('Invalid reconstruction pattern identity');
                source(p.reconstructionId!);
                reconstructionPatterns.set(p.reconstructionId!, p);
            }
            if (p.kind === 'tuple' || p.kind === 'constructor') p.items.forEach(indexPattern);
        };
        const backingPlaces = new Set<string>();
        const backingTransfers = new Set<Instruction>();
        const indexBlock = (b: IRBlock, selected: readonly string[] = []): void => {
            const inputs = outputs(b.instructions);
            for (const i of b.instructions) {
                if (i.op === 'bind') indexPattern(i.pattern);
                else if (i.op === 'scope') indexBlock(i.body, selected);
                else if (i.op === 'case')
                    for (const c of i.cases) {
                        if (c.pattern.reconstructionOwner) {
                            const owner = inputs.get(i.value);
                            if (
                                owner?.op !== 'move' ||
                                slotKey(owner.slot) !== slotKey(c.pattern.reconstructionOwner)
                            )
                                fail('Reconstruction pattern selects a different owner');
                        }
                        indexPattern(c.pattern);
                        indexBlock(
                            c.body,
                            c.pattern.reconstructionId
                                ? [...selected, c.pattern.reconstructionId]
                                : selected,
                        );
                    }
                else if (i.op === 'aslens') {
                    if (backingPlaces.has(i.backing)) fail('Duplicate temporary backing');
                    backingPlaces.add(i.backing);
                    const transfer = i.cleanup?.instructions[0];
                    if (
                        transfer?.op !== 'move' ||
                        transfer.slot.place !== i.backing ||
                        transfer.slot.path.length ||
                        transfer.slot.permit
                    )
                        fail('Cleanup must move the entire temporary backing first');
                    backingTransfers.add(transfer!);
                    if (i.reconstruction) {
                        if (!selected.includes(i.reconstruction.reconstructionId!))
                            fail('Reconstruction is outside its selected pattern');
                        reconstructions.push({ temporary: i, inputs });
                    }
                    indexBlock(i.cleanup, selected);
                }
            }
        };
        const lexicalPlace = (place: string) => {
            if (backingPlaces.has(place)) fail('Temporary backing cannot be accessed directly');
        };
        for (const loan of u.loans) lexicalPlace(loan.place);
        const slotKey = (r: SlotRef) => JSON.stringify([r.place, r.path, r.permit ?? null]);
        const patternKey = (p: IRPattern): string =>
            JSON.stringify([
                p.kind,
                typeKey(p.type),
                p.reconstructionId,
                p.reconstructionOwner && slotKey(p.reconstructionOwner),
                p.kind === 'bind'
                    ? slotKey(p.slot)
                    : p.kind === 'literal'
                      ? p.value
                      : p.kind === 'constructor'
                        ? [
                              p.name,
                              p.items.map(patternKey),
                              p.instance.definition,
                              typeKey(p.instance.type),
                              p.instance.arguments
                                  .map((a) => [a.parameter, typeKey(a.type)])
                                  .sort(),
                          ]
                        : p.kind === 'tuple'
                          ? p.items.map(patternKey)
                          : null,
            ]);
        indexBlock(u.entry);
        u.functions.forEach((f) => indexBlock(f.body));
        const seenReconstruction = new Set<string>();
        for (const { temporary: m, inputs } of reconstructions) {
            const p = m.reconstruction!;
            const original = p.reconstructionId && reconstructionPatterns.get(p.reconstructionId);
            if (
                !original ||
                patternKey(original) !== patternKey(p) ||
                seenReconstruction.has(p.reconstructionId!)
            )
                fail('Reconstruction does not match its selected pattern');
            seenReconstruction.add(p.reconstructionId!);
            const [transfer, bind, ...body] = m.cleanup.instructions;
            if (transfer.op !== 'move' || bind?.op !== 'bind' || bind.value !== transfer.out.id)
                return fail('Missing reconstruction final field bindings');
            const fields = new Map<IRPattern, SlotRef>();
            const matchFields = (p: IRPattern, final: IRPattern, initial: string): void => {
                const input = inputs.get(initial);
                if (p.kind === 'bind') {
                    if (
                        input?.op !== 'move' ||
                        slotKey(input.slot) !== slotKey(p.slot) ||
                        final.kind !== 'bind'
                    )
                        return fail('Reconstruction field mapping changed');
                    fields.set(p, final.slot);
                    return;
                }
                if (p.kind === 'constructor' && p.items.length === 1) {
                    matchFields(p.items[0]!, final, initial);
                    return;
                }
                const items =
                    p.kind === 'literal'
                        ? []
                        : p.kind === 'tuple' || p.kind === 'constructor'
                          ? p.items
                          : fail('Reconstruction discards an unmatched field');
                if (
                    !items.length &&
                    final.kind === 'tuple' &&
                    !final.items.length &&
                    input?.op === 'constant' &&
                    input.value === null
                )
                    return;
                if (
                    input?.op !== 'tuple' ||
                    final.kind !== 'tuple' ||
                    input.items.length !== items.length ||
                    final.items.length !== items.length
                )
                    return fail('Reconstruction field shape changed');
                items.forEach((child, n) => matchFields(child, final.items[n]!, input.items[n]!));
            };
            matchFields(p, bind.pattern, m.initial);
            const instructions = outputs(body);
            const used = new Set<string>();
            const rebuild = (p: IRPattern, value: string): void => {
                if (used.has(value)) fail('Reconstruction duplicates a field');
                used.add(value);
                const i = instructions.get(value);
                if (!i) fail('Missing reconstruction value');
                if (p.kind === 'bind') {
                    if (i!.op !== 'move' || slotKey(i!.slot) !== slotKey(fields.get(p)!))
                        fail('Reconstruction field changed');
                } else if (p.kind === 'tuple' && !p.items.length) {
                    if (i!.op !== 'constant' || i!.value !== null)
                        fail('Reconstruction constructor or shape changed');
                } else if (p.kind === 'constructor' || p.kind === 'tuple') {
                    if (
                        (p.kind === 'constructor'
                            ? i!.op !== 'construct' || i!.name !== p.name
                            : i!.op !== 'tuple') ||
                        !('items' in i!) ||
                        i!.items.length !== p.items.length
                    )
                        fail('Reconstruction constructor or shape changed');
                    p.items.forEach((child, n) =>
                        rebuild(
                            child,
                            (i as Extract<Instruction, { op: 'tuple' | 'construct' }>).items[n],
                        ),
                    );
                } else if (p.kind === 'literal') {
                    if (typeof p.value === 'string') {
                        if (i!.op !== 'string' || i!.head !== p.value || i!.parts.length)
                            fail('Reconstruction literal changed');
                    } else if (
                        i!.op !== 'constant' ||
                        JSON.stringify(i!.value) !== JSON.stringify(p.value)
                    )
                        fail('Reconstruction literal changed');
                } else fail('Reconstruction discards an unmatched field');
            };
            const swap = instructions.get(m.cleanup.result);
            if (!swap || swap.op !== 'swap') fail('Reconstruction does not restore its owner');
            const target = instructions.get((swap as Extract<Instruction, { op: 'swap' }>).lens);
            if (
                !target ||
                target.op !== 'acquire' ||
                slotKey(target.slot) !== slotKey(p.reconstructionOwner!)
            )
                fail('Reconstruction restores a different owner');
            used.add(swap!.out.id);
            used.add(target!.out.id);
            rebuild(p, (swap as Extract<Instruction, { op: 'swap' }>).value);
            const drops = m.cleanup.cleanup;
            const expected = [...fields.values()].map(slotKey).sort();
            if (
                used.size !== body.length ||
                drops.some((drop) => drop.kind !== 'drop-place') ||
                JSON.stringify(
                    drops
                        .map((drop) =>
                            slotKey((drop as Extract<Cleanup, { kind: 'drop-place' }>).slot),
                        )
                        .sort(),
                ) !== JSON.stringify(expected)
            )
                fail('Unexpected reconstruction cleanup effects');
        }
        if (seenReconstruction.size !== reconstructionPatterns.size)
            fail('Missing selected-pattern reconstruction');
        const fresh = (): State => ({
            slots: new Map(),
            values: new Map(),
            loans: new Map(),
            held: new Map(),
        });
        const clone = (s: State): State => ({
            slots: new Map(
                [...s.slots].map(([id, v]) => [
                    id,
                    { ...v, empty: v.empty.map((p) => [...p]), version: new Map(v.version) },
                ]),
            ),
            values: new Map(s.values),
            loans: new Map(s.loans),
            held: new Map(s.held),
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
                if (!isProduct(type) || !tupleItems(type)[index]) fail('Invalid focus projection');
                type = tupleItems(type)[index];
            }
            return type;
        };
        const full = (s: State, r: SlotRef) => !access(s, r).empty.some((p) => overlap(p, r.path));
        const write = (s: State, r: SlotRef, value: SemanticType, empty = false): void => {
            const slot = access(s, r);
            const update = (t: SemanticType, path: number[]): SemanticType => {
                if (!path.length) return value;
                if (!isProduct(t) || !tupleItems(t)[path[0]])
                    return fail('Cannot update this projection');
                if (t.tag === 'record')
                    return {
                        tag: 'record',
                        fields: t.fields.map((f, i) =>
                            i === path[0] ? { ...f, type: update(f.type, path.slice(1)) } : f,
                        ),
                    };
                return {
                    tag: 'tuple',
                    items: (t as SemanticType & { tag: 'tuple' }).items.map((v, i) =>
                        i === path[0] ? update(v, path.slice(1)) : v,
                    ),
                };
            };
            slot.type = update(slot.type, r.path);
            slot.empty = slot.empty.filter((p) => !overlap(p, r.path));
            if (empty) slot.empty.push(r.path);
            const key = JSON.stringify(r.path);
            slot.version.set(key, (slot.version.get(key) ?? 0) + 1);
        };
        const normalized = (refs: SlotRef[]): SlotRef[] =>
            refs.filter(
                (r, i, all) =>
                    !all.some(
                        (o, j) =>
                            o.place === r.place &&
                            o.permit === r.permit &&
                            prefix(o.path, r.path) &&
                            (o.path.length < r.path.length || j < i),
                    ),
            );
        const targets = (c: Cap): SlotRef[] =>
            c.kind === 'given'
                ? []
                : c.kind === 'aslens'
                ? [c.backing, ...c.holds]
                : c.kind === 'choice'
                  ? c.refs
                  : c.kind === 'place'
                    ? [c.slot]
                    : c.kind === 'tuple' || c.kind === 'constructor'
                      ? c.items.flatMap(targets)
                      : c.kind === 'scope'
                        ? targets(c.inner)
                        : c.effects.flatMap((e) => targets(e.cap));
        const read = (s: State, c: Cap): SemanticType =>
            c.kind === 'given'
                ? c.read
                : c.kind === 'aslens'
                ? focus(s, c.backing)
                : c.kind === 'choice'
                  ? c.read
                  : c.kind === 'place'
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
                case 'constructor':
                    return c.items.flatMap((v, i) => empty(s, v).map((p) => [i, ...p]));
                case 'aslens':
                    return empty(s, { kind: 'place', slot: c.backing });
                case 'scope':
                    return empty(s, c.inner);
                case 'call':
                case 'given':
                    return [];
                case 'choice':
                    return c.arms.flatMap((arm) => empty(arm.state, arm.cap));
            }
        };
        const mergeStates = (into: State, branches: State[], places: string[]): void => {
            for (const place of places) {
                const first = branches[0].slots.get(place) ?? fail('Branch retired outer storage');
                for (const other of branches.slice(1)) {
                    const slot = other.slots.get(place) ?? fail('Branch retired outer storage');
                    eq(first.type, slot.type);
                    const paths = (ps: number[][]) =>
                        [...new Set(ps.map((p) => JSON.stringify(p)))].sort().join(';');
                    if (paths(first.empty) !== paths(slot.empty))
                        fail('Branch availability was not normalized with edge drops');
                }
                into.slots.set(place, {
                    ...first,
                    empty: first.empty.map((p) => [...p]),
                    version: joinVersions(branches.map((s) => s.slots.get(place)!.version)),
                });
            }
        };
        const externalTargets = (outer: State, branch: State, c: Cap): SlotRef[] => {
            if (c.kind === 'choice')
                return c.arms.flatMap((a) => externalTargets(outer, a.state, a.cap));
            if (c.kind === 'scope') return externalTargets(outer, branch, c.inner);
            if (c.kind === 'given') return [];
            if (c.kind === 'aslens')
                return targets(c).flatMap((slot) =>
                    externalTargets(outer, branch, { kind: 'place', slot }),
                );
            if (c.kind === 'tuple' || c.kind === 'constructor')
                return c.items.flatMap((v) => externalTargets(outer, branch, v));
            if (c.kind === 'call')
                return c.effects.flatMap((e) => externalTargets(outer, branch, e.cap));
            // Preserve an outer computed focus and its permit; tracing its
            // frontend would expose owners already locked by that focus.
            const computed = [...branch.loans.entries()].find(
                ([id]) => loans.get(id)!.owners && loans.get(id)!.place === c.slot.place,
            );
            if (!outer.slots.has(c.slot.place))
                return computed ? externalTargets(outer, branch, computed[1].cap) : [];
            let permit = c.slot.permit;
            while (permit && !outer.loans.has(permit)) permit = loans.get(permit)?.parent;
            return [{ ...c.slot, permit }];
        };
        const apply = (s: State, c: Cap, type: SemanticType): void => {
            switch (c.kind) {
                case 'given':
                    eq(type, c.write);
                    if (c.inner) apply(s, c.inner, type);
                    return;
                case 'aslens':
                    write(s, c.backing, type);
                    plain(verifyBlock(c.cleanup, s));
                    if (full(s, c.backing)) fail('Temporary backing was not consumed');
                    s.slots.delete(c.backing.place);
                    return;
                case 'choice': {
                    if (
                        c.guards.some(
                            (g) => revision(s.slots.get(g.place)?.version, g.path) !== g.version,
                        )
                    )
                        fail('Branch lens owner changed before restoration');
                    const branches = c.arms.map((arm) => {
                        const branch = clone(arm.state);
                        for (const place of c.places) {
                            const current =
                                s.slots.get(place) ??
                                fail('Branch owner retired before restoration');
                            const original = branch.slots.get(place)!;
                            branch.slots.set(place, {
                                ...current,
                                empty: current.empty.map((p) => [...p]),
                                version: advance(
                                    original.version,
                                    current.version,
                                    c.versions.get(place)!,
                                ),
                            });
                        }
                        for (const id of c.baseLoans) branch.loans.delete(id);
                        for (const [id, loan] of s.loans) branch.loans.set(id, loan);
                        apply(branch, arm.cap, type);
                        cleanup(branch, arm.restored);
                        for (const place of branch.slots.keys())
                            if (!c.places.includes(place)) {
                                if (full(branch, { place, path: [] }))
                                    fail('Branch-local storage has no deferred disposal');
                                branch.slots.delete(place);
                            }
                        if (
                            JSON.stringify([...branch.loans.keys()].sort()) !==
                            JSON.stringify([...s.loans.keys()].sort())
                        )
                            fail('Branch restoration leaks a lexical loan');
                        return branch;
                    });
                    mergeStates(s, branches, c.places);
                    return;
                }
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
                case 'constructor':
                    eq(type, c.write);
                    c.items.forEach((v, i) => apply(s, v, c.fields[i]));
                    return;
                case 'call':
                    eq(type, c.write);
                    if (
                        c.guards.some(
                            (g) => revision(s.slots.get(g.place)?.version, g.path) !== g.version,
                        )
                    )
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
                        if (loan.owners.length) s.slots.delete(loan.place);
                        else write(s, focus, irUnit(), true);
                        continue;
                    }
                    const refs = targets(borrowed.cap);
                    if (refs.some((r) => !full(s, r))) fail('Unrestored borrowed focus');
                    eq(read(s, borrowed.cap), borrowed.type.write);
                } else if (action.kind === 'end') {
                    lexicalPlace(action.slot.place);
                    const contract =
                        s.held.get(action.slot.place) ?? fail('No owned lens to end');
                    if (action.slot.path.length || !full(s, action.slot))
                        fail('Unrestored owned lens');
                    eq(focus(s, action.slot), contract);
                    s.held.delete(action.slot.place);
                    write(s, action.slot, irUnit(), true);
                } else if (action.kind === 'restored') {
                    lexicalPlace(action.slot.place);
                    if (!full(s, action.slot)) fail('Unrestored lens parameter');
                    eq(focus(s, action.slot), action.type);
                } else if (action.kind === 'drop-place') {
                    lexicalPlace(action.slot.place);
                    access(s, action.slot);
                    write(s, action.slot, irUnit(), true);
                } else fail('Unknown cleanup operation');
            }
        };
        const allocate = (s: State, place: string, type: SemanticType, backing = false): void => {
            if (!backing) lexicalPlace(place);
            if (s.slots.has(place)) fail('Place allocated twice');
            s.slots.set(place, { type, empty: [], version: new Map() });
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
                    if (!isProduct(t) || tupleItems(t).length !== p.items.length)
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
                    case 'tuple': {
                        const items = i.items.map((v) => plain(take(s, v)));
                        const out = valueType(i.out.type);
                        if (out.tag === 'record') {
                            if (tupleItems(out).length !== items.length)
                                fail('Record construction arity mismatch', i.origin);
                            tupleItems(out).forEach((t, n) => eq(t, items[n], i.origin));
                        } else feq(i.out.type, irPlain({ tag: 'tuple', items }));
                        break;
                    }
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
                        if (!backingTransfers.has(i)) lexicalPlace(i.slot.place);
                        if (!full(s, i.slot)) fail('Use after move', i.origin);
                        feq(i.out.type, irPlain(focus(s, i.slot)));
                        write(s, i.slot, irUnit(), true);
                        break;
                    }
                    case 'acquire':
                        lexicalPlace(i.slot.place);
                        if (i.out.type.tag !== 'flow') fail('Acquire produces a non-lens');
                        access(s, i.slot);
                        result.cap = { kind: 'place', slot: i.slot };
                        break;
                    case 'lens-tuple': {
                        const items = i.items.map((id) => take(s, id));
                        if (items.some((v) => v.type.tag !== 'flow') || i.out.type.tag !== 'flow')
                            fail('Invalid tuple lens modes');
                        const inputs = items.map((v) => v.type as SemanticFlow & { tag: 'flow' });
                        if (inputs.some((v) => v.replaceable === false))
                            fail('A non-replaceable lens cannot be a tuple lens item');
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
                    case 'lens-construct': {
                        if (
                            i.instance.definition !== `constructor/${i.name}` ||
                            i.writeInstance.definition !== i.instance.definition
                        )
                            fail('Constructor lens tag/signature mismatch');
                        const items = i.items.map((id) => take(s, id));
                        if (items.some((v) => v.type.tag !== 'flow') || i.out.type.tag !== 'flow')
                            fail('Invalid constructor lens modes');
                        const inputs = items.map((v) => v.type as SemanticFlow & { tag: 'flow' });
                        if (inputs.some((v) => v.replaceable === false))
                            fail('A non-replaceable lens cannot be a constructor lens field');
                        const readSig = functionType(instantiate(i.instance)),
                            writeSig = functionType(instantiate(i.writeInstance));
                        if (readSig.args.length !== items.length || writeSig.args.length !== items.length)
                            fail('Constructor lens arity mismatch');
                        inputs.forEach((v, n) => {
                            eq(v.read, valueType(readSig.args[n]));
                            eq(v.write, valueType(writeSig.args[n]));
                        });
                        const read = valueType(readSig.result),
                            write = valueType(writeSig.result);
                        const out = i.out.type as SemanticFlow & { tag: 'flow' };
                        eq(out.read, read);
                        eq(out.write, write);
                        result.cap = {
                            kind: 'constructor',
                            read,
                            write,
                            fields: writeSig.args.map(valueType),
                            items: items.map(cap),
                        };
                        const refs = targets(result.cap);
                        refs.forEach((a, n) =>
                            refs.slice(n + 1).forEach((b) => {
                                if (a.place === b.place && overlap(a.path, b.path))
                                    fail('Overlapping constructor lens fields');
                            }),
                        );
                        break;
                    }
                    case 'give': {
                        const t = i.out.type;
                        if (t.tag !== 'flow') return fail('Giving away a lens produced data');
                        if ('loan' in i.from) {
                            const id = i.from.loan,
                                loan = loans.get(id) ?? fail('Unknown lens loan'),
                                borrowed = s.loans.get(id) ?? fail('Lens loan is not held');
                            // An owned lens protects no storage but its own focus.
                            if (!loan.owners || loan.owners.length)
                                fail('Only a lens that borrows nothing can move', i.origin);
                            const slot = { place: loan.place, path: [], permit: id };
                            if (!full(s, slot)) fail('Moved an unrestored lens', i.origin);
                            eq(focus(s, slot), t.read);
                            eq(t.write, borrowed.type.write);
                            write(s, slot, irUnit(), true);
                            s.loans.delete(id);
                            result.cap = {
                                kind: 'given',
                                read: t.read,
                                write: t.write,
                                inner: borrowed.cap,
                            };
                        } else {
                            const slot = { place: i.from.place, path: [] };
                            lexicalPlace(slot.place);
                            const contract =
                                s.held.get(slot.place) ?? fail('Place holds no owned lens');
                            if (!full(s, slot)) fail('Moved an unrestored lens', i.origin);
                            eq(focus(s, slot), t.read);
                            eq(t.write, contract);
                            write(s, slot, irUnit(), true);
                            s.held.delete(slot.place);
                            result.cap = { kind: 'given', read: t.read, write: t.write };
                        }
                        break;
                    }
                    case 'swap': {
                        const target = take(s, i.lens),
                            replacement = plain(take(s, i.value)),
                            c = cap(target);
                        const t = target.type as SemanticFlow & { tag: 'flow' };
                        if (t.replaceable === false)
                            fail('Whole-value replacement of a non-replaceable lens', i.origin);
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
                                const parameter = f.args[index];
                                if (parameter.tag === 'flow' && parameter.owned) {
                                    if (targets(c).length)
                                        fail('Moved lens borrows caller storage', i.origin);
                                    // The callee now ends it, so this path is done with it.
                                    apply(s, c, v.type.write);
                                } else effects.push({ cap: c, type: v.type.write });
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
                                        path: [...r.path],
                                        version: revision(access(s, r).version, r.path),
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
                            const expected = f.captures[n];
                            if (c.place !== expected.place) fail('Capture target mismatch');
                            const v = take(s, c.value);
                            if (!expected.lens) {
                                eq(plain(v), expected.type);
                                return;
                            }
                            if (v.type.tag !== 'flow') return fail('Lens capture received data');
                            const moved = cap(v);
                            if (targets(moved).length) fail('Captured lens borrows outer storage');
                            eq(v.type.read, expected.type);
                            eq(v.type.write, expected.lens.write);
                            apply(s, moved, v.type.write);
                        });
                        break;
                    }
                    case 'aslens': {
                        const backing = { place: i.backing, path: [] };
                        const initial = plain(take(s, i.initial));
                        const flow = i.out.type;
                        if (flow.tag !== 'flow') return fail('Temporary lens produced data');
                        eq(initial, flow.read);
                        const record = u.bindings.find(
                            (b) => b.place === i.backing && b.declaration === i.origin,
                        );
                        if (
                            !record ||
                            record.kind !== 'local' ||
                            record.path.length ||
                            record.borrow
                        )
                            return fail('Invalid temporary backing');
                        eq(record.initialType, initial);
                        allocate(s, i.backing, initial, true);
                        const local = new Set([backing.place]),
                            refs: SlotRef[] = [],
                            scopedLoans = new Set<string>();
                        const patternPlaces = (p: IRPattern): void => {
                            if (p.kind === 'bind') local.add(p.slot.place);
                            else if (p.kind === 'tuple' || p.kind === 'constructor')
                                p.items.forEach(patternPlaces);
                        };
                        const scan = (b: IRBlock): void => {
                            for (const instruction of b.instructions) {
                                if (instruction.op === 'bind') patternPlaces(instruction.pattern);
                                else if (instruction.op === 'borrow') {
                                    scopedLoans.add(instruction.loan);
                                    const loan = loans.get(instruction.loan)!;
                                    if (loan?.owners) local.add(loan.place);
                                } else if (
                                    instruction.op === 'move' ||
                                    instruction.op === 'acquire'
                                )
                                    refs.push(instruction.slot);
                                else if (instruction.op === 'scope') scan(instruction.body);
                                else if (instruction.op === 'case')
                                    for (const arm of instruction.cases) {
                                        patternPlaces(arm.pattern);
                                        scan(arm.body);
                                        for (const a of [
                                            ...(arm.setup ?? []),
                                            ...(arm.restored ?? []),
                                        ])
                                            if (a.kind !== 'release') refs.push(a.slot);
                                    }
                                else if (instruction.op === 'aslens') {
                                    local.add(instruction.backing);
                                    refs.push(...instruction.holds);
                                    scan(instruction.cleanup);
                                }
                            }
                            for (const a of b.cleanup) if (a.kind !== 'release') refs.push(a.slot);
                        };
                        scan(i.cleanup);
                        const held = normalized(
                            refs
                                .filter((r) => !local.has(r.place))
                                .map((r) => {
                                    let permit = r.permit;
                                    while (permit && scopedLoans.has(permit))
                                        permit = loans.get(permit)?.parent;
                                    return { ...r, permit };
                                }),
                        );
                        const keys = (rs: SlotRef[]) =>
                            normalized(rs)
                                .map((r) => JSON.stringify([r.place, r.path, r.permit ?? null]))
                                .sort();
                        if (JSON.stringify(keys(held)) !== JSON.stringify(keys(i.holds)))
                            fail('Temporary cleanup dependency protection mismatch');
                        i.holds.forEach((r) => {
                            lexicalPlace(r.place);
                            access(s, r);
                        });
                        result.cap = {
                            kind: 'aslens',
                            backing,
                            holds: i.holds,
                            cleanup: i.cleanup,
                            reconstructionOwner: i.reconstruction?.reconstructionOwner,
                        };
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
                            if (
                                i.out.type.tag === 'plain' &&
                                (c.setup?.length || c.restored?.length)
                            )
                                fail('Owned case edges must use block cleanup');
                            if (
                                [...(c.setup ?? []), ...(c.restored ?? [])].some(
                                    (a) => a.kind !== 'drop-place',
                                )
                            )
                                fail('Branch normalization must only discard places');
                            const branch = clone(s);
                            pattern(branch, c.pattern, t);
                            const v = verifyBlock(c.body, branch);
                            feq(v.type, i.out.type);
                            cleanup(branch, c.setup ?? []);
                            if (v.type.tag === 'plain') {
                                cleanup(branch, c.restored ?? []);
                                for (const place of branch.slots.keys())
                                    if (!s.slots.has(place)) {
                                        if (full(branch, { place, path: [] }))
                                            fail('Case pattern value has no disposal');
                                        branch.slots.delete(place);
                                    }
                            } else eq(read(branch, cap(v)), v.type.read);
                            return { state: branch, result: v, restored: c.restored ?? [] };
                        });
                        if (i.out.type.tag === 'flow') {
                            for (const branch of branches.slice(1))
                                if (
                                    JSON.stringify([...branch.state.values.keys()]) !==
                                    JSON.stringify([...branches[0].state.values.keys()])
                                )
                                    fail('Branch temporary consumption mismatch');
                            s.values = new Map(branches[0].state.values);
                            const refs = branches
                                .flatMap((b) => externalTargets(s, b.state, cap(b.result)))
                                .filter(
                                    (r, index, all) =>
                                        !all.some(
                                            (other, j) =>
                                                other.place === r.place &&
                                                other.permit === r.permit &&
                                                prefix(other.path, r.path) &&
                                                (other.path.length < r.path.length || j < index),
                                        ),
                                );
                            const places = [...s.slots.keys()];
                            mergeStates(
                                s,
                                branches.map((b) => b.state),
                                places,
                            );
                            result.cap = {
                                kind: 'choice',
                                read: i.out.type.read,
                                refs,
                                places,
                                versions: new Map(
                                    [...s.slots].map(([p, slot]) => [p, new Map(slot.version)]),
                                ),
                                baseLoans: [...s.loans.keys()],
                                guards: refs.map((r) => ({
                                    place: r.place,
                                    path: [...r.path],
                                    version: revision(access(s, r).version, r.path),
                                })),
                                arms: branches.map((b) => ({
                                    state: b.state,
                                    cap: cap(b.result),
                                    restored: b.restored,
                                })),
                            };
                            break;
                        }
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
                                a.version = joinVersions([a.version, b.version]);
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
                        for (const other of branches.slice(1))
                            if (
                                JSON.stringify([...first.held.keys()]) !==
                                JSON.stringify([...other.state.held.keys()])
                            )
                                fail('Branch owned-lens state mismatch');
                        s.slots = first.slots;
                        s.values = first.values;
                        s.loans = first.loans;
                        s.held = first.held;
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
            f.captures.forEach((c) => {
                allocate(state, c.place, c.type);
                if (c.lens) state.held.set(c.place, c.lens.write);
            });
            if (f.parameters.length !== f.type.args.length)
                fail('Function parameter arity mismatch');
            const lensPlaces = new Set<string>();
            f.parameters.forEach((p, n) => {
                const argument = f.type.args[n];
                if (argument.tag === 'flow') {
                    if (!p.lensPlace) fail('Missing lens parameter place');
                    allocate(state, p.lensPlace!, argument.read);
                    lensPlaces.add(p.lensPlace!);
                    if (argument.owned) state.held.set(p.lensPlace!, argument.write);
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
                const escapes = (state: State, c: Cap): boolean => {
                    if (c.kind === 'choice') return c.arms.some((a) => escapes(a.state, a.cap));
                    if (c.kind === 'scope') return escapes(state, c.inner);
                    if (c.kind === 'aslens')
                        return c.reconstructionOwner
                            ? escapes(state, { kind: 'place', slot: c.reconstructionOwner })
                            : false;
                    if (c.kind === 'tuple' || c.kind === 'constructor')
                        return c.items.some((v) => escapes(state, v));
                    if (c.kind === 'call') return c.effects.some((e) => escapes(state, e.cap));
                    if (c.kind === 'given') return false;
                    const loan = [...state.loans.entries()].find(
                        ([id]) => loans.get(id)!.owners && loans.get(id)!.place === c.slot.place,
                    );
                    return loan ? escapes(state, loan[1].cap) : !lensPlaces.has(c.slot.place);
                };
                if (escapes(state, c)) fail('Lens return escapes owned local storage', f.origin);
                eq(read(state, c), result.type.read);
                apply(state, c, result.type.write);
            }
            if (state.held.size) fail('An owned lens was neither ended nor moved', f.origin);
            f.parameters.forEach((p, n) => {
                const declared = f.type.args[n];
                if (p.lensPlace && !(declared.tag === 'flow' && declared.owned)) {
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
