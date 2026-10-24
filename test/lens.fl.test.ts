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
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'c');

        return [
            $.recv(gamma1, $.back(gamma1, '+')($.back(gamma1, 'c'), 1), 'c'),
            $.back(gamma1, 'c'),
        ];
    }, 'c'),
);

$.addFn('fst', (arg0: any) =>
    $.wrap(
        (gamma1) => {
            $.recv(gamma1, arg0, ['x', 'y']);

            return [
                $.back(gamma1, 'x'),
                (recv: any) => {
                    $.recv(gamma1, recv, 'x');
                    return $.back(gamma1, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);

$.addFn('incFst', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'x');

        return [
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, 'x')),
                (tmp0) => {
                    return $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, tmp0)), tmp0);
                },
                'x',
            ),
            $.back(gamma1, 'x'),
        ];
    }, 'x'),
);

$.addFn('idf', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'x');

        return [[], $.back(gamma1, 'x')];
    }, 'x'),
);

$.addFn('idl', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'x');

        return [
            $.back(gamma1, 'x'),
            (recv: any) => {
                $.recv(gamma1, recv, 'x');
                return $.back(gamma1, 'x');
            },
        ];
    }, 'x'),
);

$.addFn('united', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'x');

        return [
            [],
            (recv: any) => {
                $.recv(gamma1, recv, []);
                return $.back(gamma1, 'x');
            },
        ];
    }, 'x'),
);

$.addFn('makeunit', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, []);

        return [
            [],
            (recv: any) => {
                $.recv(gamma1, recv, []);
                return null; // this should be right I think
            },
        ];
    }, []),
);

it('Item 0 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:4:4', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 10, $.drop);
        $.recv(gamma0, $.back(gamma0, 'log'), $.drop);
        $.recv(gamma0, true, $.drop);
        $.recv(gamma0, `one`, $.drop);
        $.recv(gamma0, $.back(gamma0, 'log')(`Hello`, 3), $.drop);
        return `One${10}`;
    });
    expect(result).toEqual([[`Hello`, 3], `One10`]);
});

it('Item 1 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:15:4', () => {
    const result = $.run((gamma0) => {
        return $.back(gamma0, '+')(2, 2);
    });
    expect(result).toEqual(4);
});

it('Item 2 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:20:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        return $.back(gamma0, '+')($.back(gamma0, 'x'), 4);
    });
    expect(result).toEqual(6);
});

it('Item 3 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:33:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(gamma0, $.recv(gamma0, 3, 'x'), 'm');
        return $.back(gamma0, '+')($.back(gamma0, 'x'), $.back(gamma0, 'm'));
    });
    expect(result).toEqual(5);
});

it('Item 4 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:41:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(gamma0, $.recv(gamma0, 3, 'x'), $.drop);
        return $.back(gamma0, '+')($.back(gamma0, 'x'), 2);
    });
    expect(result).toEqual(5);
});

it('Item 5 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:49:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], ['x', 'y']);
        return $.back(gamma0, '+')($.back(gamma0, 'x'), $.back(gamma0, 'y'));
    });
    expect(result).toEqual(3);
});

it('Item 6 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:56:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], ['x', 'y']);
        $.recv(gamma0, $.recv(gamma0, 4, 'x'), $.drop);
        return $.back(gamma0, '+')($.back(gamma0, 'x'), $.back(gamma0, 'y'));
    });
    expect(result).toEqual(6);
});

it('Item 7 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:64:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], ['x', 'y']);
        $.recv(gamma0, $.recv(gamma0, $.recv(gamma0, $.back(gamma0, 'x'), 'y'), 'x'), $.drop);
        return $.back(gamma0, '+')(
            $.back(gamma0, 'x'),
            $.back(gamma0, '*')($.back(gamma0, 'y'), 5),
        );
    });
    expect(result).toEqual(7);
});

it('Item 8 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:72:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], ['x', 'y']);
        return [$.recv(gamma0, [4, 5], ['x', 'y']), [$.back(gamma0, 'x'), $.back(gamma0, 'y')]];
    });
    expect(result).toEqual([
        [1, 2],
        [4, 5],
    ]);
});

it('Item 9 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:80:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'x');

                        return $.back(gamma1, '+')($.back(gamma1, 'x'), 2);
                    }, []),
                'go',
            ),
            $.drop,
        );
        return $.back(gamma0, 'go')(4);
    });
    expect(result).toEqual(6);
});

it('Item 10 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:87:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'm');

                        return [
                            $.recv(gamma1, $.back(gamma1, '+')($.back(gamma1, 'm'), 10), 'm'),
                            $.back(gamma1, 'm'),
                        ];
                    }, 'm'),
                'inc',
            ),
            $.drop,
        );
        $.recv(gamma0, 5, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(15);
});

