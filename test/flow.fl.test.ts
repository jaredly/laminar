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
        $.recv(gamma1, arg0, 'x');

        return [
            $.recv(gamma1, $.back(gamma1, '+')($.back(gamma1, 'x'), 1), 'x'),
            $.back(gamma1, 'x'),
        ];
    }, 'x'),
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

$.addFn('gimme', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'initial');

        return [
            $.back(gamma1, 'initial'),
            (res: any) => {
                $.recv(gamma1, res, 'b');
                $.recv(gamma1, $.back(gamma1, 'drop')($.back(gamma1, 'b')), []);
                // assert that all values have been used (except lenscaptured)
                $.checkUnused(gamma1, []);
            },
        ];
    }, []),
);

$.addFn('swap', (arg0: any) =>
    $.wrap(
        (gamma1) => {
            $.recv(gamma1, arg0, ['x', 'y']);

            return [
                [$.back(gamma1, 'y'), $.back(gamma1, 'x')],
                (recv: any) => {
                    $.recv(gamma1, recv, ['y', 'x']);
                    return $.back(gamma1, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);

$.addFn("united'", (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'x');

        return [[], $.back(gamma1, 'x')];
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

$.addFn('take', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'a');

        return [$.recv(gamma1, [], 'a'), $.back(gamma1, 'a')];
    }, 'a'),
);

$.addFn('map', (arg0: any, arg1: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'f');
        $.recv(gamma1, arg1, 'x');

        return [$.recv(gamma1, $.back(gamma1, 'f')($.back(gamma1, 'x')), 'x'), $.back(gamma1, 'x')];
    }, 'x'),
);

$.addFn('double', (arg0: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'x');

        return $.back(gamma1, '*')($.back(gamma1, 'x'), 2);
    }, []),
);

$.addFn('unmap', (arg0: any, arg1: any) =>
    $.wrap((gamma1) => {
        $.recv(gamma1, arg0, 'f');
        $.recv(gamma1, arg1, 'x');

        $.recv(gamma1, $.tee(gamma1, $.back(gamma1, 'f')($.back(gamma1, 'x')), 'x'), $.drop);
        return $.back(gamma1, 'x');
    }, []),
);

it('Item 0 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:17:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 5, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'inc')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(6);
});

it('Item 1 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:28:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'fst')($.back(gamma0, 'x')),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'y');
                    const res1 = $.recv(gamma0, 5, 'y');
                    $.recv(gamma0, $.back(gamma0, 'y'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma0, 'z'), $.back(gamma0, 'x')];
    });
    expect(result).toEqual([1, [5, 2]]);
});

it('Item 2 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:42:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 4], 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'incFst')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 3 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:53:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'idf')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 4 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:64:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'idl')($.back(gamma0, 'x')),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'm');
                    const res1 = $.recv(gamma0, 4, 'm');
                    $.recv(gamma0, $.back(gamma0, 'm'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma0, 'z'), $.back(gamma0, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 5 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:78:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'united')($.back(gamma0, 'x')),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'm');
                    const res1 = $.recv(gamma0, [], 'm');
                    $.recv(gamma0, $.back(gamma0, 'm'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.back(gamma0, 'z'), $.back(gamma0, 'x')];
    });
    expect(result).toEqual([[], 2]);
});

it('Item 6 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:96:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 2, 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'gimme')(5),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'm');
                    const res1 = $.recv(gamma0, [], 'm');
                    $.recv(gamma0, $.back(gamma0, 'm'), tmp0);
                    return res1;
                },
                [],
            ),
            'z',
        );
        return [$.back(gamma0, 'z'), $.back(gamma0, 'x')];
    });
    expect(result).toEqual([5, 2]);
});

it('Item 7 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:126:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'swap')($.back(gamma0, 'x')),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'z');
                    const res1 = $.tee(gamma0, $.back(gamma0, 'incFst')($.back(gamma0, 'z')), 'z');
                    $.recv(gamma0, $.back(gamma0, 'z'), tmp0);
                    return res1;
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([1, 3]);
});

it('Item 8 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:139:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], 'x');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'swap')($.back(gamma0, 'x')),
                (tmp0) => {
                    return $.tee(gamma0, $.back(gamma0, 'incFst')($.back(gamma0, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([1, 3]);
});

it('Item 9 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:151:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 1, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, "united'")($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(1);
});

it('Item 10 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:162:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 1, 'x');
        return $.tee2(
            gamma0,
            $.back(gamma0, 'makeunit')([]),
            (tmp0) => {
                $.recv(gamma0, $.back(gamma0, tmp0), 'm');
                const res1 = $.back(gamma0, 'x');
                $.recv(gamma0, $.back(gamma0, 'm'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(1);
});

it('Item 11 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:173:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 1, 'x');
        $.recv(gamma0, $.tee(gamma0, $.back(gamma0, 'take')($.back(gamma0, 'x')), 'x'), $.drop);
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual([]);
});

it('Item 12 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:186:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, 10, 'x');
        $.recv(
            gamma0,
            $.tee(
                gamma0,
                $.back(gamma0, 'map')($.back(gamma0, 'double'), $.back(gamma0, 'x')),
                'x',
            ),
            $.drop,
        );
        return $.back(gamma0, 'x');
    });
    expect(result).toEqual(20);
});

it('Item 13 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:195:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                () =>
                    $.wrap((gamma1) => {
                        return 4;
                    }, []),
                'nothing',
            ),
            $.drop,
        );
        return $.back(gamma0, 'nothing')();
    });
    expect(result).toEqual(4);
});

it('Item 14 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:202:4', () => {
    const result = $.run((gamma0) => {
        $.recv(
            gamma0,
            $.recv(
                gamma0,
                (arg0: any, arg1: any, arg2: any) =>
                    $.wrap((gamma1) => {
                        $.recv(gamma1, arg0, 'a');
                        $.recv(gamma1, arg1, 'b');
                        $.recv(gamma1, arg2, 'c');

                        return [
                            $.back(gamma1, 'a'),
                            $.back(gamma1, '+')($.back(gamma1, 'b'), $.back(gamma1, 'c')),
                        ];
                    }, []),
                'multi',
            ),
            $.drop,
        );
        return $.back(gamma0, 'multi')(2, 3, 4);
    });
    expect(result).toEqual([2, 7]);
});

it('Item 15 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:215:4', () => {
    const result = $.run((gamma0) => {
        return $.back(gamma0, 'unmap')($.back(gamma0, 'inc'), 5);
    });
    expect(result).toEqual(6);
});

it('Item 16 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:220:0', () => {
    const result = $.run((gamma0) => {
        $.recv(gamma0, [1, 2], 'a');
        $.recv(
            gamma0,
            $.tee2(
                gamma0,
                $.back(gamma0, 'swap')($.back(gamma0, 'a')),
                (tmp0) => {
                    $.recv(gamma0, $.back(gamma0, tmp0), 'x');
                    const res1 = 5;
                    $.recv(gamma0, $.back(gamma0, 'x'), tmp0);
                    return res1;
                },
                'a',
            ),
            'm',
        );
        return [$.back(gamma0, 'm'), $.back(gamma0, 'a')];
    });
    expect(result).toEqual([5, [1, 2]]);
});
