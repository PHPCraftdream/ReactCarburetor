/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Deterministic operation counts for ordered whole-key restore; deliberately no timings.
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, persist} = await load();
class Store extends Carburetor {}
const makeStorage = entries => {
    const map = new Map(Object.entries(entries));
    const counts = {reads: 0, writes: 0, removes: 0};
    return {
        counts,
        map,
        getItem(key) { counts.reads++; return map.get(key) ?? null; },
        setItem(key, value) { counts.writes++; map.set(key, value); },
        removeItem(key) { counts.removes++; map.delete(key); },
    };
};
const check = (entries, keys, current = 'new') => {
    const storage = makeStorage(entries);
    const store = new Store({value: 0});
    const selected = Object.hasOwn(entries, current) ? undefined : keys.find(key => Object.hasOwn(entries, key));
    let stop;
    try {
        stop = persist(store, {key: current, storage, previousKeys: keys});
    } catch {
        return {reads: storage.counts.reads, writes: storage.counts.writes,
            removes: storage.counts.removes, contentOk: false, oldRetained: true};
    }
    const contentOk = JSON.parse(storage.map.get(current) ?? 'null')?.value === (selected
        ? JSON.parse(entries[selected]).value : JSON.parse(entries[current] ?? 'null')?.value ?? 0);
    const oldRetained = Object.keys(entries).filter(key => key !== current && key !== selected)
        .every(key => storage.map.has(key)) && (!selected || !storage.map.has(selected));
    stop();
    return {...storage.counts, contentOk, oldRetained};
};
const current = check({new: JSON.stringify({value: 7}), old0: JSON.stringify({value: 3})}, ['old0']);
const fallback = check({old0: JSON.stringify({value: 3}), old1: JSON.stringify({value: 4})}, ['miss', 'old0', 'old1']);
const extraFallback = check({old1: JSON.stringify({value: 4})}, ['miss', 'old0', 'old1']);
const control = makeStorage({});
control.getItem('missing');
control.getItem('missing-again');
control.setItem('deliberate', '{}');
control.setItem('deliberate', '{}');
control.removeItem('deliberate');
control.removeItem('deliberate');
emit({currentReads: current.reads, currentWrites: current.writes, currentRemoves: current.removes,
    currentOldRetained: current.oldRetained, currentContentOk: current.contentOk,
    fallbackReads: fallback.reads, fallbackWrites: fallback.writes,
    fallbackRemoves: fallback.removes, fallbackContentOk: fallback.contentOk,
    fallbackOldRetained: fallback.oldRetained,
    extraReads: extraFallback.reads, extraWrites: extraFallback.writes,
    extraRemoves: extraFallback.removes,
    controlReads: control.counts.reads, controlWrites: control.counts.writes,
    controlRemoves: control.counts.removes});
