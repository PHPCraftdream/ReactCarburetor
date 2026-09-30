// Paired development-build benchmark for the unpublished draft diagnostic. Both sides perform
// actual draft writes, notifications and queued checks; the timed work excludes waiting for the
// queued microtasks. Callback identities count the allocation opportunity, not allocated bytes.
// BASELINE_DIST=path/to/baseline/dist AFTER_DIST=path/to/fixed/dist node benchmarks/state/unpublishedDraftCheck.mjs

import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const beforeRoot = process.env.BASELINE_DIST;
const afterRoot = process.env.AFTER_DIST;
if (!beforeRoot || !afterRoot) {
    throw new Error('Set BASELINE_DIST and AFTER_DIST to two independently built dist directories');
}
if (process.env.NODE_ENV === 'production') {
    throw new Error('This benchmark requires development diagnostics: unset NODE_ENV=production');
}

const load = async (root) => {
    const url = pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href;
    const {Carburetor} = await import(url);

    return class Counter extends Carburetor {
        /** Initializes a real counter store. */
        constructor() {
            super({n: -1});
        }

        /** Writes one draft value.
         *
         * @param n - next counter
         * @param publish - whether to publish this cycle
         */
        set(n, publish = true) {
            this.draft.n = n;
            if (publish) this.emitUpdate();
        }
    };
};

const before = await load(beforeRoot);
const after = await load(afterRoot);
const flush = () => Promise.resolve();

// Separate untimed identity/behavior check: instrumentation cannot distort timing samples.
const inspect = async (Counter) => {
    const store = new Counter();
    let deliveries = 0;
    const subscription = store.subscribe(() => deliveries++);
    const callbacks = new Set();
    let queued = 0;
    const originalQueue = globalThis.queueMicrotask;
    const originalError = console.error;
    let warnings = 0;
    globalThis.queueMicrotask = (callback) => {
        queued++;
        callbacks.add(callback);
        originalQueue(callback);
    };
    console.error = () => warnings++;
    try {
        for (let i = 0; i < 8; i++) {
            store.set(i);
        }
        await flush();
        store.set(8, false);
        await flush();
        store.set(9);
        await flush();
        if (store.getData().n !== 9 || deliveries !== 9 || warnings !== 1) {
            throw new Error('Unexpected n/deliveries/warnings/queued: '
                + `${store.getData().n}/${deliveries}/${warnings}/${queued}`);
        }
    } finally {
        globalThis.queueMicrotask = originalQueue;
        console.error = originalError;
        store.unsubscribe(subscription);
    }
    return {writes: 10, deliveries, warnings, queued, distinctCallbacks: callbacks.size};
};

const beforeWork = await inspect(before);
const afterWork = await inspect(after);
console.log('before work:', beforeWork);
console.log('after work: ', afterWork);
if (beforeWork.queued !== afterWork.queued) {
    throw new Error('The paired implementations queued different amounts of diagnostic work');
}
if (beforeWork.distinctCallbacks <= 1 || afterWork.distinctCallbacks !== 1) {
    throw new Error('Expected one newly minted callback per baseline cycle and one reused callback after');
}

const ITERATIONS = 10000;
const ROUNDS = 9;
const WARMUP_ROUNDS = 2;
const sample = async (Counter) => {
    const store = new Counter();
    let deliveries = 0;
    const subscription = store.subscribe(() => deliveries++);
    store.set(-2); // warm the write-proxy tree and, on the fixed side, mint the callback
    await flush();
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS; i++) {
        store.set(i);
    }
    const milliseconds = Number(process.hrtime.bigint() - start) / 1e6;
    await flush();
    store.unsubscribe(subscription);
    if (deliveries !== ITERATIONS + 1 || store.getData().n !== ITERATIONS - 1) {
        throw new Error(`Timed writes changed semantics: ${deliveries} deliveries, n=${store.getData().n}`);
    }
    return milliseconds;
};

const times = {before: [], after: []};
for (let round = 0; round < WARMUP_ROUNDS + ROUNDS; round++) {
    for (const side of round % 2 === 0 ? ['before', 'after'] : ['after', 'before']) {
        const elapsed = await sample(side === 'before' ? before : after);
        if (round >= WARMUP_ROUNDS) {
            times[side].push(elapsed);
        }
    }
}
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const pairRatios = times.after.map((ms, index) => ms / times.before[index]);
console.log(`${ITERATIONS} writes/sample × ${WARMUP_ROUNDS} warmup + ${ROUNDS} alternating measured rounds`);
console.log(`before ms: ${times.before.map(ms => ms.toFixed(3)).join(', ')}`);
console.log(`after  ms: ${times.after.map(ms => ms.toFixed(3)).join(', ')}`);
console.log(`paired after/before ratios: ${pairRatios.map(ratio => ratio.toFixed(3)).join(', ')}`);
console.log(`medians: before=${median(times.before).toFixed(3)}ms, after=${median(times.after).toFixed(3)}ms`
    + `, paired ratio=${median(pairRatios).toFixed(3)}`);
console.log('Timings include real draft writes and queueMicrotask scheduling but exclude microtask execution; callback identity is not a byte-allocation measurement.');
