/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent} = await load();
const {useCarburetorValue} = await load('Interop');
const size = Number(process.argv[2]);
const route = process.argv[3];
class Store extends Carburetor {
    recorded = 0;
    change(fn) { this.update(fn); }
    read(record) { return super.read(path => { this.recorded++; record(path); }); }
}
const select = d => d.items;
const store = new Store({tick: 0, items: Array.from({length: size}, (_, id) => ({id, title: `T${id}`, done: false}))});
let renders = 0;
let latest;
let previous;
let root;
let container;
let flush = fn => fn();
let stop;
if (route === 'watch') {
    stop = store.watch(select, (next, before) => { renders++; latest = next; previous = before; });
} else {
    const dom = await setupReact();
    ({root, container} = dom);
    flush = dom.flushSync;
    const {React} = dom;
    const output = items => {
        renders++; previous = latest; latest = items;
        return React.createElement('output', null, `${items[7].title}:${items.length}`);
    };
    const Hook = () => output(useCarburetorValue(store, select));
    class Owner extends AntiHookComponent {
        items = this.connectSelection(store, select);
        render() { return output(this.items()); }
    }
    flush(() => root.render(React.createElement(route === 'hook' ? Hook : Owner)));
}
const initialReads = store.recorded;
const reads = [];
let correct = initialReads > size;
const initialRenders = renders;
for (const count of [2, 8, 64]) {
    const beforeRenders = renders;
    for (let k = 0; k < count; k++) flush(() => store.change(d => { d.tick++; }));
    correct &&= renders === beforeRenders;
    store.recorded = 0;
    flush(() => store.change(d => { d.items[7].title = `K${count}`; }));
    reads.push(store.recorded);
    correct &&= renders === beforeRenders + 1 && latest[7].title === `K${count}` && latest.length === size;
    correct &&= previous[7].title === (count === 2 ? 'T7' : count === 8 ? 'K2' : 'K8');
    if (container) correct &&= container.textContent === `K${count}:${size}`;
}
stop?.();
root?.unmount();
// External native aliases force the ownership ledger to reject reuse, independent of lag coverage.
const peer = {n: 1};
const aliasItems = Array.from({length: size}, (_, id) => ({id, title: `T${id}`, link: null}));
aliasItems[0].link = new Map([['peer', peer]]);
const aliasStore = new Store({tick: 0, peer, items: aliasItems});
let aliasNext;
let aliasPrevious;
let aliasWakes = 0;
let aliasContainer;
let aliasRoot;
let aliasFlush = fn => fn();
let aliasStop;
const aliasOutput = items => {
    aliasWakes++; aliasPrevious = aliasNext; aliasNext = items;
    return `${items[0].link.get('peer').n}:${items.length}`;
};
if (route === 'watch') {
    aliasStop = aliasStore.watch(select, (next, before) => {
        aliasOutput(next); aliasPrevious = before;
    });
} else {
    const dom = await setupReact();
    aliasContainer = dom.container; aliasRoot = dom.root; aliasFlush = dom.flushSync;
    const {React} = dom;
    const Hook = () => React.createElement('output', null, aliasOutput(useCarburetorValue(aliasStore, select)));
    class Owner extends AntiHookComponent {
        items = this.connectSelection(aliasStore, select);
        render() { return React.createElement('output', null, aliasOutput(this.items())); }
    }
    aliasFlush(() => aliasRoot.render(React.createElement(route === 'hook' ? Hook : Owner)));
}
const aliasInitialWakes = aliasWakes;
const aliasHeld = aliasNext;
aliasStore.recorded = 0;
for (let k = 0; k < 8; k++) aliasFlush(() => aliasStore.change(d => { d.tick++; }));
const aliasQuiet = aliasWakes === aliasInitialWakes && aliasStore.recorded === 0;
aliasStore.recorded = 0;
aliasFlush(() => aliasStore.change(d => { d.peer.n = 2; }));
const aliasReads = aliasStore.recorded;
const aliasCorrect = aliasQuiet && aliasWakes === aliasInitialWakes + 1 &&
    aliasNext[0].link.get('peer').n === 2 && aliasPrevious[0].link.get('peer').n === 1 &&
    (!aliasHeld || aliasHeld[0].link.get('peer').n === 1) &&
    (!aliasContainer || aliasContainer.textContent === `2:${size}`);
aliasStop?.();
aliasRoot?.unmount();
// A single outside leaf path gets a new raw target in each small publication.
const overflowStore = new Store({items: Array.from({length: size}, (_, id) => ({id, n: 0})), outside: {n: 0}, tick: 0});
let overflowWakes = 0;
const overflowSeen = [];
const overflowBefore = [];
const overflowStop = overflowStore.watch(select, (next, before) => {
    overflowWakes++; overflowSeen.push(next); overflowBefore.push(before);
});
for (let k = 0; k < 4100; k++) overflowStore.change(d => { d.outside = {n: 0}; d.outside.n = k + 1; });
const overflowQuiet = overflowWakes === 0;
overflowStore.recorded = 0;
overflowStore.change(d => { d.items[7].n = 1; });
const overflowReads = overflowStore.recorded;
overflowStore.recorded = 0;
overflowStore.change(d => { d.items[7].n = 2; });
const recoveryReads = overflowStore.recorded;
for (let k = 0; k < 8; k++) overflowStore.change(d => { d.tick++; });
overflowStore.recorded = 0;
overflowStore.change(d => { d.items[7].n = 3; });
const interleavedRecoveryReads = overflowStore.recorded;
const overflowCorrect = overflowQuiet && overflowWakes === 3 &&
    overflowSeen.every((items, index) => items[7].n === index + 1 && items.length === size) &&
    overflowBefore.every((items, index) => items[7].n === index);
overflowStop();
emit({reads: reads.join(','), maxReads: Math.max(...reads), aliasReads, initialReads,
    overflowReads, recoveryReads, interleavedRecoveryReads, overflowCorrect,
    renders: renders - initialRenders, text: latest[7].title + ':' + latest.length,
    aliasCorrect, done: correct && aliasCorrect && overflowCorrect});
