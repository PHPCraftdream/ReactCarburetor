// Paired baseline/fixed build benchmark for R12-E02. Run after the integration owner builds
// both trees: BASELINE_DIST=<baseline dist> node benchmarks/state/tracking/inheritedReadPrecision.mjs
// Read-only cases exclude setup and construction. The final case includes construction
// and a leaf read to measure the weak raw-view registry added for graph alias detachment.
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const beforeDir = path.resolve(root, process.env.BASELINE_DIST || '.bench-baseline-dist');
const afterDir = path.resolve(root, 'dist');
const load = dir => import(pathToFileURL(path.join(dir, 'esm/Carburetor/Store/Tracking/createReadProxy.mjs')).href);
const [{createReadProxy: before}, {createReadProxy: after}] = await Promise.all([
    load(beforeDir), load(afterDir),
]);
const repetitions = 20_000;
const warmups = 8;
const rounds = 25;
let sink = 0;

const median = numbers => {
    const sorted = [...numbers].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const cases = {
    'plain own leaves': make => {
        let recorded = 0;
        const value = make({left: 3, right: 4}, () => { recorded++; });
        return () => {
            let sum = 0;
            for (let i = 0; i < repetitions; i++) {
                sum += value.left + value.right;
            }
            sink += sum + recorded;
        };
    },
    'array method lookups': make => {
        let recorded = 0;
        const value = make([2, 3], () => { recorded++; });
        return () => {
            let sum = 0;
            for (let i = 0; i < repetitions; i++) {
                sum += Number(value.map === Array.prototype.map);
                sum += Number(value.filter === Array.prototype.filter);
            }
            sink += sum + recorded;
        };
    },
    'array own indices and length': make => {
        let recorded = 0;
        const value = make([2, 3], () => { recorded++; });
        return () => {
            let sum = 0;
            for (let i = 0; i < repetitions; i++) {
                sum += value[0] + value[1] + value.length;
            }
            sink += sum + recorded;
        };
    },
    'proxy construction + leaf read (2000 views)': make => {
        let recorded = 0;
        const record = () => { recorded++; };
        return () => {
            const initial = recorded;
            let sum = 0;
            for (let i = 0; i < 2_000; i++) {
                sum += make({leaf: i}, record).leaf;
            }
            if (recorded - initial !== 2_000 || sum !== 1_999_000) {
                throw new Error('Proxy construction lost a tracked leaf read');
            }
            sink += sum;
        };
    },
};

for (const [label, setup] of Object.entries(cases)) {
    const baseline = setup(before);
    const changed = setup(after);
    const samples = [];
    const measure = run => {
        const started = process.hrtime.bigint();
        run();
        return Number(process.hrtime.bigint() - started) / 1e6;
    };
    for (let i = 0; i < warmups; i++) {
        baseline();
        changed();
    }
    for (let i = 0; i < rounds; i++) {
        const first = i % 2 ? changed : baseline;
        const second = i % 2 ? baseline : changed;
        const t1 = measure(first);
        const t2 = measure(second);
        const beforeMs = i % 2 ? t2 : t1;
        const afterMs = i % 2 ? t1 : t2;
        samples.push({beforeMs, afterMs, ratio: afterMs / beforeMs});
    }
    console.log(`${label}: baseline=${median(samples.map(s => s.beforeMs)).toFixed(3)}ms ` +
        `fixed=${median(samples.map(s => s.afterMs)).toFixed(3)}ms ` +
        `paired ratio=${median(samples.map(s => s.ratio)).toFixed(3)}x`);
}
console.log('read sink:', sink);
