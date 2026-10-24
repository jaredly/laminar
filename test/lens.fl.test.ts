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
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'c');

        return [$.recv(gamma, $.back(gamma, '+')($.back(gamma, 'c'), 1), 'c'), $.back(gamma, 'c')];
    }, 'c'),
);

$.addFn('fst', (arg0: any) =>
    $.wrap(
        (gamma) => {
            $.recv(gamma, arg0, ['x', 'y']);

            return [
                $.back(gamma, 'x'),
                (recv: any) => {
                    $.recv(gamma, recv, 'x');
                    return $.back(gamma, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);

$.addFn('incFst', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

        return [
            $.tee2(
                gamma,
                $.back(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            $.back(gamma, 'x'),
        ];
    }, 'x'),
);

$.addFn('idf', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

        return [[], $.back(gamma, 'x')];
    }, 'x'),
);

$.addFn('idl', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

        return [
            $.back(gamma, 'x'),
            (recv: any) => {
                $.recv(gamma, recv, 'x');
                return $.back(gamma, 'x');
            },
        ];
    }, 'x'),
);

$.addFn('united', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

        return [
            [],
            (recv: any) => {
                $.recv(gamma, recv, []);
                return $.back(gamma, 'x');
            },
        ];
    }, 'x'),
);

$.addFn('makeunit', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, []);

        return [
            [],
            (recv: any) => {
                $.recv(gamma, recv, []);
                return null; // this should be right I think
            },
        ];
    }, []),
);

it('Item 0 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:4:4', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 10, $.drop);
        $.recv(gamma, $.back(gamma, 'log'), $.drop);
        $.recv(gamma, true, $.drop);
        $.recv(gamma, `one`, $.drop);
        $.recv(gamma, $.back(gamma, 'log')(`Hello`, 3), $.drop);
        return `One${10}`;
    });
    expect(result).toEqual([[`Hello`, 3], `One10`]);
});

it('Item 1 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:15:4', () => {
    const result = $.run((gamma) => {
        return $.back(gamma, '+')(2, 2);
    });
    expect(result).toEqual(4);
});

it('Item 2 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:20:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        return $.back(gamma, '+')($.back(gamma, 'x'), 4);
    });
    expect(result).toEqual(6);
});

it('Item 3 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:33:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.recv(gamma, 3, 'x'), 'm');
        return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, 'm'));
    });
    expect(result).toEqual(5);
});

it('Item 4 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:41:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.recv(gamma, 3, 'x'), $.drop);
        return $.back(gamma, '+')($.back(gamma, 'x'), 2);
    });
    expect(result).toEqual(5);
});

it('Item 5 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:49:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, 'y'));
    });
    expect(result).toEqual(3);
});

it('Item 6 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:56:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        $.recv(gamma, $.recv(gamma, 4, 'x'), $.drop);
        return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, 'y'));
    });
    expect(result).toEqual(6);
});

it('Item 7 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:64:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        $.recv(gamma, $.recv(gamma, $.recv(gamma, $.back(gamma, 'x'), 'y'), 'x'), $.drop);
        return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, '*')($.back(gamma, 'y'), 5));
    });
    expect(result).toEqual(7);
});

it('Item 8 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:72:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        return [$.recv(gamma, [4, 5], ['x', 'y']), [$.back(gamma, 'x'), $.back(gamma, 'y')]];
    });
    expect(result).toEqual([
        [1, 2],
        [4, 5],
    ]);
});

it('Item 9 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:80:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'x');

                        return $.back(gamma, '+')($.back(gamma, 'x'), 2);
                    }, []),
                'go',
            ),
            $.drop,
        );
        return $.back(gamma, 'go')(4);
    });
    expect(result).toEqual(6);
});

it('Item 10 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:87:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'm');

                        return [
                            $.recv(gamma, $.back(gamma, '+')($.back(gamma, 'm'), 10), 'm'),
                            $.back(gamma, 'm'),
                        ];
                    }, 'm'),
                'inc',
            ),
            $.drop,
        );
        $.recv(gamma, 5, 'x');
        $.recv(gamma, $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, 'x')), 'x'), $.drop);
        return $.back(gamma, 'x');
    });
    expect(result).toEqual(15);
});

it('Item 11 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:97:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'n');

                        $.recv(gamma, 5, 'm');
                        return $.back(gamma, '+')($.back(gamma, 'n'), $.back(gamma, 'm'));
                    }, []),
                'hello',
            ),
            $.drop,
        );
        return $.back(gamma, 'hello')(3);
    });
    expect(result).toEqual(8);
});

