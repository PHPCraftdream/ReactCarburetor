// A/B for R6-04: subscribe()'s internal-transfer path (transferReads) against the pre-fix
// behavior of adopting any given `reads` Set unconditionally, plus the public copy path's cost.
// Runs "after" against this branch's build and "before" against a pre-fix snapshot:
//   cp -r dist .bench-baseline-dist   (snapshot taken BEFORE the R6-04 source change)
//   npm run build                     (rebuilds dist as "after")
//   node --expose-gc benchmarks/subscribeReads.mjs
// BASELINE_DIST overrides the baseline directory (default ../.bench-baseline-dist).
// The baseline predates ReadsTransfer entirely, so its "internal path" is emulated with a plain
// {id, reads} literal — pre-fix, subscribe() adopted that by reference regardless of any brand.
// Kept out of the test suite on purpose — the rstest run must stay fast.

import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const afterDir = path.resolve(here, '../dist');
const baselineDir = path.resolve(here, process.env.BASELINE_DIST || '../.bench-baseline-dist');

const load = (baseDir, relPath) => import(pathToFileURL(path.join(baseDir, relPath)).href);

const {Carburetor: AfterCarburetor} = await load(afterDir, 'esm/Carburetor/Store/Carburetor.mjs');
const {Carburetor: BeforeCarburetor} = await load(baselineDir, 'esm/Carburetor/Store/Carburetor.mjs');
const {transferReads} = await load(afterDir, 'esm/Carburetor/Store/Paths/Markers/transferReads.mjs');

const ROUNDS = 41;
const COUNT = 4000;

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const timeOnce = (body) => {
    const started = process.hrtime.bigint();

    body();

    return Number(process.hrtime.bigint() - started) / 1e6;
};

const WARMUP_ROUNDS = 10;

/**
 * Runs `rounds` interleaved A/B rounds — alternating which side goes first each round, so a
 * drifting machine load cannot land entirely on one side — and returns each side's median time
 * plus the median of the per-round after/before ratio. The per-round ratio is the headline gate
 * figure: this repo's benchmark machine is shared with other work (see CONTRIBUTING), and a
 * process-wide noise burst moves both sides of one round together, which a ratio taken *within*
 * that round cancels far better than dividing two medians computed from separate samples.
 * Setup is unmeasured; only `run` is timed. A handful of untimed warm-up rounds run first on
 * both sides, so neither pays a JIT tier-up cost the other has already amortized.
 */
const compareAB = (rounds, sides) => {
    const runOnce = (side) => {
        const ctx = side === 'after' ? sides.setupAfter() : sides.setupBefore();

        return side === 'after' ? timeOnce(() => sides.runAfter(ctx)) : timeOnce(() => sides.runBefore(ctx));
    };

    for (let i = 0; i < WARMUP_ROUNDS; i++) {
        runOnce('after');
        runOnce('before');
    }

    const afterTimes = [];
    const beforeTimes = [];
    const ratios = [];

    for (let round = 0; round < rounds; round++) {
        const afterFirst = round % 2 === 0;
        const first = runOnce(afterFirst ? 'after' : 'before');
        const second = runOnce(afterFirst ? 'before' : 'after');
        const afterElapsed = afterFirst ? first : second;
        const beforeElapsed = afterFirst ? second : first;

        afterTimes.push(afterElapsed);
        beforeTimes.push(beforeElapsed);
        ratios.push(afterElapsed / beforeElapsed);
    }

    return {after: median(afterTimes), before: median(beforeTimes), ratio: median(ratios)};
};

const readsFor = (index, extra = 0) => {
    const paths = [`items.item${index}.title`, `items.item${index}.done`, `order.${index}`];

    for (let i = 0; i < extra; i++) {
        paths.push(`extra.${index}.${i}`);
    }

    return new Set(paths);
};

const freshData = () => ({items: {}, order: [], extra: {}});

let allPass = true;

