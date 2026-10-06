/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R12-E01: two stores sharing one scheduler with the same local subscription id both deliver;
// a plain wildcard fan-out still delivers every write to every subscriber. Args: [subscribers=64] [writes=500] [samples=7]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {ComponentUpdateThrottle} = await loadPath('Carburetor/Store/Scheduling/ComponentUpdateThrottle.mjs');
class S extends Carburetor {
    set(n) { this.update(draft => { draft.n = n; }); }
}

const subscribers = Number(process.argv[2] ?? 64);
const writes = Number(process.argv[3] ?? 500);
const samples = Number(process.argv[4] ?? 7);

class Controlled extends ComponentUpdateThrottle {
    /** Uses explicit flushing rather than timers. */
    setupTimeout() {}
    /** Delivers one complete queue. */
    flush() { this.letsUpdate(); }
}

// Same local id in two stores over one shared scheduler: both callbacks must run.
const shared = new Controlled();
const first = new S({n: 0}, shared);
const second = new S({n: 0}, shared);
let sharedDeliveries = 0;
first.subscribe(() => { sharedDeliveries++; }, {id: 'view'});
second.subscribe(() => { sharedDeliveries++; }, {id: 'view'});
first.set(1);
second.set(1);
shared.flush();

// Wildcard fan-out through setData: subscribers x writes deliveries.
const times = [];
let fanoutDeliveries = 0;
for (let round = 0; round < samples; round++) {
    const store = new S({n: 0});
    for (let i = 0; i < subscribers; i++) {
        store.subscribe(() => { fanoutDeliveries++; }, {id: 's' + i});
    }
    const start = performance.now();
    for (let n = 1; n <= writes; n++) {
        store.setData({n});
    }
    times.push(performance.now() - start);
}
emit({sharedDeliveries, fanoutDeliveries, fanoutMs: median(times)});
