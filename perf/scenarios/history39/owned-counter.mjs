/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Count the clone's own cycle ledger, not captureHistory: direct own(baseline) is included.
import {load, loadPath} from '../../harness/lib.mjs';

// deepClone exists before patch history; the older build snapshots instead of owning graphs.
await loadPath('Carburetor/Store/Utils/deepClone.mjs');
const {Carburetor} = await load();
// loadPath returns an ESM namespace: exported const bindings cannot be replaced by a consumer.
// Instead identify new WeakMaps by the module filename in their constructor stack. Each set on
// that ledger is an actual newly cloned object (including native nodes), not a traversal estimate.
const marker = /[/\\]cloneOwnedGraph\.mjs(?::|\b)/;
export const countOwned = fn => {
    const originalSnapshot = Carburetor.prototype.snapshot;
    const originalOwnKeys = Reflect.ownKeys;
    let snapshotClones = 0;
    let snapshotNodes = 0;
    Carburetor.prototype.snapshot = function (...args) {
        snapshotClones++;
        return originalSnapshot.apply(this, args);
    };
    Reflect.ownKeys = function (value) {
        if (/[/\\]deepClone\.mjs(?::|\b)/.test(new Error().stack ?? '')) snapshotNodes++;
        return originalOwnKeys(value);
    };
    const Original = globalThis.WeakMap;
    const originalSet = Original.prototype.set;
    const ledgers = new Original();
    const sizes = [];
    const originalDate = globalThis.Date;
    let dateClones = 0;
    globalThis.WeakMap = new Proxy(Original, {
        construct(target, args) {
            const ledger = Reflect.construct(target, args);
            if (marker.test(new Error().stack ?? '')) {
                const size = {nodes: 0};
                originalSet.call(ledgers, ledger, size);
                sizes.push(size);
            }
            return ledger;
        },
    });
    Original.prototype.set = function (key, value) {
        const size = ledgers.get(this);
        if (size) size.nodes++;
        return originalSet.call(this, key, value);
    };
    globalThis.Date = new Proxy(originalDate, {
        construct(target, args) {
            if (marker.test(new Error().stack ?? '')) dateClones++;
            return Reflect.construct(target, args);
        },
    });
    try {
        const result = fn();
        return {
            result, ownedClones: sizes.length || snapshotClones,
            clonedNodes: sizes.reduce((sum, size) => sum + size.nodes, 0) || snapshotNodes,
            dateClones,
        };
    } finally {
        Carburetor.prototype.snapshot = originalSnapshot;
        Reflect.ownKeys = originalOwnKeys;
        globalThis.WeakMap = Original;
        Original.prototype.set = originalSet;
        globalThis.Date = originalDate;
    }
};
