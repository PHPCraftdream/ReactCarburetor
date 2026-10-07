/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-01: a repeated opaque read answers from the per-read cache, and a warmed Map view iterates
// at raw speed. Warm both paths and alternate batched samples to amortize timer/JIT effects.
// freshMs (first read after a topological write) is informational: its run-to-run spread is too
// wide for a stable gate. Args: [rows=10000]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
class Payload { constructor(items) { this.items = items; } }
const rows_ = Array.from({length: rows}, (_, n) => ({n}));
const s = new S({
    row: rows_[0],
    model: new Payload(rows_),
    byId: new Map(rows_.map((row, index) => [index, row])),
});

const iterate = map => {
    let count = 0;
    for (const row of map.values()) count += row.n;
    return count;
};

// Cached opaque read: warm once, then batch `void view.model` reads for a per-read cost.
const view = s.read(() => undefined);
const payloadOk = view.model.items.length === rows;
void view.model; // warm the per-read answer cache untimed
global.gc?.();
let reads = 0;
const readStart = performance.now();
while (performance.now() - readStart < 200 && reads < 100000) {
    for (let i = 0; i < 100; i++) void view.model;
    reads += 100;
}
const cachedReadMs = (((performance.now() - readStart) * 1e6) / reads / 1e3) / 1000;

// Warm the same measured batches, then alternate their order.
const mapView = s.read(() => undefined);
void mapView.byId;
const rawMap = s.getData().byId;
const expectedTotal = iterate(rawMap);
let iterateOk = iterate(mapView.byId) === expectedTotal;
const viewTimes = [];
const rawTimes = [];
const batchSize = 32;
const viewMap = () => mapView.byId;
const raw = () => rawMap;
const measureBatch = readMap => {
    const start = performance.now();
    for (let iteration = 0; iteration < batchSize; iteration++) {
        if (iterate(readMap()) !== expectedTotal) iterateOk = false;
    }
    return (performance.now() - start) / batchSize;
};
for (let warmup = 0; warmup < 4; warmup++) {
    measureBatch(viewMap);
    measureBatch(raw);
}
for (let round = 0; round < 9; round++) {
    if (round % 2 === 0) {
        viewTimes.push(measureBatch(viewMap));
        rawTimes.push(measureBatch(raw));
    } else {
        rawTimes.push(measureBatch(raw));
        viewTimes.push(measureBatch(viewMap));
    }
}
const viewIterateMs = median(viewTimes);
const rawIterateMs = median(rawTimes);

// Informational: first opaque read after a topological write re-derives the alias answer.
const s2 = new S({row: rows_[0], model: new Payload(rows_)});
const view2 = s2.read(() => undefined);
void view2.model;
const freshTimes = [];
for (let i = 0; i < 7; i++) {
    s2.run(d => { d.row = {n: -i - 1}; });
    global.gc?.();
    const start = performance.now();
    void view2.model;
    freshTimes.push(performance.now() - start);
}
const freshMs = median(freshTimes);

emit({cachedReadMs, viewIterateMs, rawIterateMs, freshMs, payloadOk, iterateOk});
