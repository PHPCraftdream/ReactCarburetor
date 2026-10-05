/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Shared helpers for scenario probes: dist loading, timing, DOM setup and engine counters.
// A scenario reads its build from DIST_ROOT (a directory holding Carburetor/ and Interop/,
// e.g. dist/esm-prod, dist/esm or a patched copy) and ends with one `@@ {json}` metrics line.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(process.env.DIST_ROOT ?? 'dist/esm-prod');

/** Imports one entry of the build under test. */
export const load = async (entry = 'Carburetor') =>
    import(pathToFileURL(resolve(root, entry, 'index.mjs')).href);

export const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
};

/** Times `fn` `runs` times and returns the median in milliseconds. */
export const timeMedian = (fn, runs) => {
    const samples = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        fn(i);
        samples.push(performance.now() - start);
    }
    return median(samples);
};

/** Prints the metrics line the A/B runner collects. */
export const emit = metrics => {
    console.log('@@ ' + JSON.stringify(metrics));
};

/** JSDOM globals plus React 19 entry points for hook scenarios. */
export const setupReact = async () => {
    const {JSDOM} = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true, writable: true});
    globalThis.HTMLElement = dom.window.HTMLElement;
    const React = (await import('react')).default;
    const {flushSync} = await import('react-dom');
    const {createRoot} = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    return {React, flushSync, root: createRoot(container), container};
};

/**
 * Counts how often a store falls back to its write log for a drift answer: the O(read set)
 * path the per-subscription matched version is meant to spare. Reads the protected field.
 */
export const countWriteLogMatches = store => {
    const log = store.writeLog;
    const original = log.matches.bind(log);
    const counter = {calls: 0};
    log.matches = (version, reads) => {
        counter.calls++;
        return original(version, reads);
    };
    return counter;
};
