import assert from 'node:assert/strict';
import {emit, median} from '../../harness/lib.mjs';
import {api} from './api.mjs';
import {graph} from './graph.mjs';

const [K, M] = process.argv.slice(2, 4).map(Number);
const layout = process.argv[4] ?? 'aliases';
const libraries = await api(layout === 'mixed');
const validation = graph(libraries, K, M, layout);
try {
    assert.equal(validation.top.get(), validation.initial);
    for (let i = 1; i <= 120; i++) assert.equal(validation.bump(), validation.initial + i);
    assert.equal(validation.runs.top, 121);
    assert.equal(validation.runs.group, 1);
    assert.deepEqual(validation.events, Array.from({length: 120}, (_, i) => validation.initial + i + 1));
    assert.equal(validation.top.getVersion(), 120);
    const after = structuredClone(validation.runs);
    validation.sources[0].update(draft => { draft.noise++; });
    assert.equal(validation.top.get(), validation.initial + 120);
    assert.deepEqual(validation.runs, after);
    assert.equal(validation.events.length, 120);
    assert.ok(validation.intact());
} finally { validation.close(); }
const f = graph(libraries, K, M, layout, false);
const samples = [];
let checksum = 0;
try {
    assert.equal(f.top.get(), f.initial);
    for (let i = 1; i <= 8; i++) assert.equal(f.bump(), f.initial + i);
    for (let round = 0; round < 7; round++) {
        const start = performance.now();
        for (let i = 0; i < 16; i++) checksum += f.bump();
        samples.push((performance.now() - start) / 16);
        assert.equal(f.top.get(), f.initial + 8 + (round + 1) * 16);
    }
    assert.equal(checksum, 112 * f.initial + 7224);
    assert.equal(f.top.getVersion(), 120);
    f.sources[0].update(draft => { draft.noise++; });
    const noiseValue = f.top.get();
    const noiseVersion = f.top.getVersion();
    assert.equal(noiseValue, f.initial + 120);
    assert.equal(noiseVersion, 120);
    assert.ok(f.intact());
    emit({K, M, layout, writes: samples.length * 16, checksum,
        publicVersion: f.top.getVersion(), noiseValue, noiseVersion, updateGetMs: median(samples),
        timingUnit: 'milliseconds per completed tick update+get',
        snapshotsIntact: f.intact(), validationCorrect: true, correct: true, done: true});
} finally { f.close(); }
