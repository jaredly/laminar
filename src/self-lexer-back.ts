import {Grammar, Id, Node, option, many, list, b, lit, rest, wrapper, re} from "./grammar-lexer.ts";
import {File, FileItem, RawRule, RawOption, Pat, WrapperKind, ListKind} from "./grammar-lexer.ts";

export const grammar = new Grammar();

function parseList(kind: Id, items: Pat[]): Pat {
    if ("{[(".includes(kind.text[0])) {
        return {
            type: 'wrapper',
            kind: { ...kind, text: kind.text[0] },
            child: { type: 'list', kind: { ...kind, text: kind.text[1] }, items },
        };
    }
    return { type: 'list', kind, items };
}


grammar.add("File", [
                option(
                    list("\n", many("items", "FileItem")),
    ({items}: {items: FileItem[]}): File => items
                )
            ])

grammar.add("FileItem", [
                option(
                    b("rule","RawRule"),
    ({rule}: {rule: RawRule}): FileItem => ({type: "rule", rule})
                ),
    option(
                    list(" ", lit("function"), rest("rest", "any")),
    ({rest}: {rest: Node}): FileItem => ({type: "function", rest})
                ),
    option(
                    list(" ", lit("const"), rest("rest", "any")),
    ({rest}: {rest: Node}): FileItem => ({type: "const", rest})
                )
            ])

grammar.add("RawRule", [
                option(
                    list(" ", b("name","id"), wrapper("{", list("\n", many("options", "RawOption")))),
    ({name,options}: {name: Id,options: RawOption[]}): RawRule => ({name, options})
                ),
    option(
                    list(" ", b("name","id"), wrapper("{", b("option","RawOption"))),
    ({name,option}: {name: Id,option: RawOption}): RawRule => ({name, options: [option]})
                )
            ])

grammar.add("RawOption", [
                option(
                    list(" ", b("pat","Pat"), lit("->"), rest("res", "any")),
    ({pat,res}: {pat: Pat,res: Node}): RawOption => ({pat, res})
                ),
    option(
                    list("\"", b("text","id")),
    ({text}: {text: Id}): RawOption => ({pat: {type: "literal", text}})
                ),
    option(
                    list("", lit("re"), list("\"", b("raw","id"))),
    ({raw}: {raw: Id}): RawOption => ({pat: {type: "regexp", regexp: new RegExp(raw.text)}})
                )
            ])

grammar.add("Pat", [
                option(
                    list("\"", b("text","id")),
    ({text}: {text: Id}): Pat => ({type: "literal", text})
                ),
    option(
                    list(":", b("name","id"), b("rule","id")),
    ({name,rule}: {name: Id,rule: Id}): Pat => ({type: "rule", name, rule})
                ),
    option(
                    wrapper("[", list(" ", list("\"", b("kind","WrapperKind")), b("child","Pat"))),
    ({kind,child}: {kind: WrapperKind,child: Pat}): Pat => ({type: "wrapper", kind, child})
                ),
    option(
                    wrapper("[", list(" ", list("\"", b("kind","ListKind")), many("items", "Pat"))),
    ({kind,items}: {kind: ListKind,items: Pat[]}): Pat => parseList(kind, items)
                ),
    option(
                    list(":", list("", lit("..."), b("name","id")), list("", lit("*"), b("rule","id"))),
    ({name,rule}: {name: Id,rule: Id}): Pat => ({type: "rest", name, rule, multi: !1})
                ),
    option(
                    list(":", list("", lit("..."), b("name","id")), list("", lit("**"), b("rule","id"))),
    ({name,rule}: {name: Id,rule: Id}): Pat => ({type: "rest", name, rule, multi: !0})
                ),
    option(
                    list(":", list("", lit("..."), b("name","id")), b("rule","id")),
    ({name,rule}: {name: Id,rule: Id}): Pat => ({type: "many", name, rule})
                ),
    option(
                    list(":", list("", lit("..."), b("name","id")), wrapper("(", list(" ", many("items", "Pat")))),
    ({name,items}: {name: Id,items: Pat[]}): Pat => ({type: "many-items", name, items})
                ),
    option(
                    list("", lit("re"), list("\"", b("raw","id"))),
    ({raw}: {raw: Id}): Pat => ({type: "regexp", regexp: new RegExp(raw.text)})
                )
            ])

grammar.add("WrapperKind", [
                option(
                    lit("{"),
                ),
    option(
                    lit("("),
                ),
    option(
                    lit("["),
                )
            ])

grammar.add("ListKind", [
                option(
                    re(/[{([][ ,;:\n]/),
                ),
    option(
                    lit(","),
                ),
    option(
                    lit(";"),
                ),
    option(
                    lit(""),
                ),
    option(
                    lit(" "),
                ),
    option(
                    lit(":"),
                ),
    option(
                    lit("\""),
                ),
    option(
                    lit("\n"),
                )
            ])
    