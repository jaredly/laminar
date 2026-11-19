import { readFileSync } from 'fs';
import { typedProgram } from '../test/backend/typed-program.ts';
import { locLines, readFile, readLines } from '../src/lexer.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';
import { TypedProgram } from '../src/typed-ir.ts';
import { checkFile } from '../src/check.ts';
import { grammar } from '../src/laminar-parser.ts';
import { File } from '../src/ast.ts';

const [_, __, name] = process.argv;
const source = readFileSync(name, 'utf-8');

const file = grammar.parse<File>('File', readFile(source).node);
if (file.type === 'failure') throw new Error('parse fail');
checkFile(file.value);
console.log('Checked ok');

console.time('Type');
let p: TypedProgram;
try {
    p = typedProgram(source!);
} catch (err) {
    console.error(err);
    console.log('bad types');
    const pos = locLines(source.split('\n'));
    console.log(pos((err as { loc: number }).loc));
    process.exit(1);
}
console.timeEnd('Type');

const result = executeTypedProgram(p);
console.log(result);
process.exit(0);

// Native eval, waiting on that

// import { compileConcreteProgram } from '../src/lower-concrete.ts';
// import { spawnSync } from 'child_process';
// import { targetConfig } from '../src/backend/target.ts';
// import { buildAndRun } from '../src/c/build.ts';
// import { emitC } from '../src/c/emit.ts';
// import { constructorTypes } from '../src/builtins.ts';
// const version = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8' });
// const clang = version('clang'),
//     emcc = version('emcc'),
//     node = version('node');
//
// const macros =
//     spawnSync('clang', ['-dM', '-E', '-x', 'c', '/dev/null'], { encoding: 'utf8' }).stdout ?? '';
//
// const wasm = false;
//
// const native = targetConfig({
//     schemaVersion: 1,
//     triple: spawnSync('clang', ['-dumpmachine'], { encoding: 'utf8' }).stdout.trim(),
//     pointerBits: Number(macros.match(/#define __SIZEOF_POINTER__ (\d+)/)?.[1]) === 4 ? 32 : 64,
//     byteOrder: /#define __BYTE_ORDER__ __ORDER_BIG_ENDIAN__/.test(macros) ? 'big' : 'little',
//     abi: 'c11',
//     toolchain: { compiler: 'clang', version: clang.stdout.trim() },
//     runtime: 'native',
//     features: [],
// });
//
// const constructors = constructorTypes();
// constructors.set('Some', solver.generalize(fn([plain(a)], plain(option)), []));
// constructors.set('None', solver.generalize(fn([], plain(option)), []));

// const variable = { tag: 'variable' as const, id: 'T', rigid: false };
// const c = compileConcreteProgram(
//     p,
//     native, // wasm ? wasm32Emscripten(emcc.stdout.trim()) : native!,
//     [{ unit: p.units.at(-1)!.id, arguments: [] }],
//     {
//         layoutDefinitions: [
//             // {
//             //     name: 'List',
//             //     parameters: ['T'],
//             //     kind: 'union',
//             //     fields: [
//             //         { name: 'nil', type: { tag: 'tuple', items: [] } },
//             //         {
//             //             name: 'cons',
//             //             type: {
//             //                 tag: 'tuple',
//             //                 items: [variable, { tag: 'con', name: 'List', args: [variable] }],
//             //             },
//             //             indirect: true,
//             //         },
//             //     ],
//             // },
//             // {
//             //     name: 'Option',
//             //     parameters: ['T'],
//             //     kind: 'union',
//             //     fields: [
//             //         { name: 'Some', type: variable },
//             //         { name: 'None', type: { tag: 'tuple', items: [] } },
//             //     ],
//             // },
//         ],
//     },
// );
// console.timeEnd('Compile');
// try {
//     console.time('Build and run');
//     const result = await buildAndRun(emitC(c), { compiler: wasm ? 'emcc' : 'clang', wasm });
//     console.timeEnd('Build and run');
//     console.log(result);
//     // throw Error('Expected runtime trap');
// } catch (error) {
//     console.error(error);
//     // expect((error as { code?: string }).code).toBe('c-runtime');
//     // const directory = String(error).match(/Artifacts: (.+)/)![1]!;
//     // // Expected trap artifacts have been checked; real regressions remain retained.
//     // await rm(directory, { recursive: true });
// }
