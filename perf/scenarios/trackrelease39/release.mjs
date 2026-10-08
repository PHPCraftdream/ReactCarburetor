/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent} = await load();
const {useCarburetorValue} = await load('Interop');
const route = process.argv[2];
const SIZE = 1000;
class Store extends Carburetor {
    recorded = 0;
    change(fn) { this.update(fn); }
    read(record) { return super.read(path => { this.recorded++; record(path); }); }
}
const count = fn => {
    const OriginalMap = globalThis.Map;
    const OriginalSet = globalThis.Set;
    const counts = {maps: 0, sets: 0};
    globalThis.Map = class extends OriginalMap { constructor(...args) { super(...args); counts.maps++; } };
    globalThis.Set = class extends OriginalSet { constructor(...args) { super(...args); counts.sets++; } };
    try { fn(); } finally { globalThis.Map = OriginalMap; globalThis.Set = OriginalSet; }
    return counts;
};
const select = d => d.items;
const store = new Store({tick: 0, items: Array.from({length: SIZE}, (_, id) => ({id, n: 0}))});
let latest;
let wakes = 0;
/** Mounts one consumer of the route; returns its flusher and teardown. */
const mount = async () => {
    if (route === 'watch') {
        const stop = store.watch(select, next => { wakes++; latest = next; });
        latest = undefined;
        return {flush: fn => fn(), stop};
    }
    const {React, flushSync, root} = await setupReact();
    const output = items => { latest = items; wakes++; return React.createElement('output', null, String(items.length)); };
    const Hook = () => output(useCarburetorValue(store, select));
    class Owner extends AntiHookComponent {
        items = this.connectSelection(store, select);
        render() { return output(this.items()); }
    }
    flushSync(() => root.render(React.createElement(route === 'hook' ? Hook : Owner)));
    return {flush: flushSync, stop: () => flushSync(() => root.unmount())};
};
/** One related write; returns the tracked reads it cost and whether the consumer saw it. */
const probe = (consumer, value) => {
    const before = wakes;
    store.recorded = 0;
    consumer.flush(() => store.change(d => { d.items[7].n = value; }));
    return {reads: store.recorded, seen: wakes === before + 1 && latest[7].n === value && latest.length === SIZE};
};
const first = await mount();
for (let k = 0; k < 4; k++) first.flush(() => store.change(d => { d.tick++; }));
const alive = probe(first, 1);
first.stop();
// Nobody selects now: 1000 writes must cost what they cost on a store that never had a consumer.
const released = count(() => {
    for (let i = 2; i <= 1001; i++) store.change(d => { d.items[7].n = i; });
});
// A consumer created after the full release reads correctly and patches again.
const second = await mount();
const settled = route === 'watch' || (latest.length === SIZE && latest[7].n === 1001);
const again = probe(second, 2000);
second.stop();
emit({maps: released.maps, sets: released.sets, aliveReads: alive.reads, remountReads: again.reads,
    done: alive.seen && again.seen && settled && store.getVersion() >= 1001});
