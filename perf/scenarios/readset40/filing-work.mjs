/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, loadPath} from '../../harness/lib.mjs';
const {SubscriberIndex} = await loadPath('Carburetor/Store/Paths/SubscriberIndex.mjs');
const subscribers = Number(process.argv[2] ?? 4000);
const index = new SubscriberIndex();
const counters = {exactVisits: 0, branchVisits: 0, exactWrites: 0, branchWrites: 0, otherWrites: 0};
const originals = {};
for (const method of ['get', 'set', 'delete']) {
    originals[method] = Map.prototype[method];
    Map.prototype[method] = function(...args) {
        if (method === 'get') {
            if (this === index.exact) counters.exactVisits++;
            else if (this === index.branch) counters.branchVisits++;
        } else if (this === index.exact) counters.exactWrites++;
        else if (this === index.branch) counters.branchWrites++;
        else counters.otherWrites++;
        return originals[method].apply(this, args);
    };
}
try {
    for (let n = 0; n < subscribers; n++) {
        index.add('sub-' + n, new Set([`rows.${n}`, `rows.${n}.title`, `rows.${n}.done`]));
    }
    for (let n = 0; n < subscribers; n++) index.remove('sub-' + n);
} finally {
    for (const method of ['get', 'set', 'delete']) Map.prototype[method] = originals[method];
}
const {exactVisits, branchVisits, exactWrites, branchWrites, otherWrites} = counters;
const empty = index.exact.size === 0 && index.branch.size === 0 && index.readsById.size === 0;
emit({subscribers, exactVisits, branchVisits, exactWrites, branchWrites, otherWrites, empty});
