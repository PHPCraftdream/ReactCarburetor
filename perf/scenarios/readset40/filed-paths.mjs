/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent, computed} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class Store extends Carburetor {
    filed = [];
    change(body) { this.update(body); }
    subscribe(callback, options = {}) {
        if (options.reads) this.filed.push([...options.reads]);
        return super.subscribe(callback, options);
    }
}
const items = {};
for (let i = 0; i < 1000; i++) items['r' + i] = {title: 't' + i, done: i % 3 === 0, owner: {name: 'n' + i}};
const store = new Store({items, filter: {text: ''}, user: {name: 'u'}});
const Hook = () => React.createElement('p', null, useCarburetorValue(store, d => d.items.r1?.title ?? 'missing'));
flushSync(() => root.render(React.createElement(Hook)));
const hookPaths = store.filed.at(-1).length;
let wakeCorrect = container.textContent === 't1';
flushSync(() => store.change(d => { d.items.r2.title = 'sibling'; }));
wakeCorrect &&= container.textContent === 't1';
flushSync(() => store.change(d => { d.items.r1 = {title: 'replacement', done: false, owner: {name: 'n1'}}; }));
wakeCorrect &&= container.textContent === 'replacement';
class Row extends AntiHookComponent {
    data = this.connect(store);
    render() { return React.createElement('p', null, this.data.items.r1.title + this.data.items.r1.owner.name); }
}
flushSync(() => root.render(React.createElement(Row)));
const classPaths = store.filed.at(-1).length;
wakeCorrect &&= container.textContent === 'replacementn1';
flushSync(() => root.render(null));
const watchValues = [];
const stop = store.watch(d => d.items.r2.done, next => watchValues.push(next));
const watchPaths = store.filed.at(-1).length;
store.change(d => { d.items.r2.done = true; });
const value = computed(read => read(store).items.r1.owner.name.length + read(store).filter.text.length);
const id = value.subscribe(() => {});
const computedPaths = store.filed.at(-1).length;
wakeCorrect &&= value.get() === 2;
store.change(d => { d.filter.text = 'x'; });
wakeCorrect &&= value.get() === 3;
const active = computed(read => {
    const {items: rows} = read(store);
    return Object.keys(rows).filter(key => !rows[key].done).length;
});
const activeId = active.subscribe(() => {});
const activeCountPaths = store.filed.at(-1).length;
wakeCorrect &&= active.get() === 665;
const presence = [];
const stopPresence = store.watch(d => 'r1' in d.items, next => presence.push(next));
const presenceMarkers = store.filed.at(-1).filter(path => path.endsWith('.~p')).length;
const stopUser = store.watch(d => !!d.user, () => {});
const userMarkers = store.filed.at(-1).filter(path => path.endsWith('.~p')).length;
store.change(d => { delete d.items.r1; });
wakeCorrect &&= presence.join(',') === 'false' && watchValues.join(',') === 'true';
stop(); stopPresence(); stopUser(); value.unsubscribe(id); active.unsubscribe(activeId);
flushSync(() => root.unmount());
const delivery = new Store({items: {
    r0: {title: 'a'}, r1: {title: 'b'}, r2: {title: 'c'},
}, user: {name: 'u'}, branch: {}});
let rowReplacement = 0, parentReplacement = 0, siblingDeliveries = 0;
let phase = 'sibling';
const rowStops = ['r0', 'r1', 'r2'].map(key => delivery.watch(d => d.items[key]?.title, () => {
    if (phase === 'row') rowReplacement++;
    else if (phase === 'parent') parentReplacement++;
    else siblingDeliveries++;
}));
delivery.change(d => { d.items.r0.extra = true; });
phase = 'row';
delivery.change(d => { d.items.r1 = {title: 'new'}; });
phase = 'parent';
delivery.change(d => { d.items = {r0: {title: 'x'}, r1: {title: 'y'}, r2: {title: 'z'}}; });
for (const dispose of rowStops) dispose();
let inDeletion = 0, userReplacement = 0, branchReplacement = 0;
const presenceStop = delivery.watch(d => 'r1' in d.items, () => { inDeletion++; });
const userStop = delivery.watch(d => d.user, () => { userReplacement++; });
const branchValue = computed(read => read(delivery).branch);
const branchId = branchValue.subscribe(() => {});
const branchReads = new Set(delivery.filed.at(-1));
const branchMarkers = [...branchReads].filter(path => path === 'branch.~p').length;
branchValue.unsubscribe(branchId);
const branchWakeId = delivery.subscribe(() => { branchReplacement++; }, {reads: branchReads});
const branchStop = () => delivery.unsubscribe(branchWakeId);
delivery.change(d => { delete d.items.r1; });
delivery.change(d => { d.user = {name: 'new'}; });
delivery.change(d => { d.branch = null; });
for (const dispose of [...rowStops, presenceStop, userStop, branchStop]) dispose();
emit({hookPaths, classPaths, watchPaths, computedPaths, activeCountPaths, presenceMarkers, userMarkers, wakeCorrect,
    rowReplacement, parentReplacement, siblingDeliveries, inDeletion,
    userReplacement, branchReplacement, branchMarkers});
