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
$.addFn('inc', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'c');

            return [
                $.recv(gamma2, $.back(gamma2, '+')($.back(gamma2, 'c'), 1), 'c'),
                $.back(gamma2, 'c'),
            ];
        },
        ['c'],
    ),
);

$.addFn('fst', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, ['x', 'y']);

            return [
                $.back(gamma2, 'x'),
                (recv: any) => {
                    $.recv(gamma2, recv, 'x');
                    return $.back(gamma2, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);

$.addFn('incFst', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'x');

            return [
                $.tee2(
                    gamma2,
                    $.back(gamma2, 'fst')($.back(gamma2, 'x')),
                    (tmp0) => {
                        return $.tee(gamma2, $.back(gamma2, 'inc')($.back(gamma2, tmp0)), tmp0);
                    },
                    'x',
                ),
                $.back(gamma2, 'x'),
            ];
        },
        ['x'],
    ),
);

$.addFn('idf', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'x');

            return [[], $.back(gamma2, 'x')];
        },
        ['x'],
    ),
);

$.addFn('idl', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'x');

            return [
                $.back(gamma2, 'x'),
                (recv: any) => {
                    $.recv(gamma2, recv, 'x');
                    return $.back(gamma2, 'x');
                },
            ];
        },
        ['x'],
    ),
);

$.addFn('united', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'x');

            return [
                [],
                (recv: any) => {
                    $.recv(gamma2, recv, []);
                    return $.back(gamma2, 'x');
                },
            ];
        },
        ['x'],
    ),
);

$.addFn('makeunit', (arg0: any) =>
    $.wrap((gamma2) => {
        $.recv(gamma2, arg0, []);

        return [
            [],
            (recv: any) => {
                $.recv(gamma2, recv, []);
                return null; // this should be right I think
            },
        ];
    }, []),
);

it('Item 0 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:4:4', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 10, $.drop);
        $.recv(gamma1, $.back(gamma1, 'log'), $.drop);
        $.recv(gamma1, true, $.drop);
        $.recv(gamma1, `one`, $.drop);
        $.recv(gamma1, $.back(gamma1, 'log')(`Hello`, 3), $.drop);
        return `One${10}`;
    });
    expect(result).toEqual([[`Hello`, 3], `One10`]);
});

it('Item 1 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:15:4', () => {
    const result = $.run((gamma1) => {
        return $.back(gamma1, '+')(2, 2);
    });
    expect(result).toEqual(4);
});

it('Item 2 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:20:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        return $.back(gamma1, '+')($.back(gamma1, 'x'), 4);
    });
    expect(result).toEqual(6);
});

it('Item 3 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:33:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(gamma1, $.recv(gamma1, 3, 'x'), 'm');
        return $.back(gamma1, '+')($.back(gamma1, 'x'), $.back(gamma1, 'm'));
    });
    expect(result).toEqual(5);
});

it('Item 4 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:41:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(gamma1, $.recv(gamma1, 3, 'x'), $.drop);
        return $.back(gamma1, '+')($.back(gamma1, 'x'), 2);
    });
    expect(result).toEqual(5);
});

it('Item 5 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:49:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], ['x', 'y']);
        return $.back(gamma1, '+')($.back(gamma1, 'x'), $.back(gamma1, 'y'));
    });
    expect(result).toEqual(3);
});

it('Item 6 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:56:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], ['x', 'y']);
        $.recv(gamma1, $.recv(gamma1, 4, 'x'), $.drop);
        return $.back(gamma1, '+')($.back(gamma1, 'x'), $.back(gamma1, 'y'));
    });
    expect(result).toEqual(6);
});

it('Item 7 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:64:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], ['x', 'y']);
        $.recv(gamma1, $.recv(gamma1, $.recv(gamma1, $.back(gamma1, 'x'), 'y'), 'x'), $.drop);
        return $.back(gamma1, '+')(
            $.back(gamma1, 'x'),
            $.back(gamma1, '*')($.back(gamma1, 'y'), 5),
        );
    });
    expect(result).toEqual(7);
});

it('Item 8 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:72:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], ['x', 'y']);
        return [$.recv(gamma1, [4, 5], ['x', 'y']), [$.back(gamma1, 'x'), $.back(gamma1, 'y')]];
    });
    expect(result).toEqual([
        [1, 2],
        [4, 5],
    ]);
});

it('Item 9 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:80:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap((gamma2) => {
                        $.recv(gamma2, arg0, 'x');

                        return $.back(gamma2, '+')($.back(gamma2, 'x'), 2);
                    }, []),
                'go',
            ),
            $.drop,
        );
        return $.back(gamma1, 'go')(4);
    });
    expect(result).toEqual(6);
});

