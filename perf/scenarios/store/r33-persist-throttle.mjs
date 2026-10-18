/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// persist throttleMs bounds the storage write rate. The scenario stubs the clock persist
// reads (Date.now) and the timers it schedules (setTimeout/clearTimeout), so the window is
// opened and advanced by hand: process pauses and system-clock changes cannot move the
// counters. A build without the option writes one per microtask instead (5 during the
// burst, 5 total). Args: [rows=10000] [writes=5]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, persist} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const writes = Number(process.argv[3] ?? 5);
const storageStub = () => ({
    calls: 0,
    map: new Map(),
    getItem(k) { return this.map.get(k) ?? null; },
    setItem(k, v) { this.calls++; this.map.set(k, v); },
    removeItem(k) { this.map.delete(k); },
});
const settle = () => new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));

void (async () => {
    const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, done: false}))});
    const storage = storageStub();

    const realDateNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    let fakeNow = 1_000_000;
    let timers = [];
    Date.now = () => fakeNow;
    globalThis.setTimeout = (callback, delay) => {
        timers.push({callback, delay: delay ?? 0});
        return timers.length;
    };
    globalThis.clearTimeout = handle => {
        if (timers[handle - 1]) timers[handle - 1].callback = () => undefined;
    };

    let dispose = () => undefined;

    try {
        dispose = persist(s, {key: 'bench', storage, throttleMs: 60000});

        for (let i = 0; i < writes; i++) {
            s.run(d => { d.rows[i].done = true; });
            await settle();
        }
        const burstWrites = storage.calls;

        // Advance past the window and let the scheduled timer deliver the held-back state
        // without disposal.
        fakeNow += 60001;
        const dueTimers = timers;
        timers = [];
        dueTimers.forEach(timer => timer.callback());
        await settle();
        const writesBeforeDispose = storage.calls;

        dispose();
        const setItemCalls = storage.calls;
        const contentOk = storage.getItem('bench') === JSON.stringify(s);

        emit({throttleMs: 60000, burstWrites, writesBeforeDispose, setItemCalls, contentOk});
    } finally {
        Date.now = realDateNow;
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
    }
})();
