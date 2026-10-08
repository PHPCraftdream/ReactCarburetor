/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Probe original AND intermediate rows: a copier registers source -> detached target in its ledger.
export const rowProbe = rows => {
    const originals = new WeakSet(rows);
    const ownKeys = Reflect.ownKeys;
    const set = WeakMap.prototype.set;
    const define = Object.defineProperty;
    const descriptor = Object.getOwnPropertyDescriptor;
    const isRow = value => value !== null && typeof value === 'object'
        && descriptor(value, 'probeRow')?.value === 'PG-D1';
    return fn => {
        const counts = {originalVisits: 0, intermediateVisits: 0, originalCopies: 0, intermediateCopies: 0, rowDefines: 0};
        Reflect.ownKeys = function (value) {
            if (isRow(value)) counts[originals.has(value) ? 'originalVisits' : 'intermediateVisits']++;
            return ownKeys(value);
        };
        WeakMap.prototype.set = function (source, target) {
            if (isRow(source) && target !== source && typeof target === 'object') {
                counts[originals.has(source) ? 'originalCopies' : 'intermediateCopies']++;
            }
            return set.call(this, source, target);
        };
        Object.defineProperty = function (target, key, desc) {
            if (isRow(target) || (key === 'probeRow' && desc.value === 'PG-D1')) counts.rowDefines++;
            return define(target, key, desc);
        };
        const start = performance.now();
        let result;
        try { result = fn(); } finally {
            Reflect.ownKeys = ownKeys; WeakMap.prototype.set = set; Object.defineProperty = define;
        }
        return {...counts, copies: counts.originalCopies + counts.intermediateCopies,
            ms: performance.now() - start, result};
    };
};
export const makeRows = size => Array.from({length: size}, (_, id) => ({probeRow: 'PG-D1', id, value: 0}));
