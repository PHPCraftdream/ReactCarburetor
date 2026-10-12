import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {records, snapshot, intact, pairCount, covers} from '../computed42/snapshots.mjs';
import {graph, argumentsForGraph} from './graph.mjs';

const {K, M, layout} = argumentsForGraph();
const f = graph(K, M, layout);
try {
    assert.equal(f.top.get(), f.initial);
    const borrowed = records(f.group)[0];
    const parts = borrowed.parts.slice();
    assert.equal(parts.length, M);
    assert.ok(f.aliases.every(alias => records(alias)[0] === borrowed));
    const saved = [f.top, f.group, ...f.aliases, ...f.leaves].map(snapshot);
    const oldTop = records(f.top).find(record => record.source === f.store);
    const common = new Set(parts.map(part => part.reads));
    const nativeGet = Map.prototype.get;
    const count = body => {
        let probes = 0;
        Map.prototype.get = function(key) {
            if (common.has(key)) probes++;
            return nativeGet.call(this, key);
        };
        try { return {value: body(), probes}; }
        finally { Map.prototype.get = nativeGet; }
    };
    const emptyProbes = count(() => 0).probes;
    const known = new Map(parts.map(part => [part.reads, part.version]));
    const positiveProbes = count(() => { for (const part of parts) known.get(part.reads); }).probes;
    const work = count(() => f.bump());
    const pairs = pairCount(f.top);
    const current = work.value;
    const counts = f.counts();
    const deliveries = f.events.length;
    const deliveryChecksum = f.events.reduce((sum, value) => sum + value, 0);
    const pairCoverage = covers(f.top, f.leaves);
    const output = records(f.top).find(record => record.source === f.store);
    const actual = output.parts ?? [output];
    const commonOrder = actual.filter(pair => common.has(pair.reads));
    const orderCorrect = commonOrder.length === M && commonOrder.every((pair, i) =>
        pair.reads === parts[i].reads && pair.version === parts[i].version)
        && (layout === 'distinct' || (layout === 'bare-first'
            ? !common.has(actual[0].reads) : !common.has(actual.at(-1).reads)));
    const snapshotsIntact = saved.every(intact)
        && (oldTop.parts ?? [oldTop]).length === (layout === 'distinct' ? M : M + 1);
    const beforeNoise = JSON.stringify(f.counts());
    f.store.update(draft => { draft.noise++; });
    const noiseQuiet = f.top.get() === f.initial + 1 && JSON.stringify(f.counts()) === beforeNoise
        && f.events.length === 1;
    f.store.update(draft => { draft.p0++; });
    const final = f.top.get();
    const finalCounts = f.counts();
    const commonUpdateCorrect = final === f.initial + 1 + K && f.top.getVersion() === 2
        && JSON.stringify(f.events) === JSON.stringify([f.initial + 1, f.initial + 1 + K])
        && finalCounts.groupRuns === 2 && finalCounts.topRuns === 3
        && finalCounts.aliasRuns.every(n => n === 2)
        && finalCounts.leafRuns.every((n, i) => n === (i === 0 ? 2 : 1))
        && covers(f.top, f.leaves) && pairCount(f.top) === M + 1 && saved.every(intact);
    emit({K, M, layout, initial: f.initial, current, final, pairs,
        commonProbes: work.probes, positiveProbes, emptyProbes,
        bodyRuns: counts.topRuns, groupRuns: counts.groupRuns,
        aliasRuns: counts.aliasRuns.reduce((sum, n) => sum + n, 0),
        leafRuns: counts.leafRuns.reduce((sum, n) => sum + n, 0), deliveries, deliveryChecksum,
        pairCoverage, orderCorrect, snapshotsIntact, noiseQuiet, commonUpdateCorrect,
        workUnit: 'Map.get calls keyed by genuine common reads identities', done: true});
} finally { f.close(); }
