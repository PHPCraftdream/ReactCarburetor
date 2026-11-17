import {describe, expect, it} from '@rstest/core';
import sampling from '../../../perf/harness/sampling.mjs';
const {classifySampling, demandByKey, phaseBudget, elapsedRow, timingSummary} = sampling;
const {concurrentKeys, parseShard, shardOf} = sampling;

// Scenario reader that reports clean, deterministic sources for every scenario name.
const clean = (): string => '';

interface IGateEntry {
    id: string;
    scenario: string;
    gates: unknown[];
}

const manifest = async (file: string): Promise<IGateEntry[]> =>
    (await import('../../../perf/gates/' + file)).default as IGateEntry[];

describe('counter sampling', () => {
    it('samples deterministic non-time gates once but mixed and byte metrics repeatedly', () => {
        expect(classifySampling({scenario: 's', gates: [{metric: 'hits', equals: 2}]}, clean)).toBe('counter');
        expect(classifySampling({scenario: 's', gates: [{metric: 'hits', max: 2},
            {metric: 'costMs', min: 0}]}, clean)).toBe('mixed');
        expect(classifySampling({scenario: 's', gates: [{metric: 'heapBytes', max: 5}]}, clean)).toBe('mixed');
    });
    it('shares the largest demand, including transitive scale-source consumers', () => {
        const entries = [{id: 'source', scenario: 'a', gates: [{metric: 'n', equals: 1}]},
            {id: 'counter', scenario: 'a', gates: [{metric: 'n', equals: 1}]},
            {id: 'scaled', scenario: 'b', gates: [{metric: 'n', scale: {from: 'source'}, max: 2}]}];
        expect(demandByKey(entries, 1, 3, clean)).toEqual(new Map([
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
        expect(demandByKey(entries, 1, 5, clean).get('["a",[],[]]')).toBe(9);
        expect(demandByKey([{...entries[0], runs: 5}], 1, 5, clean).get('["a",[],[]]')).toBe(5);
        expect(demandByKey([{...entries[0], runs: undefined}], 1, 5, clean).get('["a",[],[]]')).toBe(5);
        expect(demandByKey([{...entries[0], runs: undefined}], 1, 9, clean).get('["a",[],[]]')).toBe(9);
        expect(demandByKey([{...entries[0], runs: undefined}], 1, 1, clean).get('["a",[],[]]')).toBe(3);
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
            expect(classifySampling({scenario: 's', gates}, clean)).toBe('mixed');
        }
    });
    it('keeps garbage-collection and heap sensitive scenarios multi-sample', () => {
        const counter = [{metric: 'collected', equals: true}];
        const read = (source: string) => (): string => source;
        expect(classifySampling({scenario: 's', gates: counter}, read('const ref = new WeakRef({});'))).toBe('mixed');
        expect(classifySampling({scenario: 's', gates: counter}, read('globalThis.gc();'))).toBe('mixed');
        expect(classifySampling({scenario: 's', gates: counter}, read('process.memoryUsage();'))).toBe('mixed');
        expect(classifySampling({scenario: 's', nodeArgs: ['--expose-gc'], gates: counter}, clean)).toBe('mixed');
        expect(classifySampling({scenario: 's', gates: counter}, () => undefined)).toBe('mixed');
        const sources: Array<[string, string]> = [['a.mjs', "import './helper.mjs';"],
            ['helper.mjs', 'new FinalizationRegistry(() => {});']];
        const chained = (path: string): string | undefined => sources.find(([name]) => path.endsWith(name))?.[1];
        expect(classifySampling({scenario: 'a', gates: counter}, chained)).toBe('mixed');
    });
    it('classifies the retention gates of the real manifests as multi-sample', async () => {
        const find = async (file: string, part: string) => {
            const entry = (await manifest(file)).find(candidate => candidate.id.includes(part));
            expect(entry).toBeDefined();
            return entry!;
        };
        for (const [file, part] of [['resource-retention41.mjs', ''], ['hooks44.mjs', 'computed-snapshot-lifetime'],
            ['array.mjs', 'live']] as const) {
            expect(classifySampling(await find(file, part))).toBe('mixed');
        }
    });
    it('keeps most real entries single-sample so the run stays short', async () => {
        const { readdirSync } = await import('node:fs');
        let counters = 0;
        let total = 0;
        for (const file of readdirSync('perf/gates').filter(name => name.endsWith('.mjs'))) {
            for (const entry of await manifest(file)) {
                total++;
                if (classifySampling(entry) === 'counter') counters++;
            }
        }
        expect(counters / total).toBeGreaterThan(0.7);
    });
    it('sorts elapsed rows descending before selecting the top twenty', () => {
        let text = '';
        timingSummary('t', Array.from({length: 25}, (_, i) => ({id: String(i), elapsedMs: i})),
            value => {text = value;});
        expect(text).toContain('| 24 | 24ms |');
        expect(text).not.toContain('| 0 | 0ms |');
    });
    it('reports centralized phase budgets and elapsed failures', () => {
        expect(phaseBudget('combined')).toBe(5 * 60_000);
        expect(elapsedRow({id: 'x'}, 12, new Error('bad')).elapsedMs).toBe(12);
        let text = '';
        timingSummary('t', Array.from({length: 25}, (_, i) => ({id: String(i), elapsedMs: i})),
            value => {text = value;});
        expect(text.match(/\| \d+ \|/g)).toHaveLength(20);
    });
});

describe('concurrent sampling', () => {
    it('runs side by side only the keys no timed entry reads', () => {
        const entries = [
            {id: 'counter', scenario: 'a', gates: [{metric: 'hits', equals: 2}]},
            {id: 'heap', scenario: 'b', gates: [{metric: 'heapBytes', max: 5}, {metric: 'collected', equals: true}]},
            {id: 'timed', scenario: 'c', gates: [{metric: 'costMs', max: 5}]},
            {id: 'sharesTimed', scenario: 'c', gates: [{metric: 'hits', equals: 1}]},
            {id: 'overTime', scenario: 'd', gates: [{metric: 'hits', over: 'controlMs', max: 1}]},
            {id: 'overCounts', scenario: 'e', gates: [{metric: 'maps', over: 'controlMaps', max: 0.5}]},
            {id: 'source', scenario: 'f', args: [2], gates: [{metric: 'found', equals: 2}]},
            {id: 'scaled', scenario: 'f', args: [8], gates: [{metric: 'found', equals: 8},
                {metric: 'lintMs', scale: {from: 'source'}, max: 12}]},
            {id: 'ungated', scenario: 'g', gates: []},
            {id: 'gcFlag', scenario: 'h', nodeArgs: ['--expose-gc'], gates: [{metric: 'hits', equals: 1}]},
        ];

        expect([...concurrentKeys(entries, clean)].sort((a, b) => a.localeCompare(b)))
            .toEqual(['["a",[],[]]', '["b",[],[]]', '["e",[],[]]']);
    });
    it('keeps a scenario that depends on garbage collection serial', () => {
        const entries = [{id: 'weak', scenario: 'w', gates: [{metric: 'collected', equals: true}]},
            {id: 'plain', scenario: 'p', gates: [{metric: 'hits', equals: 1}]}];
        const read = (path: string): string => (path.endsWith('w.mjs') ? 'new WeakRef(x)' : '');

        expect([...concurrentKeys(entries, read)]).toEqual(['["p",[],[]]']);
    });
    it('keeps every lint-binary scaling entry serial', async () => {
        const entries = [...await manifest('lintBinary.mjs'), ...await manifest('lintClasses.mjs')];

        expect(concurrentKeys(entries).size).toBe(0);
    });
});

describe('shards', () => {
    const entries = [
        {id: 'heavy', scenario: 'h', gates: [{metric: 'n', equals: 1}]},
        {id: 'shares', scenario: 'h', gates: [{metric: 'm', equals: 1}]},
        {id: 'source', scenario: 's', args: [2], gates: [{metric: 'n', equals: 2}]},
        {id: 'scaled', scenario: 's', args: [8], gates: [{metric: 'lintMs', scale: {from: 'source'}, max: 12}]},
        {id: 'a', scenario: 'a', gates: [{metric: 'n', equals: 1}]},
        {id: 'b', scenario: 'b', gates: [{metric: 'n', equals: 1}]},
    ];
    const weights = {heavy: 900, source: 300, scaled: 300, a: 100, b: 100};

    it('covers every entry exactly once and keeps keys and scale pairs together', () => {
        const parts = [1, 2, 3].map(index => shardOf(entries, index, 3, weights, clean));
        const all = parts.flatMap(part => [...part]).sort((x, y) => x.localeCompare(y));

        expect(all).toEqual(entries.map(entry => entry.id).sort((x, y) => x.localeCompare(y)));
        const home = (id: string): number => parts.findIndex(part => part.has(id));
        expect(home('shares')).toBe(home('heavy'));
        expect(home('scaled')).toBe(home('source'));
    });
    it('balances by cost, a side-by-side key counting a third of its serial time', () => {
        const part = (index: number): string[] =>
            [...shardOf(entries, index, 3, weights, clean)].sort((x, y) => x.localeCompare(y));

        // The timed scale pair costs 600; the counter key 'h' 900 / 3 = 300; a and b 33 each.
        expect(part(1)).toEqual(['scaled', 'source']);
        expect(part(2)).toEqual(['heavy', 'shares']);
        expect(part(3)).toEqual(['a', 'b']);
    });
    it('parses i/n and rejects anything else', () => {
        expect(parseShard('2/6')).toEqual({index: 2, count: 6});
        for (const text of ['0/3', '4/3', '1/0', 'x', '1-3']) expect(() => parseShard(text)).toThrow();
    });
});
