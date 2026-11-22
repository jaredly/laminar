import { expect, it } from 'bun:test';
import { reachableNames, typeDependencies } from '../src/backend/reachable.ts';

it('follows recursive layout and ABI dependencies without rooting unused cycles', () => {
    const graph = typeDependencies(
        {
            layouts: [
                {
                    id: 'node',
                    key: '',
                    kind: 'record',
                    fields: [
                        { name: 'next', kind: 'pointer', layout: 'node' },
                        { name: 'run', kind: 'code', abi: 'callback' },
                        { name: 'opaque', kind: 'pointer' },
                    ],
                },
                { id: 'unit', key: '', kind: 'unit', fields: [] },
                {
                    id: 'dead',
                    key: '',
                    kind: 'record',
                    fields: [{ name: 'next', kind: 'pointer', layout: 'dead' }],
                },
            ],
            abis: [
                {
                    id: 'callback',
                    key: '',
                    environment: 'opaque-pointer',
                    arguments: ['node'],
                    result: 'unit',
                },
            ],
        },
        new Map([
            ['node', 'Node'],
            ['unit', 'Unit'],
            ['dead', 'Dead'],
        ]),
        new Map([['callback', 'Callback']]),
    );
    expect([...reachableNames(graph, ['Node', 'external'])].sort()).toEqual([
        'Callback',
        'Node',
        'Unit',
    ]);
    expect([...reachableNames(graph, [])]).toEqual([]);
});
