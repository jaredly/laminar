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

$.addFn('inc', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'c');
        return [$.recv(gamma, $.get(gamma, '+')($.get(gamma, 'c'), 1), 'c'), $.back(gamma, 'c')];
    }, 'c'),
);
$.addFn('fst', (arg: any) =>
    $.wrap(
        (gamma) => {
            $.recv(gamma, arg, ['x', 'y']);
            return [
                $.get(gamma, 'x'),
                (recv: any) => {
                    $.recv(gamma, recv, 'x');
                    return $.back(gamma, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);
$.addFn('incFst', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'x');
        return [
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            $.back(gamma, 'x'),
        ];
    }, 'x'),
);
$.addFn('idf', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'x');
        return [null, $.back(gamma, 'x')];
    }, 'x'),
);
$.addFn('idl', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'x');
        return [
            $.get(gamma, 'x'),
            (recv: any) => {
                $.recv(gamma, recv, 'x');
                return $.back(gamma, 'x');
            },
        ];
    }, 'x'),
);
$.addFn('united', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'x');
        return [
            [],
            (recv: any) => {
                $.recv(gamma, recv, []);
                return $.back(gamma, 'x');
            },
        ];
    }, 'x'),
);
$.addFn('makeunit', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, []);
        return [
            [],
            (recv: any) => {
                $.recv(gamma, recv, []);
                return null; // this should be right I think
            },
        ];
    }, []),
);
it('Item 0 at test/lens.fl:3:0', () => {
    const result = $.run((gamma) => {
        return $.get(gamma, '+')(2, 2);
    });
    expect(result).toEqual(4);
});

it('Item 1 at test/lens.fl:9:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        return $.get(gamma, '+')($.get(gamma, 'x'), 4);
    });
    expect(result).toEqual(6);
});

it('Item 2 at test/lens.fl:22:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.recv(gamma, 3, 'x'), 'm');
        return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'm'));
    });
    expect(result).toEqual(5);
});

it('Item 3 at test/lens.fl:30:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.recv(gamma, 3, 'x'), $.drop);
        return $.get(gamma, '+')($.get(gamma, 'x'), 2);
    });
    expect(result).toEqual(5);
});

it('Item 4 at test/lens.fl:38:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'y'));
    });
    expect(result).toEqual(3);
});

it('Item 5 at test/lens.fl:45:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        $.recv(gamma, $.recv(gamma, 4, 'x'), $.drop);
        return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'y'));
    });
    expect(result).toEqual(6);
});

it('Item 6 at test/lens.fl:53:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        $.recv(gamma, $.recv(gamma, $.recv(gamma, $.get(gamma, 'x'), 'y'), 'x'), []);
        return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, '*')($.get(gamma, 'y'), 5));
    });
    expect(result).toEqual(7);
});

it('Item 7 at test/lens.fl:61:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], ['x', 'y']);
        return [$.recv(gamma, [4, 5], ['x', 'y']), [$.get(gamma, 'x'), $.get(gamma, 'y')]];
    });
    expect(result).toEqual([
        [1, 2],
        [4, 5],
    ]);
});

it('Item 8 at test/lens.fl:68:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'x');
                        return $.get(gamma, '+')($.get(gamma, 'x'), 2);
                    }, []),
                'go',
            ),
            [],
        );
        return $.get(gamma, 'go')(4);
    });
    expect(result).toEqual(6);
});

it('Item 9 at test/lens.fl:75:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'm');
                        return [
                            $.recv(gamma, $.get(gamma, '+')($.get(gamma, 'm'), 10), 'm'),
                            $.back(gamma, 'm'),
                        ];
                    }, 'm'),
                'inc',
            ),
            [],
        );
        $.recv(gamma, 5, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, 'x')), 'x'), []);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(15);
});

it('Item 10 at test/lens.fl:85:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'n');
                        $.recv(gamma, 5, 'm');
                        return $.get(gamma, '+')($.get(gamma, 'n'), $.get(gamma, 'm'));
                    }, []),
                'hello',
            ),
            [],
        );
        return $.get(gamma, 'hello')(3);
    });
    expect(result).toEqual(8);
});

it('Item 11 at test/lens.fl:95:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.recv(gamma, $.get(gamma, '+')($.get(gamma, 'a'), 10), 'a'),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'inc2',
            ),
            [],
        );
        $.recv(gamma, 5, 'x');
        $.recv(gamma, 3, 'y');
        $.recv(
            gamma,
            $.tee(gamma, $.get(gamma, 'inc2')($.back(gamma, ['x', 'y'])), ['x', 'y']),
            [],
        );
        return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'y'));
    });
    expect(result).toEqual(18);
});

