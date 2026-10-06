/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-06: one history entry with overlapping object patches must stay independent (folded patch
// list) instead of cloning the whole owned baseline for the preflight.
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rounds = 9;

// Overlapping patches (new object, then a field inside it) as the state grows.
const runDep = count => {
    const s = new S({docs: {}, rows: Array.from({length: count}, (_, i) => ({id: i}))});
    const rowsRef = s.getData().rows;
    const history = new CarburetorHistory(s);
    const times = [];
    let key = '';
    for (let i = 0; i < rounds; i++) {
        key = 'entry-' + i;
        global.gc?.();
        const start = performance.now();
        s.run(d => { d.docs[key] = {id: i}; d.docs[key].id = -i; });
        times.push(performance.now() - start);
    }
    history.undo();
    const undoneOk = !(key in s.getData().docs);
    history.redo();
    const redoneOk = s.getData().docs[key].id === -(rounds - 1);
    const rowsUnchanged = s.getData().rows === rowsRef;
    history.disconnect();
    return {ms: median(times), undoneOk, redoneOk, rowsUnchanged};
};

const dep1k = runDep(1000);
const dep10k = runDep(10000);

// Mechanism probe: row-object key walks during one dependent update at 10k rows, plus a snapshot
// control proving the instrumentation sees engine walks (the pre-R33-06 preflight cloned the whole
// owned baseline and walked every row).
const rowWalks = fn => {
    const originalOwnKeys = Reflect.ownKeys;
    const originalKeys = Object.keys;
    let walks = 0;
    Reflect.ownKeys = target => {
        if (target !== null && typeof target === 'object' && !Array.isArray(target)
            && Number.isInteger(target.id) && target.id >= 0) walks++;
        return originalOwnKeys(target);
    };
    Object.keys = target => {
        if (target !== null && typeof target === 'object' && !Array.isArray(target)
            && Number.isInteger(target.id) && target.id >= 0) walks++;
        return originalKeys(target);
    };
    try {
        return fn(() => walks);
    } finally {
        Reflect.ownKeys = originalOwnKeys;
        Object.keys = originalKeys;
    }
};
const probe = new S({docs: {}, rows: Array.from({length: 10000}, (_, i) => ({id: i}))});
const probeHistory = new CarburetorHistory(probe);
const depRowWalks = rowWalks(get => {
    probe.run(d => { d.docs['entry-probe'] = {id: -1}; d.docs['entry-probe'].id = -2; });
    return get();
});
const controlRowWalks = rowWalks(get => { probe.snapshot(); return get(); });
probeHistory.disconnect();

// Subtree write with and without history attached (guard only; ratio was 21-27x pre-fix).
const subtreeBench = withHistory => {
    const s = new S({docs: {}, rows: Array.from({length: 1000}, (_, i) => ({id: i}))});
    const history = withHistory ? new CarburetorHistory(s) : null;
    const subtree = Object.fromEntries(Array.from({length: 1000}, (_, i) => [i, {id: i, value: i * 2}]));
    const times = [];
    let key = '';
    for (let i = 0; i < 5; i++) {
        key = 'sub-' + i;
        global.gc?.();
        const start = performance.now();
        s.run(d => { d.docs[key] = subtree; });
        times.push(performance.now() - start);
    }
    if (history) {
        history.undo();
        history.redo();
        subtreeRedoneOk = s.getData().docs[key][999].value === 1998;
        history.disconnect();
    }
    return median(times);
};
let subtreeRedoneOk = false;
const subtreeWithMs = subtreeBench(true);
const subtreeWithoutMs = subtreeBench(false);

emit({
    dep1kMs: dep1k.ms, dep10kMs: dep10k.ms,
    undoneOk: dep10k.undoneOk, redoneOk: dep10k.redoneOk, rowsUnchanged: dep10k.rowsUnchanged,
    depRowWalks, controlRowWalks, subtreeWithMs, subtreeWithoutMs, subtreeRedoneOk,
});
