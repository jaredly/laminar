import assert from 'assert';
import * as $ from './runtime.ts';
import { it } from 'node:test';

const expect = (m: any) => ({
    toThrow() {
        assert.throws(m);
    },
    toEqual(n: any) {
        assert.deepStrictEqual(m, n);
    },
});

it('Error 0 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:4:4', () => {
    expect(() =>
        $.run((gamma0) => {
            return $.back(gamma0, 'x');
        }),
    ).toThrow();
});

it('Error 1 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:8:0', () => {
    expect(() =>
        $.run((gamma0) => {
            $.recv(gamma0, 4, 'x');
            $.recv(gamma0, $.back(gamma0, 'x'), 'y');
            return $.back(gamma0, '+')($.back(gamma0, 'x'), $.back(gamma0, 'y'));
        }),
    ).toThrow();
});

it('Error 2 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:15:0', () => {
    expect(() =>
        $.run((gamma0) => {
            $.recv(gamma0, 4, 'x');
            $.recv(gamma0, 2, 'y');
            return $.back(gamma0, 'x');
        }),
    ).toThrow();
});

it('Error 3 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:23:4', () => {
    expect(() =>
        $.run((gamma0) => {
            $.recv(
                gamma0,
                $.recv(
                    gamma0,
                    (arg0: any) =>
                        $.wrap((gamma1) => {
                            $.recv(gamma1, arg0, 'x');

                            return [
                                $.back(gamma1, 'consume')($.back(gamma1, 'x')),
                                $.back(gamma1, 'x'),
                            ];
                        }, 'x'),
                    'use',
                ),
                $.drop,
            );
            $.recv(gamma0, 3, 'x');
            return $.tee(gamma0, $.back(gamma0, 'use')($.back(gamma0, 'x')), 'x');
        }),
    ).toThrow();
});

it('Error 4 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:32:4', () => {
    expect(() =>
        $.run((gamma0) => {
            $.recv(
                gamma0,
                $.recv(
                    gamma0,
                    (arg0: any) =>
                        $.wrap((gamma1) => {
                            $.recv(gamma1, arg0, 'a');

                            return [
                                3,
                                (res: any) => {
                                    $.recv(gamma1, res, 'b');
                                    $.recv(gamma1, 100, []);
                                    // assert that all values have been used (except lenscaptured)
                                    $.checkUnused(gamma1, 'a');
                                    return $.back(gamma1, 'a');
                                },
                            ];
                        }, 'a'),
                    'passer',
                ),
                $.drop,
            );
            $.recv(gamma0, 20, 'x');
            $.recv(
                gamma0,
                $.tee2(
                    gamma0,
                    $.back(gamma0, 'passer')($.back(gamma0, 'x')),
                    (tmp0) => {
                        $.recv(gamma0, $.back(gamma0, tmp0), 'v');
                        $.recv(
                            gamma0,
                            $.back(gamma0, 'log')(`v from passer`, $.recv(gamma0, 10, 'v')),
                            $.drop,
                        );
                        const res1 = 4;
                        $.recv(gamma0, $.back(gamma0, 'v'), tmp0);
                        return res1;
                    },
                    'x',
                ),
                'res',
            );
            return [$.back(gamma0, 'res'), $.back(gamma0, 'x')];
        }),
    ).toThrow();
});

it('Error 5 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:49:4', () => {
    expect(() =>
        $.run((gamma0) => {
            $.recv(
                gamma0,
                $.recv(
                    gamma0,
                    (arg0: any) =>
                        $.wrap((gamma1) => {
                            $.recv(gamma1, arg0, 'a');

                            return [
                                3,
                                (res: any) => {
                                    $.recv(gamma1, res, 'b');
                                    $.recv(gamma1, $.back(gamma1, 'log')(`Hello`, 2), []);
                                    // assert that all values have been used (except lenscaptured)
                                    $.checkUnused(gamma1, 'a');
                                    return $.back(gamma1, 'a');
                                },
                            ];
                        }, 'a'),
                    'passer',
                ),
                $.drop,
            );
            $.recv(gamma0, 20, 'x');
            $.recv(
                gamma0,
                $.tee2(
                    gamma0,
                    $.back(gamma0, 'passer')($.back(gamma0, 'x')),
                    (tmp0) => {
                        $.recv(gamma0, $.back(gamma0, tmp0), 'v');
                        $.recv(
                            gamma0,
                            $.back(gamma0, 'log')(`v from passer`, $.recv(gamma0, 10, 'v')),
                            $.drop,
                        );
                        const res1 = 4;
                        $.recv(gamma0, $.back(gamma0, 'v'), tmp0);
                        return res1;
                    },
                    'x',
                ),
                'res',
            );
            return [$.back(gamma0, 'res'), $.back(gamma0, 'x')];
        }),
    ).toThrow();
});
