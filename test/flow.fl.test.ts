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
        $.recv(gamma, arg0, 'x');

        return [$.recv(gamma, $.get(gamma, '+')($.get(gamma, 'x'), 1), 'x'), $.back(gamma, 'x')];
    }, 'x'),
);

$.addFn('fst', (arg0: any) =>
    $.wrap(
        (gamma) => {
            $.recv(gamma, arg0, ['x', 'y']);

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

$.addFn('incFst', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

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
            $.get(gamma, 'x'),
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

$.addFn('gimme', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'initial');

        return [
            $.get(gamma, 'initial'),
            (res: any) => {
                $.recv(gamma, res, 'b');
                $.recv(gamma, $.get(gamma, 'drop')($.get(gamma, 'b')), []);
                // assert that all values have been used (except lenscaptured)
                $.checkUnused(gamma, []);
            },
        ];
    }, []),
);

$.addFn('swap', (arg0: any) =>
    $.wrap(
        (gamma) => {
            $.recv(gamma, arg0, ['x', 'y']);

            return [
                [$.get(gamma, 'y'), $.get(gamma, 'x')],
                (recv: any) => {
                    $.recv(gamma, recv, ['y', 'x']);
                    return $.back(gamma, ['x', 'y']);
                },
            ];
        },
        ['x', 'y'],
    ),
);

$.addFn("united'", (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

        return [[], $.back(gamma, 'x')];
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

$.addFn('take', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'a');

        return [$.recv(gamma, [], 'a'), $.back(gamma, 'a')];
    }, 'a'),
);

$.addFn('map', (arg0: any, arg1: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'f');
        $.recv(gamma, arg1, 'x');

        return [$.recv(gamma, $.get(gamma, 'f')($.get(gamma, 'x')), 'x'), $.back(gamma, 'x')];
    }, 'x'),
);

$.addFn('double', (arg0: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'x');

        return $.get(gamma, '*')($.get(gamma, 'x'), 2);
    }, []),
);

$.addFn('unmap', (arg0: any, arg1: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg0, 'f');
        $.recv(gamma, arg1, 'x');

        $.recv(gamma, $.tee(gamma, $.get(gamma, 'f')($.back(gamma, 'x')), 'x'), $.drop);
        return $.get(gamma, 'x');
    }, []),
);

it('Item 0 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:17:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 5, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'inc')($.back(gamma, 'x')), 'x'), $.drop);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(6);
});

it('Item 1 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:28:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'fst')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'y');
                    const res1 = $.recv(gamma, 5, 'y');
                    $.recv(gamma, $.back(gamma, 'y'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.get(gamma, 'z'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([1, [5, 2]]);
});

it('Item 2 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:42:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 4], 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'incFst')($.back(gamma, 'x')), 'x'), $.drop);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([2, 4]);
});

it('Item 3 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:53:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'idf')($.back(gamma, 'x')), 'x'), $.drop);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(2);
});

it('Item 4 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:64:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'idl')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'm');
                    const res1 = $.recv(gamma, 4, 'm');
                    $.recv(gamma, $.back(gamma, 'm'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.get(gamma, 'z'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([2, 4]);
});

it('Item 5 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:78:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'united')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'm');
                    const res1 = $.recv(gamma, [], 'm');
                    $.recv(gamma, $.back(gamma, 'm'), tmp0);
                    return res1;
                },
                'x',
            ),
            'z',
        );
        return [$.get(gamma, 'z'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([[], 2]);
});

it('Item 6 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:96:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 2, 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'gimme')(5),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'm');
                    const res1 = $.recv(gamma, [], 'm');
                    $.recv(gamma, $.back(gamma, 'm'), tmp0);
                    return res1;
                },
                [],
            ),
            'z',
        );
        return [$.get(gamma, 'z'), $.get(gamma, 'x')];
    });
    expect(result).toEqual([5, 2]);
});

it('Item 7 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:126:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'swap')($.back(gamma, 'x')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'z');
                    const res1 = $.tee(gamma, $.get(gamma, 'incFst')($.back(gamma, 'z')), 'z');
                    $.recv(gamma, $.back(gamma, 'z'), tmp0);
                    return res1;
                },
                'x',
            ),
            $.drop,
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([1, 3]);
});

it('Item 8 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:139:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], 'x');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'swap')($.back(gamma, 'x')),
                (tmp0) => {
                    return $.tee(gamma, $.get(gamma, 'incFst')($.back(gamma, tmp0)), tmp0);
                },
                'x',
            ),
            $.drop,
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([1, 3]);
});

it('Item 9 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:151:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 1, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, "united'")($.back(gamma, 'x')), 'x'), $.drop);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(1);
});

it('Item 10 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:162:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 1, 'x');
        return $.tee2(
            gamma,
            $.get(gamma, 'makeunit')([]),
            (tmp0) => {
                $.recv(gamma, $.back(gamma, tmp0), 'm');
                const res1 = $.get(gamma, 'x');
                $.recv(gamma, $.back(gamma, 'm'), tmp0);
                return res1;
            },
            [],
        );
    });
    expect(result).toEqual(1);
});

it('Item 11 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:173:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 1, 'x');
        $.recv(gamma, $.tee(gamma, $.get(gamma, 'take')($.back(gamma, 'x')), 'x'), $.drop);
        return $.get(gamma, 'x');
    });
    expect(result).toEqual([]);
});

it('Item 12 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:186:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, 10, 'x');
        $.recv(
            gamma,
            $.tee(gamma, $.get(gamma, 'map')($.get(gamma, 'double'), $.back(gamma, 'x')), 'x'),
            $.drop,
        );
        return $.get(gamma, 'x');
    });
    expect(result).toEqual(20);
});

it('Item 13 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:195:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                () =>
                    $.wrap((gamma) => {
                        return 4;
                    }, []),
                'nothing',
            ),
            $.drop,
        );
        return $.get(gamma, 'nothing')();
    });
    expect(result).toEqual(4);
});

it('Item 14 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:202:4', () => {
    const result = $.run((gamma) => {
        $.recv(
            gamma,
            $.recv(
                gamma,
                (arg0: any, arg1: any, arg2: any) =>
                    $.wrap((gamma) => {
                        $.recv(gamma, arg0, 'a');
                        $.recv(gamma, arg1, 'b');
                        $.recv(gamma, arg2, 'c');

                        return [
                            $.get(gamma, 'a'),
                            $.get(gamma, '+')($.get(gamma, 'b'), $.get(gamma, 'c')),
                        ];
                    }, []),
                'multi',
            ),
            $.drop,
        );
        return $.get(gamma, 'multi')(2, 3, 4);
    });
    expect(result).toEqual([2, 7]);
});

it('Item 15 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:215:4', () => {
    const result = $.run((gamma) => {
        return $.get(gamma, 'unmap')($.get(gamma, 'inc'), 5);
    });
    expect(result).toEqual(6);
});

it('Item 16 at /Users/jared/clone/exploration/laminar/ts/test/flow.fl:220:0', () => {
    const result = $.run((gamma) => {
        $.recv(gamma, [1, 2], 'a');
        $.recv(
            gamma,
            $.tee2(
                gamma,
                $.get(gamma, 'swap')($.back(gamma, 'a')),
                (tmp0) => {
                    $.recv(gamma, $.back(gamma, tmp0), 'x');
                    const res1 = 5;
                    $.recv(gamma, $.back(gamma, 'x'), tmp0);
                    return res1;
                },
                'a',
            ),
            'm',
        );
        return [$.get(gamma, 'm'), $.get(gamma, 'a')];
    });
    expect(result).toEqual([5, [1, 2]]);
});