it('Item 12 at test/lens.fl:105:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.recv(gamma, $.recv(gamma, $.get(gamma, 'a'), 'b'), 'a'),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            [],
        );
        $.recv(gamma, 1, 'x');
        $.recv(gamma, 5, 'y');
        $.recv(
            gamma,
            $.tee(gamma, $.get(gamma, 'swap')($.back(gamma, ['x', 'y'])), ['x', 'y']),
            [],
        );
        return $.get(gamma, '+')($.get(gamma, '*')($.get(gamma, 'x'), 5), $.get(gamma, 'y'));
    });
    expect(result).toEqual(26);
});

it('Item 13 at test/lens.fl:115:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.recv(gamma, $.recv(gamma, $.get(gamma, 'a'), 'b'), 'a'),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            [],
        );
        $.recv(gamma, [1, 5], 'two');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'swap')($.back(gamma, 'two')), 'two'), []);
        $.recv(gamma, $.get(gamma, 'two'), ['x', 'y']);
        return $.get(gamma, '+')($.get(gamma, '*')($.get(gamma, 'x'), 5), $.get(gamma, 'y'));
    });
    expect(result).toEqual(26);
});

it('Item 14 at test/lens.fl:125:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.recv(gamma, [$.get(gamma, 'b'), $.get(gamma, 'a')], ['a', 'b']),
                                $.back(gamma, ['a', 'b']),
                            ];
                        },
                        ['a', 'b'],
                    ),
                'swap',
            ),
            [],
        );
        $.recv(gamma, [1, 5], 'two');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'swap')($.back(gamma, 'two')), 'two'), []);
        $.recv(gamma, $.get(gamma, 'two'), ['x', 'y']);
        return $.get(gamma, '+')($.get(gamma, '*')($.get(gamma, 'x'), 5), $.get(gamma, 'y'));
    });
    expect(result).toEqual(26);
});

it('Item 15 at test/lens.fl:135:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'a'),
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
            [],
        );
        $.recv(gamma, [1, 10], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.get(gamma, 'x')),
                (tmp) => $.recv(gamma, 5, tmp),
                'x',
            ),
            'z',
        );
        return [$.get(gamma, 'x'), $.get(gamma, 'z')];
    });
    expect(result).toEqual([[5, 10], 1]);
});

it('Item 16 at test/lens.fl:144:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'a'),
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
            [],
        );
        $.recv(gamma, [1, 10], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            [],
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([2, 10]);
});

it('Item 17 at test/lens.fl:154:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'a'),
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
            [],
        );
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'b'),
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
            [],
        );
        $.recv(gamma, [1, [10, 5]], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'snd')($.back(gamma, 'x')),
                (tmp1) => {
                    return $.tee2(
                        gamma,
                        $.get(gamma, 'fst')($.back(gamma, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                'x',
            ),
            [],
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([1, [11, 5]]);
});

it('Item 18 at test/lens.fl:164:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'a'),
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
            [],
        );
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'b'),
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
            [],
        );
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'c');
                        return [
                            $.recv(gamma, $.get(gamma, '*')($.get(gamma, 'c'), 10), 'c'),
                            $.back(gamma, 'c'),
                        ];
                    }, 'c'),
                'mul',
            ),
            [],
        );
        $.recv(gamma, [1, 2], 'x');
        $.recv(gamma, [3, 4], 'y');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.back(gamma, ['x', 'y'])),
                (tmp1) => {
                    return $.tee2(
                        gamma,
                        $.get(gamma, 'snd')($.back(gamma, tmp1)),
                        (tmp0) => {
                            return $.tee(gamma, $.get(gamma, 'mul')($.back(gamma, tmp0)), tmp0);
                        },
                        tmp1,
                    );
                },
                ['x', 'y'],
            ),
            [],
        );
        return [$.get(gamma, 'x'), $.get(gamma, 'y')];
    });
    expect(result).toEqual([
        [1, 20],
        [3, 4],
    ]);
});

