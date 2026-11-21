import { expect, it } from 'bun:test';
import { compileSource } from '../../src/compiler.ts';
import { goTarget } from '../../src/backend/target.ts';
import { emitGo } from '../../src/go/emit.ts';
import { buildAndRunGo } from '../../src/go/build.ts';
import { GoNames } from '../../src/go/names.ts';

const compile = (source: string, specializeLenses?: readonly string[]) =>
    compileSource(source, { target: goTarget('test'), specializeLenses });
const execute = process.env.LAMINAR_EXEC ? it : it.skip;
const scalar =
    'fn nextGuess(lastGuess) {let next = lastGuess + 1\n (dup(~next), next)}\nnextGuess(3)';
const generic = 'fn id(value) value\n(id(3), id(true))';
const forwarding =
    'fn bump(~x) {x := dup(~x) + 1}\nfn run(~(a, b)) {bump(~a)}\n{let x = 1\n let y = 2\n run(~(x, y))\n let pair = (3, 4)\n run(~pair)\n (x, y, pair)}';
const shadow = 'fn tick(n) {n + 1}\nfn pair(x) {(x, {let x = tick(1)\n x})}\npair(1)';
const closure = 'fn maker(n) {let add = fn (x) {n + x}\n add}\nmaker(1)(2)';
const keyword = 'fn func(range) {let var = range + 1\n var}\nfunc(2)';
const collision = 'fn main(fmt, environment) {let back0 = fmt + environment\n back0}\nmain(2, 3)';
const recursive =
    'fn environment(n) {match dup(~n) {0 -> 0; _ -> environment(n - 1)}}\nenvironment(3)';
const interpolation = '{let strconv = true\n "${strconv}"}';

it('preserves source function, parameter and local names', () => {
    const { code } = compile(scalar);
    expect(code).toMatch(/func nextGuess\(lastGuess float64\)/);
    expect(code).toContain('next :=');
    expect(code).not.toMatch(/func fn\d+\(/);
    expect(code).toContain('nextGuess(3.0)');
});

it('names semantic and lens-representation specializations', () => {
    const { code } = compile(generic);
    expect(code).toContain('func id_number(');
    expect(code).toContain('func id_bool(');
    const lenses = compile(forwarding, ['run']).code;
    expect(lenses).toContain('func run_thin(');
    expect(lenses).toContain('func run_scattered(');
});

it('names local closures and capture storage from retained source bindings', () => {
    const { code } = compile(closure);
    expect(code).toMatch(/func maker_add\(environment any, x float64\)/);
    expect(code).toContain('n :=');
    expect(code).toContain('invoke0: maker_add');
});

it('uses distinct names for shadowed bindings and storage versions', () => {
    const { code } = compile(shadow);
    expect(code).toMatch(/func pair\(x float64\)/);
    expect(code).toContain('x_2 :=');
    expect(code).not.toMatch(/^\s*x :=/m);
});

it('escapes Go keywords, generated symbols and runtime names', () => {
    const names = new GoNames();
    const chosen = ['func', 'main', 'math', 'L0', 'back0', '+', '_u2b_', 'λ', '1start', '_'].map(
        (n) => names.source(n),
    );
    expect(new Set(chosen).size).toBe(chosen.length);
    chosen.forEach((n) => expect(n).toMatch(/^[A-Za-z_][A-Za-z_0-9]*$/));
    expect(chosen[0]).toBe('func_2');
    expect(chosen[3]).toBe('L0_source');
    expect(compile(keyword).code).toContain('func func_2(');
    expect(compile(collision).code).toContain('func main_2(');
});

it('does not mutate IR and emits the same names on repeated lowering', () => {
    const compiled = compile(closure);
    const before = JSON.stringify(compiled.concrete);
    expect(emitGo(compiled.concrete)).toBe(compiled.code);
    expect(compile(closure).code).toBe(compiled.code);
    expect(JSON.stringify(compiled.concrete)).toBe(before);
});

for (const [name, source, expected] of [
    ['source names', scalar, [4, 4]],
    ['generic variants', generic, [3, true]],
    ['lens variants', forwarding, [2, 2, [4, 4]]],
    ['shadowing', shadow, [1, 2]],
    ['captured closure', closure, 3],
    ['Go keywords', keyword, 3],
    ['generated and runtime collisions', collision, 5],
    ['recursive environment name', recursive, 0],
    ['import shadowing', interpolation, 'true'],
] as const)
    execute(
        `named Go: ${name}`,
        async () => {
            expect(await buildAndRunGo(compile(source).code)).toEqual([expected]);
        },
        60000,
    );
