/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31-01 + R31-05 in React: reordered Map/Set selections re-render the hook consumer and the memo
// child with the new order; an equal Invalid Date keeps both quiet. No args.
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {Carburetor, AntiHookComponent} = await load();
const {useCarburetorValue} = await load('Interop');
const {createRoot} = await import('react-dom/client');
const {React, flushSync, root, container} = await setupReact();
if (globalThis.MutationObserver === undefined) {
    Object.defineProperty(globalThis, 'MutationObserver', {configurable: true, value: window.MutationObserver});
}

const state = (map, set) => ({map, set});
const label = selection => `${[...selection.map.keys()][0]}|${[...selection.set][0]}`;

const store = new Carburetor(state(new Map([['a', 1], ['b', 2]]), new Set(['a', 'b'])));
let hookRenders = 0;
const View = () => {
    hookRenders++;
    const selection = useCarburetorValue(store, data => ({map: data.map, set: data.set}));
    return React.createElement('span', null, label(selection));
};
flushSync(() => root.render(React.createElement(View)));
const hookInitialRenders = hookRenders;
const hookInitialText = container.textContent;
if (hookInitialText !== 'a|a') throw new Error(`initial text ${hookInitialText}`);
flushSync(() => store.setData(state(new Map([['a', 1], ['b', 2]]), new Set(['a', 'b']))));
const hookSameOrderRenders = hookRenders;
const hookSameOrderText = container.textContent;
flushSync(() => store.setData(state(new Map([['b', 2], ['a', 1]]), new Set(['b', 'a']))));
const hookReorderRenders = hookRenders;
const hookReorderText = container.textContent;
flushSync(() => root.unmount());

const classStore = new Carburetor(state(new Map([['a', 1], ['b', 2]]), new Set(['a', 'b'])));
let memoRenders = 0;
const MemoNative = React.memo(({selection}) => {
    memoRenders++;
    return React.createElement('span', null, label(selection));
});
const getClassStore = () => classStore;
const selectNative = data => ({map: data.map, set: data.set});
class Parent extends AntiHookComponent {
    constructor(props) {
        super(props);
        this.selected = this.connectSelection(getClassStore, selectNative);
    }
    render() {
        return React.createElement(MemoNative, {selection: this.selected()});
    }
}
const classContainer = document.createElement('div');
document.body.appendChild(classContainer);
const classRoot = createRoot(classContainer);
flushSync(() => classRoot.render(React.createElement(Parent)));
const memoInitialRenders = memoRenders;
flushSync(() => classStore.setData(state(new Map([['a', 1], ['b', 2]]), new Set(['a', 'b']))));
const memoSameOrderRenders = memoRenders;
flushSync(() => classStore.setData(state(new Map([['b', 2], ['a', 1]]), new Set(['b', 'a']))));
const memoReorderRenders = memoRenders;
const memoReorderText = classContainer.textContent;
flushSync(() => classRoot.unmount());

const dateStore = new Carburetor({tick: 0, date: new Date(Number.NaN)});
let dateRenders = 0;
const DateView = () => {
    dateRenders++;
    const selection = useCarburetorValue(dateStore, data => ({tick: data.tick % 2, date: data.date}));
    return React.createElement('span', null, `${selection.tick}:${selection.date.getTime()}`);
};
const dateContainer = document.createElement('div');
document.body.appendChild(dateContainer);
const dateRoot = createRoot(dateContainer);
flushSync(() => dateRoot.render(React.createElement(DateView)));
flushSync(() => dateStore.setData({tick: 2, date: new Date(Number.NaN)}));
const invalidSameRenders = dateRenders;
const invalidSameText = dateContainer.textContent;
flushSync(() => dateStore.setData({tick: 2, date: new Date(0)}));
const invalidToValidRenders = dateRenders;
const invalidToValidText = dateContainer.textContent;
flushSync(() => dateRoot.unmount());

emit({
    hookInitialRenders, hookInitialText, hookSameOrderRenders, hookSameOrderText, hookReorderRenders, hookReorderText,
    memoInitialRenders, memoSameOrderRenders, memoReorderRenders, memoReorderText,
    invalidSameRenders, invalidSameText, invalidToValidRenders, invalidToValidText,
});
