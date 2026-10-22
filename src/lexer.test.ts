import { it, expect } from 'bun:test';
import { compact, read, readFile, stringify } from './lexer.ts';

it('should do a basic', () => {
    expect(read('hello')).toEqual({ type: 'id', text: 'hello', loc: 0 });
});

it('should do a wrapper', () => {
    expect(read('{hello}')).toMatchInlineSnapshot(`
      {
        "child": {
          "loc": 1,
          "text": "hello",
          "type": "id",
        },
        "kind": "{",
        "loc": 0,
        "type": "wrapper",
      }
    `);
});

it('should ignore newlines between elemesn', () => {
    expect(
        compact(
            read(`[0,
            2,
            3,
        ]`),
        ),
    ).toEqual(['[,', '0', '2', '3']);
});

it('should handle comments and newlines', () => {
    expect(compact(read(`[0//hello\n1]`))).toEqual(['[\n', '0', '1']);
});

it('should handle comments and newlines', () => {
    expect(compact(read(`[0\n//hello\n1]`))).toEqual(['[\n', '0', '1']);
});

const cr = (t: string) => compact(readFile(t).node);

it('idk', () => {
    expect(cr(`one\ntwo\nthree: four five six`)).toEqual([
        '\n',
        'one',
        'two',
        [' ', [':', 'three', 'four'], 'five', 'six'],
    ]);
});

it('should lex this right', () => {
    expect(
        cr(`2\n\n(
(("v from passer", 3),
 ("Hello", 10)),
 (4, 20)
)`),
    ).toEqual([
        '\n',
        '2',
        [
            '(,',
            ['(,', ['(,', ['"', 'v from passer'], '3'], ['(,', ['"', 'Hello'], '10']],
            ['(,', '4', '20'],
        ],
    ]);
});

it('should count newlines within elemesn', () => {
    expect(compact(read(`[0,2,3\n4,5,6]`))).toEqual([
        '[\n',
        [',', '0', '2', '3'],
        [',', '4', '5', '6'],
    ]);
});

it('should correctly nest spacers', () => {
    expect(compact(read(`(1.2,3;4:5)`))).toEqual([
        '(;',
        [',', ['', '1', '.', '2'], '3'],
        [':', '4', '5'],
    ]);
});

it('should allow := ops', () => {
    expect(compact(read(`[x:2, x: -2, x:=2]`))).toEqual([
        '[,',
        [':', 'x', '2'],
        [':', 'x', ['', '-', '2']],
        ['', 'x', ':=', '2'],
    ]);
});

it('should ignore trailing commas', () => {
    expect(compact(read(`[0, ]`))).toEqual(['[', '0']);
});

it('should ignore trailing commas between semis', () => {
    expect(compact(read(`[0,;1,;2,;3]`))).toEqual(['[;', '0', '1', '2', '3']);
});

it('should handle stuff', () => {
    expect(JSON.stringify(compact(read('[(a: b / m, c: d) => e + f]')))).toMatchInlineSnapshot(
        `"["[ ",["(,",[" ",[":","a","b"],"/","m"],[":","c","d"]],"=>","e","+","f"]"`,
    );
});

it('should handle strings', () => {
    expect(compact(read('"Hello"'))).toEqual(['"', 'Hello']);
});

it('should handle strings in context', () => {
    expect(compact(read('{case "Hello": return}'))).toEqual([
        '{ ',
        'case',
        [':', ['"', 'Hello'], 'return'],
    ]);
});

it('should handle js better', () => {
    expect(
        stringify(
            read(`(function handleSuffixes(head, suffixes) {
            return suffixes.reduce((head, suffix): Linear => {
                switch (suffix.type) {
                    case "attr": return {type: "attr", target: head, attr: suffix.attr}
                    case "index": return {type: "index", index: suffix.index, target: head}
                    case "apply": return {type: "apply", fn: head, args: suffix.args}
                }
            }, head)
        })`),
        ),
    ).toMatchInlineSnapshot(`
      "(function handleSuffixes(head, suffixes) {return suffixes.reduce((head, suffix): Linear => {switch (suffix.type) {
      case "attr": return {type: "attr", target: head, attr: suffix.attr}
      case "index": return {type: "index", index: suffix.index, target: head}
      case "apply": return {type: "apply", fn: head, args: suffix.args}
      }}, head)})"
    `);
});

