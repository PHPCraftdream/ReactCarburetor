/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Past DIFF_PATH_THRESHOLD, diffPaths decides collapse versus precise with one counting pass and restore
// counts inside its scan. Counts container reads on instrumented rows against one complete walk of them.
import {emit, loadPath} from '../../harness/lib.mjs';

const {diffPaths} = await loadPath('Carburetor/Store/Paths/Diff/diffPaths.mjs');
const {applyDiff} = await loadPath('Carburetor/Store/Paths/Diff/applyDiff.mjs');
const {scanBranch} = await loadPath('Carburetor/Store/Paths/Diff/Order/scanBranch.mjs');

const counter = {reads: 0};
const instrument = (value, memo = new Map()) => {
    if (value === null || typeof value !== 'object') return value;
    if (memo.has(value)) return memo.get(value);
    const copy = Array.isArray(value)
        ? Object.assign([], {length: value.length})
        : Object.create(Object.getPrototypeOf(value));
    const proxy = new Proxy(copy, {get: (target, key, receiver) => {
        if (typeof key === 'string') counter.reads++;
        return Reflect.get(target, key, receiver);
    }});
    memo.set(value, proxy);
    for (const key of Object.keys(value)) copy[key] = instrument(value[key], memo);
    return proxy;
};
const rowPair = (count, changed) => {
    const previous = Array.from({length: count}, (_, title) => ({title}));
    return {previous, next: previous.map((row, index) => ({title: index < changed ? row.title + 1 : row.title}))};
};
const diffReads = (count, changed, root = false, patches) => {
    const {previous, next} = rowPair(count, changed);
    const memo = new Map();
    const oldTree = instrument(root ? {rows: previous, unrelated: {value: 1}} : previous, memo);
    const newTree = instrument(root ? {rows: next, unrelated: oldTree.unrelated} : next, memo);
    counter.reads = 0;
    const paths = root ? diffPaths(oldTree, newTree, '', [], patches)
        : diffPaths(oldTree, newTree, 'rows', ['rows'], patches);
    return {reads: counter.reads, paths: [...paths]};
};
const restoreReads = (count, changed, scanOnly = false) => {
    const rows = Array.from({length: count}, (_, title) => ({title}));
    const nextRows = rows.map((row, index) => (index < changed ? {title: row.title + 1} : row));
    const memo = new Map();
    const previous = instrument({rows}, memo);
    const next = instrument({rows: nextRows}, memo);
    const target = {rows: rows.map(row => ({...row}))};
    counter.reads = 0;
    const applied = scanOnly
        ? scanBranch(previous, next, {unchanged: new Map(), changes: 0}) !== 'blocked'
        : applyDiff(target, previous, next);
    return {reads: counter.reads, applied};
};

const walk1500 = diffReads(1500, 0);
const under1500 = diffReads(1500, 1500);
const walk2500 = diffReads(2500, 0);
const full2500 = diffReads(2500, 2500);
const walk10k = diffReads(10000, 0);
const full10k = diffReads(10000, 10000);
const rootWalk10k = diffReads(10000, 0, true);
const root10k = diffReads(10000, 10000, true);
const partial = diffReads(10000, 2500);
let longestBuffer = 0;
const patches = new Proxy([], {set: (target, key, value, receiver) => {
    const done = Reflect.set(target, key, value, receiver);
    longestBuffer = Math.max(longestBuffer, target.length);
    return done;
}});
const buffered = diffReads(10000, 10000, false, patches);
const scanOne = restoreReads(10000, 1, true);
const restoreOne = restoreReads(10000, 1);
const scanFull = restoreReads(10000, 10000, true);
const restoreFull = restoreReads(10000, 10000);

emit({
    walkReads1500: walk1500.reads, underReads1500: under1500.reads, underPaths1500: under1500.paths.length,
    walkReads2500: walk2500.reads, collapseReads2500: full2500.reads,
    walkReads10k: walk10k.reads, collapseReads10k: full10k.reads,
    rootWalkReads10k: rootWalk10k.reads, rootReads10k: root10k.reads,
    preciseReads: partial.reads, precisePaths: partial.paths.length,
    preciseLeaf: partial.paths[0] === 'rows.0.title' && partial.paths[2499] === 'rows.2499.title',
    collapsed: full2500.paths.join() === 'rows' && full10k.paths.join() === 'rows',
    rootKeys: root10k.paths.join(),
    longestBuffer, finalPatches: patches.length, bufferedCollapsed: buffered.paths.join() === 'rows',
    scanReadsOne: scanOne.reads, restoreReadsOne: restoreOne.reads, restoreOneApplied: restoreOne.applied,
    scanReadsFull: scanFull.reads, restoreReadsFull: restoreFull.reads, restoreFullApplied: restoreFull.applied,
    valid: scanOne.applied && scanFull.applied,
});
