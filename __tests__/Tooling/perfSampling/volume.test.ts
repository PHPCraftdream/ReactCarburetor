import {describe, expect, it} from '@rstest/core';
import {readFileSync} from 'node:fs';
import arrayGates from '../../../perf/gates/array.mjs';

describe('positional workload', () => {
    it('reduces only diagnostic repeats and keeps the fixture and exact gate matrix', () => {
        const source = readFileSync(new URL('../../../perf/scenarios/array/positional.mjs', import.meta.url), 'utf8');
        expect(source).toContain('const WARMUP = 0;');
        expect(source).toContain('const ROUNDS = 1;');
        expect(source).toContain('Number(process.argv[2] ?? 10000)');
        expect(source).toContain('round >= WARMUP');
        const entries = arrayGates.filter(entry => entry.scenario === 'array/positional');
        expect(entries.map(entry => [entry.id, entry.args])).toEqual([
            ['array/positional@10k', [10000, 0]],
            ['array/positional@10k-subs', [10000, 1]],
        ]);
        expect(entries[0].gates.map(gate => gate.metric)).toEqual([
            'spliceHeadPaths', 'spliceMidPaths', 'shiftPaths', 'unshiftPaths',
            'reversePaths', 'sortPaths', 'correct', 'subs',
        ]);
        expect(entries[1].gates.map(gate => gate.metric)).toEqual([
            'spliceHeadPaths', 'spliceMidPaths', 'shiftPaths', 'unshiftPaths',
            'reversePaths', 'sortPaths',
            'spliceHeadWoken', 'spliceMidWoken', 'shiftWoken', 'unshiftWoken', 'reverseWoken', 'sortWoken',
            'spliceHeadOtherWakes', 'spliceMidOtherWakes', 'shiftOtherWakes',
            'unshiftOtherWakes',
            'reverseOtherWakes', 'sortOtherWakes', 'correct', 'subs',
        ]);
    });
});
