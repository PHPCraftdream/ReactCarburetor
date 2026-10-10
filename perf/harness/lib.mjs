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

/** Imports any module of the build under test by its path inside the build, e.g. 'Carburetor/Store/Carburetor.mjs'. */
export const loadPath = async relative => import(pathToFileURL(resolve(root, relative)).href);

/** The directory of the build under test, for scenarios that spawn their own children or read files. */
export const distRoot = root;

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
 * Key of an engine member: the plain name before R40-01, the internal symbol after (scenarios that
 * read or override engine internals stay runnable on both builds).
 */
export const engineKey = (name, holder) => {
    // Prefer symbols across the entire chain: a domain field can shadow an old plain name.
    for (let o = holder; o; o = Object.getPrototypeOf(o)) {
        const symbol = Object.getOwnPropertySymbols(o).find(s => /^(store|resource|component|computed)\./.test(s.description ?? '')
            && s.description.endsWith('.' + name));
        if (symbol) return symbol;
    }
    return name;
};

/** Value of an engine member of `holder` (see engineKey). */
export const engine = (holder, name) => holder?.[engineKey(name, holder)];

/** Calls an engine method of `holder` (see engineKey). */
export const call = (holder, name, ...args) => holder[engineKey(name, holder)](...args);

/**
 * Counts how often a store falls back to its write log for a drift answer: the O(read set)
 * path the per-subscription matched version is meant to spare. Reads the protected field.
 */
export const countWriteLogMatches = store => {
    const log = engine(store, 'writeLog');
    if (!log || typeof log.matches !== 'function') {
        throw new Error(
            'countWriteLogMatches: store.writeLog.matches is missing on this build'
            + ` (store ${store?.constructor?.name}); the counter would silently stay 0 and blind`
            + ' every gate on it — port the scenario to the renamed engine API');
    }
    const original = log.matches.bind(log);
    const counter = {calls: 0};
    log.matches = (version, reads) => {
        counter.calls++;
        return original(version, reads);
    };
    return counter;
};
