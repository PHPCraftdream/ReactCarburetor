/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R19-ENGINE-02: one unlocked cache replacement, plus exact endpoint and idle controls.
import {emit, loadPath} from '../../../harness/lib.mjs';
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {CarburetorHistory} = await loadPath('Carburetor/Tooling/CarburetorHistory.mjs');
const cache = new ResourceCache(async key => key);
const roots = new Set();
const dictionaries = new Set();
const bodies = new Set();
const capture = cache.captureHistory;
cache.captureHistory = function (own) {
    return capture.call(this, value => {
        const state = own(value);
        roots.add(state);
        dictionaries.add(state.entries);
        for (const entry of Object.values(state.entries)) bodies.add(entry);
        return state;
    });
};
const history = new CarburetorHistory(cache);
for (let n = 0; n < 8; n++) await cache.load(n);
const key = cache.keyOf(0);
const entries = cache.getData().entries;
const replacement = {entries: {...entries, [key]: {...entries[key], data: 17}}};
const measure = fn => {
    const keys = Object.keys;
    const counts = {root: 0, dictionary: 0, entry: 0};
    Object.keys = function (value) {
        if (roots.has(value)) counts.root++;
        if (dictionaries.has(value)) counts.dictionary++;
        if (bodies.has(value)) counts.entry++;
        return keys(value);
    };
    try { fn(); } finally { Object.keys = keys; }
    return counts;
};
const idle = measure(() => cache.getData().entries[key].data);
const counts = measure(() => cache.setData(replacement));
cache.captureHistory(value => value);
const root = [...roots].at(-1);
const dictionary = root.entries;
for (const state of roots) {
    for (const entry of Object.values(state.entries)) bodies.add(entry);
}
const control = measure(() => {
    Object.keys(root);
    Object.keys(dictionary);
    for (const entry of [...bodies].slice(0, 8)) Object.keys(entry);
});
const cacheOk = cache.getData().entries[key].data === 17;
const undoOk = history.undo() && cache.getData().entries[key].data === 0;
const redoOk = history.redo() && cache.getData().entries[key].data === 17;
history.disconnect();
emit({rootVisits: counts.root, dictionaryVisits: counts.dictionary, entryVisits: counts.entry,
    controlRootVisits: control.root, controlDictionaryVisits: control.dictionary, controlEntryVisits: control.entry,
    idleRootVisits: idle.root, idleDictionaryVisits: idle.dictionary, idleEntryVisits: idle.entry,
    cacheOk, undoOk, redoOk});
