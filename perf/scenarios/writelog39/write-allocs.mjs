/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor} = await load();
class Store extends Carburetor { change(fn) { this.update(fn); } }
const count = fn => {
    const OriginalMap = globalThis.Map;
    const OriginalSet = globalThis.Set;
    const counts = {maps: 0, sets: 0};
    globalThis.Map = class extends OriginalMap { constructor(...args) { super(...args); counts.maps++; } };
    globalThis.Set = class extends OriginalSet { constructor(...args) { super(...args); counts.sets++; } };
    try { fn(); } finally { globalThis.Map = OriginalMap; globalThis.Set = OriginalSet; }
    return counts;
};
const make = () => new Store({tick: 0, rows: [{a: 0}]});
const store = make();
store.change(d => { d.rows[0].a = 1; });
const noConsumer = count(() => {
    for (let i = 2; i <= 1001; i++) store.change(d => { d.rows[0].a = i; });
});
const consumer = make();
let wakes = 0;
let latest;
const stop = consumer.watch(d => d.rows, next => { wakes++; latest = next; });
consumer.change(d => { d.rows[0].a = 1; });
const withConsumer = count(() => {
    for (let i = 2; i <= 1001; i++) {
        consumer.change(d => { d.tick++; });
        consumer.change(d => { d.rows[0].a = i; });
    }
});
stop();
emit({maps: noConsumer.maps, sets: noConsumer.sets, consumerMaps: withConsumer.maps,
    consumerSets: withConsumer.sets, wakes, done: store.getData().rows[0].a === 1001
        && store.getVersion() === 1001 && latest[0].a === 1001 && wakes === 1001});
