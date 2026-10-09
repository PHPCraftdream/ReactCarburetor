import {emit, load, median} from '../../harness/lib.mjs';
import {countHandlers} from './counts.mjs';
import {sameReads} from './sameReads.mjs';
const {Carburetor} = await load();
const method = process.argv[2] ?? 'map';
const n = 5000;
const ids = Array.from({length: n}, (_, i) => 'r' + i);
const store = new Carburetor({ids});
const expected = ['ids.~p', 'ids.length', ...ids.map((_, i) => 'ids.' + i)];
const checksumOf = (value, i) => value.length * (i % 17 + 1);
const run = native => {
    const reads = new Set(); let checksum = 0; let result;
    const counts = countHandlers(() => {
        const view = store.read(p => reads.add(p)).ids;
        const callback = (value, i) => {
            checksum += checksumOf(value, i);
            return method === 'filter' ? i % 3 === 0 : value;
        };
        result = native ? Array.prototype[method].call(view, callback) : view[method](callback);
    });
    return {...counts, checksum, reads, result};
};
const fast = run(false), native = run(true);
let manualChecksum = 0;
const manualReads = new Set();
const manual = countHandlers(() => {
    const view = store.read(p => manualReads.add(p)).ids;
    const length = view.length;
    for (let i = 0; i < length; i++) manualChecksum += checksumOf(view[i], i);
});
const raw = ids[method]((value, i) => method === 'filter' ? i % 3 === 0 : value);
const reads = new Set();
const view = store.read(p => reads.add(p));
let timingCorrect = true;
const samples = [];
for (let i = 0; i < 70; i++) {
    const start = performance.now();
    const result = view.ids.map(x => x);
    const elapsed = performance.now() - start;
    timingCorrect &&= result.length === n && result[1234] === 'r1234' && result[n - 1] === ids[n - 1];
    if (i >= 20) samples.push(elapsed);
}
const mapMs = median(samples);
emit({gets: fast.get, has: fast.has, trapsPerElement: (fast.get + fast.has) / n,
    nativeGets: native.get, nativeHas: native.has, nativeTrapsPerElement: (native.get + native.has) / n,
    manualGets: manual.get, manualHas: manual.has, checksum: fast.checksum, manualChecksum,
    readCount: fast.reads.size, nativeReadCount: native.reads.size,
    exactReads: sameReads(fast.reads, expected) && sameReads(native.reads, expected)
        && sameReads(manualReads, expected),
    mapMs, mapUsPerElement: mapMs * 1000 / n,
    correct: timingCorrect && fast.checksum === manualChecksum && native.checksum === manualChecksum
        && JSON.stringify(fast.result) === JSON.stringify(raw)
        && JSON.stringify(native.result) === JSON.stringify(raw)});
