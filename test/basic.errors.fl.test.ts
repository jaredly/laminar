
import assert from "assert";
import * as $ from "./runtime.ts";
import {it} from "node:test";

const expect = (m:any) => ({
    toThrow() {assert.throws(m)},
    toEqual(n:any) { assert.deepStrictEqual(m, n) }
})


it("Error 0 at test/errors.fl:4:4", () => {
    expect(() => $.run((gamma) => {
return $.get(gamma, "x")
})).toThrow();
})

it("Error 1 at test/errors.fl:8:0", () => {
    expect(() => $.run((gamma) => {
$.recv(gamma, 4, "x");
$.recv(gamma, $.get(gamma, "x"), "y");
return $.get(gamma, "+")($.get(gamma, "x"), $.get(gamma, "y"))
})).toThrow();
})

it("Error 2 at test/errors.fl:15:0", () => {
    expect(() => $.run((gamma) => {
$.recv(gamma, 4, "x");
$.recv(gamma, 2, "y");
return $.get(gamma, "x")
})).toThrow();
})

it("Error 3 at test/errors.fl:23:4", () => {
    expect(() => $.run((gamma) => {
$.recv(gamma, $.recv(gamma, (arg: any) => $.wrap((gamma) => {
    $.recv(gamma, arg, "x");
    return [$.get(gamma, "consume")($.get(gamma, "x")), $.back(gamma, "x")]
}, "x"), "use"), $.drop);
$.recv(gamma, 3, "x");
return $.tee(gamma, $.get(gamma, "use")($.back(gamma, "x")), "x")
})).toThrow();
})

it("Error 4 at test/errors.fl:32:4", () => {
    expect(() => $.run((gamma) => {
$.recv(gamma, $.recv(gamma, (arg: any) => $.wrap((gamma) => {
    $.recv(gamma, arg, "a");
    return [3, (res: any) => {
                        $.recv(gamma, res, "b");
                        $.recv(gamma, 100, []);
                        // assert that all values have been used (except lenscaptured)
                        $.checkUnused(gamma, "a");
                        return $.back(gamma, "a");
                    }];
}, "a"), "passer"), $.drop);
$.recv(gamma, 20, "x");
$.recv(gamma, $.tee2(gamma, $.get(gamma, "passer")($.back(gamma, "x")), tmp0 => {$.recv(gamma, $.back(gamma, tmp0), "v");
$.recv(gamma, $.get(gamma, "log")(`v from passer`, $.recv(gamma, 10, "v")), $.drop);
const res1 = 4;
$.recv(gamma, $.back(gamma, "v"), tmp0)
return res1}, "x"), "res");
return [$.get(gamma, "res"), $.get(gamma, "x")]
})).toThrow();
})

it("Error 5 at test/errors.fl:49:4", () => {
    expect(() => $.run((gamma) => {
$.recv(gamma, $.recv(gamma, (arg: any) => $.wrap((gamma) => {
    $.recv(gamma, arg, "a");
    return [3, (res: any) => {
                        $.recv(gamma, res, "b");
                        $.recv(gamma, $.get(gamma, "log")(`Hello`, 2), []);
                        // assert that all values have been used (except lenscaptured)
                        $.checkUnused(gamma, "a");
                        return $.back(gamma, "a");
                    }];
}, "a"), "passer"), $.drop);
$.recv(gamma, 20, "x");
$.recv(gamma, $.tee2(gamma, $.get(gamma, "passer")($.back(gamma, "x")), tmp0 => {$.recv(gamma, $.back(gamma, tmp0), "v");
$.recv(gamma, $.get(gamma, "log")(`v from passer`, $.recv(gamma, 10, "v")), $.drop);
const res1 = 4;
$.recv(gamma, $.back(gamma, "v"), tmp0)
return res1}, "x"), "res");
return [$.get(gamma, "res"), $.get(gamma, "x")]
})).toThrow();
})
