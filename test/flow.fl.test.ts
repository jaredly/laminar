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
        $.recv(gamma, arg, 'x');
        return [$.recv(gamma, $.get(gamma, '+')($.get(gamma, 'x'), 1), 'x'), $.back(gamma, 'x')];
    }, 'x'),
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
        return [[], $.back(gamma, 'x')];
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

$.addFn('swap', (arg: any) =>
    $.wrap(
        (gamma) => {
            $.recv(gamma, arg, ['x', 'y']);
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

$.addFn("united'", (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'x');
        return [[], $.back(gamma, 'x')];
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

$.addFn('take', (arg: any) =>
    $.wrap((gamma) => {
        $.recv(gamma, arg, 'a');
        return [$.recv(gamma, [], 'a'), $.back(gamma, 'a')];
    }, 'a'),
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