it('Item 11 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:97:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'n');

                        $.recv(gamma1, 5, 'm');
                        return $.back(gamma1, '+')($.back(gamma1, 'n'), $.back(gamma1, 'm'));
                    }, []),
                'hello',
            ),
            $.drop,
        );
        return $.back(gamma0, 'hello')(3);
    });
    expect(result).toEqual(8);
});

it('Item 12 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:107:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma1, $.back(gamma1, '+')($.back(gamma1, 'a'), 10), 'a'),
                                $.back(gamma1, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'inc2',
            ),
            $.drop,
        );
        $.recv(gamma0, 5, 'x');
        $.recv(gamma0, 3, 'y');
        $.recv(
            gamma0,
            $.tee(gamma0, $.back(gamma0, 'inc2')($.back(gamma0, ['x', 'y'])), ['x', 'y']),
            $.drop,
        );
        return $.back(gamma0, '+')($.back(gamma0, 'x'), $.back(gamma0, 'y'));
    });
    expect(result).toEqual(18);
});

it('Item 13 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:117:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma1, $.recv(gamma1, $.back(gamma1, 'a'), 'b'), 'a'),
                                $.back(gamma1, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma0, 1, 'x');
        $.recv(gamma0, 5, 'y');
        $.recv(
            gamma0,
            $.tee(gamma0, $.back(gamma0, 'swap')($.back(gamma0, ['x', 'y'])), ['x', 'y']),
            $.drop,
        );
        return $.back(gamma0, '+')(
            $.back(gamma0, '*')($.back(gamma0, 'x'), 5),
            $.back(gamma0, 'y'),
        );
    });
    expect(result).toEqual(26);
});

it('Item 14 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:127:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma1, $.recv(gamma1, $.back(gamma1, 'a'), 'b'), 'a'),
                                $.back(gamma1, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, 5], 'two');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'swap')($.back(gamma0, 'two')), 'two'), $.drop);
        $.recv(gamma0, $.back(gamma0, 'two'), ['x', 'y']);
        return $.back(gamma0, '+')(
            $.back(gamma0, '*')($.back(gamma0, 'x'), 5),
            $.back(gamma0, 'y'),
        );
    });
    expect(result).toEqual(26);
});

it('Item 15 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:137:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.recv(
                                    gamma1,
                                    [$.back(gamma1, 'b'), $.back(gamma1, 'a')],
                                    ['a', 'b'],
                                ),
                                $.back(gamma1, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, 5], 'two');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'swap')($.back(gamma0, 'two')), 'two'), $.drop);
        $.recv(gamma0, $.back(gamma0, 'two'), ['x', 'y']);
        return $.back(gamma0, '+')(
            $.back(gamma0, '*')($.back(gamma0, 'x'), 5),
            $.back(gamma0, 'y'),
        );
    });
    expect(result).toEqual(26);
});

it('Item 16 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:147:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'a'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'a');
                                    return $.back(gamma1, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, 10], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'fst')($.back(gamma0, 'x')),
                (tmp0) => {
                    return $.recv(gamma0, 5, tmp0);
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma0, 'x'), $.back(gamma0, 'z')];
    });
    expect(result).toEqual([[5, 10], 1]);
});

it('Item 17 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:156:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'a'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'a');
                                    return $.back(gamma1, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, 10], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'fst')($.back(gamma0, 'x')),
                (tmp0) => {
                    return $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([2, 10]);
});

it('Item 18 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:165:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'a'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'a');
                                    return $.back(gamma1, ['a', 'b']);
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
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'b'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'b');
                                    return $.back(gamma1, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'snd',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, [10, 5]], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'snd')($.back(gamma0, 'x')),
                (tmp1) => {
                    return $.tee2(
                        gamma0,
                        $.back(gamma0, 'fst')($.back(gamma0, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([1, [11, 5]]);
});

it('Item 19 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:175:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'a'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'a');
                                    return $.back(gamma1, ['a', 'b']);
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
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'b'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'b');
                                    return $.back(gamma1, ['a', 'b']);
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
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'c');

                        return [
                            $.recv(gamma1, $.back(gamma1, '*')($.back(gamma1, 'c'), 10), 'c'),
                            $.back(gamma1, 'c'),
                        ];
                    }, 'c'),
                'mul',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, 2], 'x');
        $.recv(gamma0, [3, 4], 'y');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'fst')($.back(gamma0, ['x', 'y'])),
                (tmp1) => {
                    return $.tee2(
                        gamma0,
                        $.back(gamma0, 'snd')($.back(gamma0, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma0, $.back(gamma0, 'mul')($.back(gamma0, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                ['x', 'y'],
            ),
            $.drop,
        );
        return [$.back(gamma0, 'x'), $.back(gamma0, 'y')];
    });
    expect(result).toEqual([
        [1, 20],
        [3, 4],
    ]);
});

