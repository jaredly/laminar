import { readFileSync } from 'fs';
import { compact, readLines, stringify } from '../src/nnodes.ts';
import { parseLinear } from '../src/flowparse.ts';
import { evaluate, Value } from '../src/floweval.ts';
// import { readList } from "../src/nnodes.ts";

const raw = readFileSync(import.meta.dirname + '/simple.fl', 'utf-8');
const nodes = readLines(raw);
for (let node of nodes) {
    console.log();
    const exp = parseLinear(node);
    console.log(JSON.stringify(exp));
    console.log(JSON.stringify(compact(node)));
    console.log(stringify(node));
    const [value, gamma] = evaluate(exp, {
        bindings: {},
        builtins: {
            '-': (a: Value, b: Value) => ({
                type: 'int',
                value: (a as Value & { type: 'int' }).value - (b as Value & { type: 'int' }).value,
            }),
            '+': (a: Value, b: Value) => ({
                type: 'int',
                value: (a as Value & { type: 'int' }).value + (b as Value & { type: 'int' }).value,
            }),
            '<': (a: Value, b: Value) => ({
                type: 'bool',
                value: (a as Value & { type: 'int' }).value < (b as Value & { type: 'int' }).value,
            }),
            left: (value: Value) => ({
                type: 'union',
                side: 'left',
                value,
            }),
            right: (value: Value) => ({
                type: 'union',
                side: 'right',
                value,
            }),
        },
    });
    console.log(value);
}
