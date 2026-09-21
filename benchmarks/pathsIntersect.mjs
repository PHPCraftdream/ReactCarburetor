// Measures how path matching scales with subscriber count and write-set size.
// Runs against the built ESM output, so it measures shipped code:
//   npm run build && node benchmarks/pathsIntersect.mjs
// Kept out of the test suite on purpose — the rstest run must stay fast.

import {Carburetor} from '../dist/esm/Carburetor/Store/Carburetor.mjs';
import {pathsIntersect} from '../dist/esm/Carburetor/Store/Paths/pathsIntersect.mjs';

class BenchCarburetor extends Carburetor {
    /** Records a set of writes and publishes them in one pass, as a transaction would. */
    writePaths(paths) {
        paths.forEach((path) => this.recordWrite(path));
        this.emitUpdate();
    }
}

const readsFor = (index) => new Set([
    `items.item${index}.title`,
    `items.item${index}.done`,
    `order.${index}`,
]);

const measure = (label, iterations, body) => {
    body();

    const started = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
        body();
    }

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(
        `${label.padEnd(52)} ${(elapsedMs / iterations).toFixed(4)} ms/op`
        + `   (${iterations} ops in ${elapsedMs.toFixed(1)} ms)`
    );
};

const buildStore = (subscriberCount) => {
    const store = new BenchCarburetor({items: {}, order: []});

    for (let i = 0; i < subscriberCount; i++) {
        store.subscribe(() => undefined, {id: `subscriber${i}`, reads: readsFor(i)});
    }

    return store;
};

const writeSet = (count, offset = 0) => {
    const paths = [];

    for (let i = 0; i < count; i++) {
        paths.push(`items.item${i + offset}.title`);
    }

    return paths;
};

console.log('pathsIntersect: raw matching');

const reads = readsFor(0);
const oneWrite = new Set(['items.item999999.title']);
const manyWrites = new Set(writeSet(500, 999999));

measure('1 read set x 1 write path (no match)', 200000, () => pathsIntersect(reads, oneWrite));
measure('1 read set x 500 write paths (no match)', 2000, () => pathsIntersect(reads, manyWrites));

console.log('\nemitUpdate: end to end');

const small = buildStore(100);
const large = buildStore(1000);

measure('100 subscribers, 1 changed path', 20000, () => small.writePaths(['items.item50.title']));
measure('1000 subscribers, 1 changed path', 2000, () => large.writePaths(['items.item500.title']));
measure('1000 subscribers, 1 unmatched path', 2000, () => large.writePaths(['missing.path']));
measure('1000 subscribers, 500 changed paths', 100, () => large.writePaths(writeSet(500)));
measure('1000 subscribers, 500 unmatched paths', 100, () => large.writePaths(writeSet(500, 999999)));
