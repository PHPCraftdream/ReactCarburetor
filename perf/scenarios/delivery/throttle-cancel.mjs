/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R11-06: cancelling during a flush drops the captured callback — cancelled updates are not
// delivered; the uncancelled control delivers everything. Args: [rounds=2000] [samples=7]
import {emit, loadPath, median} from '../../harness/lib.mjs';

const {ComponentUpdateThrottle} = await loadPath('Carburetor/Store/Scheduling/ComponentUpdateThrottle.mjs');

const rounds = Number(process.argv[2] ?? 2000);
const samples = Number(process.argv[3] ?? 7);
const KEYS = Array.from({length: 63}, (_, index) => 'later-' + index);

class Controlled extends ComponentUpdateThrottle {
    /** Uses explicit flushing rather than timers. */
    setupTimeout() {}
    /** Delivers one complete queue. */
    flush() { this.letsUpdate(); }
}

const cancelledTimes = [];
let cancelledDelivered = 0;
for (let round = 0; round < samples; round++) {
    const scheduler = new Controlled();
    let delivered = 0;
    const first = () => {
        delivered++;
        for (const key of KEYS) {
            scheduler.cancel(key);
        }
    };
    const tail = () => { delivered++; };
    const start = performance.now();
    for (let iteration = 0; iteration < rounds; iteration++) {
        scheduler.schedule('first', first);
        for (const key of KEYS) {
            scheduler.schedule(key, tail);
        }
        scheduler.flush();
    }
    cancelledTimes.push(performance.now() - start);
    cancelledDelivered = delivered;
}

const controlTimes = [];
let controlDelivered = 0;
for (let round = 0; round < samples; round++) {
    const scheduler = new Controlled();
    let delivered = 0;
    const first = () => { delivered++; };
    const tail = () => { delivered++; };
    const start = performance.now();
    for (let iteration = 0; iteration < rounds; iteration++) {
        scheduler.schedule('first', first);
        for (const key of KEYS) {
            scheduler.schedule(key, tail);
        }
        scheduler.flush();
    }
    controlTimes.push(performance.now() - start);
    controlDelivered = delivered;
}
emit({
    cancelledDelivered, cancelledMs: median(cancelledTimes),
    controlDelivered, controlMs: median(controlTimes),
});