it('Item 20 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:187:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'a'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'a');
                                    return $.back(gamma1, ['a', 'b']);
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
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap(
                        (gamma1) => {
                            $.recv(gamma1, arg0, ['a', 'b']);

                            return [
                                $.back(gamma1, 'b'),
                                (recv: any) => {
                                    $.recv(gamma1, recv, 'b');
                                    return $.back(gamma1, ['a', 'b']);
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
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'c');

                        return [
                            $.recv(gamma1, $.back(gamma1, '*')($.back(gamma1, 'c'), 10), 'c'),
                            $.back(gamma1, 'c'),
                        ];
                    }, 'c'),
                'mul',
            ),
            $.drop,
        );
        $.recv(gamma0, [1, 2], 'x');
        $.recv(gamma0, [3, 4], 'y');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'fst')($.back(gamma0, 'y')),
                (tmp1) => {
                    return $.tee2(
                        gamma0,
                        $.back(gamma0, 'snd')($.back(gamma0, ['x', tmp1])),
                        (tmp0) => {
                            return $.tee(gamma0, $.back(gamma0, 'mul')($.back(gamma0, tmp0)), tmp0);
                        },
                        ['x', tmp1],
                    );
                },
                'y',
            ),
            $.drop,
        );
        return [$.back(gamma0, 'x'), $.back(gamma0, 'y')];
    });
    expect(result).toEqual([
        [1, 2],
        [30, 4],
    ]);
});

it('Item 21 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:198:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 5, 'a');
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (
                    (outer0) => (arg0: any) =>
                        $.wrap(
                            (gamma1) => {
                                $.recv(gamma1, arg0, 'x');

                                return $.back(gamma1, '+')(
                                    $.back(gamma1, 'x'),
                                    $.back(gamma1, 'a'),
                                );
                            },
                            [],
                            outer0,
                        )
                )({ a: $.back(gamma0, 'a') }),
                'captures',
            ),
            $.drop,
        );
        $.recv(gamma0, $.recv(gamma0, 2, 'a'), $.drop);
        return [$.back(gamma0, 'a'), $.back(gamma0, 'captures')(4)];
    });
    expect(result).toEqual([2, 9]);
});

it('Item 22 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:209:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 5, 'a');
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (
                    (outer0) => (arg0: any) =>
                        $.wrap(
                            (gamma1) => {
                                $.recv(gamma1, arg0, 'x');

                                $.recv(
                                    gamma1,
                                    $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, 'a')), 'a'),
                                    $.drop,
                                );
                                return $.back(gamma1, '+')(
                                    $.back(gamma1, 'x'),
                                    $.back(gamma1, 'a'),
                                );
                            },
                            [],
                            outer0,
                        )
                )({ a: $.back(gamma0, 'a') }),
                'captures',
            ),
            $.drop,
        );
        $.recv(gamma0, $.recv(gamma0, 2, 'a'), $.drop);
        return [$.back(gamma0, 'a'), $.back(gamma0, 'captures')(4)];
    });
    expect(result).toEqual([2, 10]);
});

it('Item 23 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:221:0', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            (() => {
                $.recv(gamma0, 2, 'y');
                return $.back(gamma0, '+')($.back(gamma0, 'y'), 3);
            })(),
            'x',
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(5);
});

it('Item 24 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:233:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'x');

                        $.recv(gamma1, $.back(gamma1, 'x'), 'y');
                        const res0 = $.recv(gamma1, 5, 'y');
                        $.recv(gamma1, $.back(gamma1, 'y'), 'x');
                        return [res0, $.back(gamma1, 'x')];
                    }, 'x'),
                'alias',
            ),
            $.drop,
        );
        $.recv(gamma0, 2, 'x');
        return [
            $.tee(gamma0, $.back(gamma0, 'alias')($.back(gamma0, 'x')), 'x'),
            $.back(gamma0, 'x'),
        ];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 25 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:243:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            (() => {
                $.recv(gamma0, $.back(gamma0, 'x'), 'y');
                const res0 = $.recv(gamma0, 5, 'y');
                $.recv(gamma0, $.back(gamma0, 'y'), 'x');
                return res0;
            })(),
            'z',
        );
        return [$.back(gamma0, 'z'), $.back(gamma0, 'x')];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 26 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:255:4', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, $.back(gamma0, 'consume')(2), $.drop);
        return 4;
    });
    expect(result).toEqual([2, 4]);
});

