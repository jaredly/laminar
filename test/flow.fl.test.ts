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
            $.recv(gamma2, arg0, 'x');

            return [
                $.recv(gamma2, $.back(gamma2, '+')($.back(gamma2, 'x'), 1), 'x'),
                $.back(gamma2, 'x'),
            ];
        },
        ['x'],
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

$.addFn('gimme', (arg0: any) =>
    $.wrap((gamma2) => {
        $.recv(gamma2, arg0, 'initial');

        return [
            $.back(gamma2, 'initial'),
            (res: any) => {
                $.recv(gamma2, res, 'b');
                $.recv(gamma2, $.back(gamma2, 'drop')($.back(gamma2, 'b')), []);
                // assert that all values have been used (except lenscaptured)
                $.checkUnused(gamma2, []);
            },
        ];
    }, []),
);

$.addFn('swap', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, ['x', 'y']);

            return [
                [$.back(gamma2, 'y'), $.back(gamma2, 'x')],
                (recv: any) => {
                    $.recv(gamma2, recv, ['y', 'x']);
                    return $.back(gamma2, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);

$.addFn("united'", (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'x');

            return [[], $.back(gamma2, 'x')];
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

$.addFn('take', (arg0: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'a');

            return [$.recv(gamma2, [], 'a'), $.back(gamma2, 'a')];
        },
        ['a'],
    ),
);

$.addFn('map', (arg0: any, arg1: any) =>
    $.wrap(
        (gamma2) => {
            $.recv(gamma2, arg0, 'f');
            $.recv(gamma2, arg1, 'x');

            return [
                $.recv(gamma2, $.back(gamma2, 'f')($.back(gamma2, 'x')), 'x'),
                $.back(gamma2, 'x'),
            ];
        },
        ['x'],
    ),
);

$.addFn('double', (arg0: any) =>
    $.wrap((gamma2) => {
        $.recv(gamma2, arg0, 'x');

        return $.back(gamma2, '*')($.back(gamma2, 'x'), 2);
    }, []),
);

$.addFn('unmap', (arg0: any, arg1: any) =>
    $.wrap((gamma2) => {
        $.recv(gamma2, arg0, 'f');
        $.recv(gamma2, arg1, 'x');

        $.recv(gamma2, $.tee(gamma2, $.back(gamma2, 'f')($.back(gamma2, 'x')), 'x'), $.drop);
        return $.back(gamma2, 'x');
    }, []),
);

it('Item 0 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:17:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 5, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'inc')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(6);
});

it('Item 1 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:28:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'fst')($.back(gamma1, 'x')),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'y');
                    const res1 = $.recv(gamma1, 5, 'y');
                    $.recv(gamma1, $.back(gamma1, 'y'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma1, 'z'), $.back(gamma1, 'x')];
    });
    expect(result).toEqual([1, [5, 2]]);
});

it('Item 2 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:42:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 4], 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'incFst')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 3 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:53:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'idf')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 4 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:64:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'idl')($.back(gamma1, 'x')),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'm');
                    const res1 = $.recv(gamma1, 4, 'm');
                    $.recv(gamma1, $.back(gamma1, 'm'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma1, 'z'), $.back(gamma1, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 5 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:78:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'united')($.back(gamma1, 'x')),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'm');
                    const res1 = $.recv(gamma1, [], 'm');
                    $.recv(gamma1, $.back(gamma1, 'm'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma1, 'z'), $.back(gamma1, 'x')];
    });
    expect(result).toEqual([[], 2]);
});

it('Item 6 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:96:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 2, 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'gimme')(5),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'm');
                    const res1 = $.recv(gamma1, [], 'm');
                    $.recv(gamma1, $.back(gamma1, 'm'), tmp0);
                    return res1;
                },
                [],
            ),
            'z',
        );
        return [$.back(gamma1, 'z'), $.back(gamma1, 'x')];
    });
    expect(result).toEqual([5, 2]);
});

