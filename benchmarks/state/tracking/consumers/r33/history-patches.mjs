import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const CHILDREN = 5;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = async (root, count, scenario, runs = 11) => {
    const storeUrl = resolve(root, 'esm-prod/Carburetor/Store/Carburetor.mjs');
    const historyUrl = resolve(root, 'esm-prod/Carburetor/Tooling/CarburetorHistory.mjs');
    const {Carburetor} = await import(pathToFileURL(storeUrl).href);
    const {CarburetorHistory} = await import(pathToFileURL(historyUrl).href);
    const samples = [];
    for (let round = 0; round < runs; round++) {
        const rows = Array.from({length: count}, (_, i) => ({id: i}));
        const store = new Carburetor({docs: {}, rows});
        const history = new CarburetorHistory(store);
        const key = `entry-${round}`;
        if (scenario === 'dependent') {
            const start = process.hrtime.bigint();
            store.update(draft => { draft.docs[key] = {id: round}; draft.docs[key].id = -round; });
            samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        } else {
            const subtree = Object.fromEntries(Array.from({length: 1000}, (_, i) => [i, {id: i, value: i * 2}]));
            const start = process.hrtime.bigint();
            store.update(draft => { draft.docs[key] = subtree; });
            samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        if (store.getData().rows !== rows) throw new Error('unrelated live rows identity changed');
        // Undo/redo correctness, outside the timed section.
        history.undo();
        if (key in store.getData().docs) throw new Error(`undo did not remove ${key}`);
        history.redo();
        const docs = store.getData().docs;
        if (scenario === 'dependent') {
            if (!docs[key] || docs[key].id !== -round) throw new Error(`redo did not restore ${key}`);
        } else if (!docs[key] || docs[key][0]?.id !== 0 || docs[key][999]?.value !== 1998) {
            throw new Error(`redo did not restore ${key}`);
        }
        if (scenario === 'subtree' && store.getData().rows !== rows) throw new Error('unrelated rows identity changed after undo/redo');
        history.disconnect();
    }
    return median(samples);
};

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify({
        dependent: {
            small: await measure(process.env.BENCH_ROOT, 1000, 'dependent'),
            large: await measure(process.env.BENCH_ROOT, 10000, 'dependent'),
        },
        subtree: {
            small: await measure(process.env.BENCH_ROOT, 1000, 'subtree'),
            large: await measure(process.env.BENCH_ROOT, 1000, 'subtree'),
        },
    }));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST');
    const roots = {baseline: process.env.BASELINE_DIST, after: process.env.AFTER_DIST ?? 'dist'};
    const values = {baseline: [], after: []};
    const script = fileURLToPath(import.meta.url);
    for (let round = 0; round < CHILDREN; round++) {
        for (const label of round % 2 ? ['after', 'baseline'] : ['baseline', 'after']) {
            const child = spawnSync(process.execPath, [script], {
                encoding: 'utf8', env: {...process.env, BENCH_ROOT: resolve(roots[label])},
            });
            if (child.status !== 0) throw new Error(`${label}: ${child.stderr || child.error}`);
            values[label].push(JSON.parse(child.stdout));
        }
    }
    const result = {};
    for (const scenario of ['dependent', 'subtree']) {
        result[scenario] = {};
        for (const size of ['small', 'large']) {
            const baseline = median(values.baseline.map(row => row[scenario][size]));
            const after = median(values.after.map(row => row[scenario][size]));
            const ratio = after / baseline;
            let pass = null;
            let gate = null;
            if (scenario === 'dependent' && size === 'large') {
                gate = 'absolute <= 0.5ms';
                pass = after <= 0.5;
            } else if (scenario === 'subtree') {
                gate = 'ratio <= 0.6';
                pass = ratio <= 0.6;
            }
            result[scenario][size] = {baseline, after, ratio, gate, pass};
        }
    }
    console.log(JSON.stringify(result, null, 2));
}