it('Item 12 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:107:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma, $.back(gamma, '+')($.back(gamma, 'a'), 10), 'a'),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'inc2',
            ),
            $.drop,
        );
        $.recv(gamma, 5, 'x');
        $.recv(gamma, 3, 'y');
        $.recv(
            gamma,
            $.tee(gamma, $.back(gamma, 'inc2')($.back(gamma, ['x', 'y'])), ['x', 'y']),
            $.drop,
        );
        return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, 'y'));
    });
    expect(result).toEqual(18);
});

it('Item 13 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:117:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma, $.recv(gamma, $.back(gamma, 'a'), 'b'), 'a'),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma, 1, 'x');
        $.recv(gamma, 5, 'y');
        $.recv(
            gamma,
            $.tee(gamma, $.back(gamma, 'swap')($.back(gamma, ['x', 'y'])), ['x', 'y']),
            $.drop,
        );
        return $.back(gamma, '+')($.back(gamma, '*')($.back(gamma, 'x'), 5), $.back(gamma, 'y'));
    });
    expect(result).toEqual(26);
});

it('Item 14 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:127:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma, $.recv(gamma, $.back(gamma, 'a'), 'b'), 'a'),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma, [1, 5], 'two');
        $.recv(gamma, $.tee(gamma, $.back(gamma, 'swap')($.back(gamma, 'two')), 'two'), $.drop);
        $.recv(gamma, $.back(gamma, 'two'), ['x', 'y']);
        return $.back(gamma, '+')($.back(gamma, '*')($.back(gamma, 'x'), 5), $.back(gamma, 'y'));
    });
    expect(result).toEqual(26);
});

it('Item 15 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:137:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.recv(gamma, [$.back(gamma, 'b'), $.back(gamma, 'a')], ['a', 'b']),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            $.drop,
        );
        $.recv(gamma, [1, 5], 'two');
        $.recv(gamma, $.tee(gamma, $.back(gamma, 'swap')($.back(gamma, 'two')), 'two'), $.drop);
        $.recv(gamma, $.back(gamma, 'two'), ['x', 'y']);
        return $.back(gamma, '+')($.back(gamma, '*')($.back(gamma, 'x'), 5), $.back(gamma, 'y'));
    });
    expect(result).toEqual(26);
});

it('Item 16 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:147:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'a'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'a');
                                    return $.back(gamma, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(gamma, [1, 10], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.recv(gamma, 5, tmp0);
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma, 'x'), $.back(gamma, 'z')];
    });
    expect(result).toEqual([[5, 10], 1]);
});

it('Item 17 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:156:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'a'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'a');
                                    return $.back(gamma, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'fst',
            ),
            $.drop,
        );
        $.recv(gamma, [1, 10], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma, 'x');
    });
    expect(result).toEqual([2, 10]);
});

it('Item 18 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:165:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'a'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'a');
                                    return $.back(gamma, ['a', 'b']);
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
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'b'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'b');
                                    return $.back(gamma, ['a', 'b']);
                                },
                            ];
                        },
                        ['a', 'b'],
                    ),
                'snd',
            ),
            $.drop,
        );
        $.recv(gamma, [1, [10, 5]], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'snd')($.back(gamma, 'x')),
                (tmp1) => {
                    return $.tee2(
                        gamma,
                        $.back(gamma, 'fst')($.back(gamma, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma, 'x');
    });
    expect(result).toEqual([1, [11, 5]]);
});

it('Item 19 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:175:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'a'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'a');
                                    return $.back(gamma, ['a', 'b']);
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
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'b'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'b');
                                    return $.back(gamma, ['a', 'b']);
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
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'c');

                        return [
                            $.recv(gamma, $.back(gamma, '*')($.back(gamma, 'c'), 10), 'c'),
                            $.back(gamma, 'c'),
                        ];
                    }, 'c'),
                'mul',
            ),
            $.drop,
        );
        $.recv(gamma, [1, 2], 'x');
        $.recv(gamma, [3, 4], 'y');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'fst')($.back(gamma, ['x', 'y'])),
                (tmp1) => {
                    return $.tee2(
                        gamma,
                        $.back(gamma, 'snd')($.back(gamma, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma, $.back(gamma, 'mul')($.back(gamma, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                ['x', 'y'],
            ),
            $.drop,
        );
        return [$.back(gamma, 'x'), $.back(gamma, 'y')];
    });
    expect(result).toEqual([
        [1, 20],
        [3, 4],
    ]);
});