it('should do a wrapper with single list kind', () => {
    expect(read('{one, two, trhee}')).toMatchInlineSnapshot(`
      {
        "child": {
          "children": [
            {
              "loc": 1,
              "text": "one",
              "type": "id",
            },
            {
              "loc": 6,
              "text": "two",
              "type": "id",
            },
            {
              "loc": 11,
              "text": "trhee",
              "type": "id",
            },
          ],
          "kind": ",",
          "loc": 1,
          "type": "list",
        },
        "kind": "{",
        "loc": 0,
        "type": "wrapper",
      }
    `);
});

it('should do a wrapper with multi list kind', () => {
    expect(read('{1,2,3;4,5,6}')).toMatchInlineSnapshot(`
      {
        "child": {
          "children": [
            {
              "children": [
                {
                  "loc": 1,
                  "text": "1",
                  "type": "id",
                },
                {
                  "loc": 3,
                  "text": "2",
                  "type": "id",
                },
                {
                  "loc": 5,
                  "text": "3",
                  "type": "id",
                },
              ],
              "kind": ",",
              "loc": 1,
              "type": "list",
            },
            {
              "children": [
                {
                  "loc": 7,
                  "text": "4",
                  "type": "id",
                },
                {
                  "loc": 9,
                  "text": "5",
                  "type": "id",
                },
                {
                  "loc": 11,
                  "text": "6",
                  "type": "id",
                },
              ],
              "kind": ",",
              "loc": 7,
              "type": "list",
            },
          ],
          "kind": ";",
          "loc": 1,
          "type": "list",
        },
        "kind": "{",
        "loc": 0,
        "type": "wrapper",
      }
    `);
});

it('three levels deep', () => {
    expect(read('{(1 + 2, 3; a.b - c, d; e)}')).toMatchInlineSnapshot(`
      {
        "child": {
          "child": {
            "children": [
              {
                "children": [
                  {
                    "children": [
                      {
                        "loc": 2,
                        "text": "1",
                        "type": "id",
                      },
                      {
                        "loc": 4,
                        "text": "+",
                        "type": "op",
                      },
                      {
                        "loc": 6,
                        "text": "2",
                        "type": "id",
                      },
                    ],
                    "kind": " ",
                    "loc": 2,
                    "type": "list",
                  },
                  {
                    "loc": 9,
                    "text": "3",
                    "type": "id",
                  },
                ],
                "kind": ",",
                "loc": 2,
                "type": "list",
              },
              {
                "children": [
                  {
                    "children": [
                      {
                        "children": [
                          {
                            "loc": 12,
                            "text": "a",
                            "type": "id",
                          },
                          {
                            "loc": 13,
                            "text": ".",
                            "type": "op",
                          },
                          {
                            "loc": 14,
                            "text": "b",
                            "type": "id",
                          },
                        ],
                        "kind": "",
                        "loc": 12,
                        "type": "list",
                      },
                      {
                        "loc": 16,
                        "text": "-",
                        "type": "op",
                      },
                      {
                        "loc": 18,
                        "text": "c",
                        "type": "id",
                      },
                    ],
                    "kind": " ",
                    "loc": 12,
                    "type": "list",
                  },
                  {
                    "loc": 21,
                    "text": "d",
                    "type": "id",
                  },
                ],
                "kind": ",",
                "loc": 12,
                "type": "list",
              },
              {
                "loc": 24,
                "text": "e",
                "type": "id",
              },
            ],
            "kind": ";",
            "loc": 2,
            "type": "list",
          },
          "kind": "(",
          "loc": 1,
          "type": "wrapper",
        },
        "kind": "{",
        "loc": 0,
        "type": "wrapper",
      }
    `);
});
