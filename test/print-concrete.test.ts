import { expect, it } from 'bun:test';
import { stringify } from '../parser-generator/lexer.ts';
import { lconcrete, printConcreteProgram } from '../src/print-concrete.ts';
import { compileConcreteProgram } from '../src/lower-concrete.ts';
import { wasm32Emscripten } from '../src/backend/target.ts';
import { typedProgram } from './backend/typed-program.ts';
import type { ConcreteBlock, ConcreteInstruction } from '../src/concrete-ir.ts';
const compile = (text: string) => {
    const p = typedProgram(text);
    return compileConcreteProgram(p, wasm32Emscripten('test'), [
        { unit: p.units.at(-1)!.id, arguments: [] },
    ]);
};
const walk = (b: ConcreteBlock): ConcreteInstruction[] =>
    b.instructions.flatMap((i) => [
        i,
        ...(i.op === 'scope'
            ? walk(i.body)
            : i.op === 'case'
              ? i.cases.flatMap((c) => walk(c.body))
              : []),
    ]);
it('prints generic variants with compact cross-references through lexer nodes', () => {
    const p = compile('fn id(x) x\n(id(1), id(true))');
    const text = stringify(lconcrete(p));
    expect(printConcreteProgram(p)).toBe(text);
    expect(text).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3, L4, L5)
          abis (abi0, abi1, abi2, abi3)
          code (id0, id1, entry0)
      }
      layouts {
          L0 = unit
          L1 = bool
          L2 = record environment
          L3 = f64
          L4 = record callable {
              environment: ptr<void>
              dispose: code<abi3>
          }
          L5 = record {
              item0: L3
              item1: L1
          }
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L1
          abi1 = (env: ptr<void>, L3) -> L3
          abi2 = (env: ptr<void>) -> L5
          abi3 = (env: ptr<void>) -> L0
      }
      wrappers {
          wrap0 : abi3 env L2 = dispose () drop-captures-and-free
          wrap1 : abi0 env L2 = invoke id1 transfer-captures-and-free
          wrap2 : abi3 env L2 = dispose () drop-captures-and-free
          wrap3 : abi3 env L2 = dispose () drop-captures-and-free
          wrap4 : abi3 env L2 = dispose () drop-captures-and-free
          wrap5 : abi1 env L2 = invoke id0 transfer-captures-and-free
      }
      callables {
          callable0 : L4 env L2 {dispose wrap2}
          callable1 : L4 env L2 {dispose wrap3}
          callable2 : L4 env L2 {dispose wrap0}
          callable3 : L4 env L2 {dispose wrap4}
      }
      fn id0($x: L3) : abi1 env L2 {
          %0: L3 = move $x
          return %0 : L3
          cleanup {drop $x}
      }
      fn id1($x: L1) : abi0 env L2 {
          %0: L1 = move $x
          return %0 : L1
          cleanup {drop $x}
      }
      fn entry0() : abi2 env L0 {
          %0: L4 = make-callable callable0 {}
          %1: L3 = 1
          %2: L3 = %0(%1) via wrap5 : abi1
          %3: L4 = make-callable callable2 {}
          %4: L1 = true
          %5: L1 = %3(%4) via wrap1 : abi0
          %6: L5 = (%2, %5)
          return %6 : L5
      }"
    `);
});
it('prints nested lens topology, loans, and deferred restoration cleanup', () => {
    const p = compile(
        'fn first(~(x, y)) ~x\n{let pair = ((1, 2), 3)\n first(~pair) := true\n pair}',
    );
    const text = printConcreteProgram(p);
    expect(text).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L2, L4, L5, L3, L0, L6, L7, L8, L1, L9)
          abis (abi0, abi1, abi2, abi3, abi4)
          code (first0, entry0)
      }
      layouts {
          L0 = bool
          L1 = f64
          L2 = record {
              item0: L0
              item1: L1
          }
          L3 = record {
              item0: L1
              item1: L1
          }
          L4 = record {
              item0: L3
              item1: L1
          }
          L5 = unit
          L6 = record thin {
              read: ptr<L3>
              replacement: ptr<L0>
              restore: code<abi4>
              context: ptr<void>
          }
          L7 = record environment
          L8 = record thin {
              read: ptr<L4>
              replacement: ptr<L2>
              restore: code<abi0>
              context: ptr<void>
          }
          L9 = record callable {
              environment: ptr<void>
              dispose: code<abi3>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2) -> L5
          abi1 = (env: ptr<void>, L8) -> L6
          abi2 = (env: ptr<void>) -> L2
          abi3 = (env: ptr<void>) -> L5
          abi4 = (env: ptr<void>, L0) -> L5
      }
      wrappers {
          wrap0 : abi3 env L7 = dispose () drop-captures-and-free
          wrap1 : abi1 env L7 = invoke first0 transfer-captures-and-free
          wrap2 : abi3 env L7 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L9 env L7 {dispose wrap0}
          callable1 : L9 env L7 {dispose wrap2}
      }
      fn first0(lens $p0 ($p0.0, $p0.1): L8) : abi1 env L7 {
          %0: L6 = acquire $p0.0
          return %0 : L6
          cleanup after-restore {restored $p0 : (Bool, Number)}
      }
      fn entry0() : abi2 env L5 {
          %0: L1 = 1
          %1: L1 = 2
          %2: L3 = (%0, %1)
          %3: L1 = 3
          %4: L4 = (%2, %3)
          %5: L2 = scope {
              bind $pair = %4
              %6: L8 = acquire $pair
              %7: L9 = make-callable callable1 {}
              %8: L6 = %7(%6) via wrap1 : abi1
              %9: L0 = true
              %10: L3 = swap(%8, %9)
              %11: L2 = scope {
                  bind _ = %10
                  %12: L2 = move $pair
                  return %12 : L2
              }
              return %11 : L2
              cleanup {drop $pair}
          }
          return %5 : L2
      }"
    `);
    const alias = printConcreteProgram(compile('{let x = 1\n {let y = ~x\n y := 2}\n x}'));
    expect(alias).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2)
          abis (abi0, abi1)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = f64
          L2 = record thin {
              read: ptr<L1>
              restore: code<abi0>
              context: ptr<void>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L0
          abi1 = (env: ptr<void>) -> L1
      }
      wrappers {}
      callables {}
      fn entry0() : abi1 env L0 {
          %0: L1 = 1
          %1: L1 = scope {
              bind $x = %0
              %2: L2 = acquire $x
              %3: L1 = scope {
                  borrow loan0 = %2
                  %4: L2 = acquire $x@loan0
                  %5: L1 = 2
                  %6: L1 = swap(%4, %5)
                  return %6 : L1
                  cleanup {release loan0}
              }
              %7: L1 = scope {
                  bind _ = %3
                  %8: L1 = move $x
                  return %8 : L1
              }
              return %7 : L1
              cleanup {drop $x}
          }
          return %1 : L1
      }"
    `);
});
it('prints captures and disposer contracts for affine closures', () => {
    const text = printConcreteProgram(compile('{let x = 1\n let f = fn (()) x\n f(())}'));
    expect(text).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L4, L3)
          abis (abi0, abi1, abi2)
          code (lambda0, entry0)
      }
      layouts {
          L0 = record callable {
              environment: ptr<void>
              dispose: code<abi1>
              invoke0: code<abi0>
          }
          L1 = unit
          L2 = record environment
          L3 = f64
          L4 = record environment {capture0: L3}
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L3
          abi1 = (env: ptr<void>) -> L1
          abi2 = (env: ptr<void>) -> L3
      }
      wrappers {
          wrap0 : abi0 env L4 = invoke lambda0 transfer-captures-and-free
          wrap1 : abi0 env L2 = dispatch (callable0 wrap0) selected-environment
          wrap2 : abi1 env L4 = dispose (L3) drop-captures-and-free
          wrap3 : abi1 env L2 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L0 env L4 {
              dispose wrap2
              invoke0 = wrap0 : abi0
          }
          callable1 : L0 env L2 {
              dispose wrap3
              invoke0 = wrap1 : abi0
          }
      }
      fn lambda0((): L1) : abi0 env L4 captures (capture0 $x: L3) {
          %0: L3 = move $x
          return %0 : L3
          cleanup {drop $x}
      }
      fn entry0() : abi2 env L1 {
          %0: L3 = 1
          %1: L3 = scope {
              bind $x = %0
              %2: L3 = move $x
              %3: L0 = make-callable callable0 {capture0 <- %2}
              %4: L3 = scope {
                  bind $f = %3
                  %5: L0 = move $f
                  %6: L1 = ()
                  %7: L3 = %5.invoke0(%6) via wrap1 : abi0
                  return %7 : L3
                  cleanup {drop $f}
              }
              return %4 : L3
              cleanup {drop $x}
          }
          return %1 : L3
      }"
    `);
});
it('prints all concrete instructions: scalar', () => {
    const p = compile('{let x = 1\n x + 2}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3)
          abis (abi0, abi1, abi2)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = record environment
          L2 = f64
          L3 = record callable {
              environment: ptr<void>
              dispose: code<abi1>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2, L2) -> L2
          abi1 = (env: ptr<void>) -> L0
          abi2 = (env: ptr<void>) -> L2
      }
      wrappers {
          wrap0 : abi1 env L1 = dispose () drop-captures-and-free
          wrap1 : abi1 env L1 = dispose () drop-captures-and-free
          wrap2 : abi0 env L1 = native "native/+" no-environment
      }
      callables {
          callable0 : L3 env L1 {dispose wrap1}
          callable1 : L3 env L1 {dispose wrap0}
      }
      fn entry0() : abi2 env L0 {
          %0: L2 = 1
          %1: L2 = scope {
              bind $x = %0
              %2: L3 = make-callable callable1 {}
              %3: L2 = move $x
              %4: L2 = 2
              %5: L2 = %2(%3, %4) via wrap2 : abi0
              return %5 : L2
              cleanup {drop $x}
          }
          return %1 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: tuple', () => {
    const p = compile('(1, true, ())'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3)
          abis (abi0)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = bool
          L2 = f64
          L3 = record {
              item0: L2
              item1: L1
              item2: L0
          }
      }
      abis {abi0 = (env: ptr<void>) -> L3}
      wrappers {}
      callables {}
      fn entry0() : abi0 env L0 {
          %0: L2 = 1
          %1: L1 = true
          %2: L0 = ()
          %3: L3 = (%0, %1, %2)
          return %3 : L3
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: generic-calls', () => {
    const p = compile('fn id(x) x\n(id(1), id(true))'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3, L4, L5)
          abis (abi0, abi1, abi2, abi3)
          code (id0, id1, entry0)
      }
      layouts {
          L0 = unit
          L1 = bool
          L2 = record environment
          L3 = f64
          L4 = record callable {
              environment: ptr<void>
              dispose: code<abi3>
          }
          L5 = record {
              item0: L3
              item1: L1
          }
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L1
          abi1 = (env: ptr<void>, L3) -> L3
          abi2 = (env: ptr<void>) -> L5
          abi3 = (env: ptr<void>) -> L0
      }
      wrappers {
          wrap0 : abi3 env L2 = dispose () drop-captures-and-free
          wrap1 : abi0 env L2 = invoke id1 transfer-captures-and-free
          wrap2 : abi3 env L2 = dispose () drop-captures-and-free
          wrap3 : abi3 env L2 = dispose () drop-captures-and-free
          wrap4 : abi3 env L2 = dispose () drop-captures-and-free
          wrap5 : abi1 env L2 = invoke id0 transfer-captures-and-free
      }
      callables {
          callable0 : L4 env L2 {dispose wrap2}
          callable1 : L4 env L2 {dispose wrap3}
          callable2 : L4 env L2 {dispose wrap0}
          callable3 : L4 env L2 {dispose wrap4}
      }
      fn id0($x: L3) : abi1 env L2 {
          %0: L3 = move $x
          return %0 : L3
          cleanup {drop $x}
      }
      fn id1($x: L1) : abi0 env L2 {
          %0: L1 = move $x
          return %0 : L1
          cleanup {drop $x}
      }
      fn entry0() : abi2 env L0 {
          %0: L4 = make-callable callable0 {}
          %1: L3 = 1
          %2: L3 = %0(%1) via wrap5 : abi1
          %3: L4 = make-callable callable2 {}
          %4: L1 = true
          %5: L1 = %3(%4) via wrap1 : abi0
          %6: L5 = (%2, %5)
          return %6 : L5
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: annotated-generic', () => {
    const p = compile('id :: (a) => a\nfn id(x) x\nid(2)'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3)
          abis (abi0, abi1, abi2)
          code (id0, entry0)
      }
      layouts {
          L0 = unit
          L1 = record environment
          L2 = f64
          L3 = record callable {
              environment: ptr<void>
              dispose: code<abi1>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2) -> L2
          abi1 = (env: ptr<void>) -> L0
          abi2 = (env: ptr<void>) -> L2
      }
      wrappers {
          wrap0 : abi1 env L1 = dispose () drop-captures-and-free
          wrap1 : abi0 env L1 = invoke id0 transfer-captures-and-free
          wrap2 : abi1 env L1 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L3 env L1 {dispose wrap0}
          callable1 : L3 env L1 {dispose wrap2}
      }
      fn id0($x: L2) : abi0 env L1 {
          %0: L2 = move $x
          return %0 : L2
          cleanup {drop $x}
      }
      fn entry0() : abi2 env L0 {
          %0: L3 = make-callable callable0 {}
          %1: L2 = 2
          %2: L2 = %0(%1) via wrap1 : abi0
          return %2 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: narrow-contract', () => {
    const p = compile('id :: (Number) => Number\nfn id(x) x\nid(2)'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3)
          abis (abi0, abi1, abi2)
          code (id0, entry0)
      }
      layouts {
          L0 = unit
          L1 = record environment
          L2 = f64
          L3 = record callable {
              environment: ptr<void>
              dispose: code<abi1>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2) -> L2
          abi1 = (env: ptr<void>) -> L0
          abi2 = (env: ptr<void>) -> L2
      }
      wrappers {
          wrap0 : abi1 env L1 = dispose () drop-captures-and-free
          wrap1 : abi1 env L1 = dispose () drop-captures-and-free
          wrap2 : abi0 env L1 = invoke id0 transfer-captures-and-free
      }
      callables {
          callable0 : L3 env L1 {dispose wrap1}
          callable1 : L3 env L1 {dispose wrap0}
      }
      fn id0($x: L2) : abi0 env L1 {
          %0: L2 = move $x
          return %0 : L2
          cleanup {drop $x}
      }
      fn entry0() : abi2 env L0 {
          %0: L3 = make-callable callable0 {}
          %1: L2 = 2
          %2: L2 = %0(%1) via wrap2 : abi0
          return %2 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: thin-update', () => {
    const p = compile('fn inc(~x) {x := x + 1}\n{let x = 1\n inc(~x)\n x}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3, L4, L5)
          abis (abi0, abi1, abi2, abi3, abi4)
          code (inc0, entry0)
      }
      layouts {
          L0 = unit
          L1 = record environment
          L2 = record thin {
              read: ptr<L0>
              replacement: ptr<L3>
              restore: code<abi0>
              context: ptr<void>
          }
          L3 = f64
          L4 = record thin {
              read: ptr<L3>
              restore: code<abi0>
              context: ptr<void>
          }
          L5 = record callable {
              environment: ptr<void>
              dispose: code<abi2>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L3) -> L0
          abi1 = (env: ptr<void>, L3, L3) -> L3
          abi2 = (env: ptr<void>) -> L0
          abi3 = (env: ptr<void>) -> L3
          abi4 = (env: ptr<void>, L4) -> L0
      }
      wrappers {
          wrap0 : abi2 env L1 = dispose () drop-captures-and-free
          wrap1 : abi2 env L1 = dispose () drop-captures-and-free
          wrap2 : abi2 env L1 = dispose () drop-captures-and-free
          wrap3 : abi4 env L1 = invoke inc0 transfer-captures-and-free
          wrap4 : abi1 env L1 = native "native/+" no-environment
          wrap5 : abi2 env L1 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L5 env L1 {dispose wrap2}
          callable1 : L5 env L1 {dispose wrap5}
          callable2 : L5 env L1 {dispose wrap1}
          callable3 : L5 env L1 {dispose wrap0}
      }
      fn inc0(lens $p0 $p0: L4) : abi4 env L1 {
          %0: L2 = acquire $p0
          %1: L5 = make-callable callable3 {}
          %2: L3 = move $p0
          %3: L3 = 1
          %4: L3 = %1(%2, %3) via wrap4 : abi1
          %5: L0 = swap(%0, %4)
          return %5 : L0
          cleanup {restored $p0 : Number}
      }
      fn entry0() : abi3 env L0 {
          %0: L3 = 1
          %1: L3 = scope {
              bind $x = %0
              %2: L4 = acquire $x
              %3: L5 = make-callable callable2 {}
              %4: L0 = %3(%2) via wrap3 : abi4
              %5: L3 = scope {
                  bind _ = %4
                  %6: L3 = move $x
                  return %6 : L3
              }
              return %5 : L3
              cleanup {drop $x}
          }
          return %1 : L3
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: scattered-update', () => {
    const p = compile(
            'fn inc(~(x, y)) {x := x + 1}\n{let a = 1\n let b = 2\n inc(~(a, b))\n (a, b)}',
        ),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L1, L2, L4, L5, L6, L3, L0, L7)
          abis (abi0, abi1, abi2, abi3, abi4, abi5)
          code (inc0, entry0)
      }
      layouts {
          L0 = record thin {
              read: ptr<L3>
              restore: code<abi0>
              context: ptr<void>
          }
          L1 = record scattered {
              item0: L0
              item1: L0
              restore: code<abi3>
              context: ptr<void>
          }
          L2 = unit
          L3 = f64
          L4 = record {
              item0: L3
              item1: L3
          }
          L5 = record environment
          L6 = record thin {
              read: ptr<L2>
              replacement: ptr<L3>
              restore: code<abi0>
              context: ptr<void>
          }
          L7 = record callable {
              environment: ptr<void>
              dispose: code<abi4>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L3) -> L2
          abi1 = (env: ptr<void>, L3, L3) -> L3
          abi2 = (env: ptr<void>) -> L4
          abi3 = (env: ptr<void>, L4) -> L2
          abi4 = (env: ptr<void>) -> L2
          abi5 = (env: ptr<void>, L1) -> L2
      }
      wrappers {
          wrap0 : abi4 env L5 = dispose () drop-captures-and-free
          wrap1 : abi5 env L5 = invoke inc0 transfer-captures-and-free
          wrap2 : abi4 env L5 = dispose () drop-captures-and-free
          wrap3 : abi1 env L5 = native "native/+" no-environment
          wrap4 : abi4 env L5 = dispose () drop-captures-and-free
          wrap5 : abi4 env L5 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L7 env L5 {dispose wrap4}
          callable1 : L7 env L5 {dispose wrap5}
          callable2 : L7 env L5 {dispose wrap2}
          callable3 : L7 env L5 {dispose wrap0}
      }
      fn inc0(lens $p0 ($p0.0, $p0.1): L1) : abi5 env L5 {
          %0: L6 = acquire $p0.0
          %1: L7 = make-callable callable3 {}
          %2: L3 = move $p0.0
          %3: L3 = 1
          %4: L3 = %1(%2, %3) via wrap3 : abi1
          %5: L2 = swap(%0, %4)
          return %5 : L2
          cleanup {restored $p0 : (Number, Number)}
      }
      fn entry0() : abi2 env L2 {
          %0: L3 = 1
          %1: L4 = scope {
              bind $a = %0
              %2: L3 = 2
              %3: L4 = scope {
                  bind $b = %2
                  %4: L0 = acquire $a
                  %5: L0 = acquire $b
                  %6: L1 = lens-tuple(%4, %5)
                  %7: L7 = make-callable callable1 {}
                  %8: L2 = %7(%6) via wrap1 : abi5
                  %9: L4 = scope {
                      bind _ = %8
                      %10: L3 = move $a
                      %11: L3 = move $b
                      %12: L4 = (%10, %11)
                      return %12 : L4
                  }
                  return %9 : L4
                  cleanup {drop $b}
              }
              return %3 : L4
              cleanup {drop $a}
          }
          return %1 : L4
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: thin-pair-update', () => {
    const p = compile('fn inc(~(x, y)) {x := x + 1}\n{let x = (1, 2)\n inc(~x)\n x}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L2, L3, L4, L5, L1, L6)
          abis (abi0, abi1, abi2, abi3, abi4, abi5)
          code (inc0, entry0)
      }
      layouts {
          L0 = unit
          L1 = f64
          L2 = record {
              item0: L1
              item1: L1
          }
          L3 = record environment
          L4 = record thin {
              read: ptr<L0>
              replacement: ptr<L1>
              restore: code<abi1>
              context: ptr<void>
          }
          L5 = record thin {
              read: ptr<L2>
              restore: code<abi4>
              context: ptr<void>
          }
          L6 = record callable {
              environment: ptr<void>
              dispose: code<abi5>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L5) -> L0
          abi1 = (env: ptr<void>, L1) -> L0
          abi2 = (env: ptr<void>, L1, L1) -> L1
          abi3 = (env: ptr<void>) -> L2
          abi4 = (env: ptr<void>, L2) -> L0
          abi5 = (env: ptr<void>) -> L0
      }
      wrappers {
          wrap0 : abi5 env L3 = dispose () drop-captures-and-free
          wrap1 : abi5 env L3 = dispose () drop-captures-and-free
          wrap2 : abi0 env L3 = invoke inc0 transfer-captures-and-free
          wrap3 : abi5 env L3 = dispose () drop-captures-and-free
          wrap4 : abi2 env L3 = native "native/+" no-environment
          wrap5 : abi5 env L3 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L6 env L3 {dispose wrap3}
          callable1 : L6 env L3 {dispose wrap5}
          callable2 : L6 env L3 {dispose wrap1}
          callable3 : L6 env L3 {dispose wrap0}
      }
      fn inc0(lens $p0 ($p0.0, $p0.1): L5) : abi0 env L3 {
          %0: L4 = acquire $p0.0
          %1: L6 = make-callable callable3 {}
          %2: L1 = move $p0.0
          %3: L1 = 1
          %4: L1 = %1(%2, %3) via wrap4 : abi2
          %5: L0 = swap(%0, %4)
          return %5 : L0
          cleanup {restored $p0 : (Number, Number)}
      }
      fn entry0() : abi3 env L0 {
          %0: L1 = 1
          %1: L1 = 2
          %2: L2 = (%0, %1)
          %3: L2 = scope {
              bind $x = %2
              %4: L5 = acquire $x
              %5: L6 = make-callable callable1 {}
              %6: L0 = %5(%4) via wrap2 : abi0
              %7: L2 = scope {
                  bind _ = %6
                  %8: L2 = move $x
                  return %8 : L2
              }
              return %7 : L2
              cleanup {drop $x}
          }
          return %3 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: branch', () => {
    const p = compile('{let x = 1\n match true {true -> x; false -> 2}}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2)
          abis (abi0)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = bool
          L2 = f64
      }
      abis {abi0 = (env: ptr<void>) -> L2}
      wrappers {}
      callables {}
      fn entry0() : abi0 env L0 {
          %0: L2 = 1
          %1: L2 = scope {
              bind $x = %0
              %2: L1 = true
              %3: L2 = match %2 {
                  true -> {
                      %4: L2 = move $x
                      return %4 : L2
                  }
                  false -> {
                      %5: L2 = 2
                      return %5 : L2
                      cleanup {drop $x}
                  }
              }
              return %3 : L2
              cleanup {drop $x}
          }
          return %1 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: recursion', () => {
    const p = compile('fn count(n) (match dup(~n) {0 -> 0; _ -> count(n - 1)})\ncount(3)'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3, L4)
          abis (abi0, abi1, abi2, abi3, abi4, abi5)
          code (count0, entry0)
      }
      layouts {
          L0 = unit
          L1 = record environment
          L2 = f64
          L3 = record thin {
              read: ptr<L2>
              restore: code<abi1>
              context: ptr<void>
          }
          L4 = record callable {
              environment: ptr<void>
              dispose: code<abi4>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2) -> L2
          abi1 = (env: ptr<void>, L2) -> L0
          abi2 = (env: ptr<void>, L2, L2) -> L2
          abi3 = (env: ptr<void>, L3) -> L2
          abi4 = (env: ptr<void>) -> L0
          abi5 = (env: ptr<void>) -> L2
      }
      wrappers {
          wrap0 : abi4 env L1 = dispose () drop-captures-and-free
          wrap1 : abi3 env L1 = native "native/dup" no-environment
          wrap2 : abi0 env L1 = invoke count0 transfer-captures-and-free
          wrap3 : abi2 env L1 = native "native/-" no-environment
          wrap4 : abi4 env L1 = dispose () drop-captures-and-free
          wrap5 : abi4 env L1 = dispose () drop-captures-and-free
          wrap6 : abi4 env L1 = dispose () drop-captures-and-free
          wrap7 : abi4 env L1 = dispose () drop-captures-and-free
          wrap8 : abi4 env L1 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L4 env L1 {dispose wrap0}
          callable1 : L4 env L1 {dispose wrap5}
          callable2 : L4 env L1 {dispose wrap7}
          callable3 : L4 env L1 {dispose wrap6}
          callable4 : L4 env L1 {dispose wrap8}
          callable5 : L4 env L1 {dispose wrap4}
      }
      fn count0($n: L2) : abi0 env L1 {
          %0: L3 = acquire $n
          %1: L4 = make-callable callable2 {}
          %2: L2 = %1(%0) via wrap1 : abi3
          %3: L2 = match %2 {
              0 -> {
                  %4: L2 = 0
                  return %4 : L2
                  cleanup {drop $n}
              }
              _ -> {
                  %5: L4 = make-callable callable3 {}
                  %6: L4 = make-callable callable0 {}
                  %7: L2 = move $n
                  %8: L2 = 1
                  %9: L2 = %6(%7, %8) via wrap3 : abi2
                  %10: L2 = %5(%9) via wrap2 : abi0
                  return %10 : L2
              }
          }
          return %3 : L2
          cleanup {drop $n}
      }
      fn entry0() : abi5 env L0 {
          %0: L4 = make-callable callable3 {}
          %1: L2 = 3
          %2: L2 = %0(%1) via wrap2 : abi0
          return %2 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: type-changing-slot', () => {
    const p = compile('{let x = 1\n x := true\n x}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3)
          abis (abi0, abi1)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = bool
          L2 = f64
          L3 = record thin {
              read: ptr<L2>
              replacement: ptr<L1>
              restore: code<abi1>
              context: ptr<void>
          }
      }
      abis {
          abi0 = (env: ptr<void>) -> L1
          abi1 = (env: ptr<void>, L1) -> L0
      }
      wrappers {}
      callables {}
      fn entry0() : abi0 env L0 {
          %0: L2 = 1
          %1: L1 = scope {
              bind $x = %0
              %2: L3 = acquire $x
              %3: L1 = true
              %4: L2 = swap(%2, %3)
              %5: L1 = scope {
                  bind _ = %4
                  %6: L1 = move $x
                  return %6 : L1
              }
              return %5 : L1
              cleanup {drop $x}
          }
          return %1 : L1
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: returned-focus', () => {
    const p = compile('{let x = (1, 2)\n fst(~x) := true\n x}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L2, L3, L4, L0, L5, L1, L6, L7, L8)
          abis (abi0, abi1, abi2, abi3, abi4)
          code (entry0)
      }
      layouts {
          L0 = bool
          L1 = f64
          L2 = record {
              item0: L0
              item1: L1
          }
          L3 = unit
          L4 = record {
              item0: L1
              item1: L1
          }
          L5 = record environment
          L6 = record thin {
              read: ptr<L1>
              replacement: ptr<L0>
              restore: code<abi4>
              context: ptr<void>
          }
          L7 = record thin {
              read: ptr<L4>
              replacement: ptr<L2>
              restore: code<abi0>
              context: ptr<void>
          }
          L8 = record callable {
              environment: ptr<void>
              dispose: code<abi2>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2) -> L3
          abi1 = (env: ptr<void>) -> L2
          abi2 = (env: ptr<void>) -> L3
          abi3 = (env: ptr<void>, L7) -> L6
          abi4 = (env: ptr<void>, L0) -> L3
      }
      wrappers {
          wrap0 : abi2 env L5 = dispose () drop-captures-and-free
          wrap1 : abi2 env L5 = dispose () drop-captures-and-free
          wrap2 : abi3 env L5 = native "native/fst" no-environment
      }
      callables {
          callable0 : L8 env L5 {dispose wrap0}
          callable1 : L8 env L5 {dispose wrap1}
      }
      fn entry0() : abi1 env L3 {
          %0: L1 = 1
          %1: L1 = 2
          %2: L4 = (%0, %1)
          %3: L2 = scope {
              bind $x = %2
              %4: L7 = acquire $x
              %5: L8 = make-callable callable0 {}
              %6: L6 = %5(%4) via wrap2 : abi3
              %7: L0 = true
              %8: L1 = swap(%6, %7)
              %9: L2 = scope {
                  bind _ = %8
                  %10: L2 = move $x
                  return %10 : L2
              }
              return %9 : L2
              cleanup {drop $x}
          }
          return %3 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: nested-shape', () => {
    const p = compile(
            'fn set(~(x, y)) {x := true}\n{let a = (1, 2)\n let b = 3\n set(~(a, b))\n (a, b)}',
        ),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L2, L3, L4, L0, L5, L6, L1, L7, L8, L9)
          abis (abi0, abi1, abi2, abi3, abi4, abi5)
          code (set0, entry0)
      }
      layouts {
          L0 = bool
          L1 = f64
          L2 = record {
              item0: L0
              item1: L1
          }
          L3 = unit
          L4 = record {
              item0: L1
              item1: L1
          }
          L5 = record thin {
              read: ptr<L4>
              replacement: ptr<L0>
              restore: code<abi5>
              context: ptr<void>
          }
          L6 = record environment
          L7 = record thin {
              read: ptr<L1>
              restore: code<abi0>
              context: ptr<void>
          }
          L8 = record callable {
              environment: ptr<void>
              dispose: code<abi4>
          }
          L9 = record scattered {
              item0: L5
              item1: L7
              restore: code<abi1>
              context: ptr<void>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L3
          abi1 = (env: ptr<void>, L2) -> L3
          abi2 = (env: ptr<void>) -> L2
          abi3 = (env: ptr<void>, L9) -> L4
          abi4 = (env: ptr<void>) -> L3
          abi5 = (env: ptr<void>, L0) -> L3
      }
      wrappers {
          wrap0 : abi4 env L6 = dispose () drop-captures-and-free
          wrap1 : abi4 env L6 = dispose () drop-captures-and-free
          wrap2 : abi3 env L6 = invoke set0 transfer-captures-and-free
      }
      callables {
          callable0 : L8 env L6 {dispose wrap0}
          callable1 : L8 env L6 {dispose wrap1}
      }
      fn set0(lens $p0 ($p0.0, $p0.1): L9) : abi3 env L6 {
          %0: L5 = acquire $p0.0
          %1: L0 = true
          %2: L4 = swap(%0, %1)
          return %2 : L4
          cleanup {restored $p0 : (Bool, Number)}
      }
      fn entry0() : abi2 env L3 {
          %0: L1 = 1
          %1: L1 = 2
          %2: L4 = (%0, %1)
          %3: L2 = scope {
              bind $a = %2
              %4: L1 = 3
              %5: L2 = scope {
                  bind $b = %4
                  %6: L5 = acquire $a
                  %7: L7 = acquire $b
                  %8: L9 = lens-tuple(%6, %7)
                  %9: L8 = make-callable callable0 {}
                  %10: L4 = %9(%8) via wrap2 : abi3
                  %11: L2 = scope {
                      bind _ = %10
                      %12: L0 = move $a
                      %13: L1 = move $b
                      %14: L2 = (%12, %13)
                      return %14 : L2
                  }
                  return %11 : L2
                  cleanup {drop $b}
              }
              return %5 : L2
              cleanup {drop $a}
          }
          return %3 : L2
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: closure', () => {
    const p = compile('{let x = 1\n let f = fn (()) x\n f(())}'),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L4, L3)
          abis (abi0, abi1, abi2)
          code (lambda0, entry0)
      }
      layouts {
          L0 = record callable {
              environment: ptr<void>
              dispose: code<abi1>
              invoke0: code<abi0>
          }
          L1 = unit
          L2 = record environment
          L3 = f64
          L4 = record environment {capture0: L3}
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L3
          abi1 = (env: ptr<void>) -> L1
          abi2 = (env: ptr<void>) -> L3
      }
      wrappers {
          wrap0 : abi0 env L4 = invoke lambda0 transfer-captures-and-free
          wrap1 : abi0 env L2 = dispatch (callable0 wrap0) selected-environment
          wrap2 : abi1 env L4 = dispose (L3) drop-captures-and-free
          wrap3 : abi1 env L2 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L0 env L4 {
              dispose wrap2
              invoke0 = wrap0 : abi0
          }
          callable1 : L0 env L2 {
              dispose wrap3
              invoke0 = wrap1 : abi0
          }
      }
      fn lambda0((): L1) : abi0 env L4 captures (capture0 $x: L3) {
          %0: L3 = move $x
          return %0 : L3
          cleanup {drop $x}
      }
      fn entry0() : abi2 env L1 {
          %0: L3 = 1
          %1: L3 = scope {
              bind $x = %0
              %2: L3 = move $x
              %3: L0 = make-callable callable0 {capture0 <- %2}
              %4: L3 = scope {
                  bind $f = %3
                  %5: L0 = move $f
                  %6: L1 = ()
                  %7: L3 = %5.invoke0(%6) via wrap1 : abi0
                  return %7 : L3
                  cleanup {drop $f}
              }
              return %4 : L3
              cleanup {drop $x}
          }
          return %1 : L3
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('prints all concrete instructions: capture-restore', () => {
    const p = compile(
            '{let x = 1\n let f = {let y = ~x\n let f = fn (()) y\n y := 2\n f}\n (f(()), x)}',
        ),
        before = JSON.stringify(p);
    expect(printConcreteProgram(p)).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L3, L4, L5, L6, L2, L7)
          abis (abi0, abi1, abi2, abi3)
          code (lambda0, entry0)
      }
      layouts {
          L0 = record callable {
              environment: ptr<void>
              dispose: code<abi3>
              invoke0: code<abi0>
          }
          L1 = unit
          L2 = f64
          L3 = record {
              item0: L2
              item1: L2
          }
          L4 = record environment
          L5 = record thin {
              read: ptr<L1>
              replacement: ptr<L2>
              restore: code<abi1>
              context: ptr<void>
          }
          L6 = record environment {capture0: L2}
          L7 = record thin {
              read: ptr<L2>
              restore: code<abi1>
              context: ptr<void>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L1) -> L2
          abi1 = (env: ptr<void>, L2) -> L1
          abi2 = (env: ptr<void>) -> L3
          abi3 = (env: ptr<void>) -> L1
      }
      wrappers {
          wrap0 : abi0 env L4 = dispatch (callable0 wrap1) selected-environment
          wrap1 : abi0 env L6 = invoke lambda0 transfer-captures-and-free
          wrap2 : abi3 env L6 = dispose (L2) drop-captures-and-free
          wrap3 : abi3 env L4 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L0 env L6 {
              dispose wrap2
              invoke0 = wrap1 : abi0
          }
          callable1 : L0 env L4 {
              dispose wrap3
              invoke0 = wrap0 : abi0
          }
      }
      fn lambda0((): L1) : abi0 env L6 captures (capture0 $y: L2) {
          %0: L2 = move $y
          return %0 : L2
          cleanup {drop $y}
      }
      fn entry0() : abi2 env L1 {
          %0: L2 = 1
          %1: L3 = scope {
              bind $x = %0
              %2: L7 = acquire $x
              %3: L0 = scope {
                  borrow loan0 = %2
                  %4: L2 = move $x@loan0
                  %5: L0 = make-callable callable0 {capture0 <- %4}
                  %6: L0 = scope {
                      bind $f = %5
                      %7: L5 = acquire $x@loan0
                      %8: L2 = 2
                      %9: L1 = swap(%7, %8)
                      %10: L0 = scope {
                          bind _ = %9
                          %11: L0 = move $f
                          return %11 : L0
                      }
                      return %10 : L0
                      cleanup {drop $f}
                  }
                  return %6 : L0
                  cleanup {release loan0}
              }
              %12: L3 = scope {
                  bind $f_1 = %3
                  %13: L0 = move $f_1
                  %14: L1 = ()
                  %15: L2 = %13.invoke0(%14) via wrap0 : abi0
                  %16: L2 = move $x
                  %17: L3 = (%15, %16)
                  return %17 : L3
                  cleanup {drop $f_1}
              }
              return %12 : L3
              cleanup {drop $x}
          }
          return %1 : L3
      }"
    `);
    expect(JSON.stringify(p)).toBe(before);
});
it('can show original identities and source origins for debugging', () => {
    const p = compile('fn id(x) x\nid(1)');
    expect(printConcreteProgram(p, { ids: 'full', origins: true })).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (
          entry_7dfb509f12917c9aa0fe195a923417473519bf568f68224079da7483ae7adfb3
      )
      forward {
          layouts (
              layout_54e87936ddd855ff180315156315fc921450e51b98e0d46cf360ab9ec1d5d689, layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327, layout_88fc96595525ef5086de4658706bcd430cfff1b985823d74d195e9b5ee374143, layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
          )
          abis (
              abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350, abi_b3b0e1262582d3fe4865774f76f20845d5fec9e992f12fabd3c1bf3fb00dd01b, abi_f62d6b85c2ffd15b1c966622fd997fe6516449f10c80481db4d6a77e4f895394
          )
          code (
              code_879d6dbaf0d774be7f3d33b55f80df6f70d86174eed5dcf89c1d1a6ce458d315, entry_7dfb509f12917c9aa0fe195a923417473519bf568f68224079da7483ae7adfb3
          )
      }
      layouts {
          layout_54e87936ddd855ff180315156315fc921450e51b98e0d46cf360ab9ec1d5d689 = unit
          layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327 = record environment
          layout_88fc96595525ef5086de4658706bcd430cfff1b985823d74d195e9b5ee374143 = record callable {
              environment: ptr<
                  layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327
              >
              dispose: code<
                  abi_b3b0e1262582d3fe4865774f76f20845d5fec9e992f12fabd3c1bf3fb00dd01b
              >
              invoke0: code<
                  abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350
              >
          }
          layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef = f64
      }
      abis {
          abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350 = (
              env: ptr<void>, layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
          ) -> layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
          abi_b3b0e1262582d3fe4865774f76f20845d5fec9e992f12fabd3c1bf3fb00dd01b = (env: ptr<void>) -> layout_54e87936ddd855ff180315156315fc921450e51b98e0d46cf360ab9ec1d5d689
          abi_f62d6b85c2ffd15b1c966622fd997fe6516449f10c80481db4d6a77e4f895394 = (env: ptr<void>) -> layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
      }
      wrappers {
          wrapper_21e57a56b996331d95517c27258f4a3221b1114c0ec86c2a55e5fdc6700ec451 : abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350 env layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327 = invoke code_879d6dbaf0d774be7f3d33b55f80df6f70d86174eed5dcf89c1d1a6ce458d315 transfer-captures-and-free
          wrapper_717a36fc95e85eaeb41e40aea6fdb4b9e12ba1486a81fdf89e9a1b6dd25ecbab : abi_b3b0e1262582d3fe4865774f76f20845d5fec9e992f12fabd3c1bf3fb00dd01b env layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327 = dispose () drop-captures-and-free
      }
      callables {
          callable_0d32274247cc9fe33a86d16ae7b14da38e0de339ea1354fc17f3942de58a44a0 : layout_88fc96595525ef5086de4658706bcd430cfff1b985823d74d195e9b5ee374143 env layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327 {
              dispose wrapper_717a36fc95e85eaeb41e40aea6fdb4b9e12ba1486a81fdf89e9a1b6dd25ecbab
              invoke0 = wrapper_21e57a56b996331d95517c27258f4a3221b1114c0ec86c2a55e5fdc6700ec451 : abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350
          }
      }
      fn code_879d6dbaf0d774be7f3d33b55f80df6f70d86174eed5dcf89c1d1a6ce458d315(
          unit/definition/id/p13: layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
      ) : abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350 env layout_5bbd9dcda6322b402fdd702f13ac2628a5b55cbd4b536bba4917e34754201327 source "spec_f5355660216bf78b6186f353f3b32788d36c13d88a6cc9b3f63d4e3e06219f7a" "unit/definition/id/n0/function" {
          unit/definition/id/v0: layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef = move unit/definition/id/p13 @ "unit/definition/id/n2"
          return unit/definition/id/v0 : layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
          cleanup {drop unit/definition/id/p13}
      }
      fn entry_7dfb509f12917c9aa0fe195a923417473519bf568f68224079da7483ae7adfb3() : abi_f62d6b85c2ffd15b1c966622fd997fe6516449f10c80481db4d6a77e4f895394 env layout_54e87936ddd855ff180315156315fc921450e51b98e0d46cf360ab9ec1d5d689 source "spec_3bc84350fdb5ea443a5bdc1ea3eb9d8eff9afa2f0506c0534811199c08f3821b" {
          unit/expression/0/v0: layout_88fc96595525ef5086de4658706bcd430cfff1b985823d74d195e9b5ee374143 = make-callable callable_0d32274247cc9fe33a86d16ae7b14da38e0de339ea1354fc17f3942de58a44a0 {} @ "unit/expression/0/n2"
          unit/expression/0/v1: layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef = 1 @ "unit/expression/0/n1"
          unit/expression/0/v2: layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef = unit/expression/0/v0.invoke0(unit/expression/0/v1) via wrapper_21e57a56b996331d95517c27258f4a3221b1114c0ec86c2a55e5fdc6700ec451 : abi_2557b72183a4607daa242bcd749d5491ea66af8382ee7a15f6d4a8d67514f350 @ "unit/expression/0/n0"
          return unit/expression/0/v2 : layout_904fe785e425170c4753ac2aa280cc140492f2ed8514768a8c28db5073e1d5ef
      }"
    `);
});
it('preserves special numeric payloads', () => {
    const p = structuredClone(compile('(1, 2, 3, 4)'));
    const constants = p.code.flatMap((c) => walk(c.body)).filter((i) => i.op === 'constant');
    const values = ['NaN', 'Infinity', '-Infinity', '-0'] as const;
    constants.forEach((i, n) => {
        if (i.op === 'constant') i.value = { number: values[n]! };
    });
    const text = printConcreteProgram(p);
    expect(text).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L2, L1)
          abis (abi0)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = f64
          L2 = record {
              item0: L1
              item1: L1
              item2: L1
              item3: L1
          }
      }
      abis {abi0 = (env: ptr<void>) -> L2}
      wrappers {}
      callables {}
      fn entry0() : abi0 env L0 {
          %0: L1 = NaN
          %1: L1 = Infinity
          %2: L1 = -Infinity
          %3: L1 = -0
          %4: L2 = (%0, %1, %2, %3)
          return %4 : L2
      }"
    `);
});
it('prints stable aliases after a JSON round trip', () => {
    const p = compile('fn count(n) (match dup(~n) {0 -> 0; _ -> count(n - 1)})\ncount(3)');
    const text = printConcreteProgram(p);
    expect(text).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L1, L2, L3, L4)
          abis (abi0, abi1, abi2, abi3, abi4, abi5)
          code (count0, entry0)
      }
      layouts {
          L0 = unit
          L1 = record environment
          L2 = f64
          L3 = record thin {
              read: ptr<L2>
              restore: code<abi1>
              context: ptr<void>
          }
          L4 = record callable {
              environment: ptr<void>
              dispose: code<abi4>
          }
      }
      abis {
          abi0 = (env: ptr<void>, L2) -> L2
          abi1 = (env: ptr<void>, L2) -> L0
          abi2 = (env: ptr<void>, L2, L2) -> L2
          abi3 = (env: ptr<void>, L3) -> L2
          abi4 = (env: ptr<void>) -> L0
          abi5 = (env: ptr<void>) -> L2
      }
      wrappers {
          wrap0 : abi4 env L1 = dispose () drop-captures-and-free
          wrap1 : abi3 env L1 = native "native/dup" no-environment
          wrap2 : abi0 env L1 = invoke count0 transfer-captures-and-free
          wrap3 : abi2 env L1 = native "native/-" no-environment
          wrap4 : abi4 env L1 = dispose () drop-captures-and-free
          wrap5 : abi4 env L1 = dispose () drop-captures-and-free
          wrap6 : abi4 env L1 = dispose () drop-captures-and-free
          wrap7 : abi4 env L1 = dispose () drop-captures-and-free
          wrap8 : abi4 env L1 = dispose () drop-captures-and-free
      }
      callables {
          callable0 : L4 env L1 {dispose wrap0}
          callable1 : L4 env L1 {dispose wrap5}
          callable2 : L4 env L1 {dispose wrap7}
          callable3 : L4 env L1 {dispose wrap6}
          callable4 : L4 env L1 {dispose wrap8}
          callable5 : L4 env L1 {dispose wrap4}
      }
      fn count0($n: L2) : abi0 env L1 {
          %0: L3 = acquire $n
          %1: L4 = make-callable callable2 {}
          %2: L2 = %1(%0) via wrap1 : abi3
          %3: L2 = match %2 {
              0 -> {
                  %4: L2 = 0
                  return %4 : L2
                  cleanup {drop $n}
              }
              _ -> {
                  %5: L4 = make-callable callable3 {}
                  %6: L4 = make-callable callable0 {}
                  %7: L2 = move $n
                  %8: L2 = 1
                  %9: L2 = %6(%7, %8) via wrap3 : abi2
                  %10: L2 = %5(%9) via wrap2 : abi0
                  return %10 : L2
              }
          }
          return %3 : L2
          cleanup {drop $n}
      }
      fn entry0() : abi5 env L0 {
          %0: L4 = make-callable callable3 {}
          %1: L2 = 3
          %2: L2 = %0(%1) via wrap2 : abi0
          return %2 : L2
      }"
    `);
    expect(printConcreteProgram(JSON.parse(JSON.stringify(p)))).toBe(text);
});
it('keeps shadowed and already suffixed source place names distinct', () => {
    const text = printConcreteProgram(
        compile('{let x = 1\n let x_1 = 2\n {let x = 3\n (x, x_1)}}'),
    );
    const bindings = [...text.matchAll(/bind (\$[a-zA-Z0-9_]+)/g)].map((m) => m[1]);
    expect(bindings).toHaveLength(3);
    expect(new Set(bindings).size).toBe(3);
    expect(text).toMatchInlineSnapshot(`
      "concrete-ir 1
      target "wasm32-unknown-emscripten" 32bit little c11 emscripten-node
      toolchain emscripten "test" features ()
      entries (entry0)
      forward {
          layouts (L0, L2, L1)
          abis (abi0)
          code (entry0)
      }
      layouts {
          L0 = unit
          L1 = f64
          L2 = record {
              item0: L1
              item1: L1
          }
      }
      abis {abi0 = (env: ptr<void>) -> L2}
      wrappers {}
      callables {}
      fn entry0() : abi0 env L0 {
          %0: L1 = 1
          %1: L2 = scope {
              bind $x = %0
              %2: L1 = 2
              %3: L2 = scope {
                  bind $x_1 = %2
                  %4: L1 = 3
                  %5: L2 = scope {
                      bind $x_2 = %4
                      %6: L1 = move $x_2
                      %7: L1 = move $x_1
                      %8: L2 = (%6, %7)
                      return %8 : L2
                      cleanup {drop $x_2}
                  }
                  return %5 : L2
                  cleanup {drop $x_1}
              }
              return %3 : L2
              cleanup {drop $x}
          }
          return %1 : L2
      }"
    `);
});
