import { expect, it } from 'bun:test';
import { readLine, readLines } from './nnodes.ts';
import { grammar as self } from './self-made.ts';
import { asDSL, Grammar } from './grammar.ts';

const loadGrammar = (text: string) => {
    const parsed = readLines(text);
    const grammar = new Grammar();
    parsed.nodes.forEach((node) => {
        const rule = self.parse('RawRule', node);
        if (rule.type === 'failure') {
            expect(rule).toMatchObject({ type: 'success' });
            return;
        }
        grammar.addRaw(rule.value.name.text, rule.value.options);
    });
    return grammar;
};

it('should double parse', () => {
    const grammar = loadGrammar(`
Linear {
    text:id -> ({type: "id", text: text.text})
    ["" head:Linear ...suffixes:**LinearOps] -> ({type: "suffixes", head, suffixes})
}
LinearOps {
    ["" "." attr:id] -> ({type: "attr", attr: attr.text})
    ["" ["[" index:Linear]] -> ({type: "index", index})
    ["" ["(" ...args:Linear]] -> ({type: "apply", args})
}`);
    expect(grammar.parse('Linear', readLine('hello'))).toMatchInlineSnapshot(`
      {
        "type": "success",
        "value": {
          "text": "hello",
          "type": "id",
        },
      }
    `);
    expect(grammar.parse('Linear', readLine('one.two'))).toMatchInlineSnapshot(`
      {
        "type": "success",
        "value": {
          "head": {
            "text": "one",
            "type": "id",
          },
          "suffixes": [
            {
              "attr": {
                "loc": 4,
                "text": "two",
                "type": "id",
              },
            },
          ],
          "type": "suffixes",
        },
      }
    `);
    expect(grammar.parse('Linear', readLine('one.two(three, four)[four].five')))
        .toMatchInlineSnapshot(`
      {
        "type": "success",
        "value": {
          "head": {
            "text": "one",
            "type": "id",
          },
          "suffixes": [
            {
              "attr": {
                "loc": 4,
                "text": "two",
                "type": "id",
              },
            },
            {
              "args": [
                {
                  "text": "three",
                  "type": "id",
                },
                {
                  "text": "four",
                  "type": "id",
                },
              ],
            },
            {
              "index": {
                "text": "four",
                "type": "id",
              },
            },
            {
              "attr": {
                "loc": 27,
                "text": "five",
                "type": "id",
              },
            },
          ],
          "type": "suffixes",
        },
      }
    `);
});

it('should do a little', () => {
    expect(self.parse('Pat', readLine('"a"'))).toMatchInlineSnapshot(`
      {
        "type": "success",
        "value": {
          "text": {
            "loc": 1,
            "text": "a",
            "type": "id",
          },
          "type": "literal",
        },
      }
    `);
});

it('should do a named rule', () => {
    expect(self.parse('Pat', readLine('name:id'))).toMatchInlineSnapshot(`
      {
        "type": "success",
        "value": {
          "name": {
            "loc": 0,
            "text": "name",
            "type": "id",
          },
          "rule": {
            "loc": 5,
            "text": "id",
            "type": "id",
          },
          "type": "rule",
        },
      }
    `);
});

it('should do a named rule', () => {
    expect(self.parse('Pat', readLine(`["(" me:id]`))).toMatchInlineSnapshot(`
      {
        "type": "success",
        "value": {
          "items": [
            {
              "name": {
                "loc": 5,
                "text": "me",
                "type": "id",
              },
              "rule": {
                "loc": 8,
                "text": "id",
                "type": "id",
              },
              "type": "rule",
            },
          ],
          "kind": {
            "loc": 2,
            "text": "(",
            "type": "id",
          },
          "type": "list",
        },
      }
    `);
});

it('should parse a full thing', () => {
    const txt = `Pat {
    ["\\"" text:id] -> {type: "literal", text}
    [": " name:id rule:id] -> {type: "rule", name, rule}
    ["[" kind:ListKind ...items:Pat] -> {type: "list", kind, items}
    [": " ["" "..." name:id] ["" "*" rule:id]] -> {type: "rest", name, rule}
    [": " ["" "..." name:id] rule:id] -> {type: "many", name, rule}
    [": " ["" "..." name:id] ["(" ...items:Pat]] -> {type: "many-items", name, items}
}`;
    const node = readLine(txt);
    expect(self.parse('RawRule', node)).toMatchObject({
        type: 'success',
    });
});

const full = `\
File {
    ["\n" ...items:FileItem] -> items
}

FileItem {
    rule:RawRule -> ({type: 'rule', rule})
    [" " "function" ...rest:*any] -> ({type: "function", rest})
    [" " "const" ...rest:*any] -> ({type: "const", rest})
}

RawRule {
    [" " name:id ["{" ...options:RawOption]] -> ({name, options})
}

RawOption {
    [" " pat:Pat "->" ...res:*any] -> ({pat, res})
    ["\\"" text:id] -> ({pat: {type: 'literal', text}})
}

Pat {
    ["\\"" text:id] -> ({type: "literal", text})
    [": " name:id rule:id] -> ({type: "rule", name, rule})
    ["[" [" " ["\\"" kind:ListKind] ...items:Pat]] -> ({type: "list", kind, items})
    [": " ["" "..." name:id] ["" "*" rule:id]] -> ({type: "rest", name, rule})
    [": " ["" "..." name:id] ["" "**" rule:id]] -> ({type: "rest", name, rule, multi: true})
    [": " ["" "..." name:id] rule:id] -> ({type: "many", name, rule})
    [": " ["" "..." name:id] ["(" [" " ...items:Pat]]] -> ({type: "many-items", name, items})
}

ListKind {
    ""
    "{"
    "["
    "("
    " "
    ": "
    "\\""
    "\\n"
}`;

it('should parse the full shebang', () => {
    const parsed = readLines(full);
    const grammar = new Grammar();
    parsed.nodes.forEach((node) => {
        const rule = self.parse('RawRule', node);
        if (rule.type === 'failure') {
            expect(rule).toMatchObject({ type: 'success' });
            return;
        }
        grammar.addRaw(rule.value.name.text, rule.value.options);
    });

    const rulesText = (grammar: Grammar) => {
        return Object.entries(grammar.rules).map(
            ([name, rule]) => name + ': [' + rule.map((item) => asDSL(item.pat)).join(',\n') + ']',
        );
    };

    expect(rulesText(grammar)).toEqual(rulesText(self));

    const secondGrammar = new Grammar();
    parsed.nodes.forEach((node) => {
        const rule = grammar.parse('RawRule', node);
        if (rule.type === 'failure') {
            expect(rule).toMatchObject({ type: 'success' });
            return;
        }
        if (!rule.value) {
            console.log(rule);
        }
        secondGrammar.addRaw(rule.value.name.text, rule.value.options);
    });

    expect(rulesText(secondGrammar)).toEqual(rulesText(self));
});
