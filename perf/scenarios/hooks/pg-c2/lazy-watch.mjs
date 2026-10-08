/* oxlint-disable react/globals, react/immutability, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-10: count hook-owned Set initializers and unchanged watch subscription replacements.
import {emit, load, setupReact} from '../../../harness/lib.mjs';
const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
const store = new Carburetor({count: 1});
const renders = Array(100).fill(0);
const select = data => data.count;
function Reader({id}) {
    renders[id]++;
    return React.createElement('span', null, useCarburetorValue(store, select));
}
const render = tick => flushSync(() => root.render(React.createElement('div', null,
    ...renders.map((_, id) => React.createElement(Reader, {key: id, id, tick})))));
// Match the initializer's immediate frame, not all work transitively called by the hook.
const countInitializers = action => {
    const OriginalSet = globalThis.Set;
    let calls = 0;
    globalThis.Set = class extends OriginalSet {
        constructor(...args) {
            super(...args);
            const frame = new Error().stack.split('\n')[2];
            if (frame.includes('useCarburetorValue')) calls++;
        }
    };
    try { action(); } finally { globalThis.Set = OriginalSet; }
    return calls;
};
const coldInitializers = countInitializers(() => render(0));
const mountOnce = renders.every(value => value === 1);
renders.fill(0);
const warmInitializers = countInitializers(() => render(1));
const warmOnce = renders.every(value => value === 1);
renders.fill(0);
flushSync(() => store.update(draft => { draft.count = 2; }));
const changedOnce = renders.every(value => value === 1);
const changedRenders = renders.reduce((sum, value) => sum + value, 0);
const hookCorrect = container.textContent === '2'.repeat(100);
flushSync(() => root.unmount());
const watchStore = new Carburetor({choice: false, left: 1, right: 1});
const subscribe = watchStore.subscribe.bind(watchStore);
let subscriptions = 0;
watchStore.subscribe = (...args) => { subscriptions++; return subscribe(...args); };
let selectorCalls = 0;
const changes = [];
const stop = watchStore.watch(data => {
    selectorCalls++;
    return (data.choice ? data.right : data.left) > 0;
}, (next, previous) => { changes.push([next, previous]); });
const coldSubscriptions = subscriptions;
subscriptions = selectorCalls = 0;
watchStore.update(draft => { draft.left = 2; });
const unchangedSubscriptions = subscriptions;
const unchangedSelectorCalls = selectorCalls;
const unchangedCallbacks = changes.length;
subscriptions = selectorCalls = 0;
watchStore.update(draft => { draft.choice = true; });
const switchedSubscriptions = subscriptions;
const switchedSelectorCalls = selectorCalls;
selectorCalls = 0;
watchStore.update(draft => { draft.left = 0; });
const obsoleteSelectorCalls = selectorCalls;
watchStore.update(draft => { draft.right = 0; });
const changedCallbacks = changes.length;
const done = hookCorrect && JSON.stringify(changes) === '[[false,true]]' && watchStore.getData().right === 0;
stop();
watchStore.update(draft => { draft.right = 1; });
emit({coldInitializers, warmInitializers, mountOnce, warmOnce, changedOnce, changedRenders,
    coldSubscriptions, unchangedSubscriptions, unchangedSelectorCalls, unchangedCallbacks, switchedSubscriptions,
    switchedSelectorCalls, obsoleteSelectorCalls, changedCallbacks, done: done && changes.length === 1});