it('Item 27 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:261:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            (() => {
                $.recv(gamma0, $.back(gamma0, 'x'), 'y');
                const res0 = $.recv(gamma0, 4, 'y');
                $.recv(gamma0, $.back(gamma0, 'y'), 'x');
                return res0;
            })(),
            'm',
        );
        return [$.back(gamma0, 'm'), $.back(gamma0, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 28 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:273:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'a');

                        return [
                            $.back(gamma1, 'a'),
                            (res: any) => {
                                $.recv(gamma1, res, 'b');
                                $.recv(gamma1, $.back(gamma1, 'consume')($.back(gamma1, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma1, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            $.drop,
        );
        $.recv(gamma0, $.back(gamma0, 'consume')(1), $.drop);
        return $.tee2(
            gamma0,
            $.back(gamma0, 'dropper')(5),
            (tmp0) => {
                $.recv(gamma0, $.back(gamma0, tmp0), 'v');
                $.recv(gamma0, $.back(gamma0, 'consume')(2), $.drop);
                $.recv(gamma0, $.back(gamma0, 'consume')($.recv(gamma0, 10, 'v')), $.drop);
                $.recv(gamma0, $.back(gamma0, 'consume')(3), $.drop);
                const res1 = 4;
                $.recv(gamma0, $.back(gamma0, 'v'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual([[1, 2, 5, 3, 10], 4]);
});

it('Item 29 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:289:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'a');

                        return [
                            $.back(gamma1, 'a'),
                            (res: any) => {
                                $.recv(gamma1, res, 'b');
                                $.recv(gamma1, $.back(gamma1, 'consume')($.back(gamma1, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma1, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            $.drop,
        );
        $.recv(gamma0, $.back(gamma0, 'consume')(1), $.drop);
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'dropper')(5),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'v');
                    $.recv(gamma0, $.back(gamma0, 'consume')($.recv(gamma0, 10, 'v')), $.drop);
                    const res1 = 4;
                    $.recv(gamma0, $.back(gamma0, 'v'), tmp0);
                    return res1;
                },
                [],
            ),
            'res',
        );
        $.recv(gamma0, $.back(gamma0, 'consume')(3), $.drop);
        return $.back(gamma0, 'res');
    });
    expect(result).toEqual([[1, 5, 10, 3], 4]);
});

it('Item 30 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:321:4', () => {
    const result = $.run((gamma0) => {
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
                                $.recv(
                                    gamma1,
                                    $.back(gamma1, 'log')(`Hello`, $.back(gamma1, 'b')),
                                    [],
                                );
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
    });
    expect(result).toEqual([
        [
            [`v from passer`, 3],
            [`Hello`, 10],
        ],
        [4, 20],
    ]);
});

it('Item 31 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:341:4', () => {
    const result = $.run((gamma0) => {
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
                                $.recv(
                                    gamma1,
                                    $.back(gamma1, 'log')(
                                        `Prev a`,
                                        $.recv(gamma1, $.back(gamma1, 'b'), 'a'),
                                    ),
                                    [],
                                );
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
    });
    expect(result).toEqual([
        [
            [`v from passer`, 3],
            [`Prev a`, 20],
        ],
        [4, 10],
    ]);
});

it('Item 32 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:389:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'x');

                        $.recv(gamma1, $.back(gamma1, 'x'), ['a', 'b']);
                        $.recv(
                            gamma1,
                            $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, 'a')), 'a'),
                            $.drop,
                        );
                        const res0 = 2;
                        $.recv(gamma1, $.back(gamma1, ['a', 'b']), 'x');
                        return [res0, $.back(gamma1, 'x')];
                    }, 'x'),
                'incfst',
            ),
            $.drop,
        );
        $.recv(gamma0, [4, 10], 'm');
        return [
            $.tee(gamma0, $.back(gamma0, 'incfst')($.back(gamma0, 'm')), 'm'),
            $.back(gamma0, 'm'),
        ];
    });
    expect(result).toEqual([2, [5, 10]]);
});

it('Item 33 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:404:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 3, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(4);
});

it('Item 34 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:414:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 4], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'fst')($.back(gamma0, 'x')),
                (tmp0) => {
                    return $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 35 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:424:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 4], 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'incFst')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 36 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:434:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'idf')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 37 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:444:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'idl')($.back(gamma0, 'x')),
                (tmp0) => {
                    return $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(3);
});

it('Item 38 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:454:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'united')($.back(gamma0, 'x')),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'l');
                    const res1 = 1;
                    $.recv(gamma0, $.back(gamma0, 'l'), tmp0);
                    return res1;
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 39 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:467:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        return $.tee2(
            gamma0,
            $.back(gamma0, 'makeunit')([]),
            (tmp0) => {
                $.recv(gamma0, $.back(gamma0, tmp0), 'l');
                const res1 = $.back(gamma0, 'x');
                $.recv(gamma0, $.back(gamma0, 'l'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(2);
});
