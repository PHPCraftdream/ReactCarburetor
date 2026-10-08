/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, loadPath, setupReact} from '../../../harness/lib.mjs';

const {AntiHookComponent} = await load();
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {React, flushSync, root, container} = await setupReact();
const count = Number(process.argv[2] ?? 100);
const query = {id: 'settled'};
const absent = {id: 'absent'};
let loaderCalls = 0;
const cache = new ResourceCache(async () => { loaderCalls++; return 'loaded'; }, {ttl: Infinity});
await cache.load(query);
const stringify = JSON.stringify;
let stringifyCalls = 0;
const measure = fn => {
    let calls = 0;
    JSON.stringify = function(value, ...args) {
        if (value === query) calls++;
        return stringify.call(this, value, ...args);
    };
    try { fn(); } finally { JSON.stringify = stringify; }
    return calls;
};
const idleStringifies = measure(() => {});
const controlStringifies = measure(() => cache.keyOf(query));
let renders = 0;
let previousAbsent;
let newAbsentViews = 0;
let measuring = false;
class Reader extends AntiHookComponent {
    render() {
        renders++;
        let view;
        const calls = measure(() => { view = this.useResource(cache, query); });
        const absentView = cache.getEntry(absent);
        if (measuring) {
            stringifyCalls += calls;
            if (absentView !== previousAbsent) newAbsentViews++;
        }
        previousAbsent = absentView;
        return React.createElement('span', null, view.data);
    }
}
flushSync(() => root.render(React.createElement(Reader, {wave: 0})));
measuring = true;
for (let wave = 1; wave <= count; wave++) {
    flushSync(() => root.render(React.createElement(Reader, {wave})));
}
measuring = false;
const before = cache.getEntry(query);
cache.setData({entries: {[cache.keyOf(query)]: {...before, data: 'changed'}}});
const identityControl = Number(before !== cache.getEntry(query));
const text = container.textContent;
const done = renders === count + 1 && loaderCalls === 1 && text === 'loaded'
    && previousAbsent.data === undefined && previousAbsent.stale === true
    && cache.getEntry(query).data === 'changed' && JSON.stringify === stringify;
flushSync(() => root.unmount());
emit({stringifyCalls, newAbsentViews, idleStringifies, controlStringifies, identityControl,
    renders, loaderCalls, text, done});
