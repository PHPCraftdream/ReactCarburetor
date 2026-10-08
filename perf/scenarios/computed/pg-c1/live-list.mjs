/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R14-01: late title reads amend a live computed without re-subscribing each leaf.
import {emit, load, setupReact} from '../../../harness/lib.mjs';

const count = Number(process.argv[2] ?? 1000);
const {React, flushSync, root, container} = await setupReact();
const {Carburetor, computed} = await load();
const {useComputedValue} = await load('Interop');
const store = new Carburetor({items: Object.fromEntries(
    Array.from({length: count}, (_, index) => [index, {title: `row-${index}`}])
)});
const originalSubscribe = store.subscribe;
const extendKey = typeof store.extend === 'function'
    ? 'extend' : Symbol.for('react-carburetor/v1/subscription-extend');
const originalExtend = store[extendKey];
let subscribeCalls = 0;
let extendCalls = 0;
let renders = 0;
let bodyRuns = 0;
store.subscribe = function (...args) {
    subscribeCalls++;
    return originalSubscribe.apply(this, args);
};
// Pre-JS-R14-01 has no extend API: zero calls is real, not a missing metric.
if (typeof originalExtend === 'function') {
    store[extendKey] = function (...args) {
        extendCalls++;
        return originalExtend.apply(this, args);
    };
}
const rows = computed(read => {
    bodyRuns++;
    return Object.values(read(store).items);
});
function View() {
    renders++;
    const items = useComputedValue(rows);
    return React.createElement('div', null, Object.values(items).map(row => row.title).join('|'));
}
let metrics;
try {
    flushSync(() => root.render(React.createElement(View)));
    const mountSubscribeCalls = subscribeCalls;
    const mountExtendCalls = extendCalls;
    const mountBodyRuns = bodyRuns;
    const mountRenders = renders;
    const mountTextCorrect = container.textContent === Array.from(
        {length: count}, (_, index) => `row-${index}`).join('|');
    subscribeCalls = 0;
    extendCalls = 0;
    bodyRuns = 0;
    renders = 0;
    const start = performance.now();
    flushSync(() => store.update(draft => { draft.items[5].title = 'edited-5'; }));
    metrics = {
        rows: count, subscribeCalls, extendCalls, bodyRuns, renders,
        editMs: performance.now() - start,
        textCorrect: container.textContent === Array.from(
            {length: count}, (_, index) => index === 5 ? 'edited-5' : `row-${index}`).join('|'),
        mountSubscribeCalls, mountExtendCalls, mountBodyRuns, mountRenders, mountTextCorrect,
    };
} finally {
    flushSync(() => root.unmount());
    store.subscribe = originalSubscribe;
    if (typeof originalExtend === 'function') store[extendKey] = originalExtend;
}
emit(metrics);