const gateRatio = (label, ratio, limit) => {
    const pass = ratio <= limit;

    allPass = allPass && pass;
    console.log(`   ${label.padEnd(52)} ${ratio.toFixed(3)}x  (limit ${limit}x)  ${pass ? 'PASS' : 'FAIL'}`);
};

const gateAbs = (label, delta, limit) => {
    const pass = delta <= limit;
    const sign = delta >= 0 ? '+' : '';

    allPass = allPass && pass;
    console.log(`   ${label.padEnd(52)} ${sign}${delta.toFixed(1)} B  (limit +${limit} B)  ${pass ? 'PASS' : 'FAIL'}`);
};

const report = (label, value) => {
    console.log(`   ${label.padEnd(52)} ${value}  (report only)`);
};

console.log(`subscribeReads (R6-04): ${ROUNDS} interleaved rounds per scenario, medians reported\n`);

// --- 1. 4000 internal subscriptions, 3-path read sets -----------------------------------------
{
    const {after, before, ratio} = compareAB(ROUNDS, {
        setupAfter: () => new AfterCarburetor(freshData()),
        runAfter: (store) => {
            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, transferReads(readsFor(i), `s${i}`));
            }
        },
        setupBefore: () => new BeforeCarburetor(freshData()),
        runBefore: (store) => {
            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, {id: `s${i}`, reads: readsFor(i)});
            }
        },
    });

    console.log(`1) ${COUNT} internal subscriptions, 3-path reads`);
    console.log(`   after=${after.toFixed(2)}ms before=${before.toFixed(2)}ms`);
    gateRatio('ratio (after/before, per-round median)', ratio, 1.03);
}

// --- 2. 4000 internal re-subscriptions, +1 path -------------------------------------------------
{
    const {after, before, ratio} = compareAB(ROUNDS, {
        setupAfter: () => {
            const store = new AfterCarburetor(freshData());

            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, transferReads(readsFor(i), `s${i}`));
            }

            return store;
        },
        runAfter: (store) => {
            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, transferReads(readsFor(i, 1), `s${i}`));
            }
        },
        setupBefore: () => {
            const store = new BeforeCarburetor(freshData());

            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, {id: `s${i}`, reads: readsFor(i)});
            }

            return store;
        },
        runBefore: (store) => {
            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, {id: `s${i}`, reads: readsFor(i, 1)});
            }
        },
    });

    console.log(`2) ${COUNT} internal re-subscriptions (+1 path)`);
    console.log(`   after=${after.toFixed(2)}ms before=${before.toFixed(2)}ms`);
    gateRatio('ratio (after/before, per-round median)', ratio, 1.03);
}

// --- 3. 4000 extend() calls ---------------------------------------------------------------------
{
    const {after, before, ratio} = compareAB(ROUNDS, {
        setupAfter: () => {
            const store = new AfterCarburetor(freshData());
            const ids = [];

            for (let i = 0; i < COUNT; i++) {
                ids.push(store.subscribe(() => undefined, transferReads(readsFor(i), `s${i}`)));
            }

            return {store, ids};
        },
        runAfter: ({store, ids}) => {
            for (let i = 0; i < COUNT; i++) {
                store.extend(ids[i], `extra.${i}.0`);
            }
        },
        setupBefore: () => {
            const store = new BeforeCarburetor(freshData());
            const ids = [];

            for (let i = 0; i < COUNT; i++) {
                ids.push(store.subscribe(() => undefined, {id: `s${i}`, reads: readsFor(i)}));
            }

            return {store, ids};
        },
        runBefore: ({store, ids}) => {
            for (let i = 0; i < COUNT; i++) {
                store.extend(ids[i], `extra.${i}.0`);
            }
        },
    });

    console.log(`3) ${COUNT} extend() calls`);
    console.log(`   after=${after.toFixed(2)}ms before=${before.toFixed(2)}ms`);
    gateRatio('ratio (after/before, per-round median)', ratio, 1.03);
}

