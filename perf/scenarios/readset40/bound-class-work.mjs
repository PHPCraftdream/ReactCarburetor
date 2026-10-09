/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
import {emit, load, median, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
class Store extends Carburetor {
    reads = 0;
    subscriptions = 0;
    filed;
    filedChecks = 0;
    read(record) { return super.read(path => { this.reads++; record(path); }); }
    subscribe(callback, options) {
        this.subscriptions++;
        this.filed = options.reads;
        return super.subscribe(callback, options);
    }
    change(body) { this.update(body); }
}
const store = new Store({tick: 0, items: Array.from({length: 10000}, (_, id) => ({id, title: 'T' + id}))});
let renders = 0;
class Owner extends AntiHookComponent {
    items = this.connectSelection(store, data => data.items);
    render() {
        renders++;
        const items = this.items();
        return React.createElement('output', null, items[7].title + ':' + items.length);
    }
}
flushSync(() => root.render(React.createElement(Owner)));
const initialReads = store.reads;
const initialSubscriptions = store.subscriptions;
const nativeHas = Set.prototype.has;
let allChecks = 0;
Set.prototype.has = function(path) {
    allChecks++;
    if (this === store.filed) store.filedChecks++;
    return nativeHas.call(this, path);
};
const samples = [];
const reads = [];
let correct = true;
for (let k = 1; k <= 21; k++) {
    for (let t = 0; t < 2; t++) flushSync(() => store.change(data => { data.tick++; }));
    const before = store.reads;
    const start = performance.now();
    flushSync(() => store.change(data => { data.items[7].title = 'K' + k; }));
    samples.push(performance.now() - start);
    reads.push(store.reads - before);
    correct &&= renders === k + 1 && container.textContent === 'K' + k + ':10000';
}
Set.prototype.has = nativeHas;
root.unmount();
emit({relatedWriteMs: median(samples), samplesMs: samples, reads, initialReads,
    allChecks, filedChecks: store.filedChecks, maxReads: Math.max(...reads), initialSubscriptions,
    refiles: store.subscriptions - initialSubscriptions, renders: renders - 1, correct});
