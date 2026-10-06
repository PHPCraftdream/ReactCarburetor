/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-07: persist coalesces storage writes by default (one stringify per microtask);
// {coalesce: false} keeps a synchronous stringify per write. Args: [rows=10000] [writes=50]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, persist} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const writes = Number(process.argv[3] ?? 50);
const storageStub = () => ({
    map: new Map(),
    calls: 0,
    getItem(k) { return this.map.get(k) ?? null; },
    setItem(k, v) { this.calls++; this.map.set(k, v); },
    removeItem(k) { this.map.delete(k); },
});

const variant = async coalesced => {
    const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, done: false}))});
    const storage = storageStub();
    const dispose = persist(s, {key: 'bench', storage, coalesce: coalesced ? undefined : false});
    const start = performance.now();
    for (let i = 0; i < writes; i++) s.run(d => { d.rows[i].done = true; });
    if (coalesced) await new Promise(resolve => setTimeout(resolve, 0));
    const ms = performance.now() - start;
    const calls = storage.calls;
    const contentOk = storage.getItem('bench') === JSON.stringify(s);
    dispose();
    return {ms, calls, contentOk};
};

void (async () => {
    const def = await variant(true);
    const sync = await variant(false);
    emit({
        defaultMs: def.ms, noCoalesceMs: sync.ms,
        setItemCallsDefault: def.calls, setItemCallsNoCoalesce: sync.calls,
        defaultContentOk: def.contentOk, noCoalesceContentOk: sync.contentOk,
    });
})();