it('Item 19 at test/lens.fl:176:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'a'),
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
            [],
        );
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap(
                        (gamma) => {
                            $.recv(gamma, arg, ['a', 'b']);
                            return [
                                $.get(gamma, 'b'),
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
            [],
        );
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'c');
                        return [
                            $.recv(gamma, $.get(gamma, '*')($.get(gamma, 'c'), 10), 'c'),
                            $.back(gamma, 'c'),
                        ];
                    }, 'c'),
                'mul',
            ),
            [],
        );
        $.recv(gamma, [1, 2], 'x');
        $.recv(gamma, [3, 4], 'y');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.back(gamma, 'y')),
                (tmp1) => {
                    return $.tee2(
                        gamma,
                        $.get(gamma, 'snd')($.back(gamma, ['x', tmp1])),
                        (tmp0) => {
                            return $.tee(gamma, $.get(gamma, 'mul')($.back(gamma, tmp0)), tmp0);
                        },
                        ['x', tmp1],
                    );
                },
                'y',
            ),
            [],
        );
        return [$.get(gamma, 'x'), $.get(gamma, 'y')];
    });
    expect(result).toEqual([
        [1, 2],
        [30, 4],
    ]);
});

it('Item 20 at test/lens.fl:188:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 5, 'a');
        $.recv(
            gamma,
            $.recv(
                gamma,
                (
                    (outer0) => (arg: any) =>
                        $.wrap(
                            (gamma) => {
                                $.recv(gamma, arg, 'x');
                                return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'a'));
                            },
                            [],
                            outer0,
                        )
                )({ a: $.get(gamma, 'a') }),
                'captures',
            ),
            [],
        );
        $.recv(gamma, $.recv(gamma, 2, 'a'), []);
        return [$.get(gamma, 'a'), $.get(gamma, 'captures')(4)];
    });
    expect(result).toEqual([2, 9]);
});

it('Item 21 at test/lens.fl:199:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 5, 'a');
        $.recv(
            gamma,
            $.recv(
                gamma,
                (
                    (outer0) => (arg: any) =>
                        $.wrap(
                            (gamma) => {
                                $.recv(gamma, arg, 'x');
                                $.recv(
                                    gamma,
                                    $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, 'a')), 'a'),
                                    [],
                                );
                                return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'a'));
                            },
                            [],
                            outer0,
                        )
                )({ a: $.get(gamma, 'a') }),
                'captures',
            ),
            [],
        );
        $.recv(gamma, $.recv(gamma, 2, 'a'), []);
        return [$.get(gamma, 'a'), $.get(gamma, 'captures')(4)];
    });
    expect(result).toEqual([2, 10]);
});

it('Item 22 at test/lens.fl:211:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            (() => {
                $.recv(gamma, 2, 'y');
                return $.get(gamma, '+')($.get(gamma, 'y'), 3);
            })(),
            'x',
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(5);
});

it('Item 23 at test/lens.fl:222:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'x');
                        $.recv(gamma, $.back(gamma, 'x'), 'y');
                        const res0 = $.recv(gamma, 5, 'y');
                        $.recv(gamma, $.back(gamma, 'y'), 'x');
                        return [res0, $.back(gamma, 'x')];
                    }, 'x'),
                'alias',
            ),
            [],
        );
        $.recv(gamma, 2, 'x');
        return [$.tee(gamma, $.get(gamma, 'alias')($.back(gamma, 'x')), 'x'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 24 at test/lens.fl:233:0', () => {
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
        return [$.get(gamma, 'z'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([2, 5]);
});

it('Item 25 at test/lens.fl:244:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, $.get(gamma, 'consume')(2), []);
        return 4;
    });
    expect(result).toEqual([2, 4]);
});

