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
        $.run((gamma1) => {
            return $.back(gamma1, 'x');
        }),
    ).toThrow();
});

it('Error 1 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:8:0', () => {
    expect(() =>
        $.run((gamma1) => {
            $.recv(gamma1, 4, 'x');
            $.recv(gamma1, $.back(gamma1, 'x'), 'y');
            return $.back(gamma1, '+')($.back(gamma1, 'x'), $.back(gamma1, 'y'));
        }),
    ).toThrow();
});

it('Error 2 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:15:0', () => {
    expect(() =>
        $.run((gamma1) => {
            $.recv(gamma1, 4, 'x');
            $.recv(gamma1, 2, 'y');
            return $.back(gamma1, 'x');
        }),
    ).toThrow();
});

it('Error 3 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:23:4', () => {
    expect(() =>
        $.run((gamma1) => {
            $.recv(
                gamma1,
                $.recv(
                    gamma1,
                    (arg0: any) =>
                        $.wrap(
                            (gamma2) => {
                                $.recv(gamma2, arg0, 'x');

                                return [
                                    $.back(gamma2, 'consume')($.back(gamma2, 'x')),
                                    $.back(gamma2, 'x'),
                                ];
                            },
                            ['x'],
                        ),
                    'use',
                ),
                $.drop,
            );
            $.recv(gamma1, 3, 'x');
            return $.tee(gamma1, $.back(gamma1, 'use')($.back(gamma1, 'x')), 'x');
        }),
    ).toThrow();
});

it('Error 4 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:32:4', () => {
    expect(() =>
        $.run((gamma1) => {
            $.recv(
                gamma1,
                $.recv(
                    gamma1,
                    (arg0: any) =>
                        $.wrap(
                            (gamma2) => {
                                $.recv(gamma2, arg0, 'a');

                                return [
                                    3,
                                    (res: any) => {
                                        $.recv(gamma2, res, 'b');
                                        $.recv(gamma2, 100, []);
                                        // assert that all values have been used (except lenscaptured)
                                        $.checkUnused(gamma2, 'a');
                                        return $.back(gamma2, 'a');
                                    },
                                ];
                            },
                            ['a'],
                        ),
                    'passer',
                ),
                $.drop,
            );
            $.recv(gamma1, 20, 'x');
            $.recv(
                gamma1,
                $.tee2(
                    gamma1,
                    $.back(gamma1, 'passer')($.back(gamma1, 'x')),
                    (tmp0) => {
                        $.recv(gamma1, $.back(gamma1, tmp0), 'v');
                        $.recv(
                            gamma1,
                            $.back(gamma1, 'log')(`v from passer`, $.recv(gamma1, 10, 'v')),
                            $.drop,
                        );
                        const res1 = 4;
                        $.recv(gamma1, $.back(gamma1, 'v'), tmp0);
                        return res1;
                    },
                    'x',
                ),
                'res',
            );
            return [$.back(gamma1, 'res'), $.back(gamma1, 'x')];
        }),
    ).toThrow();
});

it('Error 5 at /Users/jared/clone/exploration/laminar/ts/test/basic.errors.fl:49:4', () => {
    expect(() =>
        $.run((gamma1) => {
            $.recv(
                gamma1,
                $.recv(
                    gamma1,
                    (arg0: any) =>
                        $.wrap(
                            (gamma2) => {
                                $.recv(gamma2, arg0, 'a');

                                return [
                                    3,
                                    (res: any) => {
                                        $.recv(gamma2, res, 'b');
                                        $.recv(gamma2, $.back(gamma2, 'log')(`Hello`, 2), []);
                                        // assert that all values have been used (except lenscaptured)
                                        $.checkUnused(gamma2, 'a');
                                        return $.back(gamma2, 'a');
                                    },
                                ];
                            },
                            ['a'],
                        ),
                    'passer',
                ),
                $.drop,
            );
            $.recv(gamma1, 20, 'x');
            $.recv(
                gamma1,
                $.tee2(
                    gamma1,
                    $.back(gamma1, 'passer')($.back(gamma1, 'x')),
                    (tmp0) => {
                        $.recv(gamma1, $.back(gamma1, tmp0), 'v');
                        $.recv(
                            gamma1,
                            $.back(gamma1, 'log')(`v from passer`, $.recv(gamma1, 10, 'v')),
                            $.drop,
                        );
                        const res1 = 4;
                        $.recv(gamma1, $.back(gamma1, 'v'), tmp0);
                        return res1;
                    },
                    'x',
                ),
                'res',
            );
            return [$.back(gamma1, 'res'), $.back(gamma1, 'x')];
        }),
    ).toThrow();
});
