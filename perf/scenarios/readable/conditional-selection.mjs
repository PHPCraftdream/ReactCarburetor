/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31 readable split: a six-capability external source drives `useCarburetorValue`; recorded reads
// keep unselected writes silent and unmount releases the subscription. Args: [rounds=32]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {useCarburetorValue} = await load('Interop');
const rounds = Number(process.argv[2] ?? 32);
const {React, flushSync, root, container} = await setupReact();

class ReadableSource {
    constructor(data) {
        this.data = data;
        this.uid = 'r31-readable';
        this.version = 0;
        this.listeners = new Map();
        this.notifications = 0;
        this.nextId = 0;
    }
    getUID() { return this.uid; }
    getVersion() { return this.version; }
    getData() { return this.data; }
    read(record) {
        return new Proxy(this.data, {
            get: (target, key, receiver) => {
                if (typeof key === 'string') record(key);
                return Reflect.get(target, key, receiver);
            },
        });
    }
    subscribe(callback, options = {}) {
        const id = options.id ?? `${this.uid}:${++this.nextId}`;
        this.listeners.set(id, {callback, reads: options.reads === undefined ? undefined : new Set(options.reads)});
        return id;
    }
    unsubscribe(id) { this.listeners.delete(id); }
    replace(data, changedPaths) {
        this.data = data;
        this.version++;
        for (const listener of Array.from(this.listeners.values())) {
            if (listener.reads === undefined || [...listener.reads].some(read => changedPaths.has(read))) {
                this.notifications++;
                listener.callback();
            }
        }
    }
}

const source = new ReadableSource({active: false, primary: 'p0', secondary: 's0'});
let renders = 0;
let evaluations = 0;
let unselectedRenders = 0;
const selectValue = data => {
    evaluations++;
    return data.active ? data.primary : data.secondary;
};
const Consumer = () => {
    renders++;
    return React.createElement('output', null, useCarburetorValue(source, selectValue));
};
const text = () => container.textContent;
flushSync(() => root.render(React.createElement(Consumer)));
const initialText = text();
if (initialText !== 's0') throw new Error(`initial text ${initialText}`);

let secondary = 's0';
for (let index = 1; index <= rounds; index++) {
    flushSync(() => source.replace({active: true, primary: `p${index}`, secondary}, new Set(['active', 'primary'])));
    if (text() !== `p${index}`) throw new Error(`selected round ${index}: ${text()}`);
    const beforeUnselected = renders;
    secondary = `s${index}`;
    flushSync(() => source.replace({active: true, primary: `p${index}`, secondary}, new Set(['secondary'])));
    if (renders !== beforeUnselected) unselectedRenders++;
    flushSync(() => source.replace({active: false, primary: `p${index}`, secondary}, new Set(['active'])));
    if (text() !== secondary) throw new Error(`branch round ${index}: ${text()}`);
    const beforeOther = renders;
    flushSync(() => source.replace({active: false, primary: `p${index}`, secondary}, new Set(['primary'])));
    if (renders !== beforeOther) unselectedRenders++;
}

const finalText = text();
flushSync(() => root.unmount());
emit({
    notifications: source.notifications, renders, evaluations, unselectedRenders,
    listenersLeft: source.listeners.size, initialText, finalText,
});