it('Item 26 at test/lens.fl:251:0', () => {
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
        return [$.get(gamma, 'm'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 27 at test/lens.fl:262:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'a');
                        return [
                            $.get(gamma, 'a'),
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(gamma, $.get(gamma, 'consume')($.get(gamma, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            [],
        );
        $.recv(gamma, $.get(gamma, 'consume')(1), []);
        return $.tee2(
            gamma,
            $.get(gamma, 'dropper')(5),
            (tmp0) => {
                $.recv(gamma, $.back(gamma, tmp0), 'v');
                $.recv(gamma, $.get(gamma, 'consume')(2), []);
                $.recv(gamma, $.get(gamma, 'consume')($.recv(gamma, 10, 'v')), []);
                $.recv(gamma, $.get(gamma, 'consume')(3), []);
                const res1 = 4;
                $.recv(gamma, $.back(gamma, 'v'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual([[1, 2, 5, 3, 10], 4]);
});

it('Item 28 at test/lens.fl:278:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'a');
                        return [
                            $.get(gamma, 'a'),
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(gamma, $.get(gamma, 'consume')($.get(gamma, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, []);
                            },
                        ];
                    }, []),
                'dropper',
            ),
            [],
        );
        $.recv(gamma, $.get(gamma, 'consume')(1), []);
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'dropper')(5),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'v');
                    $.recv(gamma, $.get(gamma, 'consume')($.recv(gamma, 10, 'v')), []);
                    const res1 = 4;
                    $.recv(gamma, $.back(gamma, 'v'), tmp0);
                    return res1;
                },
                [],
            ),
            'res',
        );
        $.recv(gamma, $.get(gamma, 'consume')(3), []);
        return $.get(gamma, 'res');
    });
    expect(result).toEqual([[1, 5, 10, 3], 4]);
});

it('Item 29 at test/lens.fl:310:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'a');
                        return [
                            3,
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(gamma, $.get(gamma, 'log')(`Hello`, $.get(gamma, 'b')), []);
                                // assert that all values have been used (except lenscaptured)
                                $.checkUnused(gamma, 'a');
                                return $.back(gamma, 'a');
                            },
                        ];
                    }, 'a'),
                'passer',
            ),
            [],
        );
        $.recv(gamma, 20, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'passer')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'v');
                    $.recv(gamma, $.get(gamma, 'log')(`v from passer`, $.recv(gamma, 10, 'v')), []);
                    const res1 = 4;
                    $.recv(gamma, $.back(gamma, 'v'), tmp0);
                    return res1;
                },
                'x',
            ),
            'res',
        );
        return [$.get(gamma, 'res'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([
        [
            [`v from passer`, 3],
            [`Hello`, 10],
        ],
        [4, 20],
    ]);
});

it('Item 30 at test/lens.fl:330:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'a');
                        return [
                            3,
                            (res: any) => {
                                $.recv(gamma, res, 'b');
                                $.recv(
                                    gamma,
                                    $.get(gamma, 'log')(
                                        `Prev a`,
                                        $.recv(gamma, $.get(gamma, 'b'), 'a'),
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
            [],
        );
        $.recv(gamma, 20, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'passer')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'v');
                    $.recv(gamma, $.get(gamma, 'log')(`v from passer`, $.recv(gamma, 10, 'v')), []);
                    const res1 = 4;
                    $.recv(gamma, $.back(gamma, 'v'), tmp0);
                    return res1;
                },
                'x',
            ),
            'res',
        );
        return [$.get(gamma, 'res'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([
        [
            [`v from passer`, 3],
            [`Prev a`, 20],
        ],
        [4, 10],
    ]);
});

it('Item 31 at test/lens.fl:380:0', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg, 'x');
                        $.recv(gamma, $.back(gamma, 'x'), ['a', 'b']);
                        $.recv(
                            gamma,
                            $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, 'a')), 'a'),
                            [],
                        );
                        const res0 = 2;
                        $.recv(gamma, $.back(gamma, ['a', 'b']), 'x');
                        return [res0, $.back(gamma, 'x')];
                    }, 'x'),
                'incfst',
            ),
            [],
        );
        $.recv(gamma, [4, 10], 'm');
        return [$.tee(gamma, $.get(gamma, 'incfst')($.back(gamma, 'm')), 'm'), $.get(gamma, 'm')];
    });
    expect(result).toEqual([2, [5, 10]]);
});

it('Item 32 at test/lens.fl:396:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 3, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, 'x')), 'x'), []);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(4);
});

it('Item 33 at test/lens.fl:406:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 4], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            [],
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 34 at test/lens.fl:416:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 4], 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'incFst')($.back(gamma, 'x')), 'x'), []);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 35 at test/lens.fl:426:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'idf')($.back(gamma, 'x')), 'x'), []);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 36 at test/lens.fl:436:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'idl')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            [],
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(3);
});

