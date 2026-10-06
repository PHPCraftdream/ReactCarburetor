/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R13-10: `useCarburetor` keeps one root view per carburetor per component — re-renders that read
// unchanged data reuse the one read proxy through the public hook path instead of allocating a
// fresh tracked view per render, a data change rebuilds it exactly once, and a field no render
// ever read wakes nobody. Args: [renders=200]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const renders = Number(process.argv[2] ?? 200);
const store = new S({count: 0, unread: 0, nest: {deep: 1}});

// Counting seam: every tracked view for this store is built through read().
let readCalls = 0;
const originalRead = store.read;
store.read = function (...args) {
    readCalls++;
    return originalRead.apply(this, args);
};

let renderCount = 0;
let sink = 0;
const seenViews = new WeakSet();
let distinctViews = 0;
class View extends AntiHookComponent {
    /** Reads two fields through the public useCarburetor path. */
    render() {
        renderCount++;
        const view = this.useCarburetor(store);
        if (!seenViews.has(view)) {
            seenViews.add(view);
            distinctViews++;
        }
        sink += view.count + view.nest.deep;
        return React.createElement('span', null, view.count);
    }
}
// A changing prop, so the props gate lets every explicit re-render through.
const render = tick => flushSync(() => root.render(React.createElement(View, {tick})));

render(0);
const mountedRenders = renderCount;
const mountedReadCalls = readCalls;

// Re-renders over unchanged data: the cached root view serves every one.
for (let i = 1; i <= renders; i++) render(i);
const steadyRenders = renderCount - mountedRenders;
const steadyReadCalls = readCalls - mountedReadCalls;
const steadyViews = distinctViews - 1;

// A root replacement re-renders once and rebuilds the view exactly once (a leaf write keeps
// the root object, so the cached view stays valid and only its values change).
flushSync(() => store.setData({...store.getData(), count: 7}));
const changedRenders = renderCount - mountedRenders - steadyRenders;
const changedReadCalls = readCalls - mountedReadCalls - steadyReadCalls;

// A write to a field no render ever read wakes nobody.
flushSync(() => store.run(draft => { draft.unread = 5; }));
const unreadRenders = renderCount - mountedRenders - steadyRenders - changedRenders;

emit({
    steadyRenders, steadyReadCalls, steadyViews,
    changedRenders, changedReadCalls, unreadRenders,
    text: container.textContent, sinkPositive: sink > 0,
});
root.unmount();
