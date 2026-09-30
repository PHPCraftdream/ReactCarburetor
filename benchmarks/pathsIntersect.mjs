// Measures how path matching scales with subscriber count and write-set size.
// Runs against the built ESM output, so it measures shipped code:
//   npm run build && node benchmarks/pathsIntersect.mjs
// Kept out of the test suite on purpose — the rstest run must stay fast.

import {Carburetor} from '../dist/esm/Carburetor/Store/Carburetor.mjs';
import {pathsIntersect} from '../dist/esm/Carburetor/Store/Paths/Diff/pathsIntersect.mjs';
import {SubscriberIndex} from '../dist/esm/Carburetor/Store/Paths/SubscriberIndex.mjs';

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

console.log('\nSubscriberIndex: sibling-read registration');

const registrationCount = 300;
const registrationIds = Array.from({length: registrationCount}, (_, i) => `reader${i}`);
const fullReads = registrationIds.map((_, i) => new Set([
    `items.item${i}.title`, `items.item${i}.done`, `items.item${i}.meta`,
]));
const reducedReads = registrationIds.map((_, i) => new Set([
    `items.item${i}.done`, `items.item${i}.meta`,
]));
const index = new SubscriberIndex();

const measureRegistration = (label, iterations, body) => {
    const started = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
        body(i);
    }

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(`${label.padEnd(52)} ${(elapsedMs / iterations).toFixed(4)} ms/op`
        + `   (${iterations} ops in ${elapsedMs.toFixed(1)} ms)`);
};

measureRegistration('fresh add, 3 sibling paths', registrationCount, (i) => {
    index.add(registrationIds[i], fullReads[i]);
});

measureRegistration('re-register, remove/add 1 sibling path', registrationCount * 49, (i) => {
    const item = i % registrationCount;
    index.add(registrationIds[item], Math.floor(i / registrationCount) % 2 === 0
        ? reducedReads[item]
        : fullReads[item]);
});

const parentWrite = new Set(['items.item150']);

measure('match parent of 2 remaining sibling reads', 20000, () => index.match(parentWrite));
console.log(`parent match count: ${index.match(parentWrite).size}`);

measureRegistration('remove, 2 sibling paths', registrationCount, (i) => {
    index.remove(registrationIds[i]);
});

if (globalThis.gc) {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const retained = new SubscriberIndex();

    registrationIds.forEach((id, i) => retained.add(id, fullReads[i]));
    globalThis.gc();
    const bytes = process.memoryUsage().heapUsed - before;

    console.log(`retained heap for ${registrationCount} registrations: ${bytes} bytes`
        + ` (${(bytes / registrationCount).toFixed(1)} bytes/subscriber)`);
    console.log(`retained index parent match count: ${retained.match(parentWrite).size}`);
}