// --- 4 & 5. Memory per subscriber: internal path (gated) and public path (report only) ---------
if (typeof global.gc !== 'function') {
    console.log('4/5) memory per subscriber: run with `node --expose-gc` to measure (skipped)');
} else {
    const MEMORY_SAMPLES = 7;

    const collectGarbage = () => {
        global.gc();
        global.gc();
        global.gc();
    };

    /**
     * One sample of heap bytes retained per subscriber after 4000 registrations, with the
     * caller keeping its own reference to every reads Set — the shape `Subscriptions.tsx`/
     * `Computed` are in, where both the index and the caller hold something past the call.
     */
    const sampleMemoryPerSubscriber = (CarburetorClass, useTransfer) => {
        collectGarbage();

        const before = process.memoryUsage().heapUsed;
        const store = new CarburetorClass(freshData());
        const retained = [];

        for (let i = 0; i < COUNT; i++) {
            const reads = readsFor(i);

            retained.push(reads);
            store.subscribe(() => undefined, useTransfer ? transferReads(reads, `s${i}`) : {id: `s${i}`, reads});
        }

        collectGarbage();

        const after = process.memoryUsage().heapUsed;

        // Read after the measurement: a variable with no later use is collectable, which made
        // this report a few bytes per subscriber instead of the real few hundred.
        if (retained.length !== COUNT || store.getVersion() < 0) {
            throw new Error('unreachable');
        }

        return (after - before) / COUNT;
    };

    /** The median of several samples — one bad GC pause must not decide the reported number. */
    const memoryPerSubscriber = (CarburetorClass, useTransfer) => {
        const samples = [];

        for (let i = 0; i < MEMORY_SAMPLES; i++) {
            samples.push(sampleMemoryPerSubscriber(CarburetorClass, useTransfer));
        }

        return median(samples);
    };

    const afterInternal = memoryPerSubscriber(AfterCarburetor, true);
    const beforeInternal = memoryPerSubscriber(BeforeCarburetor, false);
    const internalDelta = afterInternal - beforeInternal;

    console.log('4) memory per subscriber, internal path (caller retains its Set)');
    console.log(`   after=${afterInternal.toFixed(1)}B before=${beforeInternal.toFixed(1)}B`);
    gateAbs('delta (after-before)', internalDelta, 8);

    const afterPublic = memoryPerSubscriber(AfterCarburetor, false);
    const beforePublic = memoryPerSubscriber(BeforeCarburetor, false);
    const publicDelta = afterPublic - beforePublic;

    console.log('5) memory per subscriber, public path (caller retains its Set) — report only');
    console.log(`   after=${afterPublic.toFixed(1)}B before=${beforePublic.toFixed(1)}B`);
    report('delta (after-before), expected ~+150 B', `${publicDelta >= 0 ? '+' : ''}${publicDelta.toFixed(1)} B`);

    const {after: afterPublicMs, before: beforePublicMs, ratio: publicRatio} = compareAB(ROUNDS, {
        setupAfter: () => new AfterCarburetor(freshData()),
        runAfter: (store) => {
            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, {id: `s${i}`, reads: readsFor(i)});
            }
        },
        setupBefore: () => new BeforeCarburetor(freshData()),
        runBefore: (store) => {
            for (let i = 0; i < COUNT; i++) {
                store.subscribe(() => undefined, {id: `s${i}`, reads: readsFor(i)});
            }
        },
    });

    console.log(`   public-path time: after=${afterPublicMs.toFixed(2)}ms before=${beforePublicMs.toFixed(2)}ms`);
    report('ratio (after/before, per-round median), expected <= 1.35x', `${publicRatio.toFixed(3)}x`);
}

console.log(`\n${allPass ? 'ALL GATES PASSED' : 'GATE FAILURE'}`);

if (!allPass) {
    process.exitCode = 1;
}
