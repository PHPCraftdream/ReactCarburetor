import {emit, median} from '../../harness/lib.mjs';
import {graph, argumentsForGraph} from './graph.mjs';

const {K, M, layout} = argumentsForGraph();
const f = graph(K, M, layout);
const samples = [];
let checksum = 0;
let correct = f.top.get() === f.initial;
try {
    for (let i = 1; i <= 8; i++) correct &&= f.bump() === f.initial + i;
    const before = f.counts();
    const eventStart = f.events.length;
    for (let round = 0; round < 7; round++) {
        const start = performance.now();
        for (let i = 0; i < 16; i++) {
            const value = f.bump();
            checksum += value;
            correct &&= value === f.initial + 9 + round * 16 + i;
        }
        samples.push((performance.now() - start) / 16);
    }
    const after = f.counts();
    const deliveryChecksum = f.events.slice(eventStart).reduce((sum, value) => sum + value, 0);
    const bodies = after.topRuns - before.topRuns;
    const deliveries = f.events.length - eventStart;
    const upstreamQuiet = after.groupRuns === before.groupRuns
        && after.aliasRuns.every((n, i) => n === before.aliasRuns[i])
        && after.leafRuns.every((n, i) => n === before.leafRuns[i]);
    f.store.update(draft => { draft.noise++; });
    const noiseQuiet = f.top.get() === f.initial + 120
        && JSON.stringify(f.counts()) === JSON.stringify(after) && f.events.length === 120;
    emit({K, M, layout, initial: f.initial, writes: 112, checksum, deliveryChecksum, bodies,
        deliveries, correct, upstreamQuiet, noiseQuiet, updateGetMs: median(samples),
        timingUnit: 'milliseconds per completed extra update+get', done: true});
} finally { f.close(); }