it('Item 7 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:108:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 1, 'a');
        $.recv(
            gamma1,
            (() => {
                $.recv(gamma1, 2, 'c');
                return 3;
            })(),
            'b',
        );
        return [$.back(gamma1, 'a'), $.back(gamma1, 'b'), $.back(gamma1, 'c')];
    });
    expect(result).toEqual([1, 3, 2]);
});

it('Item 8 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:138:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'swap')($.back(gamma1, 'x')),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'z');
                    const res1 = $.tee(gamma1, $.back(gamma1, 'incFst')($.back(gamma1, 'z')), 'z');
                    $.recv(gamma1, $.back(gamma1, 'z'), tmp0);
                    return res1;
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([1, 3]);
});

it('Item 9 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:151:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], 'x');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'swap')($.back(gamma1, 'x')),
                (tmp0) => {
                    return $.tee(gamma1, $.back(gamma1, 'incFst')($.back(gamma1, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([1, 3]);
});

it('Item 10 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:163:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 1, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, "united'")($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(1);
});

it('Item 11 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:174:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 1, 'x');
        return $.tee2(
            gamma1,
            $.back(gamma1, 'makeunit')([]),
            (tmp0) => {
                $.recv(gamma1, $.back(gamma1, tmp0), 'm');
                const res1 = $.back(gamma1, 'x');
                $.recv(gamma1, $.back(gamma1, 'm'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(1);
});

it('Item 12 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:185:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 1, 'x');
        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'take')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual([]);
});

it('Item 13 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:198:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, 10, 'x');
        $.recv(
            gamma1,
            $.tee(
                gamma1,
                $.back(gamma1, 'map')($.back(gamma1, 'double'), $.back(gamma1, 'x')),
                'x',
            ),
            $.drop,
        );
        return $.back(gamma1, 'x');
    });
    expect(result).toEqual(20);
});

it('Item 14 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:207:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                () =>
                    $.wrap((gamma2) => {
                        return 4;
                    }, []),
                'nothing',
            ),
            $.drop,
        );
        return $.back(gamma1, 'nothing')();
    });
    expect(result).toEqual(4);
});

it('Item 15 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:214:4', () => {
    const result = $.run((gamma1) => {
        $.recv(
            gamma1,
            $.recv(
                gamma1,
                (arg0: any, arg1: any, arg2: any) =>
                    $.wrap((gamma2) => {
                        $.recv(gamma2, arg0, 'a');
                        $.recv(gamma2, arg1, 'b');
                        $.recv(gamma2, arg2, 'c');

                        return [
                            $.back(gamma2, 'a'),
                            $.back(gamma2, '+')($.back(gamma2, 'b'), $.back(gamma2, 'c')),
                        ];
                    }, []),
                'multi',
            ),
            $.drop,
        );
        return $.back(gamma1, 'multi')(2, 3, 4);
    });
    expect(result).toEqual([2, 7]);
});

it('Item 16 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:227:4', () => {
    const result = $.run((gamma1) => {
        return $.back(gamma1, 'unmap')($.back(gamma1, 'inc'), 5);
    });
    expect(result).toEqual(6);
});

it('Item 17 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:232:0', () => {
    const result = $.run((gamma1) => {
        $.recv(gamma1, [1, 2], 'a');
        $.recv(
            gamma1,
            $.tee2(
                gamma1,
                $.back(gamma1, 'swap')($.back(gamma1, 'a')),
                (tmp0) => {
                    $.recv(gamma1, $.back(gamma1, tmp0), 'x');
                    const res1 = 5;
                    $.recv(gamma1, $.back(gamma1, 'x'), tmp0);
                    return res1;
                },
                'a',
            ),
            'm',
        );
        return [$.back(gamma1, 'm'), $.back(gamma1, 'a')];
    });
    expect(result).toEqual([5, [1, 2]]);
});