it('Item 20 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:187:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'a'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'a');
                                    return $.back(gamma, ['a', 'b']);
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
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg0, ['a', 'b']);

                            return [
                                $.back(gamma, 'b'),
                                (recv: any) => {
                                    $.recv(gamma, recv, 'b');
                                    return $.back(gamma, ['a', 'b']);
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
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'c');

                        return [
                            $.recv(gamma, $.back(gamma, '*')($.back(gamma, 'c'), 10), 'c'),
                            $.back(gamma, 'c'),
                        ];
                    }, 'c'),
                'mul',
            ),
            $.drop,
        );
        $.recv(gamma, [1, 2], 'x');
        $.recv(gamma, [3, 4], 'y');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'fst')($.back(gamma, 'y')),
                (tmp1) => {
                    return $.tee2(
                        gamma,
                        $.back(gamma, 'snd')($.back(gamma, ['x', tmp1])),
                        (tmp0) => {
                            return $.tee(gamma, $.back(gamma, 'mul')($.back(gamma, tmp0)), tmp0);
                        },
                        ['x', tmp1],
                    );
                },
                'y',
            ),
            $.drop,
        );
        return [$.back(gamma, 'x'), $.back(gamma, 'y')];
    });
    expect(result).toEqual([
        [1, 2],
        [30, 4],
    ]);
});

it('Item 21 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:198:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 5, 'a');
        $.recv(
            gamma,
            $.recv(
                gamma,
                (
                    (outer0) => (arg0: any) =>
                        $.wrap(
                            (gamma) => {
                                $.recv(gamma, arg0, 'x');

                                return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, 'a'));
                            },
                            [],
                            outer0,
                        )
                )({ a: $.back(gamma, 'a') }),
                'captures',
            ),
            $.drop,
        );
        $.recv(gamma, $.recv(gamma, 2, 'a'), $.drop);
        return [$.back(gamma, 'a'), $.back(gamma, 'captures')(4)];
    });
    expect(result).toEqual([2, 9]);
});

it('Item 22 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:209:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 5, 'a');
        $.recv(
            gamma,
            $.recv(
                gamma,
                (
                    (outer0) => (arg0: any) =>
                        $.wrap(
                            (gamma) => {
                                $.recv(gamma, arg0, 'x');

                                $.recv(
                                    gamma,
                                    $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, 'a')), 'a'),
                                    $.drop,
                                );
                                return $.back(gamma, '+')($.back(gamma, 'x'), $.back(gamma, 'a'));
                            },
                            [],
                            outer0,
                        )
                )({ a: $.back(gamma, 'a') }),
                'captures',
            ),
            $.drop,
        );
        $.recv(gamma, $.recv(gamma, 2, 'a'), $.drop);
        return [$.back(gamma, 'a'), $.back(gamma, 'captures')(4)];
    });
    expect(result).toEqual([2, 10]);
});

it('Item 23 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:221:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            (() => {
                $.recv(gamma, 2, 'y');
                return $.back(gamma, '+')($.back(gamma, 'y'), 3);
            })(),
            'x',
        );
        return $.back(gamma, 'x');
    });
    expect(result).toEqual(5);
});

it('Item 24 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:233:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'x');

                        $.recv(gamma, $.back(gamma, 'x'), 'y');
                        const res0 = $.recv(gamma, 5, 'y');
                        $.recv(gamma, $.back(gamma, 'y'), 'x');
                        return [res0, $.back(gamma, 'x')];
                    }, 'x'),
                'alias',
            ),
            $.drop,
        );
        $.recv(gamma, 2, 'x');
        return [$.tee(gamma, $.back(gamma, 'alias')($.back(gamma, 'x')), 'x'), $.back(gamma, 'x')];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 25 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:243:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            (() => {
                $.recv(gamma, $.back(gamma, 'x'), 'y');
                const res0 = $.recv(gamma, 5, 'y');
                $.recv(gamma, $.back(gamma, 'y'), 'x');
                return res0;
            })(),
            'z',
        );
        return [$.back(gamma, 'z'), $.back(gamma, 'x')];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 26 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:255:4', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, $.back(gamma, 'consume')(2), $.drop);
        return 4;
    });
    expect(result).toEqual([2, 4]);
});

