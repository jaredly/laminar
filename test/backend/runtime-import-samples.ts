// A fixed seed makes `random` repeatable, and every backend runs the same xorshift32.
process.env.LAMINAR_SEED = '7';

/** Phase 7 runtime imports: registry-driven natives and host I/O adapters. */
export const runtimeImportSamples = [
    {
        name: 'round halves up',
        source: '(round(2.5), round(0 - 2.5), round(1.4))',
        expected: [3, -2, 1],
    },
    {
        name: 'round keeps the sign of zero',
        source: '(round(0 - 0.4), round(0 - 0.5), round(0.4))',
        expected: [{ number: '-0' }, { number: '-0' }, 0],
    },
    {
        name: 'round near a half',
        source: 'round(0.49999999999999994)',
        expected: 0,
    },
    {
        name: 'round non-finite',
        source: '(round(1 / 0), round(0 / 0))',
        expected: [{ number: 'Infinity' }, { number: 'NaN' }],
    },
    { name: 'round as a value', source: '{let r = round\n r(1.6)}', expected: 2 },
    { name: 'heapsize', source: 'heapsize()', expected: 0 },
    {
        name: 'round through a runtime join',
        source: '{let f = match false {true -> fn (x) (x + 1); false -> round}\n f(2.5)}',
        expected: 3,
    },
    { name: 'print', source: 'print("hi")', expected: null, output: 'hi\n' },
    {
        name: 'print sequence',
        source: '{print("a")\n print("b${1}")\n 3}',
        expected: 3,
        output: 'a\nb1\n',
    },
    { name: 'print empty', source: 'print("")', expected: null, output: '\n' },
    {
        name: 'print text with newlines',
        source: '{print("x\\ny")\n "done"}',
        expected: 'done',
        output: 'x\ny\n',
    },
    { name: 'print as a value', source: '{let p = print\n p("x")}', expected: null, output: 'x\n' },
    {
        name: 'getInput',
        source: '{let n = getInput("name? ")\n let m = getInput("again? ")\n "${n}+${m}"}',
        expected: 'ann+bob',
        stdin: 'ann\nbob\n',
        output: 'name? again? ',
    },
    {
        name: 'getInput at end of input',
        source: '{let a = getInput("")\n let b = getInput("")\n (a, b)}',
        expected: ['last', ''],
        stdin: 'last',
        output: '',
    },
    {
        name: 'getInput unicode',
        source: 'charList(getInput("> "))',
        expected: ['é', '😀'],
        stdin: 'é😀\n',
        output: '> ',
    },
    {
        name: 'interactive loop',
        source: 'fn ask(n) {match dup(~n) {0 -> (); _ -> {let line = getInput("? ")\n print("got ${line}")\n ask(n - 1)}}}\nask(2)',
        expected: null,
        stdin: 'a\nb\n',
        output: '? got a\n? got b\n',
    },
    {
        name: 'write has no newline',
        source: '{write("a")\n write("b${1}")\n 3}',
        expected: 3,
        output: 'ab1',
    },
    {
        name: 'string escape e is ESC',
        source: '{write("\\e[2J")\n 1}',
        expected: 1,
        output: '\x1b[2J',
    },
    {
        name: 'waitKey reads one byte at a time',
        source: '{let a = waitKey(10)\n let b = waitKey(10)\n let c = waitKey(10)\n (a, b, c)}',
        expected: ['x', 'y', ''],
        stdin: 'xy',
        output: '',
    },
    {
        name: 'waitKey at end of input',
        source: 'waitKey(0)',
        expected: '',
        stdin: '',
        output: '',
    },
    {
        name: 'random is repeatable under a seed',
        source: '(random(10), random(10), random(10))',
        expected: [3, 5, 7],
    },
    {
        name: 'writeFile writes every byte',
        source: '{writeFile("/tmp/laminar-write-file.bin", [:0, 66, 255, 10:])\n 1}',
        expected: 1,
        file: { path: '/tmp/laminar-write-file.bin', bytes: [0, 66, 255, 10] },
    },
    {
        name: 'writeFile of an empty vector',
        source: '{writeFile("/tmp/laminar-write-file-empty.bin", [::])\n 1}',
        expected: 1,
        file: { path: '/tmp/laminar-write-file-empty.bin', bytes: [] },
    },
    { name: 'random of one', source: '(random(1), random(1))', expected: [0, 0] },
];
