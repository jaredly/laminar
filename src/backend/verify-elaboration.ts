import type { Elaboration, PlaceState, SemanticFlow, SemanticType } from '../elaborated.ts';
import { BackendDiagnostic } from './target.ts';

/** Validate retained metadata without depending on solver objects or JavaScript identity. */
export function verifyElaboration(e: Elaboration): void {
    const fail = (message: string, node?: string): never => {
        throw new BackendDiagnostic('invalid-elaboration', message, node);
    };
    const unique = (ids: string[], label: string) => {
        if (new Set(ids).size !== ids.length) fail(`Duplicate ${label} identity`);
        return new Set(ids);
    };
    if (e.schemaVersion !== 1) fail('Unsupported elaboration version');
    const nodes = unique(
        e.nodes.map((n) => n.id),
        'node',
    );
    const bindings = unique(
        e.bindings.map((b) => b.id),
        'binding',
    );
    const loans = unique(
        e.borrows.map((b) => b.id),
        'borrow',
    );
    const node = (id: string) => {
        if (!nodes.has(id)) fail(`Unknown source node ${id}`, id);
    };
    const binding = (id: string) => {
        if (!bindings.has(id)) fail(`Unknown binding ${id}`);
    };
    const type = (t: SemanticType): void => {
        switch (t.tag) {
            case 'variable':
                if (!t.id.startsWith(`${e.id}/`) || t.rigid)
                    fail('Unscoped or escaped rigid type variable');
                return;
            case 'con':
                t.args.forEach(type);
                return;
            case 'tuple':
                t.items.forEach(type);
                return;
            case 'fn':
                t.args.forEach(flow);
                flow(t.result);
                return;
            default:
                fail('Unknown semantic type');
        }
    };
    const flow = (f: SemanticFlow): void => {
        if (f.tag === 'plain') type(f.value);
        else if (f.tag === 'flow') {
            type(f.read);
            type(f.write);
        } else fail('Unknown semantic mode');
    };
    const path = (p: number[]) => {
        if (p.some((i) => !Number.isSafeInteger(i) || i < 0)) fail('Invalid place projection');
    };
    const state = (s: PlaceState) => {
        // A wildcard lens parameter can own a place without declaring a binding.
        if (!s.place.startsWith(`${e.id}/p`)) fail('Unscoped place identity');
        type(s.type);
        s.empty.forEach(path);
        if (new Set(s.borrows).size !== s.borrows.length) fail('Duplicate active borrow');
        if (s.borrows.some((id) => !loans.has(id))) fail('Unknown active borrow');
    };
    const span = ([start, end]: [number, number]) => {
        if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end < start ||
            end > e.transitions.length
        )
            fail('Invalid transition region');
    };
    node(e.root);
    if ((e.source as typeof e.source & { nodeId?: string }).nodeId !== e.root)
        fail('Source snapshot root does not match metadata');
    e.nodes.forEach((n) => {
        if (n.type) flow(n.type);
    });
    e.bindings.forEach((b) => {
        if (b.declaration) node(b.declaration);
        if (!b.place.startsWith(`${e.id}/p`)) fail('Unscoped binding place');
        if (b.borrow && !loans.has(b.borrow)) fail('Binding refers to an unknown borrow');
        // Lens parameters receive their protection from the caller's flow contract.
        const parameter = e.functions.some((f) => f.parameters.some((ps) => ps.includes(b.id)));
        if (b.kind === 'alias' && !b.borrow && !parameter) fail('Alias has no owner protection');
        if (b.borrow) {
            const loan = e.borrows.find((loan) => loan.id === b.borrow)!;
            if (
                loan.place !== b.place ||
                loan.path.length > b.path.length ||
                loan.path.some((part, i) => part !== b.path[i])
            )
                fail('Alias is outside its borrowed focus');
        }
        path(b.path);
        type(b.initialType);
    });
    e.borrows.forEach((b) => {
        node(b.node);
        path(b.path);
        if (b.owners) {
            if (b.path.length || b.parent) fail('Computed focus has a parent or projection');
            b.owners.forEach((owner) => {
                if (!owner.place.startsWith(`${e.id}/p`)) fail('Unscoped computed owner');
                path(owner.path);
                if (owner.permit && !loans.has(owner.permit)) fail('Unknown computed owner permit');
            });
        }
        const seen = new Set([b.id]);
        let parent = b.parent;
        while (parent) {
            if (!loans.has(parent) || seen.has(parent)) fail('Invalid or cyclic borrow parent');
            seen.add(parent);
            const p = e.borrows.find((b) => b.id === parent)!;
            if (p.place !== b.place || p.path.some((v, i) => b.path[i] !== v))
                fail('Borrow is outside its parent focus');
            parent = p.parent;
        }
    });
    e.uses.forEach((u) => {
        node(u.node);
        binding(u.binding);
    });
    e.instantiations.forEach((i) => {
        node(i.node);
        type(i.type);
        unique(
            i.arguments.map((a) => a.parameter),
            'instantiation parameter',
        );
        i.arguments.forEach((a) => {
            if (!a.parameter.startsWith(`${i.definition}/q`))
                fail('Instantiation names a parameter from another definition', i.node);
            type(a.type);
        });
    });
    e.captures.forEach((c) => {
        node(c.node);
        binding(c.from);
        binding(c.to);
        type(c.type);
        if (e.bindings.find((b) => b.id === c.to)!.kind !== 'capture')
            fail('Capture destination is not an owned capture', c.node);
    });
    e.transitions.forEach((t) => {
        node(t.node);
        path(t.path);
        state(t.before);
        state(t.after);
        if (t.before.place !== t.after.place)
            fail('A transition changes logical place identity', t.node);
    });
    e.scopes.forEach((s) => {
        node(s.node);
        s.bindings.forEach(binding);
        s.exit.forEach(state);
    });
    e.functions.forEach((f) => {
        node(f.node);
        node(f.body);
        span(f.transitions);
        if (f.parameters.length !== f.parameterPlaces.length)
            fail('Missing parameter/place correspondence', f.node);
        if (f.parameterPlaces.flat().some((p) => !f.entry.some((s) => s.place === p)))
            fail('Parameter place is absent from function entry', f.node);
        f.parameters.flat().forEach(binding);
        f.entry.forEach(state);
        f.exit.forEach(state);
    });
    e.branches.forEach((b) => {
        node(b.node);
        b.input.forEach(state);
        b.output.forEach(state);
        b.arms.forEach((a) => {
            node(a.node);
            span(a.transitions);
            a.output.forEach(state);
        });
    });
    type(e.signature.type);
    type(e.signature.bodyType);
    unique(e.signature.quantified, 'quantified variable');
    if (e.signature.quantified.some((id) => !id.startsWith(`${e.id}/q`)))
        fail('Unscoped exported type parameter');
    e.signature.bodyVariables.forEach((v) => type(v.type));
}