it('Item 27 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:261:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            (() => {
                $.recv(gamma, $.back(gamma, 'x'), 'y');
                const res0 = $.recv(gamma, 4, 'y');
                $.recv(gamma, $.back(gamma, 'y'), 'x');
                return res0;
            })(),
            'm',
        );
        return [$.back(gamma, 'm'), $.back(gamma, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 28 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:273:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'a');

                        return [
                            $.back(gamma, 'a'),
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(gamma, $.back(gamma, 'consume')($.back(gamma, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            $.drop,
        );
        $.recv(gamma, $.back(gamma, 'consume')(1), $.drop);
        return $.tee2(
            gamma,
            $.back(gamma, 'dropper')(5),
            (tmp0) => {
                $.recv(gamma, $.back(gamma, tmp0), 'v');
                $.recv(gamma, $.back(gamma, 'consume')(2), $.drop);
                $.recv(gamma, $.back(gamma, 'consume')($.recv(gamma, 10, 'v')), $.drop);
                $.recv(gamma, $.back(gamma, 'consume')(3), $.drop);
                const res1 = 4;
                $.recv(gamma, $.back(gamma, 'v'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual([[1, 2, 5, 3, 10], 4]);
});

it('Item 29 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:289:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'a');

                        return [
                            $.back(gamma, 'a'),
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(gamma, $.back(gamma, 'consume')($.back(gamma, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            $.drop,
        );
        $.recv(gamma, $.back(gamma, 'consume')(1), $.drop);
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'dropper')(5),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'v');
                    $.recv(gamma, $.back(gamma, 'consume')($.recv(gamma, 10, 'v')), $.drop);
                    const res1 = 4;
                    $.recv(gamma, $.back(gamma, 'v'), tmp0);
                    return res1;
                },
                [],
            ),
            'res',
        );
        $.recv(gamma, $.back(gamma, 'consume')(3), $.drop);
        return $.back(gamma, 'res');
    });
    expect(result).toEqual([[1, 5, 10, 3], 4]);
});

it('Item 30 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:321:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'a');

                        return [
                            3,
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(
                                    gamma,
                                    $.back(gamma, 'log')(`Hello`, $.back(gamma, 'b')),
                                    [],
                                );
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, 'a');
                                return $.back(gamma, 'a');
                            },
                        ];
                    }, 'a'),
                'passer',
            ),
            $.drop,
        );
        $.recv(gamma, 20, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'passer')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'v');
                    $.recv(
                        gamma,
                        $.back(gamma, 'log')(`v from passer`, $.recv(gamma, 10, 'v')),
                        $.drop,
                    );
                    const res1 = 4;
                    $.recv(gamma, $.back(gamma, 'v'), tmp0);
                    return res1;
                },
                'x',
            ),
            'res',
        );
        return [$.back(gamma, 'res'), $.back(gamma, 'x')];
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
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'a');

                        return [
                            3,
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(
                                    gamma,
                                    $.back(gamma, 'log')(
                                        `Prev a`,
                                        $.recv(gamma, $.back(gamma, 'b'), 'a'),
                                    ),
                                    [],
                                );
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, 'a');
                                return $.back(gamma, 'a');
                            },
                        ];
                    }, 'a'),
                'passer',
            ),
            $.drop,
        );
        $.recv(gamma, 20, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'passer')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'v');
                    $.recv(
                        gamma,
                        $.back(gamma, 'log')(`v from passer`, $.recv(gamma, 10, 'v')),
                        $.drop,
                    );
                    const res1 = 4;
                    $.recv(gamma, $.back(gamma, 'v'), tmp0);
                    return res1;
                },
                'x',
            ),
            'res',
        );
        return [$.back(gamma, 'res'), $.back(gamma, 'x')];
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
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'x');

                        $.recv(gamma, $.back(gamma, 'x'), ['a', 'b']);
                        $.recv(
                            gamma,
                            $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, 'a')), 'a'),
                            $.drop,
                        );
                        const res0 = 2;
                        $.recv(gamma, $.back(gamma, ['a', 'b']), 'x');
                        return [res0, $.back(gamma, 'x')];
                    }, 'x'),
                'incfst',
            ),
            $.drop,
        );
        $.recv(gamma, [4, 10], 'm');
        return [$.tee(gamma, $.back(gamma, 'incfst')($.back(gamma, 'm')), 'm'), $.back(gamma, 'm')];
    });
    expect(result).toEqual([2, [5, 10]]);
});

it('Item 33 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:404:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 3, 'x');
        $.recv(gamma, $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, 'x')), 'x'), $.drop);
        return $.back(gamma, 'x');
    });
    expect(result).toEqual(4);
});

it('Item 34 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:414:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 4], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 35 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:424:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 4], 'x');
        $.recv(gamma, $.tee(gamma, $.back(gamma, 'incFst')($.back(gamma, 'x')), 'x'), $.drop);
        return $.back(gamma, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 36 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:434:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.tee(gamma, $.back(gamma, 'idf')($.back(gamma, 'x')), 'x'), $.drop);
        return $.back(gamma, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 37 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:444:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'idl')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.back(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma, 'x');
    });
    expect(result).toEqual(3);
});

it('Item 38 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:454:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.back(gamma, 'united')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'l');
                    const res1 = 1;
                    $.recv(gamma, $.back(gamma, 'l'), tmp0);
                    return res1;
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 39 at /Users/jared/clone/exploration/laminar/ts/test/lens.fl:467:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        return $.tee2(
            gamma,
            $.back(gamma, 'makeunit')([]),
            (tmp0) => {
                $.recv(gamma, $.back(gamma, tmp0), 'l');
                const res1 = $.back(gamma, 'x');
                $.recv(gamma, $.back(gamma, 'l'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(2);
});
