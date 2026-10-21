import {describe, expect, it} from '@rstest/core';
import sampling from '../../../perf/sampling.mjs';
const {classifySampling, demandByKey, phaseBudget, elapsedRow, timingSummary} = sampling;

describe('counter sampling', () => {
    it('samples deterministic non-time gates once but mixed and byte metrics repeatedly', () => {
        expect(classifySampling({gates: [{metric: 'hits', equals: 2}]})).toBe('counter');
        expect(classifySampling({gates: [{metric: 'hits', max: 2},
            {metric: 'costMs', min: 0}]})).toBe('mixed');
        expect(classifySampling({gates: [{metric: 'heapBytes', max: 5}]})).toBe('mixed');
    });
    it('shares the largest demand, including transitive scale-source consumers', () => {
        const entries = [{id: 'source', scenario: 'a', gates: [{metric: 'n', equals: 1}]},
            {id: 'counter', scenario: 'a', gates: [{metric: 'n', equals: 1}]},
            {id: 'scaled', scenario: 'b', gates: [{metric: 'n', scale: {from: 'source'}, max: 2}]}];
        expect(demandByKey(entries, 1)).toEqual(new Map([
            ['["a",[],[]]', 3],
            ['["b",[],[]]', 3],
        ]));
    });
    it('honors requested timing counts and propagates the maximum shared demand', () => {
        const entries = [
            {id: 'five', scenario: 'a', runs: 5, gates: [{metric: 'elapsedMs', max: 5}]},
            {id: 'nine', scenario: 'a', runs: 9, gates: [{metric: 'elapsedMs', max: 5}]},
            {id: 'counter', scenario: 'a', gates: [{metric: 'n', equals: 1}]},
        ];
        expect(demandByKey(entries, 1, 5).get('["a",[],[]]')).toBe(9);
        expect(demandByKey([{...entries[0], runs: 5}], 1, 5).get('["a",[],[]]')).toBe(5);
        expect(demandByKey([{...entries[0], runs: undefined}], 1, 5).get('["a",[],[]]')).toBe(5);
        expect(demandByKey([{...entries[0], runs: undefined}], 1, 9).get('["a",[],[]]')).toBe(9);
        expect(demandByKey([{...entries[0], runs: undefined}], 1, 1).get('["a",[],[]]')).toBe(3);
    });
    it('rejects invalid counter and timing run counts', () => {
        expect(() => demandByKey([], 0)).toThrow();
        expect(() => demandByKey([], -1)).toThrow();
        expect(() => demandByKey([], 1, 0)).toThrow();
        expect(() => demandByKey([{id: 'bad', runs: 1.5}])).toThrow();
    });
    it('treats empty, unknown, compound, and memory-unit gates as mixed', () => {
        for (const gates of [[], [{metric: 'x', nonsense: 1}], [{metric: 'x', equals: 1, max: 2}],
            [{metric: 'driftKb', max: 1}], [{metric: 'heapBytes', max: 1}], [{metric: 'x', over: 'y'}]]) {
            expect(classifySampling({gates})).toBe('mixed');
        }
    });
    it('sorts elapsed rows descending before selecting the top twenty', () => {
        let text = '';
        timingSummary('t', Array.from({length: 25}, (_, i) => ({id: String(i), elapsedMs: i})),
            value => {text = value;});
        expect(text).toContain('| 24 | 24ms |');
        expect(text).not.toContain('| 0 | 0ms |');
    });
    it('reports centralized phase budgets and elapsed failures', () => {
        expect(phaseBudget('combined')).toBe(40 * 60_000);
        expect(elapsedRow({id: 'x'}, 12, new Error('bad')).elapsedMs).toBe(12);
        let text = '';
        timingSummary('t', Array.from({length: 25}, (_, i) => ({id: String(i), elapsedMs: i})),
            value => {text = value;});
        expect(text.match(/\| \d+ \|/g)).toHaveLength(20);
    });
});
