/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Partitioned persist: one storage key per top-level branch, sealed once, then only dirty
// branches rewritten. The pre-partition build ignores {partitions} and rewrites the
// whole-store key instead. Args: [rows=10000] [writes=50]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, persist} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const writes = Number(process.argv[3] ?? 50);
const storageStub = () => ({
    keys: [],
    map: new Map(),
    getItem(k) { return this.map.get(k) ?? null; },
    setItem(k, v) { this.keys.push(k); this.map.set(k, v); },
    removeItem(k) { this.map.delete(k); },
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

void (async () => {
    const branches = Array.from({length: 10}, (_, id) => `branch${id}`);
    const perBranch = Math.ceil(rows / branches.length);
    const data = {};
    branches.forEach((name, i) => {
        data[name] = Array.from({length: perBranch}, (_, id) => ({id: i * perBranch + id, done: false}));
    });
    const s = new S(data);
    const storage = storageStub();
    const dispose = persist(s, {key: 'bench', storage, partitions: branches});

    const start = performance.now();
    for (let i = 0; i < writes; i++) s.run(d => { d.branch0[i].done = true; });
    await tick();
    const partitionMs = performance.now() - start;

    const sealBranchKeys = new Set(storage.keys.filter(k => k !== 'bench')).size;
    const wholeKeyWrites = storage.keys.filter(k => k === 'bench').length;

    storage.keys = [];
    for (let i = 0; i < writes; i++) s.run(d => { d.branch0[rows + i] = {id: rows + i, done: true}; });
    await tick();

    const dirtyFlushKeys = new Set(storage.keys.filter(k => k !== 'bench')).size;
    const roundTrip = {};
    branches.forEach(name => { roundTrip[name] = JSON.parse(storage.getItem('bench.' + name)); });
    const contentOk = JSON.stringify(roundTrip) === JSON.stringify(s);
    dispose();

    emit({partitionMs, wholeKeyWrites, sealBranchKeys, dirtyFlushKeys, contentOk});
})();