it('Item 10 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:87:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, 'm');

                            return [
                                $.recv(gamma2, $.back(gamma2, '+')($.back(gamma2, 'm'), 10), 'm'),
                                $.back(gamma2, 'm'),
                            ];
                        },
                        ['m'],
                    ),
                'inc',
            ),
            $.drop,
        );
        $.recv(gamma1, 5, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(15);
});

it('Item 11 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:97:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap((gamma2) => {
                        $.recv(gamma2, arg0, 'n');

                        $.recv(gamma2, 5, 'm');
                        return $.back(gamma2, '+')($.back(gamma2, 'n'), $.back(gamma2, 'm'));
                    }, []),
                'hello',
            ),
            $.drop,
        );
        return $.back(gamma1, 'hello')(3);
    });
    expect(result).toEqual(8);
});

it('Item 12 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:107:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma2, $.back(gamma2, '+')($.back(gamma2, 'a'), 10), 'a'),
                                $.back(gamma2, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'inc2',
            ),
            $.drop,
        );
        $.recv(gamma1, 5, 'x');
        $.recv(gamma1, 3, 'y');
        $.recv(
            gamma1,
            $.tee(gamma1, $.back(gamma1, 'inc2')($.back(gamma1, ['x', 'y'])), ['x', 'y']),
            $.drop,
        );
        return $.back(gamma1, '+')($.back(gamma1, 'x'), $.back(gamma1, 'y'));
    });
    expect(result).toEqual(18);
});

it('Item 13 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:117:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma2, $.recv(gamma2, $.back(gamma2, 'a'), 'b'), 'a'),
                                $.back(gamma2, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma1, 1, 'x');
        $.recv(gamma1, 5, 'y');
        $.recv(
            gamma1,
            $.tee(gamma1, $.back(gamma1, 'swap')($.back(gamma1, ['x', 'y'])), ['x', 'y']),
            $.drop,
        );
        return $.back(gamma1, '+')(
            $.back(gamma1, '*')($.back(gamma1, 'x'), 5),
            $.back(gamma1, 'y'),
        );
    });
    expect(result).toEqual(26);
});

it('Item 14 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:127:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma2, $.recv(gamma2, $.back(gamma2, 'a'), 'b'), 'a'),
                                $.back(gamma2, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, 5], 'two');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'swap')($.back(gamma1, 'two')), 'two'), $.drop);
        $.recv(gamma1, $.back(gamma1, 'two'), ['x', 'y']);
        return $.back(gamma1, '+')(
            $.back(gamma1, '*')($.back(gamma1, 'x'), 5),
            $.back(gamma1, 'y'),
        );
    });
    expect(result).toEqual(26);
});

it('Item 15 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:137:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.recv(
                                    gamma2,
                                    [$.back(gamma2, 'b'), $.back(gamma2, 'a')],
                                    ['a', 'b'],
                                ),
                                $.back(gamma2, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, 5], 'two');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'swap')($.back(gamma1, 'two')), 'two'), $.drop);
        $.recv(gamma1, $.back(gamma1, 'two'), ['x', 'y']);
        return $.back(gamma1, '+')(
            $.back(gamma1, '*')($.back(gamma1, 'x'), 5),
            $.back(gamma1, 'y'),
        );
    });
    expect(result).toEqual(26);
});

it('Item 16 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:147:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'a'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'a');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, 10], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, 'x')),
                (tmp0) => {
                    return $.recv(gamma1, 5, tmp0);
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma1, 'x'), $.back(gamma1, 'z')];
    });
    expect(result).toEqual([[5, 10], 1]);
});

it('Item 17 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:156:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'a'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'a');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, 10], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, 'x')),
                (tmp0) => {
                    return $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([2, 10]);
});

it('Item 18 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:165:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'a'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'a');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'b'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'b');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'snd',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, [10, 5]], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'snd')($.back(gamma1, 'x')),
                (tmp1) => {
                    return $.tee2(
                        gamma1,
                        $.back(gamma1, 'fst')($.back(gamma1, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([1, [11, 5]]);
});

it('Item 19 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:175:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'a'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'a');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'b'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'b');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'snd',
            ),
            $.drop,
        );
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, 'c');

                            return [
                                $.recv(gamma2, $.back(gamma2, '*')($.back(gamma2, 'c'), 10), 'c'),
                                $.back(gamma2, 'c'),
                            ];
                        },
                        ['c'],
                    ),
                'mul',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, 2], 'x');
        $.recv(gamma1, [3, 4], 'y');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, ['x', 'y'])),
                (tmp1) => {
                    return $.tee2(
                        gamma1,
                        $.back(gamma1, 'snd')($.back(gamma1, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma1, $.back(gamma1, 'mul')($.back(gamma1, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                ['x', 'y'],
            ),
            $.drop,
        );
        return [$.back(gamma1, 'x'), $.back(gamma1, 'y')];
    });
    expect(result).toEqual([
        [1, 20],
        [3, 4],
    ]);
});

