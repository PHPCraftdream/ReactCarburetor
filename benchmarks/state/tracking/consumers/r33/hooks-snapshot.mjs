/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// A/B prebuilt production distributions; each sample runs in an isolated child process.
// BASELINE_DIST defaults to D:/dev/ReactCarburetor/worktrees/r33-baseline/dist.
// AFTER_DIST defaults to dist. Run with NODE_ENV=production:
//   node benchmarks/state/tracking/consumers/r33/hooks-snapshot.mjs
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 10000;
const WARMUP = 2;
const REPEAT = 5;
const CHILDREN = 5;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(root, unrelatedWrite) {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm-prod/Carburetor/index.mjs')).href);
    const React = (await import('react')).default;
    const {flushSync} = await import('react-dom');
    const {createRoot} = await import('react-dom/client');
    const {JSDOM} = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true, writable: true});
    globalThis.HTMLElement = dom.window.HTMLElement;

    class Store extends Carburetor {
        /** Executes one state update. */
        run(fn) { this.update(fn); }
    }
    const store = new Store({
        rows: Array.from({length: ROWS}, (_, id) => ({id, title: `Row ${id}`, done: id % 2 === 0})),
        draft: '',
    });
    let bump;
    let renderCount = 0;
    function List() {
        const rows = useCarburetorValue(store, data => data.rows);
        const [, setTick] = React.useState(0);
        bump = () => setTick(value => value + 1);
        renderCount++;
        return React.createElement('ul', null, rows.map(row => React.createElement('li', {key: row.id}, row.title)));
    }
    const {useCarburetorValue} = await import(pathToFileURL(resolve(root, 'esm-prod/Interop/index.mjs')).href);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const rootNode = createRoot(container);
    flushSync(() => rootNode.render(React.createElement(List)));
    const samples = [];
    for (let round = 0; round < WARMUP + REPEAT; round++) {
        if (unrelatedWrite) store.run(draft => { draft.draft = `draft-${round}`; });
        const start = process.hrtime.bigint();
        flushSync(() => {
            if (!unrelatedWrite) store.run(draft => { draft.draft = `draft-${round}`; });
            bump();
        });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        if (round >= WARMUP) samples.push(ms);
    }
    if (renderCount !== 1 + WARMUP + REPEAT || container.querySelectorAll('li').length !== ROWS)
        throw new Error(`invalid probe setup: renders=${renderCount}, rows=${container.querySelectorAll('li').length}`);
    flushSync(() => rootNode.unmount());
    dom.window.close();
    return median(samples);
}

if (process.env.BENCH_ROOT) {
    const ms = await measure(process.env.BENCH_ROOT, process.env.BENCH_WRITE === '1');
    console.log(JSON.stringify({ms}));
} else {
    const roots = {
        baseline: process.env.BASELINE_DIST ?? 'D:/dev/ReactCarburetor/worktrees/r33-baseline/dist',
        after: process.env.AFTER_DIST ?? 'dist',
    };
    const script = fileURLToPath(import.meta.url);
    const results = {};
    for (const write of [false, true]) {
        const byBuild = {baseline: [], after: []};
        for (let round = 0; round < CHILDREN; round++) {
            for (const label of (round % 2 === 0 ? ['baseline', 'after'] : ['after', 'baseline'])) {
                const child = spawnSync(process.execPath, [script], {
                    encoding: 'utf8', timeout: 120000,
                    env: {...process.env, BENCH_ROOT: resolve(roots[label]), BENCH_WRITE: write ? '1' : '0', NODE_ENV: 'production'},
                });
                if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
                byBuild[label].push(JSON.parse(child.stdout).ms);
            }
        }
        results[write ? 'unrelatedWrite' : 'noWrite'] = {
            baselineMs: median(byBuild.baseline), afterMs: median(byBuild.after), childrenPerBuild: CHILDREN,
        };
    }
    console.log(JSON.stringify(results, null, 2));
}
