/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, engine} from '../../harness/lib.mjs';
const {Carburetor} = await load();
const oldPaths = Number(process.argv[2]);
class Store extends Carburetor { change(fn) { this.update(fn); } }
const store = new Store({values: {}, recent: 0});
// A selection consumer would ask for proofs; builds before R39-04 retain them always.
store[Symbol.for('react-carburetor/v1/store-track-targets')]?.();
for (let i = 0; i < oldPaths; i++) store.change(d => { d.values['p' + i] = i; });
const baseline = store.getVersion();
store.change(d => { d.recent = 1; });
const log = engine(store, 'writeLog');
if (!log || typeof log.pathsSince !== 'function' || !(log.last instanceof Map)) throw new Error('write log instrumentation unavailable');
let visits = 0;
const originalIterator = log.last[Symbol.iterator].bind(log.last);
log.last[Symbol.iterator] = function* () { for (const entry of originalIterator()) { visits++; yield entry; } };
if (log.recent) {
    if (!(log.recent.entries instanceof Map)) throw new Error('recent path instrumentation unavailable');
    for (const entry of log.recent.entries.values()) {
        const version = entry.version;
        Object.defineProperty(entry, 'version', {get() { visits++; return version; }});
    }
}
const start = performance.now();
const paths = log.pathsSince(baseline);
const queryMs = performance.now() - start;
const recentVisits = visits;
visits = 0;
const control = log.pathsSince(0);
const controlVisits = visits;
emit({oldPaths, recentVisits, controlVisits, returned: paths.length, queryMs,
    done: paths.length === 1 && paths[0] === 'recent' && control.includes('recent')
        && (oldPaths === 0 || control.includes('values.p3999'))});