it('Item 20 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:187:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'a'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'a');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, ['a', 'b']);

                            return [
                                $.back(gamma2, 'b'),
                                (recv: any) => {
                                    $.recv(gamma2, recv, 'b');
                                    return $.back(gamma2, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'snd',
            ),
            $.drop,
        );
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, 'c');

                            return [
                                $.recv(gamma2, $.back(gamma2, '*')($.back(gamma2, 'c'), 10), 'c'),
                                $.back(gamma2, 'c'),
                            ];
                        },
                        ['c'],
                    ),
                'mul',
            ),
            $.drop,
        );
        $.recv(gamma1, [1, 2], 'x');
        $.recv(gamma1, [3, 4], 'y');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, 'y')),
                (tmp1) => {
                    return $.tee2(
                        gamma1,
                        $.back(gamma1, 'snd')($.back(gamma1, ['x', tmp1])),
                        (tmp0) => {
                            return $.tee(gamma1, $.back(gamma1, 'mul')($.back(gamma1, tmp0)), tmp0);
                        },
                        ['x', tmp1],
                    );
                },
                'y',
            ),
            $.drop,
        );
        return [$.back(gamma1, 'x'), $.back(gamma1, 'y')];
    });
    expect(result).toEqual([
        [1, 2],
        [30, 4],
    ]);
});

it('Item 21 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:198:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 5, 'a');
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (
                    (outer0) => (arg0: any) =>
                        $.wrap(
                            (gamma2) => {
                                $.recv(gamma2, arg0, 'x');

                                return $.back(gamma2, '+')(
                                    $.back(gamma2, 'x'),
                                    $.back(gamma2, 'a'),
                                );
                            },
                            [],
                            outer0,
                        )
                )({ a: $.back(gamma1, 'a') }),
                'captures',
            ),
            $.drop,
        );
        $.recv(gamma1, $.recv(gamma1, 2, 'a'), $.drop);
        return [$.back(gamma1, 'a'), $.back(gamma1, 'captures')(4)];
    });
    expect(result).toEqual([2, 9]);
});

it('Item 22 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:223:0', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            (() => {
                $.recv(gamma1, 2, 'y');
                return $.back(gamma1, '+')($.back(gamma1, 'y'), 3);
            })(),
            'x',
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(5);
});

it('Item 23 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:235:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, 'x');

                            $.recv(gamma2, $.back(gamma2, 'x'), 'y');
                            const res0 = $.recv(gamma2, 5, 'y');
                            $.recv(gamma2, $.back(gamma2, 'y'), 'x');
                            return [res0, $.back(gamma2, 'x')];
                        },
                        ['x'],
                    ),
                'alias',
            ),
            $.drop,
        );
        $.recv(gamma1, 2, 'x');
        return [
            $.tee(gamma1, $.back(gamma1, 'alias')($.back(gamma1, 'x')), 'x'),
            $.back(gamma1, 'x'),
        ];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 24 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:245:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            (() => {
                $.recv(gamma1, $.back(gamma1, 'x'), 'y');
                const res0 = $.recv(gamma1, 5, 'y');
                $.recv(gamma1, $.back(gamma1, 'y'), 'x');
                return res0;
            })(),
            'z',
        );
        return [$.back(gamma1, 'z'), $.back(gamma1, 'x')];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 25 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:257:4', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, $.back(gamma1, 'consume')(2), $.drop);
        return 4;
    });
    expect(result).toEqual([2, 4]);
});

