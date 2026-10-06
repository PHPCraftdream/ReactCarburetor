/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-01: paths recorded through tracked reads per one-field write under a hook and a watch returning the live list.
// The control disables the write-log enumeration, so the same write must walk the whole selection.
// Args: [rows=10000] [writes=9]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
const PATHS_SINCE = Symbol.for('react-carburetor/v1/store-paths-since');

class Counting extends Carburetor {
    recorded = 0;
    read(record) { return super.read(path => { this.recorded++; record(path); }); }
    run(fn) { this.update(fn); }
}

const rows = Number(process.argv[2] ?? 10000);
const writes = Number(process.argv[3] ?? 9);
const makeData = () => ({items: Array.from({length: rows}, (_, id) => ({id, title: `T${id}`, done: false})), other: 0});
const selectItems = d => d.items;

const hookPerWrite = (store, label) => {
    const List = () => React.createElement('p', null, String(useCarburetorValue(store, selectItems)[3].title));
    flushSync(() => root.render(React.createElement(List)));
    store.recorded = 0;
    for (let i = 0; i < writes; i++) flushSync(() => store.run(d => { d.items[3 + i].title = `${label}${i}`; }));
    const perWrite = store.recorded / writes;
    const text = container.textContent;
    flushSync(() => root.render(null));
    return {perWrite, text};
};

const patched = hookPerWrite(new Counting(makeData()), 'p');
const control = new Counting(makeData());
Object.defineProperty(control, PATHS_SINCE, {value: undefined});
const full = hookPerWrite(control, 'f');

const watched = new Counting(makeData());
let delivered = null;
const stop = watched.watch(selectItems, next => { delivered = next; });
watched.recorded = 0;
for (let i = 0; i < writes; i++) watched.run(d => { d.items[3 + i].title = `w${i}`; });
const watchPerWrite = watched.recorded / writes;
const watchText = delivered[3 + writes - 1].title;
stop();

emit({
    hookReadsPerWrite: patched.perWrite, controlReadsPerWrite: full.perWrite, watchReadsPerWrite: watchPerWrite,
    text: `${patched.text}|${full.text}|${watchText}`,
});
root.unmount();
