/**
 * A plain closure can be read, and so copied, any number of times. Every holder ends by calling
 * the closure or dropping it, and a copy that is never called must not free what another holder
 * still uses. The native build checks every case under ASan and fails on a leaked environment.
 */
const apply = 'fn apply(f) { f() }\n';
const dual = (body: string) => `// laminar: dual\n${body}`;
export const sharedClosureSamples = [
    {
        name: 'a copied closure called twice',
        source: dual(
            'fn apply(f, x) { f(x) }\n{ let k = 5\n let f = fn (x) { x + k }\n (apply(f, 1), apply(f, 2)) }',
        ),
        expected: [6, 7],
    },
    {
        name: 'a string capture shared by two calls',
        source: dual(
            `${apply}{ let s = "hello"\n let f = fn () { "\${s} world" }\n (apply(f), apply(f)) }`,
        ),
        expected: ['hello world', 'hello world'],
    },
    {
        name: 'a vector capture shared by three calls',
        source: dual(
            `${apply}{ let v = [:10, 20, 30:]\n let f = fn () { v[1] + 0 }\n (apply(f), apply(f), apply(f)) }`,
        ),
        expected: [20, 20, 20],
    },
    {
        name: 'a copy that is never called is dropped without freeing the original',
        source: dual(
            `${apply}{ let s = "kept"\n let f = fn () { "\${s}!" }\n let g = f\n apply(f) }`,
        ),
        expected: 'kept!',
    },
    {
        name: 'copies that are all dropped',
        source: dual(
            `${apply}{ let s = "never called"\n let f = fn () { "\${s}!" }\n let g = f\n let h = f\n 0 }`,
        ),
        expected: 0,
    },
    {
        name: 'a closure that captures a closure, called twice',
        source: dual(
            `${apply}{ let s = "inner"\n let f = fn () { "\${s}?" }\n let h = fn () { "\${apply(f)}!" }\n (apply(h), apply(h)) }`,
        ),
        expected: ['inner?!', 'inner?!'],
    },
];