it('Item 26 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:263:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            (() => {
                $.recv(gamma1, $.back(gamma1, 'x'), 'y');
                const res0 = $.recv(gamma1, 4, 'y');
                $.recv(gamma1, $.back(gamma1, 'y'), 'x');
                return res0;
            })(),
            'm',
        );
        return [$.back(gamma1, 'm'), $.back(gamma1, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 27 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:275:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap((gamma2) => {
                        $.recv(gamma2, arg0, 'a');

                        return [
                            $.back(gamma2, 'a'),
                            (res: any) => {
                                $.recv(gamma2, res, 'b');
                                $.recv(gamma2, $.back(gamma2, 'consume')($.back(gamma2, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma2, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            $.drop,
        );
        $.recv(gamma1, $.back(gamma1, 'consume')(1), $.drop);
        return $.tee2(
            gamma1,
            $.back(gamma1, 'dropper')(5),
            (tmp0) => {
                $.recv(gamma1, $.back(gamma1, tmp0), 'v');
                $.recv(gamma1, $.back(gamma1, 'consume')(2), $.drop);
                $.recv(gamma1, $.back(gamma1, 'consume')($.recv(gamma1, 10, 'v')), $.drop);
                $.recv(gamma1, $.back(gamma1, 'consume')(3), $.drop);
                const res1 = 4;
                $.recv(gamma1, $.back(gamma1, 'v'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual([[1, 2, 5, 3, 10], 4]);
});

it('Item 28 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:291:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap((gamma2) => {
                        $.recv(gamma2, arg0, 'a');

                        return [
                            $.back(gamma2, 'a'),
                            (res: any) => {
                                $.recv(gamma2, res, 'b');
                                $.recv(gamma2, $.back(gamma2, 'consume')($.back(gamma2, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma2, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            $.drop,
        );
        $.recv(gamma1, $.back(gamma1, 'consume')(1), $.drop);
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'dropper')(5),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'v');
                    $.recv(gamma1, $.back(gamma1, 'consume')($.recv(gamma1, 10, 'v')), $.drop);
                    const res1 = 4;
                    $.recv(gamma1, $.back(gamma1, 'v'), tmp0);
                    return res1;
                },
                [],
            ),
            'res',
        );
        $.recv(gamma1, $.back(gamma1, 'consume')(3), $.drop);
        return $.back(gamma1, 'res');
    });
    expect(result).toEqual([[1, 5, 10, 3], 4]);
});

it('Item 29 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:323:4', () => {
    const result = $.run((gamma1) => {
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
                                    $.recv(
                                        gamma2,
                                        $.back(gamma2, 'log')(`Hello`, $.back(gamma2, 'b')),
                                        [],
                                    );
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
    });
    expect(result).toEqual([
        [
            [`v from passer`, 3],
            [`Hello`, 10],
        ],
        [4, 20],
    ]);
});

it('Item 30 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:343:4', () => {
    const result = $.run((gamma1) => {
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
                                    $.recv(
                                        gamma2,
                                        $.back(gamma2, 'log')(
                                            `Prev a`,
                                            $.recv(gamma2, $.back(gamma2, 'b'), 'a'),
                                        ),
                                        [],
                                    );
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
    });
    expect(result).toEqual([
        [
            [`v from passer`, 3],
            [`Prev a`, 20],
        ],
        [4, 10],
    ]);
});

it('Item 31 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:391:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any) =>
                    $.wrap(
                        (gamma2) => {
                            $.recv(gamma2, arg0, 'x');

                            $.recv(gamma2, $.back(gamma2, 'x'), ['a', 'b']);
                            $.recv(
                                gamma2,
                                $.tee(gamma2, $.back(gamma2, 'inc')($.back(gamma2, 'a')), 'a'),
                                $.drop,
                            );
                            const res0 = 2;
                            $.recv(gamma2, $.back(gamma2, ['a', 'b']), 'x');
                            return [res0, $.back(gamma2, 'x')];
                        },
                        ['x'],
                    ),
                'incfst',
            ),
            $.drop,
        );
        $.recv(gamma1, [4, 10], 'm');
        return [
            $.tee(gamma1, $.back(gamma1, 'incfst')($.back(gamma1, 'm')), 'm'),
            $.back(gamma1, 'm'),
        ];
    });
    expect(result).toEqual([2, [5, 10]]);
});

it('Item 32 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:406:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 3, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(4);
});

it('Item 33 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:416:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 4], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, 'x')),
                (tmp0) => {
                    return $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 34 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:426:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 4], 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'incFst')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 35 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:436:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'idf')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 36 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:446:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'idl')($.back(gamma1, 'x')),
                (tmp0) => {
                    return $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(3);
});

it('Item 37 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:456:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'united')($.back(gamma1, 'x')),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'l');
                    const res1 = 1;
                    $.recv(gamma1, $.back(gamma1, 'l'), tmp0);
                    return res1;
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 38 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:469:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        return $.tee2(
            gamma1,
            $.back(gamma1, 'makeunit')([]),
            (tmp0) => {
                $.recv(gamma1, $.back(gamma1, tmp0), 'l');
                const res1 = $.back(gamma1, 'x');
                $.recv(gamma1, $.back(gamma1, 'l'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(2);
});
