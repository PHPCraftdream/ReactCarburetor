// A/B for R6-04: end-to-end mount/update/unmount cost of AntiHookComponent's commit-time
// subscribe() path (Subscriptions.tsx), against a pre-fix snapshot. Runs "after" against this
// branch's production build and "before" against a pre-fix dist snapshot:
//   cp -r dist .bench-baseline-dist   (snapshot taken BEFORE the R6-04 source change)
//   npm run build                     (rebuilds dist as "after")
//   NODE_ENV=production node benchmarks/mountAntiHookComponent.mjs
// BASELINE_DIST overrides the baseline directory (default ../.bench-baseline-dist).
// jsdom stands in for the DOM; react-dom/client + flushSync make each commit synchronous and
// measurable. Kept out of the test suite on purpose — the rstest run must stay fast.

import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});

for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in globalThis)) {
        globalThis[key] = dom.window[key];
    }
}

globalThis.window = dom.window;
globalThis.document = dom.window.document;

// Node 24 defines a getter-only `navigator` of its own; jsdom's must replace it outright.
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true, writable: true});

globalThis.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || ((id) => clearTimeout(id));

const here = path.dirname(fileURLToPath(import.meta.url));
const afterDir = path.resolve(here, '../dist');
const baselineDir = path.resolve(here, process.env.BASELINE_DIST || '../.bench-baseline-dist');

const load = (baseDir, relPath) => import(pathToFileURL(path.join(baseDir, relPath)).href);

const React = (await import('react')).default;
const {flushSync} = await import('react-dom');
const ReactDOMClient = await import('react-dom/client');

const {AntiHookComponent: AfterAntiHookComponent, Carburetor: AfterCarburetor} =
    await load(afterDir, 'esm-prod/Carburetor/index.mjs');
const {AntiHookComponent: BeforeAntiHookComponent, Carburetor: BeforeCarburetor} =
    await load(baselineDir, 'esm-prod/Carburetor/index.mjs');

const ROW_COUNT = 4000;
const WARMUP_TRIALS = 5;
const MEASURED_TRIALS = 41;

const buildStoreData = () => {
    const items = {};
    const ids = [];

    for (let i = 0; i < ROW_COUNT; i++) {
        const id = 'row' + i;

        ids.push(id);
        items[id] = {title: 'Row ' + i};
    }

    items.rowAlt = {title: 'Alt row'};

    return {ids, items};
};

/** Builds the Row/Page pair against one build's own AntiHookComponent base class. */
const buildComponents = (AntiHookComponentClass) => {
    class Row extends AntiHookComponentClass {
        /** One list row: reads its own title through useCarburetor. */
        render() {
            const {store, id} = this.props;
            const title = this.useCarburetor(store).items[id].title;

            return React.createElement('li', null, title);
        }
    }

    class Page extends AntiHookComponentClass {
        /** The row list: reads the id order and mounts one Row per id. */
        render() {
            const {store} = this.props;
            const ids = this.useCarburetor(store).ids;

            return React.createElement('ul', null, ids.map((id, index) =>
                React.createElement(Row, {key: index, id, store})));
        }
    }

    return {Row, Page};
};

const timeOnce = (body) => {
    const started = process.hrtime.bigint();

    body();

    return Number(process.hrtime.bigint() - started) / 1e6;
};

let editCounter = 0;

/** One full mount -> edit -> replace -> unmount cycle for one build, each phase timed. */
const runTrial = (CarburetorClass, AntiHookComponentClass) => {
    const {Page} = buildComponents(AntiHookComponentClass);
    const container = document.createElement('div');

    document.body.appendChild(container);

    const root = ReactDOMClient.createRoot(container);
    const store = new CarburetorClass(buildStoreData());

    const mount = timeOnce(() => {
        flushSync(() => {
            root.render(React.createElement(Page, {store}));
        });
    });

    const edit = timeOnce(() => {
        flushSync(() => {
            store.update((draft) => {
                draft.items.row0.title = 'edited-' + (editCounter++);
            });
        });
    });

    const replace = timeOnce(() => {
        flushSync(() => {
            store.update((draft) => {
                draft.ids[0] = draft.ids[0] === 'row0' ? 'rowAlt' : 'row0';
            });
        });
    });

    const unmount = timeOnce(() => {
        flushSync(() => {
            root.unmount();
        });
    });

    document.body.removeChild(container);

    return {mount, edit, replace, unmount};
};

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

for (let i = 0; i < WARMUP_TRIALS; i++) {
    runTrial(AfterCarburetor, AfterAntiHookComponent);
    runTrial(BeforeCarburetor, BeforeAntiHookComponent);
}

const metrics = ['mount', 'edit', 'replace', 'unmount'];
const afterSamples = {mount: [], edit: [], replace: [], unmount: []};
const beforeSamples = {mount: [], edit: [], replace: [], unmount: []};
const ratioSamples = {mount: [], edit: [], replace: [], unmount: []};

for (let round = 0; round < MEASURED_TRIALS; round++) {
    const afterFirst = round % 2 === 0;
    const first = afterFirst
        ? runTrial(AfterCarburetor, AfterAntiHookComponent)
        : runTrial(BeforeCarburetor, BeforeAntiHookComponent);
    const second = afterFirst
        ? runTrial(BeforeCarburetor, BeforeAntiHookComponent)
        : runTrial(AfterCarburetor, AfterAntiHookComponent);
    const after = afterFirst ? first : second;
    const before = afterFirst ? second : first;

    for (const metric of metrics) {
        afterSamples[metric].push(after[metric]);
        beforeSamples[metric].push(before[metric]);
        ratioSamples[metric].push(after[metric] / before[metric]);
    }
}

const gates = {mount: 1.02, edit: 1.03, replace: 1.03, unmount: 1.03};

console.log(`mountAntiHookComponent (R6-04): ${ROW_COUNT} rows, ${MEASURED_TRIALS} interleaved `
    + `trials per side, medians reported (NODE_ENV=${process.env.NODE_ENV})\n`);

let allPass = true;

for (const metric of metrics) {
    const afterMs = median(afterSamples[metric]);
    const beforeMs = median(beforeSamples[metric]);
    const ratio = median(ratioSamples[metric]);
    const limit = gates[metric];
    const pass = ratio <= limit;

    allPass = allPass && pass;

    console.log(`${metric.padEnd(10)} after=${afterMs.toFixed(3)}ms before=${beforeMs.toFixed(3)}ms `
        + `ratio=${ratio.toFixed(3)}x (limit ${limit}x) ${pass ? 'PASS' : 'FAIL'}`);
}

console.log(`\n${allPass ? 'ALL GATES PASSED' : 'GATE FAILURE'}`);

if (!allPass) {
    process.exitCode = 1;
}