it('Item 37 at test/lens.fl:446:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'united')($.back(gamma, 'x')),
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
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 38 at test/lens.fl:459:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        return $.tee2(
            gamma,
            $.get(gamma, 'makeunit')(null),
            (tmp0) => {
                $.recv(gamma, $.back(gamma, tmp0), 'l');
                const res1 = $.get(gamma, 'x');
                $.recv(gamma, $.back(gamma, 'l'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(2);
});

it('Error 0 at test/errors.fl:3:0', () => {
    expect(() =>
        $.run((gamma) => {
            return $.get(gamma, 'x');
        }),
    ).toThrow();
});

it('Error 1 at test/errors.fl:8:0', () => {
    expect(() =>
        $.run((gamma) => {
            $.recv(gamma, 4, 'x');
            $.recv(gamma, $.get(gamma, 'x'), 'y');
            return $.get(gamma, '+')($.get(gamma, 'x'), $.get(gamma, 'y'));
        }),
    ).toThrow();
});

it('Error 2 at test/errors.fl:15:0', () => {
    expect(() =>
        $.run((gamma) => {
            $.recv(gamma, 4, 'x');
            $.recv(gamma, 2, 'y');
            return $.get(gamma, 'x');
        }),
    ).toThrow();
});

it('Error 3 at test/errors.fl:22:0', () => {
    expect(() =>
        $.run((gamma) => {
            $.recv(
                gamma,
                $.recv(
                    gamma,
                    (arg: any) =>
                        $.wrap((gamma) => {
                            $.recv(gamma, arg, 'x');
                            return [$.get(gamma, 'consume')($.get(gamma, 'x')), $.back(gamma, 'x')];
                        }, 'x'),
                    'use',
                ),
                [],
            );
            $.recv(gamma, 3, 'x');
            return $.tee(gamma, $.get(gamma, 'use')($.back(gamma, 'x')), 'x');
        }),
    ).toThrow();
});

it('Error 4 at test/errors.fl:31:0', () => {
    expect(() =>
        $.run((gamma) => {
            $.recv(
                gamma,
                $.recv(
                    gamma,
                    (arg: any) =>
                        $.wrap((gamma) => {
                            $.recv(gamma, arg, 'a');
                            return [
                                3,
                                (res: any) => {
                                    $.recv(gamma, res, 'b');
                                    $.recv(gamma, 100, []);
                                    // assert that all values have been used (except lenscaptured)
                                    $.checkUnused(gamma, 'a');
                                    return $.back(gamma, 'a');
                                },
                            ];
                        }, 'a'),
                    'passer',
                ),
                [],
            );
            $.recv(gamma, 20, 'x');
            $.recv(
                gamma,
                $.tee2(
                    gamma,
                    $.get(gamma, 'passer')($.back(gamma, 'x')),
                    (tmp0) => {
                        $.recv(gamma, $.back(gamma, tmp0), 'v');
                        $.recv(
                            gamma,
                            $.get(gamma, 'log')(`v from passer`, $.recv(gamma, 10, 'v')),
                            [],
                        );
                        const res1 = 4;
                        $.recv(gamma, $.back(gamma, 'v'), tmp0);
                        return res1;
                    },
                    'x',
                ),
                'res',
            );
            return [$.get(gamma, 'res'), $.get(gamma, 'x')];
        }),
    ).toThrow();
});

it('Error 5 at test/errors.fl:48:0', () => {
    expect(() =>
        $.run((gamma) => {
            $.recv(
                gamma,
                $.recv(
                    gamma,
                    (arg: any) =>
                        $.wrap((gamma) => {
                            $.recv(gamma, arg, 'a');
                            return [
                                3,
                                (res: any) => {
                                    $.recv(gamma, res, 'b');
                                    $.recv(gamma, $.get(gamma, 'log')(`Hello`, 2), []);
                                    // assert that all values have been used (except lenscaptured)
                                    $.checkUnused(gamma, 'a');
                                    return $.back(gamma, 'a');
                                },
                            ];
                        }, 'a'),
                    'passer',
                ),
                [],
            );
            $.recv(gamma, 20, 'x');
            $.recv(
                gamma,
                $.tee2(
                    gamma,
                    $.get(gamma, 'passer')($.back(gamma, 'x')),
                    (tmp0) => {
                        $.recv(gamma, $.back(gamma, tmp0), 'v');
                        $.recv(
                            gamma,
                            $.get(gamma, 'log')(`v from passer`, $.recv(gamma, 10, 'v')),
                            [],
                        );
                        const res1 = 4;
                        $.recv(gamma, $.back(gamma, 'v'), tmp0);
                        return res1;
                    },
                    'x',
                ),
                'res',
            );
            return [$.get(gamma, 'res'), $.get(gamma, 'x')];
        }),
    ).toThrow();
});
