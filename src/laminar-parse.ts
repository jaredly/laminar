import {Grammar, Id, Node, option, lit, b, list, many, rest} from "./grammar.ts";
import {Pat, Type, Term, Lens, Linear, LinearOps, FnArg, LinearCase, LinearInterp} from "./ast.ts";

export const grammar = new Grammar();

grammar.add("Pat", [
    option(
        lit("_"),
    (): Pat => ({type: "drop"})
    ),
    option(
        b("text","id"),
    ({text}: {text: Id}): Pat => ({type: "id", text: text.text})
    ),
    option(
        list("", lit("~"), b("inner","Pat")),
    ({inner}: {inner: Pat}): Pat => ({type: "lens", inner})
    ),
    option(
        list("", b("name","id"), list("(", many("args", "Pat"))),
    ({name,args}: {name: Id,args: Pat[]}): Pat => ({type: "constructor", name: name.text, args})
    ),
    option(
        list("(", many("items", "Pat")),
    ({items}: {items: Pat[]}): Pat => ({type: "tuple", items})
    )
])

grammar.add("Type", [
    option(
        b("text","id"),
    ({text}: {text: Id}): Type => ({type: "id", text: text.text})
    ),
    option(
        list("", lit("~"), b("left","Type")),
    ({left}: {left: Type}): Type => ({type: "lens", left})
    ),
    option(
        list("", b("left","Type"), lit("/"), b("right","Type")),
    ({left,right}: {left: Type,right: Type}): Type => ({type: "lens", left, right})
    ),
    option(
        list("(", many("items", "Type")),
    ({items}: {items: Type[]}): Type => ({type: "tuple", items})
    ),
    option(
        list(" ", list("(", many("args", "Type")), lit("=>"), b("body","Type")),
    ({args,body}: {args: Type[],body: Type}): Type => ({type: "fn", args, body})
    )
])

grammar.add("Term", [
    option(
        list("", lit("~"), rest("lens", "Lens")),
    ({lens}: {lens: Lens}): Term => ({type: "lens", lens})
    ),
    option(
        b("linear","Linear"),
    ({linear}: {linear: Linear}): Term => linear
    )
])

grammar.add("Lens", [
    option(
        b("text","id"),
    ({text}: {text: Id}): Lens => ({type: "id", text: text.text})
    ),
    option(
        list("", b("one","Lens")),
    ({one}: {one: Lens}): Lens => one
    ),
    option(
        list("", b("fn","Linear"), list("(", many("args", "Term"))),
    ({fn,args}: {fn: Linear,args: Term[]}): Lens => ({type: "apply", fn, args})
    ),
    option(
        list("(", many("items", "Lens")),
    ({items}: {items: Lens[]}): Lens => ({type: "tuple", items})
    ),
    option(
        list("{", b("one","Lens")),
    ({one}: {one: Lens}): Lens => one
    ),
    option(
        list("{", list(" ", lit("let"), b("pat","Pat"), lit("="), rest("value", "Term")), rest("body", "Lens")),
    ({pat,value,body}: {pat: Pat,value: Term,body: Lens}): Lens => ({type: "let", pat, value, body})
    ),
    option(
        list("{", list(" ", lit("lens"), b("pat","Pat"), lit("<-"), rest("value", "Linear")), rest("body", "Linear")),
    ({pat,value,body}: {pat: Pat,value: Linear,body: Linear}): Lens => ({type: "aslens", pat, value, body})
    )
])

grammar.add("Linear", [
    option(
        lit("true"),
    (): Linear => ({type: "const", value: true})
    ),
    option(
        lit("false"),
    (): Linear => ({type: "const", value: false})
    ),
    option(
        b("text","id"),
    ({text}: {text: Id}): Linear => ({type: "id", text: text.text})
    ),
    option(
        list("", b("one","Linear")),
    ({one}: {one: Linear}): Linear => one
    ),
    option(
        list("", b("fn","op"), rest("arg", "Linear")),
    ({fn,arg}: {fn: Id,arg: Linear}): Linear => ({type: "apply", fn, args: [arg]})
    ),
    // option(
    //     list("", b("fn","Linear"), rest("suffixes", "LinearOps")),
    // ({fn,suffixes}: {fn: Linear,suffixes: LinearOps}): Linear => ({type: "apply", fn, suffixes})
    // ),
    option(
        list("(", many("items", "Linear")),
    ({items}: {items: Linear[]}): Linear => ({type: "tuple", items})
    ),
    option(
        list("\"", b("head","id"), many("interp", "LinearInterp")),
    ({head,interp}: {head: Id,interp: LinearInterp[]}): Linear => ({type: "string", head: head.text, interp})
    ),
    option(
        list(" ", lit("match"), b("value","Linear"), list("{", many("cases", "LinearCase"))),
    ({value,cases}: {value: Linear,cases: LinearCase[]}): Linear => ({type: "case", value, cases})
    ),
    option(
        list(" ", lit("fn"), list(": ", list("", b("name","id"), list("(", many("args", "FnArg"))), b("ann","Type")), b("body","Linear")),
    ({name,args,ann,body}: {name: Id,args: FnArg[],ann: Type,body: Linear}): Linear => ({type: "fn", name: name.text, args, ann, body})
    ),
    option(
        list(" ", lit("fn"), list("", b("name","id"), list("(", many("args", "FnArg"))), b("body","Linear")),
    ({name,args,body}: {name: Id,args: FnArg[],body: Linear}): Linear => ({type: "fn", name: name.text, args, body})
    ),
    option(
        list(" ", lit("fn"), list(": ", list("(", many("args", "FnArg")), b("ann","Type")), b("body","Linear")),
    ({args,ann,body}: {args: FnArg[],ann: Type,body: Linear}): Linear => ({type: "fn", args, ann, body})
    ),
    option(
        list(" ", lit("fn"), list("(", many("args", "FnArg")), b("body","Linear")),
    ({args,body}: {args: FnArg[],body: Linear}): Linear => ({type: "fn", args, body})
    ),
    option(
        list(" ", b("lens","Lens"), lit(":="), rest("value", "Linear")),
    ({lens,value}: {lens: Lens,value: Linear}): Linear => ({type: "assign", lens, value})
    ),
    option(
        list(" ", b("one","Linear")),
    ({one}: {one: Linear}): Linear => one
    )
])

grammar.add("LinearOps", [
    option(
        list("", lit("."), b("attr","id")),
    ({attr}: {attr: Id}): LinearOps => ({type: "attr", attr: attr.text})
    ),
    option(
        list("", list("[", b("index","Linear"))),
    ({index}: {index: Linear}): LinearOps => ({type: "index", index})
    ),
    option(
        list("", list("(", many("args", "Linear"))),
    ({args}: {args: Linear[]}): LinearOps => ({type: "apply", args})
    )
])

grammar.add("FnArg", [
    option(
        b("pat","Pat"),
    ({pat}: {pat: Pat}): FnArg => ({pat})
    ),
    option(
        list(": ", b("pat","Pat"), b("typ","Type")),
    ({pat,typ}: {pat: Pat,typ: Type}): FnArg => ({pat, typ})
    )
])

grammar.add("LinearCase", [
    option(
        list(" ", b("pat","Pat"), rest("body", "Linear")),
    ({pat,body}: {pat: Pat,body: Linear}): LinearCase => ({pat, body})
    )
])

grammar.add("LinearInterp", [
    option(
        list("\"", b("value","Linear"), b("tail","id")),
    ({value,tail}: {value: Linear,tail: Id}): LinearInterp => ({value, tail: tail.text})
    )
])

    